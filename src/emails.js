'use strict';
/* Admin > Emails: which sender is set up, a test button, and the latest emails with their status. */
const mail = require('./mail');
const { audit } = require('./db');

function registerEmails(route, H) {
  const { db, page, redirect, requireAdmin } = H;
  route('GET', '/admin/emails', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const S = require('./views/social');
    const list = db.prepare(`SELECT id, kind, to_email, status, attempts, last_error, subject, send_after, sent_at, created_at FROM outbox ORDER BY id DESC LIMIT 60`).all();
    const counts = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) n FROM outbox GROUP BY status`).all().map((r) => [r.status, r.n]));
    page(ctx, { title: ctx.t('tEmails'), active: 'admin', body: S.adminEmails(ctx, { provider: mail.provider(), from: mail.fromAddress(), list, counts }) });
  });
  route('POST', '/admin/emails/test', (ctx) => {
    if (!requireAdmin(ctx)) return;
    H.outbox.enqueue('test', ctx.user.email, { userId: ctx.user.id });
    audit(db, ctx.user.id, 'email-test');
    H.outbox.tick();
    redirect(ctx, '/admin/emails', { kind: 'good', msg: ctx.t('testQueued', { e: ctx.user.email }) });
  });
}
module.exports = { registerEmails };
