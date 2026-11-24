'use strict';
/*
 * Paid event tickets. Money for tickets goes through the platform's own gateway (TICKET_PAYMENT_PROVIDER),
 * kept apart from donations (which go to Kuviyam's gateway). Each order records, at the moment of sale:
 *   gross      what the buyer paid
 *   commission the platform's share, at the rate set in Admin > Tickets
 *   net        what the organiser is owed
 * Admins pay organisers from the platform account and record each payout here, so every order is either
 * waiting to be paid out or tied to a payout with its bank reference.
 */
const { nowIso, clean, ref, toPence, isEmail } = require('./util');
const { provider } = require('./payments');
const { audit } = require('./db');
const auth = require('./auth');

const DEFAULT_BPS = 500; // 5.00%
const MAX_QTY = 10;

function registerTickets(route, H) {
  const { db, page, redirect, requireUser, requireAdmin, partnerOrg, tx, HttpError } = H;
  const T = () => require('./views/tickets');

  const commissionBps = () => { const r = db.prepare(`SELECT value FROM settings WHERE key = 'ticket_commission_bps'`).get(); const n = r ? Number(r.value) : DEFAULT_BPS; return n >= 0 && n <= 5000 ? n : DEFAULT_BPS; };
  H.commissionBps = commissionBps;
  const sold = (eventId) => db.prepare(`SELECT COALESCE(SUM(qty),0) n FROM ticket_orders WHERE event_id = ? AND status = 'paid'`).get(eventId).n;
  H.ticketsSold = sold;
  const paidEvent = (id) => {
    const e = db.prepare(`SELECT e.*, o.name AS org_name, o.name_ta AS org_name_ta, o.slug AS org_slug FROM events e JOIN orgs o ON o.id = e.org_id WHERE e.id = ? AND e.status = 'live' AND o.status = 'verified'`).get(Number(id));
    if (!e || !(e.price_pence > 0)) throw new HttpError(404);
    return e;
  };
  const left = (e) => (e.capacity ? Math.max(0, e.capacity - sold(e.id)) : null);
  H.ticketsFor = (eventId, userId) => db.prepare(`SELECT ref, qty FROM ticket_orders WHERE event_id = ? AND user_id = ? AND status = 'paid' ORDER BY id`).all(eventId, userId);

  route('GET', '/events/:id/tickets', (ctx) => {
    if (!requireUser(ctx)) return;
    const e = paidEvent(ctx.params.id);
    page(ctx, { title: ctx.t('buyTickets'), active: 'community', body: T().buy(ctx, { event: e, left: left(e), max: MAX_QTY }) });
  });
  route('POST', '/events/:id/tickets', (ctx) => {
    if (!requireUser(ctx)) return;
    const e = paidEvent(ctx.params.id);
    const qty = Math.floor(Number(ctx.body.qty));
    const name = clean(ctx.body.name, 120) || ctx.user.name; const email = clean(ctx.body.email, 200).toLowerCase() || ctx.user.email;
    const errs = [];
    if (!(qty >= 1 && qty <= MAX_QTY)) errs.push(ctx.t('errQty', { n: MAX_QTY }));
    const l = left(e); if (l !== null && qty > l) errs.push(l ? ctx.t('errFewLeft', { n: l }) : ctx.t('soldOut'));
    if (!isEmail(email)) errs.push(ctx.t('errEmail'));
    if (auth.throttled('tickets:' + ctx.user.id, 20, 60 * 60 * 1000)) errs.push(ctx.t('errThrottle'));
    if (errs.length) return page(ctx, { active: 'community', body: T().buy(ctx, { event: e, left: l, max: MAX_QTY, errors: errs, values: { qty, name, email } }) }, 400);
    const bps = commissionBps(); const gross = e.price_pence * qty;
    const commission = Math.round(gross * bps / 10000);
    const pv = provider('tickets'); const r = ref('KT');
    db.prepare(`INSERT INTO ticket_orders (ref, event_id, org_id, user_id, qty, unit_pence, gross_pence, commission_bps, commission_pence, net_pence, status, provider, buyer_name, buyer_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`).run(r, e.id, e.org_id, ctx.user.id, qty, e.price_pence, gross, bps, commission, gross - commission, pv.name, name, email, nowIso());
    redirect(ctx, pv.start({ ref: r, amount_pence: gross, purpose: 'tickets' }).redirect.replace(/^\/pay\//, '/tickets/pay/'));
  });
  const orderByRef = (ctx, r) => { const o = db.prepare('SELECT * FROM ticket_orders WHERE ref = ?').get(String(r)); if (!o || !ctx.user || o.user_id !== ctx.user.id) throw new HttpError(404); return o; };
  route('GET', '/tickets/pay/:ref', (ctx) => {
    if (!requireUser(ctx)) return;
    const o = orderByRef(ctx, ctx.params.ref);
    if (o.status === 'paid') return redirect(ctx, `/tickets/${o.ref}`);
    const e = db.prepare('SELECT * FROM events WHERE id = ?').get(o.event_id);
    page(ctx, { title: ctx.t('payment'), body: T().pay(ctx, { order: o, event: e, testMode: provider('tickets').testMode }) });
  });
  route('POST', '/tickets/pay/:ref', (ctx) => {
    if (!requireUser(ctx)) return;
    const o = orderByRef(ctx, ctx.params.ref);
    if (o.status === 'paid') return redirect(ctx, `/tickets/${o.ref}`);
    const e = db.prepare('SELECT * FROM events WHERE id = ?').get(o.event_id);
    if (e.capacity && sold(e.id) + o.qty > e.capacity) { db.prepare(`UPDATE ticket_orders SET status = 'failed' WHERE id = ?`).run(o.id); return redirect(ctx, `/events/${e.id}`, { kind: 'bad', msg: ctx.t('soldOut') }); }
    const result = provider('tickets').confirm(o, ctx.req);
    if (!result.ok) { db.prepare(`UPDATE ticket_orders SET status = 'failed' WHERE id = ?`).run(o.id); return redirect(ctx, `/tickets/pay/${o.ref}`, { kind: 'bad', msg: ctx.t('payFailed') }); }
    tx(() => {
      const upd = db.prepare(`UPDATE ticket_orders SET status = 'paid', provider_ref = ?, paid_at = ? WHERE id = ? AND status = 'pending'`).run(result.providerRef, nowIso(), o.id);
      if (upd.changes !== 1) return;
      // A ticket counts as "going": the buyer gets the joining link (if any), reminders, and the host sees them.
      const had = db.prepare('SELECT tickets FROM rsvps WHERE event_id = ? AND user_id = ?').get(e.id, ctx.user.id);
      if (had) db.prepare('UPDATE rsvps SET tickets = tickets + ? WHERE event_id = ? AND user_id = ?').run(o.qty, e.id, ctx.user.id);
      else {
        db.prepare('INSERT INTO rsvps (event_id, user_id, created_at, tickets) VALUES (?, ?, ?, ?)').run(e.id, ctx.user.id, nowIso(), o.qty);
        db.prepare('UPDATE events SET going = going + 1 WHERE id = ?').run(e.id);
        for (const m of db.prepare('SELECT user_id FROM org_members WHERE org_id = ?').all(e.org_id)) H.notify(m.user_id, ctx.user.id, 'rsvp', e.id);
      }
      if (H.outbox) {
        H.outbox.enqueue('ticket_confirm', o.buyer_email, { userId: ctx.user.id, eventId: e.id, orgId: e.org_id, payload: { ref: o.ref } });
        if (!had) H.outbox.onRsvp(e, ctx.user, { confirm: false });
      }
      audit(db, ctx.user.id, 'tickets-paid', `${o.ref} x${o.qty}`);
    });
    redirect(ctx, `/tickets/${o.ref}`);
  });
  route('GET', '/tickets/:ref', (ctx) => {
    if (!requireUser(ctx)) return;
    const o = orderByRef(ctx, ctx.params.ref); if (o.status !== 'paid') throw new HttpError(404);
    const e = db.prepare(`SELECT e.*, o.name AS org_name, o.name_ta AS org_name_ta FROM events e JOIN orgs o ON o.id = e.org_id WHERE e.id = ?`).get(o.event_id);
    page(ctx, { title: ctx.t('yourTickets'), body: T().ticket(ctx, { order: o, event: e }) });
  });

  /* ---------------- partner: sales and what they are owed ---------------- */
  H.eventSales = (eventId) => db.prepare(`SELECT COUNT(*) orders, COALESCE(SUM(qty),0) tickets, COALESCE(SUM(gross_pence),0) gross, COALESCE(SUM(commission_pence),0) commission, COALESCE(SUM(net_pence),0) net,
      COALESCE(SUM(CASE WHEN payout_id IS NULL THEN net_pence ELSE 0 END),0) owed FROM ticket_orders WHERE event_id = ? AND status = 'paid'`).get(eventId);
  route('GET', '/dashboard/payouts', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    const events = db.prepare(`SELECT e.id, e.title, e.title_ta, e.starts_on, COALESCE(SUM(t.qty),0) tickets, COALESCE(SUM(t.gross_pence),0) gross, COALESCE(SUM(t.commission_pence),0) commission, COALESCE(SUM(t.net_pence),0) net,
      COALESCE(SUM(CASE WHEN t.payout_id IS NULL THEN t.net_pence ELSE 0 END),0) owed FROM events e JOIN ticket_orders t ON t.event_id = e.id AND t.status = 'paid' WHERE e.org_id = ? GROUP BY e.id ORDER BY e.starts_on DESC`).all(o.id);
    const payouts = db.prepare('SELECT * FROM payouts WHERE org_id = ? ORDER BY id DESC').all(o.id);
    page(ctx, { title: ctx.t('tPayouts'), active: 'dashboard', body: T().partnerPayouts(ctx, { org: o, events, payouts }) });
  });

  /* ---------------- admin: commission and payouts ---------------- */
  route('GET', '/admin/tickets', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const orgs = db.prepare(`SELECT o.id, o.name, o.contact_email, COUNT(t.id) orders, COALESCE(SUM(t.gross_pence),0) gross, COALESCE(SUM(t.commission_pence),0) commission,
      COALESCE(SUM(CASE WHEN t.payout_id IS NULL THEN t.net_pence ELSE 0 END),0) owed, COALESCE(SUM(CASE WHEN t.payout_id IS NULL THEN 1 ELSE 0 END),0) unpaid_orders
      FROM ticket_orders t JOIN orgs o ON o.id = t.org_id WHERE t.status = 'paid' GROUP BY o.id ORDER BY owed DESC, o.name`).all();
    const recent = db.prepare(`SELECT t.*, e.title, o.name AS org_name FROM ticket_orders t JOIN events e ON e.id = t.event_id JOIN orgs o ON o.id = t.org_id WHERE t.status = 'paid' ORDER BY t.id DESC LIMIT 50`).all();
    const payouts = db.prepare(`SELECT p.*, o.name AS org_name FROM payouts p JOIN orgs o ON o.id = p.org_id ORDER BY p.id DESC LIMIT 30`).all();
    page(ctx, { title: ctx.t('tTickets'), active: 'admin', body: T().admin(ctx, { bps: commissionBps(), orgs, recent, payouts, provider: provider('tickets') }) });
  });
  route('POST', '/admin/tickets/commission', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const pct = Number(String(ctx.body.percent || '').replace(/[^0-9.]/g, ''));
    if (!(pct >= 0 && pct <= 50)) return redirect(ctx, '/admin/tickets', { kind: 'bad', msg: ctx.t('errCommission') });
    const bps = Math.round(pct * 100);
    db.prepare(`INSERT INTO settings (key, value) VALUES ('ticket_commission_bps', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(bps));
    audit(db, ctx.user.id, 'commission', `${bps} bps`);
    redirect(ctx, '/admin/tickets', { kind: 'good', msg: ctx.t('commissionSaved', { p: (bps / 100).toFixed(2).replace(/\.00$/, '') }) });
  });
  // Record that the organiser has been paid everything owed so far (after the bank transfer is made).
  route('POST', '/admin/tickets/payout/:orgId', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const orgId = Number(ctx.params.orgId);
    const reference = clean(ctx.body.reference, 120);
    if (!reference) return redirect(ctx, '/admin/tickets', { kind: 'bad', msg: ctx.t('errPayoutRef') });
    const due = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(net_pence),0) s FROM ticket_orders WHERE org_id = ? AND status = 'paid' AND payout_id IS NULL`).get(orgId);
    const expected = toPence(ctx.body.amount);
    if (!due.n) return redirect(ctx, '/admin/tickets', { kind: 'bad', msg: ctx.t('nothingOwed') });
    if (expected !== due.s) return redirect(ctx, '/admin/tickets', { kind: 'bad', msg: ctx.t('errPayoutChanged') });
    tx(() => {
      const id = Number(db.prepare('INSERT INTO payouts (org_id, amount_pence, orders, reference, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(orgId, due.s, due.n, reference, clean(ctx.body.note, 300) || null, ctx.user.id, nowIso()).lastInsertRowid);
      db.prepare(`UPDATE ticket_orders SET payout_id = ? WHERE org_id = ? AND status = 'paid' AND payout_id IS NULL`).run(id, orgId);
      audit(db, ctx.user.id, 'payout', `org #${orgId} ${due.s}p ref ${reference}`);
    });
    redirect(ctx, '/admin/tickets', { kind: 'good', msg: ctx.t('payoutRecorded') });
  });
}

module.exports = { registerTickets, DEFAULT_BPS };
