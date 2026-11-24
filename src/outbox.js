'use strict';
/*
 * Email outbox. Emails are queued in the database and sent by a small worker every 30 seconds, so a slow mail
 * server never holds up a page, failed sends are retried, and reminders can wait until their time.
 * The email text is written at send time from the live event, so a changed joining link or time is always current.
 * Hostinger may run two copies of the app: each email is claimed by one of them before sending.
 */
const mail = require('./mail');
const ET = require('./eventtime');
const { nowIso } = require('./util');

const MAX_ATTEMPTS = 5;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const tEn = (k, v) => ({ zoneTime: `(${v && v.z} time)` }[k] || k);

/** One simple, readable layout for every email: heading, short lines, one big button, Tamil line, footer. */
function layout({ heading, headingTa, lines, button, after = [], footer }) {
  const text = [heading, headingTa, '', ...lines.map((l) => l.replace(/<[^>]+>/g, '')), button ? `\n${button.label}: ${button.url}` : '', ...after.map((l) => l.replace(/<[^>]+>/g, '')), '', footer, base()].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#F8FAF9;font-family:Arial,Helvetica,sans-serif;color:#13232B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAF9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #DFE6E3;border-radius:14px">
<tr><td style="padding:22px 26px 6px"><div style="font-weight:bold;color:#0D6B5B;font-size:18px">Kuviyam · குவியம்</div></td></tr>
<tr><td style="padding:6px 26px 0"><h1 style="font-size:22px;margin:8px 0 2px">${esc(heading)}</h1>${headingTa ? `<div style="color:#5A6B72;font-size:15px">${esc(headingTa)}</div>` : ''}</td></tr>
<tr><td style="padding:12px 26px;font-size:16px;line-height:1.55">${lines.map((l) => `<p style="margin:0 0 10px">${l}</p>`).join('')}
${button ? `<p style="margin:18px 0"><a href="${esc(button.url)}" style="background:${button.color || '#0D6B5B'};color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:bold;display:inline-block;font-size:16px">${esc(button.label)}</a></p>` : ''}
${after.map((l) => `<p style="margin:0 0 10px">${l}</p>`).join('')}</td></tr>
<tr><td style="padding:14px 26px 22px;border-top:1px solid #DFE6E3;color:#5A6B72;font-size:13px">${esc(footer)}<br><a href="${base()}" style="color:#0D6B5B">${base().replace(/^https?:\/\//, '')}</a> · Registered charity 1215402</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

function createOutbox(db) {
  const enqueue = (kind, toEmail, { userId = null, eventId = null, orgId = null, payload = null, at = new Date() } = {}) =>
    db.prepare('INSERT INTO outbox (kind, to_email, user_id, event_id, org_id, payload, send_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(kind, toEmail, userId, eventId, orgId, payload ? JSON.stringify(payload) : null, at.toISOString(), nowIso());

  const eventById = (id) => db.prepare(`SELECT e.*, o.name AS org_name, o.slug AS org_slug, o.status AS org_status FROM events e JOIN orgs o ON o.id = e.org_id WHERE e.id = ?`).get(id);
  const going = (eventId, userId) => !!db.prepare('SELECT 1 FROM rsvps WHERE event_id = ? AND user_id = ?').get(eventId, userId);

  /** Queue the confirmation now and the two reminders for later. Called when someone presses I'm going. */
  function onRsvp(event, user, { confirm = true } = {}) {
    const w = ET.window(event); const now = Date.now();
    if (confirm) enqueue('rsvp_confirm', user.email, { userId: user.id, eventId: event.id });
    const dayBefore = new Date(w.start.getTime() - 24 * 3600e3);
    if (dayBefore.getTime() > now + 30 * 60e3) enqueue('reminder_day', user.email, { userId: user.id, eventId: event.id, at: dayBefore });
    if (w.hasTime) { const hourBefore = new Date(w.start.getTime() - 3600e3); if (hourBefore.getTime() > now) enqueue('reminder_hour', user.email, { userId: user.id, eventId: event.id, at: hourBefore }); }
  }
  /** Someone changed their mind: drop the emails not yet sent. */
  function onUnRsvp(eventId, userId) {
    db.prepare(`UPDATE outbox SET status = 'skipped', last_error = 'not going any more' WHERE event_id = ? AND user_id = ? AND status = 'queued' AND kind IN ('rsvp_confirm','reminder_day','reminder_hour')`).run(eventId, userId);
  }

  /** Writes the email for one outbox row; returns null if it should no longer be sent. */
  function render(row) {
    const p = row.payload ? JSON.parse(row.payload) : {};
    if (row.kind === 'test') {
      return { subject: 'Kuviyam test email', ...layout({ heading: 'Email is working', headingTa: 'மின்னஞ்சல் செயல்படுகிறது', lines: ['This test was sent from Admin → Emails.'], footer: 'Sent to an admin of Kuviyam.' }) };
    }
    if (row.kind === 'directory_invite') {
      return { subject: `An invitation to join Kuviyam`, ...layout({ heading: `${p.name}: join Kuviyam as a partner`, headingTa: 'குவியத்தில் பங்காளராக இணைய அழைப்பு',
        lines: ['Kuviyam is a platform for Tamil charities and community groups worldwide to raise money for projects in Sri Lanka, share news and events, and show every rupee spent with receipts.',
          'We found your organisation in public listings and would love to have you. Joining is free: apply online, and once we have checked your details you can list projects, sponsor students, post events and updates.'],
        button: { label: 'Apply to join', url: `${base()}/join` }, after: ['If this is not the right address, or you would rather not hear from us, just reply and tell us.'],
        footer: `Sent by ${p.by || 'the Kuviyam team'} on behalf of Kuviyam.` }) };
    }
    if (row.kind === 'partner_digest') {
      const lines = p.events.map((e) => `<b>${esc(e.title)}</b> (${esc(fmtDate(e.starts_on))}): ${e.added} new, ${e.going} going in total.<br><span style="color:#5A6B72">${esc(e.names.join(', '))}${e.more ? ` and ${e.more} more` : ''}</span>`);
      return { subject: `New RSVPs for ${p.orgName}`, ...layout({ heading: 'New people going to your events', headingTa: 'உங்கள் நிகழ்வுகளுக்கு புதிதாக வருபவர்கள்', lines,
        button: { label: 'See who is going', url: `${base()}/dashboard/events` }, footer: `You get this daily summary because you manage ${p.orgName} on Kuviyam.` }) };
    }
    const e = eventById(row.event_id);
    if (!e || e.status !== 'live' || e.org_status !== 'verified') return null;
    const w = ET.window(e);
    if (row.kind !== 'event_msg' && (!going(e.id, row.user_id) || Date.now() > w.end.getTime())) return null;
    const when = `${fmtDate(e.starts_on)}${e.start_time ? ', ' + ET.timeLabel(e, tEn, 'en') : ''}`;
    const where = e.mode === 'online' ? 'Online' : e.place;
    const eventUrl = `${base()}/events/${e.id}`;
    const details = [`<b>When:</b> ${esc(when)}`, `<b>Where:</b> ${esc(where)}`, `<b>Hosted by:</b> ${esc(e.org_name)}`];
    const join = e.join_url ? { label: 'Join the event', url: e.join_url, color: '#1F5FA0' } : { label: 'Open the event page', url: eventUrl };
    const calendar = `<a href="${eventUrl}/calendar.ics" style="color:#0D6B5B">Add to your calendar</a>`;
    if (row.kind === 'rsvp_confirm') {
      return { subject: `You're going: ${e.title}`, ...layout({ heading: `You're going to ${e.title}`, headingTa: 'நீங்கள் வருகிறீர்கள்', lines: details,
        button: join, after: [calendar, e.join_url ? 'Keep this email: the button above is your joining link. We will also remind you before it starts.' : 'We will remind you the day before.'],
        footer: 'You get this because you pressed "I\'m going" on Kuviyam. Changed your mind? Open the event page and press the button again.' }) };
    }
    if (row.kind === 'reminder_day' || row.kind === 'reminder_hour') {
      const soon = row.kind === 'reminder_hour';
      return { subject: `${soon ? 'Starting in 1 hour' : 'Tomorrow'}: ${e.title}`, ...layout({ heading: soon ? `${e.title} starts in 1 hour` : `${e.title} is tomorrow`,
        headingTa: soon ? 'ஒரு மணி நேரத்தில் தொடங்குகிறது' : 'நாளை நடைபெறுகிறது', lines: details, button: join, after: [calendar],
        footer: 'You get this because you are going to this event on Kuviyam.' }) };
    }
    if (row.kind === 'ticket_confirm') {
      const o = db.prepare('SELECT * FROM ticket_orders WHERE ref = ?').get(p.ref);
      if (!o || o.status !== 'paid') return null;
      const money = (x) => '£' + (x / 100).toFixed(2).replace(/\.00$/, '');
      return { subject: `Your tickets: ${e.title}`, ...layout({ heading: `Your ${o.qty === 1 ? 'ticket' : o.qty + ' tickets'} for ${e.title}`, headingTa: 'உங்கள் நுழைவுச்சீட்டுகள்',
        lines: [`<b>Ticket number:</b> ${esc(o.ref)}`, `<b>Tickets:</b> ${o.qty} × ${money(o.unit_pence)} = <b>${money(o.gross_pence)}</b>`, ...details],
        button: e.join_url ? join : { label: 'View your tickets', url: `${base()}/tickets/${o.ref}` }, after: [calendar, 'Show this email or your ticket number at the door. We will remind you before it starts.'],
        footer: `Paid to the Kuviyam events platform on behalf of ${e.org_name}. Questions about the event or refunds: contact the organiser.` }) };
    }
    if (row.kind === 'event_msg') {
      if (!going(e.id, row.user_id)) return null;
      return { subject: `Message about ${e.title}`, ...layout({ heading: `${e.org_name}: ${e.title}`, headingTa: 'நிகழ்வு பற்றிய செய்தி', lines: [esc(p.text).replace(/\n/g, '<br>'), ...details],
        button: join, footer: 'You get this because you are going to this event on Kuviyam.' }) };
    }
    return null;
  }

  async function sendOne(row) {
    let m;
    try { m = render(row); } catch (err) { m = null; console.error('outbox render', row.id, err); }
    if (!m) { db.prepare(`UPDATE outbox SET status = 'skipped' WHERE id = ?`).run(row.id); return; }
    try {
      await mail.send({ to: row.to_email, subject: m.subject, text: m.text, html: m.html });
      db.prepare(`UPDATE outbox SET status = 'sent', sent_at = ?, subject = ?, last_error = NULL WHERE id = ?`).run(nowIso(), m.subject, row.id);
    } catch (err) {
      const attempts = row.attempts + 1;
      const retry = new Date(Date.now() + Math.min(60, 2 ** attempts) * 60e3).toISOString();
      db.prepare(`UPDATE outbox SET status = ?, attempts = ?, last_error = ?, send_after = ?, subject = ? WHERE id = ?`)
        .run(attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', attempts, String(err.message || err).slice(0, 300), retry, m.subject, row.id);
      console.error('outbox send failed', row.id, err.message || err);
    }
  }

  /** Once a day after 18:00 UK time: each partner gets a summary of new RSVPs since the last one. */
  function queueDigests() {
    const uk = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', hour: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (t) => uk.find((p) => p.type === t).value;
    if (Number(part('hour')) < 18) return;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    // Only one copy of the app wins this insert, so the summary goes out once.
    if (!db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, '1')`).run('digest_' + today).changes) return;
    const since = (db.prepare(`SELECT value FROM settings WHERE key = 'digest_since'`).get() || {}).value || new Date(Date.now() - 864e5).toISOString();
    const now = nowIso();
    const rows = db.prepare(`SELECT e.id, e.org_id, e.title, e.starts_on, e.going, o.name AS org_name, u.name AS user_name FROM rsvps r JOIN events e ON e.id = r.event_id JOIN orgs o ON o.id = e.org_id
      JOIN users u ON u.id = r.user_id WHERE r.created_at > ? AND r.created_at <= ? AND o.status = 'verified' ORDER BY e.starts_on, r.created_at`).all(since, now);
    const byOrg = new Map();
    for (const r of rows) {
      const o = byOrg.get(r.org_id) || { orgName: r.org_name, events: new Map() }; byOrg.set(r.org_id, o);
      const ev = o.events.get(r.id) || { title: r.title, starts_on: r.starts_on, going: r.going, added: 0, names: [], more: 0 }; o.events.set(r.id, ev);
      ev.added++; if (ev.names.length < 8) ev.names.push(r.user_name); else ev.more++;
    }
    for (const [orgId, o] of byOrg) {
      const to = db.prepare('SELECT DISTINCT u.email FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?').all(orgId).map((x) => x.email);
      if (!to.length) { const c = db.prepare('SELECT contact_email FROM orgs WHERE id = ?').get(orgId); if (c && c.contact_email) to.push(c.contact_email); }
      for (const email of to) enqueue('partner_digest', email, { orgId, payload: { orgName: o.orgName, events: [...o.events.values()] } });
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES ('digest_since', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(now);
  }

  let running = false;
  async function tick() {
    if (running) return; running = true;
    try {
      queueDigests();
      for (let i = 0; i < 20; i++) {
        // Claim one due email atomically, so two app processes never send the same one.
        const now = nowIso();
        const row = db.prepare(`UPDATE outbox SET status = 'sending', send_after = ? WHERE id = (SELECT id FROM outbox WHERE status = 'queued' AND send_after <= ? ORDER BY send_after LIMIT 1) AND status = 'queued' RETURNING *`).get(now, now);
        if (!row) break;
        await sendOne(row);
      }
      // Anything stuck in 'sending' for 10 minutes (a crash mid-send) goes back in the queue.
      db.prepare(`UPDATE outbox SET status = 'queued' WHERE status = 'sending' AND send_after < ?`).run(new Date(Date.now() - 10 * 60e3).toISOString());
    } catch (err) { console.error('outbox tick', err); } finally { running = false; }
  }
  function start() {
    const every = Number(process.env.OUTBOX_INTERVAL_MS) || 30000;
    const t = setInterval(tick, every); t.unref();
    setTimeout(tick, 2000).unref();
  }

  return { enqueue, onRsvp, onUnRsvp, tick, start, render };
}

module.exports = { createOutbox };
