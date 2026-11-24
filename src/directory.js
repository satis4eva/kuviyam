'use strict';
/*
 * Directory: Tamil organisations and community events gathered from public sources.
 * These are NOT Kuviyam partners: they have not applied, are not checked, and no money is collected for them.
 *   Admin > Directory   private outreach list with every contact detail, a status (new, contacted,
 *                       invited, joined, declined), notes, and an Invite email.
 *   /directory          public list, clearly labelled, showing only organisation-level details
 *                       (name, type, area, website, public email): never phone numbers.
 *   /events             a "Happening in the community" section of the dated public events.
 * Lists come in through Admin > Directory > Import as .xlsx files (Organisations and Upcoming Events
 * sheets), so contact details never go into the code repository. Importing again updates details and
 * keeps each organisation's status and notes.
 */
const { nowIso, clean } = require('./util');
const { readXlsx, excelDate } = require('./xlsx');
const { audit } = require('./db');
const { COUNTRIES } = require('./i18n');

const STATUSES = ['new', 'contacted', 'invited', 'joined', 'declined'];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9஀-௿]+/g, ' ').trim();
const pick = (headers, ...names) => { for (const n of names) { const i = headers.findIndex((h) => norm(h).startsWith(norm(n))); if (i >= 0) return i; } return -1; };
const webUrl = (v) => { const s = String(v || '').trim(); if (!s) return null; try { const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); return /^https?:$/.test(u.protocol) ? u.href.slice(0, 300) : null; } catch { return null; } };
const firstEmail = (v) => (String(v || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0] || null;

/** Turn one workbook into organisations and events. */
function parseWorkbook(buf, country) {
  const sheets = readXlsx(buf);
  const find = (re) => Object.entries(sheets).find(([n]) => re.test(n));
  const orgs = []; const events = [];
  const os = find(/organi[sz]ation/i) || Object.entries(sheets)[0];
  if (os) {
    const [hdr, ...rows] = os[1]; const H = hdr.map((x) => String(x || ''));
    const c = { name: pick(H, 'organisation', 'organization', 'name'), type: pick(H, 'type'), area: pick(H, 'district', 'area', 'town', 'city'), address: pick(H, 'address'),
      email: pick(H, 'public email', 'email'), phone: pick(H, 'public phone', 'phone'), website: pick(H, 'website', 'web'), reg: pick(H, 'charity number', 'registration'),
      activity: pick(H, 'upcoming event'), notes: pick(H, 'contact', 'notes'), source: pick(H, 'source'), verification: pick(H, 'verification') };
    const get = (r, k) => (c[k] >= 0 && r[c[k]] != null ? String(r[c[k]]) : null);
    for (const r of rows) {
      const name = clean(get(r, 'name'), 200); if (!name) continue;
      const o = { name, type: clean(get(r, 'type'), 120), area: clean(get(r, 'area'), 160), address: clean(get(r, 'address'), 300), email: firstEmail(get(r, 'email')),
        phone: clean(get(r, 'phone'), 200), website: webUrl(get(r, 'website')), reg_no: clean(get(r, 'reg'), 200), activity: clean(get(r, 'activity'), 300),
        notes: clean(get(r, 'notes'), 600), source_url: webUrl(get(r, 'source')), verification: clean(get(r, 'verification'), 400) };
      // Hidden from the public list: umbrella "category leads" that are not one organisation. Admins can change it.
      const lead = /category lead|umbrella|not entered as a single|multiple independent groups/i.test(`${o.verification} ${o.notes}`);
      o.is_public = lead ? 0 : 1;
      orgs.push(o);
    }
  }
  const es = find(/event/i);
  if (es) {
    const [hdr, ...rows] = es[1]; const H = hdr.map((x) => String(x || ''));
    const c = { date: pick(H, 'date'), title: pick(H, 'event', 'title'), organiser: pick(H, 'organiser', 'organizer'), category: pick(H, 'category'), venue: pick(H, 'venue'),
      area: pick(H, 'venue address', 'district', 'area'), contact: pick(H, 'public contact', 'contact'), url: pick(H, 'listing', 'url', 'link'), notes: pick(H, 'status', 'notes') };
    const get = (r, k) => (c[k] >= 0 && r[c[k]] != null ? r[c[k]] : null);
    for (const r of rows) {
      const title = clean(String(get(r, 'title') || ''), 200); if (!title) continue;
      const d = get(r, 'date'); let onDate = null; let dateText = null;
      if (typeof d === 'number') onDate = excelDate(d);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '').trim())) onDate = String(d).trim();
      else dateText = clean(String(d || ''), 120) || null;
      const organiser = clean(String(get(r, 'organiser') || ''), 200);
      events.push({ on_date: onDate, date_text: dateText, title, organiser: /not (specified|stated)/i.test(organiser) ? null : organiser || null, category: clean(String(get(r, 'category') || ''), 80),
        venue: clean(String(get(r, 'venue') || ''), 200), area: clean(String(get(r, 'area') || ''), 200), contact: clean(String(get(r, 'contact') || ''), 200),
        url: webUrl(get(r, 'url')), notes: clean(String(get(r, 'notes') || ''), 400) });
    }
  }
  return { orgs: orgs.map((o) => ({ ...o, country })), events: events.map((e) => ({ ...e, country })) };
}

function registerDirectory(route, H) {
  const { db, page, redirect, requireAdmin, tx, HttpError } = H;
  const D = () => require('./views/directory');

  function importData(data) {
    const now = nowIso(); const n = { added: 0, updated: 0, events: 0 };
    tx(() => {
      for (const o of data.orgs) {
        const key = `${norm(o.country)}|${norm(o.name)}`;
        const had = db.prepare('SELECT id FROM directory_orgs WHERE key = ?').get(key);
        if (had) {
          db.prepare(`UPDATE directory_orgs SET name=?, type=?, area=?, address=?, email=?, phone=?, website=?, reg_no=?, activity=?, notes=?, source_url=?, verification=?, updated_at=? WHERE id=?`)
            .run(o.name, o.type, o.area, o.address, o.email, o.phone, o.website, o.reg_no, o.activity, o.notes, o.source_url, o.verification, now, had.id); n.updated++;
        } else {
          db.prepare(`INSERT INTO directory_orgs (key, name, type, country, area, address, email, phone, website, reg_no, activity, notes, source_url, verification, is_public, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key, o.name, o.type, o.country, o.area, o.address, o.email, o.phone, o.website, o.reg_no, o.activity, o.notes, o.source_url, o.verification, o.is_public, now, now); n.added++;
        }
      }
      for (const e of data.events) {
        const key = `${norm(e.country)}|${e.on_date || norm(e.date_text)}|${norm(e.title)}|${norm(e.venue)}`;
        db.prepare(`INSERT INTO directory_events (key, on_date, date_text, title, organiser, category, venue, area, country, contact, url, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET organiser=excluded.organiser, category=excluded.category, area=excluded.area,
          contact=excluded.contact, url=excluded.url, notes=excluded.notes, updated_at=excluded.updated_at`)
          .run(key, e.on_date, e.date_text, e.title, e.organiser, e.category, e.venue, e.area, e.country, e.contact, e.url, e.notes, now, now); n.events++;
      }
    });
    return n;
  }
  H.directoryEvents = () => db.prepare(`SELECT * FROM directory_events WHERE is_public = 1 AND (on_date >= date('now') OR (on_date IS NULL AND date_text IS NOT NULL)) ORDER BY on_date IS NULL, on_date, title LIMIT 60`).all();

  /* ---------------- admin ---------------- */
  route('GET', '/admin/directory', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const q = ctx.query; const f = { q: clean(q.get('q'), 80), country: clean(q.get('country'), 60), status: STATUSES.includes(q.get('status')) ? q.get('status') : '' };
    const where = []; const args = [];
    if (f.q) { where.push('(name LIKE ? OR area LIKE ? OR type LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
    if (f.country) { where.push('country = ?'); args.push(f.country); }
    if (f.status) { where.push('status = ?'); args.push(f.status); }
    const list = db.prepare(`SELECT * FROM directory_orgs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY country, name LIMIT 400`).all(...args);
    const totals = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM directory_orgs GROUP BY status').all().map((r) => [r.status, r.n]));
    const countries = db.prepare('SELECT country, COUNT(*) n FROM directory_orgs GROUP BY country ORDER BY n DESC').all();
    const events = db.prepare('SELECT * FROM directory_events ORDER BY on_date IS NULL, on_date, title').all();
    page(ctx, { title: ctx.t('tDirectory'), active: 'admin', body: D().admin(ctx, { list, totals, countries, events, f, statuses: STATUSES, allCountries: COUNTRIES }) });
  });
  route('POST', '/admin/directory/import', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const country = COUNTRIES.includes(ctx.body.country) ? ctx.body.country : null;
    const file = (ctx.files || []).find((x) => x.field === 'file' && x.data.length);
    if (!country || !file) return redirect(ctx, '/admin/directory', { kind: 'bad', msg: ctx.t('dirImportNeed') });
    let data;
    try { data = parseWorkbook(file.data, country); } catch { return redirect(ctx, '/admin/directory', { kind: 'bad', msg: ctx.t('dirImportBad') }); }
    if (!data.orgs.length && !data.events.length) return redirect(ctx, '/admin/directory', { kind: 'bad', msg: ctx.t('dirImportEmpty') });
    const n = importData(data);
    audit(db, ctx.user.id, 'directory-import', `${country}: +${n.added} orgs, ${n.updated} updated, ${n.events} events`);
    redirect(ctx, `/admin/directory?country=${encodeURIComponent(country)}`, { kind: 'good', msg: ctx.t('dirImported', { a: n.added, u: n.updated, e: n.events, c: ctx.t(country) === country ? country : country }) });
  });
  const dirOrg = (id) => { const o = db.prepare('SELECT * FROM directory_orgs WHERE id = ?').get(Number(id)); if (!o) throw new HttpError(404); return o; };
  route('POST', '/admin/directory/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const o = dirOrg(ctx.params.id); const b = ctx.body;
    const status = STATUSES.includes(b.status) ? b.status : o.status;
    db.prepare('UPDATE directory_orgs SET status = ?, admin_note = ?, is_public = ?, updated_at = ? WHERE id = ?')
      .run(status, clean(b.admin_note, 600) || null, b.is_public === '1' ? 1 : 0, nowIso(), o.id);
    redirect(ctx, H.back(ctx, '/admin/directory') + `#d${o.id}`);
  });
  // Invitation email: "join Kuviyam as a partner". Marks the organisation as invited.
  route('POST', '/admin/directory/:id/invite', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const o = dirOrg(ctx.params.id);
    if (!o.email) return redirect(ctx, H.back(ctx, '/admin/directory'), { kind: 'bad', msg: ctx.t('dirNoEmail') });
    H.outbox.enqueue('directory_invite', o.email, { orgId: null, payload: { name: o.name, by: ctx.user.name } });
    db.prepare(`UPDATE directory_orgs SET status = 'invited', invited_at = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), o.id);
    audit(db, ctx.user.id, 'directory-invite', `#${o.id} ${o.email}`);
    redirect(ctx, H.back(ctx, '/admin/directory') + `#d${o.id}`, { kind: 'good', msg: ctx.t('dirInvited', { n: o.name }) });
  });
  route('POST', '/admin/directory/events/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const e = db.prepare('SELECT id FROM directory_events WHERE id = ?').get(Number(ctx.params.id)); if (!e) throw new HttpError(404);
    if (ctx.body.delete === '1') db.prepare('DELETE FROM directory_events WHERE id = ?').run(e.id);
    else db.prepare('UPDATE directory_events SET is_public = ?, updated_at = ? WHERE id = ?').run(ctx.body.is_public === '1' ? 1 : 0, nowIso(), e.id);
    redirect(ctx, '/admin/directory#events');
  });

  /* ---------------- public ---------------- */
  route('GET', '/directory', (ctx) => {
    const q = ctx.query; const f = { q: clean(q.get('q'), 80), country: clean(q.get('country'), 60) };
    const where = ['is_public = 1']; const args = [];
    if (f.q) { where.push('(name LIKE ? OR area LIKE ? OR type LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
    if (f.country) { where.push('country = ?'); args.push(f.country); }
    const list = db.prepare(`SELECT id, name, type, country, area, website, email, status FROM directory_orgs WHERE ${where.join(' AND ')} ORDER BY name LIMIT 500`).all(...args);
    const countries = db.prepare('SELECT country, COUNT(*) n FROM directory_orgs WHERE is_public = 1 GROUP BY country ORDER BY n DESC').all();
    page(ctx, { title: ctx.t('dirH'), active: 'community', body: D().publicList(ctx, { list, countries, f }) });
  });
}

module.exports = { registerDirectory, parseWorkbook };
