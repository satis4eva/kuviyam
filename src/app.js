'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Raw, toPence, nowIso, requiredReportMonth, token, ref, slugify, isEmail, clean, lines, esc } = require('./util');
const { makeT, dt, CAUSES, TYPES, CATEGORIES, DISTRICTS, COUNTRIES } = require('./i18n');
const dtTa = (s) => dt(s, 'ta'); // lets Tamil searches match English-stored places and causes
const auth = require('./auth');
const { parseMultipart, checkFile } = require('./multipart');
const { provider } = require('./payments');
const { audit } = require('./db');
const { layout } = require('./views/layout');
const { registerCommunity } = require('./community');
const P = require('./views/pages');
const M = require('./views/manage');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATIC_TYPES = { '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const MAX_FORM = 1024 * 1024; const MAX_UPLOAD = 25 * 1024 * 1024;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function createApp(db) {
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };

  /* ---------------- helpers ---------------- */
  const secure = (req) => req.headers['x-forwarded-proto'] === 'https' || process.env.FORCE_SECURE_COOKIES === '1';
  const send = (ctx, status, body, headers = {}) => {
    const html = body instanceof Raw ? body.s : String(body);
    ctx.res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers, 'Set-Cookie': ctx.cookies });
    ctx.res.end(html);
  };
  const page = (ctx, opts, status = 200) => send(ctx, status, layout(ctx, opts));
  const redirect = (ctx, loc, flash) => {
    if (flash) ctx.cookies.push(auth.cookie('flash', JSON.stringify(flash), { maxAge: 60, secure: secure(ctx.req) }));
    ctx.res.writeHead(303, { Location: loc, 'Set-Cookie': ctx.cookies, 'Cache-Control': 'no-store' }); ctx.res.end();
  };
  const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : '/');
  const requireUser = (ctx) => { if (!ctx.user) { redirect(ctx, '/login?next=' + encodeURIComponent(ctx.url.pathname)); return false; } return true; };
  const partnerOrg = (ctx) => {
    if (!requireUser(ctx)) return null;
    const o = ctx.user.orgs.find((x) => x.status === 'verified');
    if (!o) {
      if (ctx.user.role === 'admin') { page(ctx, { title: ctx.t('pdH'), active: 'dashboard', body: P.message(ctx, ctx.t('pdH'), ctx.t('pdAdminOnly'), ['/admin', ctx.t('nav_admin')]) }); return null; }
      redirect(ctx, '/join', { kind: 'warn', msg: ctx.t('pdNeedPartner') }); return null;
    }
    return db.prepare('SELECT * FROM orgs WHERE id = ?').get(o.id);
  };
  const requireAdmin = (ctx) => {
    if (!requireUser(ctx)) return false;
    if (ctx.user.role !== 'admin') throw new HttpError(403, 'forbidden');
    return true;
  };
  const isLate = (orgId) => !db.prepare(`SELECT 1 FROM reports WHERE org_id = ? AND month = ? AND status IN ('pending','published')`).get(orgId, requiredReportMonth());
  const spentOf = (reportId) => db.prepare('SELECT COALESCE(SUM(amount_lkr),0) AS s FROM expenses WHERE report_id = ?').get(reportId).s;
  const PROJECT_SQL = `SELECT p.*, o.name AS org_name, o.name_ta AS org_name_ta, o.country AS org_country, o.slug AS org_slug FROM projects p JOIN orgs o ON o.id = p.org_id`;
  const saveFile = (kind, ownerId, label, f) => Number(db.prepare(`INSERT INTO files (owner_kind, owner_id, label, filename, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(kind, ownerId, label, f.filename, f.mime, f.data.length, f.data, nowIso()).lastInsertRowid);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const fileErr = (ctx, code, name) => ctx.t('file_' + code, { f: name });
  const H = { db, page: (...a) => page(...a), redirect: (...a) => redirect(...a), requireUser: (c) => requireUser(c), partnerOrg: (c) => partnerOrg(c), requireAdmin: (c) => requireAdmin(c), saveFile: (...a) => saveFile(...a), tx: (f) => tx(f), HttpError, fileErr: (...a) => fileErr(...a) };
  const maskEmail = (e) => { const [u, d] = String(e).split('@'); return (u ? u[0] : '') + '•••@' + (d || ''); };

  /* ---------------- language ---------------- */
  route('GET', '/lang/:code', (ctx) => {
    const code = ctx.params.code === 'ta' ? 'ta' : 'en';
    ctx.cookies.push(auth.cookie('lang', code, { maxAge: 365 * 86400, secure: secure(ctx.req), httpOnly: false }));
    redirect(ctx, safeNext(ctx.query.get('back')));
  });
  route('GET', '/healthz', (ctx) => { ctx.res.writeHead(200, { 'Content-Type': 'text/plain' }); ctx.res.end('ok'); });
  route('GET', '/robots.txt', (ctx) => { ctx.res.writeHead(200, { 'Content-Type': 'text/plain' }); ctx.res.end(process.env.DEMO_MODE === '1' ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nDisallow: /admin\nDisallow: /dashboard\nDisallow: /files\n'); });

  /* ---------------- public pages ---------------- */
  route('GET', '/', (ctx) => {
    const live = db.prepare(`${PROJECT_SQL} WHERE o.status = 'verified' AND p.status = 'live' ORDER BY p.urgent DESC, p.created_at DESC`).all();
    const d = {
      raised: live.reduce((a, p) => a + p.raised_pence, 0), projects: live.length,
      partners: db.prepare(`SELECT COUNT(*) n FROM orgs WHERE status = 'verified'`).get().n,
      sponsored: db.prepare(`SELECT COUNT(*) n FROM students WHERE sponsored = 1`).get().n,
      urgent: live.filter((p) => p.urgent).slice(0, 6),
      posts: H.loadPosts(ctx, `p.status = 'live' AND o.status = 'verified'`, [], 3),
      events: db.prepare(`SELECT e.*, o.name AS org_name, o.name_ta AS org_name_ta, o.slug AS org_slug FROM events e JOIN orgs o ON o.id = e.org_id WHERE e.status = 'live' AND o.status = 'verified' AND e.starts_on >= ? ORDER BY e.starts_on LIMIT 3`).all(new Date().toISOString().slice(0, 10))
    };
    if (!d.urgent.length) d.urgent = live.slice(0, 6);
    page(ctx, { body: P.home(ctx, d), active: 'home' });
  });

  route('GET', '/projects', (ctx) => {
    const f = { q: clean(ctx.query.get('q'), 80), cause: CAUSES.includes(ctx.query.get('cause')) ? ctx.query.get('cause') : '', district: DISTRICTS.includes(ctx.query.get('district')) ? ctx.query.get('district') : '' };
    let list = db.prepare(`${PROJECT_SQL} WHERE o.status = 'verified' AND p.status = 'live' ORDER BY p.urgent DESC, p.created_at DESC`).all();
    const districts = [...new Set(list.map((p) => p.district))].sort();
    if (f.cause) list = list.filter((p) => p.cause === f.cause);
    if (f.district) list = list.filter((p) => p.district === f.district);
    let partnerHits = [];
    if (f.q) {
      const q = f.q.toLowerCase();
      list = list.filter((p) => [p.title, p.title_ta, p.district, dtTa(p.district), p.cause, dtTa(p.cause), p.org_name, p.org_name_ta, p.needs, p.needs_ta].join(' ').toLowerCase().includes(q));
      partnerHits = allPartners().filter((o) => matchPartner(o, q)).slice(0, 6);
    }
    page(ctx, { title: ctx.t('projectsH'), body: P.projects(ctx, { list, filters: f, districts, partnerHits }), active: 'projects' });
  });

  route('GET', '/projects/:id', (ctx) => {
    const p = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(Number(ctx.params.id));
    const o = p && db.prepare(`SELECT * FROM orgs WHERE id = ?`).get(p.org_id);
    if (!p || !o || o.status !== 'verified') throw new HttpError(404);
    const docs = db.prepare(`SELECT f.id, f.filename FROM expenses e JOIN reports r ON r.id = e.report_id JOIN files f ON f.id = e.file_id
      WHERE r.org_id = ? AND r.status = 'published' AND e.district = ? ORDER BY r.month DESC, e.id DESC LIMIT 6`).all(o.id, p.district);
    const ptitle = (ctx.lang === 'ta' && p.title_ta) || p.title;
    page(ctx, { title: ptitle, body: P.project(ctx, { project: p, org: o, docs }), active: 'projects', og: { title: ptitle, description: `${(ctx.lang === 'ta' && o.name_ta) || o.name} · ${ctx.t('ofGoal', { r: '£' + Math.round(p.raised_pence / 100).toLocaleString('en-GB'), g: '£' + Math.round(p.goal_pence / 100).toLocaleString('en-GB') })}`, path: `/projects/${p.id}` } });
  });

  const allPartners = () => db.prepare(`SELECT o.*, (SELECT COUNT(*) FROM projects p WHERE p.org_id = o.id AND p.status = 'live') AS projects FROM orgs o WHERE o.status = 'verified' ORDER BY o.name`).all();
  const matchPartner = (o, q) => [o.name, o.name_ta, o.place, dtTa(o.place), o.country, dtTa(o.country), o.cause, dtTa(o.cause), o.type, dtTa(o.type), o.about, o.about_ta].join(' ').toLowerCase().includes(q);
  route('GET', '/partners', (ctx) => {
    const qs = ctx.query;
    const f = { q: clean(qs.get('q'), 80), type: TYPES.includes(qs.get('type')) ? qs.get('type') : '', cause: CAUSES.includes(qs.get('cause')) ? qs.get('cause') : '', country: COUNTRIES.includes(qs.get('country')) ? qs.get('country') : '' };
    const all = allPartners();
    let list = all;
    if (f.type) list = list.filter((o) => o.type === f.type);
    if (f.cause) list = list.filter((o) => o.cause === f.cause);
    if (f.country) list = list.filter((o) => o.country === f.country);
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter((o) => matchPartner(o, q)); }
    const opts = { types: TYPES.filter((x) => all.some((o) => o.type === x)), causes: CAUSES.filter((x) => all.some((o) => o.cause === x)), countries: COUNTRIES.filter((x) => all.some((o) => o.country === x)) };
    page(ctx, { title: ctx.t('partnersH'), body: P.partners(ctx, { list: list.map((o) => ({ ...o, late: isLate(o.id) })), filters: f, opts, total: all.length }), active: 'partners' });
  });

  route('GET', '/partners/:slug', (ctx) => {
    const o = db.prepare(`SELECT * FROM orgs WHERE slug = ? AND status = 'verified'`).get(ctx.params.slug);
    if (!o) throw new HttpError(404);
    const projects = db.prepare(`${PROJECT_SQL} WHERE p.org_id = ? AND p.status = 'live' ORDER BY p.created_at DESC`).all(o.id);
    const students = db.prepare(`SELECT * FROM students WHERE org_id = ? ORDER BY sponsored, id`).all(o.id);
    page(ctx, { title: o.name, body: P.partner(ctx, { org: o, projects, students }), active: 'partners', og: { title: (ctx.lang === 'ta' && o.name_ta) || o.name, description: String((ctx.lang === 'ta' && o.about_ta) || o.about || '').slice(0, 200), path: `/partners/${o.slug}` } });
  });

  route('GET', '/sponsor', (ctx) => {
    const list = db.prepare(`SELECT s.*, o.name AS o_name, o.name_ta AS o_name_ta, o.color AS o_color FROM students s JOIN orgs o ON o.id = s.org_id WHERE o.status = 'verified' ORDER BY s.sponsored, s.id`).all()
      .map((s) => ({ ...s, org: { name: s.o_name, name_ta: s.o_name_ta, color: s.o_color } }));
    page(ctx, { title: ctx.t('sponsorH'), body: P.sponsor(ctx, { list }), active: 'sponsor' });
  });

  route('GET', '/transparency', (ctx) => {
    const orgs = db.prepare(`SELECT * FROM orgs WHERE status = 'verified' ORDER BY name`).all();
    const req = requiredReportMonth();
    const rows = orgs.map((o) => {
      const latest = db.prepare(`SELECT * FROM reports WHERE org_id = ? AND status = 'published' ORDER BY month DESC LIMIT 1`).get(o.id);
      if (latest) { latest.spent = spentOf(latest.id); latest.docs = db.prepare('SELECT COUNT(*) n FROM expenses WHERE report_id = ? AND file_id IS NOT NULL').get(latest.id).n; }
      return { org: o, latest, late: isLate(o.id), underReview: !!db.prepare(`SELECT 1 FROM reports WHERE org_id = ? AND month = ? AND status = 'pending'`).get(o.id, req) };
    });
    page(ctx, { title: ctx.t('trPageH'), body: P.transparency(ctx, { rows }), active: 'transparency' });
  });

  route('GET', '/transparency/:slug', (ctx) => {
    const o = db.prepare(`SELECT * FROM orgs WHERE slug = ? AND status = 'verified'`).get(ctx.params.slug);
    if (!o) throw new HttpError(404);
    const reports = db.prepare(`SELECT * FROM reports WHERE org_id = ? AND status = 'published' ORDER BY month`).all(o.id).map((r) => ({ ...r, spent: spentOf(r.id) }));
    const items = db.prepare(`SELECT e.*, r.month FROM expenses e JOIN reports r ON r.id = e.report_id WHERE r.org_id = ? AND r.status = 'published' ORDER BY r.month DESC, e.id`).all(o.id);
    page(ctx, { title: o.name, body: P.report(ctx, { org: o, reports, items, late: isLate(o.id) }), active: 'transparency' });
  });

  /* ---------------- files (receipts and KYC documents) ---------------- */
  route('GET', '/files/:id', (ctx) => {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(ctx.params.id));
    if (!f) throw new HttpError(404);
    let allowed = ctx.user && ctx.user.role === 'admin';
    if (f.owner_kind === 'expense') {
      const r = db.prepare(`SELECT r.status, r.org_id, o.status AS ostatus FROM expenses e JOIN reports r ON r.id = e.report_id JOIN orgs o ON o.id = r.org_id WHERE e.id = ?`).get(f.owner_id);
      if (r && r.status === 'published' && r.ostatus === 'verified') allowed = true;
      if (r && ctx.user && ctx.user.orgs.some((x) => x.id === r.org_id)) allowed = true;
    } else if (f.owner_kind === 'post') {
      const p = db.prepare(`SELECT p.status, p.org_id, o.status AS ostatus FROM posts p JOIN orgs o ON o.id = p.org_id WHERE p.id = ?`).get(f.owner_id);
      if (p && p.status === 'live' && p.ostatus === 'verified') allowed = true;
      if (p && ctx.user && ctx.user.orgs.some((x) => x.id === p.org_id)) allowed = true;
    } else if (f.owner_kind === 'memorial') {
      const m = db.prepare('SELECT status, user_id FROM memorials WHERE id = ?').get(f.owner_id);
      if (m && (m.status === 'live' || (ctx.user && m.user_id === ctx.user.id))) allowed = true;
    } else if (f.owner_kind === 'application') {
      const a = db.prepare('SELECT user_id FROM applications WHERE id = ?').get(f.owner_id);
      if (a && ctx.user && a.user_id === ctx.user.id) allowed = true;
    }
    if (!allowed) throw new HttpError(ctx.user ? 403 : 404);
    ctx.res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.data.length, 'Content-Disposition': `inline; filename="${f.filename.replace(/[^\w.\-]+/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", 'Cache-Control': 'private, max-age=300', 'Set-Cookie': ctx.cookies });
    ctx.res.end(Buffer.from(f.data));
  });

  /* ---------------- donations ---------------- */
  const target = (kind, id) => {
    if (kind === 'project') { const p = db.prepare(`${PROJECT_SQL} WHERE p.id = ? AND p.status = 'live' AND o.status = 'verified'`).get(id); return p && { orgId: p.org_id, name: (lang) => (lang === 'ta' && p.title_ta) || p.title }; }
    if (kind === 'org') { const o = db.prepare(`SELECT * FROM orgs WHERE id = ? AND status = 'verified'`).get(id); return o && { orgId: o.id, name: (lang) => (lang === 'ta' && o.name_ta) || o.name }; }
    if (kind === 'memorial') { const m = db.prepare(`SELECT m.*, p.org_id FROM memorials m JOIN projects p ON p.id = m.project_id JOIN orgs o ON o.id = p.org_id WHERE m.id = ? AND m.status = 'live' AND p.status = 'live' AND o.status = 'verified'`).get(id); return m && { orgId: m.org_id, name: (lang, t) => t('inMemOf', { n: (lang === 'ta' && m.name_ta) || m.name }) }; }
    if (kind === 'student') { const s = db.prepare(`SELECT s.* FROM students s JOIN orgs o ON o.id = s.org_id WHERE s.id = ? AND s.sponsored = 0 AND o.status = 'verified'`).get(id); return s && { orgId: s.org_id, fixed: s.monthly_pence, name: (lang, t) => t('schFor', { n: (lang === 'ta' && s.name_ta) || s.name }) }; }
    return null;
  };
  route('GET', '/donate', (ctx) => {
    const kind = ctx.query.get('kind'); const id = Number(ctx.query.get('id'));
    const tg = target(kind, id); if (!tg) throw new HttpError(404);
    const values = { monthly: kind === 'student' || ctx.query.get('monthly') === '1', amount: tg.fixed ? tg.fixed / 100 : 25, donor_name: ctx.user ? ctx.user.name : '', donor_email: ctx.user ? ctx.user.email : '', tip: true };
    page(ctx, { title: ctx.t('dTitle'), body: P.donateForm(ctx, { kind, id, values, targetName: tg.name(ctx.lang, ctx.t), fixed: tg.fixed }) });
  });
  route('POST', '/donate', (ctx) => {
    const b = ctx.body; const kind = b.kind; const id = Number(b.id);
    const tg = target(kind, id); if (!tg) throw new HttpError(404);
    const amount = tg.fixed || toPence(b.amount || b.preset);
    const errs = [];
    if (!(amount >= 100 && amount <= 1000000)) errs.push(ctx.t('errAmount'));
    if (!clean(b.donor_name, 120)) errs.push(ctx.t('errName'));
    if (!isEmail(b.donor_email)) errs.push(ctx.t('errEmail'));
    if (errs.length) return page(ctx, { body: P.donateForm(ctx, { kind, id, values: { ...b, monthly: b.monthly === '1', amount: b.amount }, targetName: tg.name(ctx.lang, ctx.t), fixed: tg.fixed, errors: errs }) }, 400);
    const pv = provider();
    const donation = { ref: ref('KV'), kind, target_id: id, org_id: tg.orgId, amount_pence: amount, tip_pence: b.tip ? Math.round(amount * 0.05) : 0, gift_aid: b.gift_aid ? 1 : 0, monthly: kind === 'student' || b.monthly === '1' ? 1 : 0 };
    db.prepare(`INSERT INTO donations (ref, kind, target_id, org_id, amount_pence, tip_pence, gift_aid, monthly, donor_name, donor_email, anonymous, status, provider, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(donation.ref, kind, id, tg.orgId, donation.amount_pence, donation.tip_pence, donation.gift_aid, donation.monthly,
      clean(b.donor_name, 120), clean(b.donor_email, 200), b.anonymous ? 1 : 0, pv.name, ctx.user ? ctx.user.id : null, nowIso());
    redirect(ctx, pv.start(donation).redirect);
  });
  const donationByRef = (r) => db.prepare('SELECT * FROM donations WHERE ref = ?').get(String(r));
  const donationName = (ctx, x) => { const tg = (() => {
      if (x.kind === 'project') { const p = db.prepare('SELECT title, title_ta FROM projects WHERE id = ?').get(x.target_id); return p && ((ctx.lang === 'ta' && p.title_ta) || p.title); }
      if (x.kind === 'org') { const o = db.prepare('SELECT name, name_ta FROM orgs WHERE id = ?').get(x.target_id); return o && ((ctx.lang === 'ta' && o.name_ta) || o.name); }
      if (x.kind === 'memorial') { const m = db.prepare('SELECT name, name_ta FROM memorials WHERE id = ?').get(x.target_id); return m && ctx.t('inMemOf', { n: (ctx.lang === 'ta' && m.name_ta) || m.name }); }
      const s = db.prepare('SELECT name, name_ta FROM students WHERE id = ?').get(x.target_id); return s && ctx.t('schFor', { n: (ctx.lang === 'ta' && s.name_ta) || s.name });
    })(); return tg || ''; };
  route('GET', '/pay/:ref', (ctx) => {
    const x = donationByRef(ctx.params.ref); if (!x) throw new HttpError(404);
    if (x.status === 'paid') return redirect(ctx, `/thanks/${x.ref}`);
    page(ctx, { title: ctx.t('payment'), body: P.pay(ctx, { donation: x, targetName: donationName(ctx, x), testMode: provider().testMode }) });
  });
  route('POST', '/pay/:ref', (ctx) => {
    const x = donationByRef(ctx.params.ref); if (!x) throw new HttpError(404);
    if (x.status === 'paid') return redirect(ctx, `/thanks/${x.ref}`);
    const result = provider().confirm(x, ctx.req);
    if (!result.ok) { db.prepare(`UPDATE donations SET status = 'failed' WHERE id = ?`).run(x.id); return redirect(ctx, `/pay/${x.ref}`, { kind: 'bad', msg: ctx.t('payFailed') }); }
    tx(() => {
      const upd = db.prepare(`UPDATE donations SET status = 'paid', provider_ref = ?, paid_at = ? WHERE id = ? AND status = 'pending'`).run(result.providerRef, nowIso(), x.id);
      if (upd.changes !== 1) return;
      if (x.kind === 'project') db.prepare('UPDATE projects SET raised_pence = raised_pence + ?, donors = donors + 1 WHERE id = ?').run(x.amount_pence, x.target_id);
      if (x.kind === 'student') db.prepare('UPDATE students SET sponsored = 1 WHERE id = ?').run(x.target_id);
      if (x.kind === 'memorial') {
        const m = db.prepare('SELECT project_id FROM memorials WHERE id = ?').get(x.target_id);
        db.prepare('UPDATE memorials SET raised_pence = raised_pence + ? WHERE id = ?').run(x.amount_pence, x.target_id);
        if (m && m.project_id) db.prepare('UPDATE projects SET raised_pence = raised_pence + ?, donors = donors + 1 WHERE id = ?').run(x.amount_pence, m.project_id);
      }
    });
    redirect(ctx, `/thanks/${x.ref}`);
  });
  route('GET', '/thanks/:ref', (ctx) => {
    const x = donationByRef(ctx.params.ref); if (!x || x.status !== 'paid') throw new HttpError(404);
    page(ctx, { title: ctx.t('thanks'), body: P.thanks(ctx, { donation: { ...x, donor_email: maskEmail(x.donor_email) }, targetName: donationName(ctx, x) }) });
  });

  /* ---------------- accounts ---------------- */
  const startSession = (ctx, userId) => { const s = auth.createSession(db, userId); ctx.cookies.push(auth.cookie('sid', s.id, { maxAge: s.maxAge, secure: secure(ctx.req) })); };
  route('GET', '/login', (ctx) => page(ctx, { title: ctx.t('login'), body: P.login(ctx, { next: safeNext(ctx.query.get('next') || '/') }) }));
  route('POST', '/login', (ctx) => {
    const email = clean(ctx.body.email, 200).toLowerCase(); const next = safeNext(ctx.body.next);
    if (auth.throttled('login:' + ctx.ip + ':' + email)) return page(ctx, { body: P.login(ctx, { email, next, errors: [ctx.t('errThrottle')] }) }, 429);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !auth.verifyPassword(ctx.body.password, u.password_hash)) return page(ctx, { body: P.login(ctx, { email, next, errors: [ctx.t('errLogin')] }) }, 400);
    startSession(ctx, u.id); audit(db, u.id, 'login');
    redirect(ctx, next);
  });
  route('GET', '/register', (ctx) => page(ctx, { title: ctx.t('register'), body: P.register(ctx, { next: safeNext(ctx.query.get('next') || '/') }) }));
  route('POST', '/register', (ctx) => {
    const b = ctx.body; const email = clean(b.email, 200).toLowerCase(); const name = clean(b.name, 120); const next = safeNext(b.next);
    const errs = [];
    if (auth.throttled('register:' + ctx.ip, 20)) errs.push(ctx.t('errThrottle'));
    if (!name) errs.push(ctx.t('errName'));
    if (!isEmail(email)) errs.push(ctx.t('errEmail'));
    if (String(b.password || '').length < 10) errs.push(ctx.t('errPassword'));
    if (!errs.length && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) errs.push(ctx.t('errEmailTaken'));
    if (errs.length) return page(ctx, { body: P.register(ctx, { name, email, next, errors: errs }) }, 400);
    const id = Number(db.prepare(`INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'donor', ?)`).run(email, name, auth.hashPassword(b.password), nowIso()).lastInsertRowid);
    startSession(ctx, id); audit(db, id, 'register');
    redirect(ctx, next, { kind: 'good', msg: ctx.t('welcome', { n: name }) });
  });
  route('POST', '/logout', (ctx) => {
    auth.destroySession(db, ctx.sid);
    ctx.cookies.push(auth.cookie('sid', '', { maxAge: 0, secure: secure(ctx.req) }));
    redirect(ctx, '/');
  });
  const adminExists = () => !!db.prepare(`SELECT 1 FROM users WHERE role = 'admin'`).get();
  route('GET', '/setup', (ctx) => {
    if (adminExists() || !process.env.SETUP_CODE) throw new HttpError(404);
    page(ctx, { title: ctx.t('setupH'), body: P.setup(ctx, {}) });
  });
  route('POST', '/setup', (ctx) => {
    if (adminExists() || !process.env.SETUP_CODE) throw new HttpError(404);
    const b = ctx.body; const email = clean(b.email, 200).toLowerCase(); const name = clean(b.name, 120);
    const want = Buffer.from(process.env.SETUP_CODE); const got = Buffer.from(String(b.code || ''));
    const errs = [];
    if (auth.throttled('setup:' + ctx.ip, 5)) errs.push(ctx.t('errThrottle'));
    else if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) errs.push(ctx.t('errSetupCode'));
    if (!name) errs.push(ctx.t('errName'));
    if (!isEmail(email)) errs.push(ctx.t('errEmail'));
    if (String(b.password || '').length < 12) errs.push(ctx.t('errPasswordAdmin'));
    if (!errs.length && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) errs.push(ctx.t('errEmailTaken'));
    if (errs.length) return page(ctx, { body: P.setup(ctx, { name, email, errors: errs }) }, 400);
    const id = Number(db.prepare(`INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)`).run(email, name, auth.hashPassword(b.password), nowIso()).lastInsertRowid);
    audit(db, id, 'setup-admin'); startSession(ctx, id);
    redirect(ctx, '/admin', { kind: 'good', msg: ctx.t('adminCreated') });
  });

  /* ---------------- partner application ---------------- */
  route('GET', '/join', (ctx) => {
    if (!ctx.user) return page(ctx, { title: ctx.t('joinPageH'), body: P.joinIntro(ctx), active: 'join' });
    const apps = db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC').all(ctx.user.id);
    if (apps.length && ctx.query.get('new') !== '1') return page(ctx, { title: ctx.t('myApplications'), body: P.joinStatus(ctx, { apps }), active: 'join' });
    page(ctx, { title: ctx.t('joinPageH'), body: P.joinForm(ctx, { values: { email: ctx.user.email, contact: ctx.user.name } }), active: 'join' });
  });
  route('POST', '/join', (ctx) => {
    if (!requireUser(ctx)) return;
    const b = ctx.body; const errs = [];
    const causes = (Array.isArray(b.causes) ? b.causes : b.causes ? [b.causes] : []).filter((c) => CAUSES.includes(c));
    const v = { type: TYPES.includes(b.type) ? b.type : '', name: clean(b.name, 160), name_ta: clean(b.name_ta, 160), country: COUNTRIES.includes(b.country) ? b.country : '', town: clean(b.town, 120),
      reg_no: clean(b.reg_no, 80), founded: Number(b.founded) || null, website: clean(b.website, 200), contact: clean(b.contact, 120), contact_role: clean(b.contact_role, 80), email: clean(b.email, 200),
      phone: clean(b.phone, 40), area: DISTRICTS.includes(b.area) ? b.area : '', about: clean(b.about, 2000), about_ta: clean(b.about_ta, 2000), causes };
    if (db.prepare(`SELECT 1 FROM applications WHERE user_id = ? AND status = 'pending'`).get(ctx.user.id)) errs.push(ctx.t('errPendingApp'));
    if (!v.type) errs.push(ctx.t('pickType'));
    if (!v.name || !v.country || !v.town || !v.reg_no || !v.contact || !v.about) errs.push(ctx.t('required'));
    if (!isEmail(v.email)) errs.push(ctx.t('errEmail'));
    if (!causes.length) errs.push(ctx.t('errCauses'));
    if (!b.agree1 || !b.agree2) errs.push(ctx.t('mustAgree'));
    const docs = {};
    for (const [field, label, required] of [['doc_reg', 'reg', true], ['doc_gov', 'gov', true], ['doc_acc', 'acc', false], ['doc_id', 'id', true]]) {
      const f = ctx.files.find((x) => x.field === field);
      if (!f) { if (required) errs.push(fileErr(ctx, 'missing', ctx.t({ reg: 'docReg', gov: 'docGov', acc: 'docAcc', id: 'docId' }[label]))); continue; }
      const e = checkFile(f); if (e) errs.push(fileErr(ctx, e, f.filename)); else docs[label] = f;
    }
    if (errs.length) return page(ctx, { title: ctx.t('joinPageH'), body: P.joinForm(ctx, { values: { ...b, causes }, errors: errs }), active: 'join' }, 400);
    tx(() => {
      const id = Number(db.prepare(`INSERT INTO applications (user_id, type, name, name_ta, country, town, area, reg_no, founded, website, contact, contact_role, email, phone, causes, about, about_ta, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(ctx.user.id, v.type, v.name, v.name_ta || null, v.country, v.town, v.area || null, v.reg_no, v.founded, v.website || null,
        v.contact, v.contact_role || null, v.email, v.phone || null, causes.join(','), v.about, v.about_ta || null, nowIso()).lastInsertRowid);
      for (const [label, f] of Object.entries(docs)) saveFile('application', id, label, f);
      audit(db, ctx.user.id, 'application', `#${id} ${v.name}`);
    });
    redirect(ctx, '/join', { kind: 'good', msg: ctx.t('appSent') });
  });

  /* ---------------- partner dashboard ---------------- */
  route('GET', '/dashboard', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    const projects = db.prepare('SELECT * FROM projects WHERE org_id = ? ORDER BY status, created_at DESC').all(o.id);
    const donations = db.prepare(`SELECT * FROM donations WHERE org_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 20`).all(o.id).map((x) => ({ ...x, target: donationName(ctx, x) }));
    const stats = db.prepare(`SELECT COUNT(*) n FROM donations WHERE org_id = ? AND status = 'paid'`).get(o.id);
    const pending = db.prepare(`SELECT COUNT(*) n FROM reports WHERE org_id = ? AND status = 'pending'`).get(o.id).n;
    page(ctx, { title: ctx.t('pdH'), active: 'dashboard', body: M.dashboard(ctx, { org: o, projects, donations, donationsCount: stats.n, raised: projects.filter((p) => p.status === 'live').reduce((a, p) => a + p.raised_pence, 0), pending, required: requiredReportMonth(), late: isLate(o.id) }) });
  });
  route('GET', '/dashboard/projects/new', (ctx) => { const o = partnerOrg(ctx); if (!o) return; page(ctx, { title: ctx.t('tProject'), active: 'dashboard', body: M.newProject(ctx, { org: o, values: { district: o.place, cause: o.cause } }) }); });
  route('POST', '/dashboard/projects', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    const b = ctx.body; const v = { title: clean(b.title, 160), title_ta: clean(b.title_ta, 160), cause: CAUSES.includes(b.cause) ? b.cause : '', district: DISTRICTS.includes(b.district) ? b.district : '',
      goal: toPence(b.goal), ends_on: /^\d{4}-\d{2}-\d{2}$/.test(b.ends_on || '') ? b.ends_on : null, needs: lines(b.needs).join('\n'), needs_ta: lines(b.needs_ta).join('\n'), urgent: b.urgent ? 1 : 0 };
    const errs = [];
    if (!v.title && !v.title_ta) errs.push(ctx.t('errTitle'));
    if (!v.cause || !v.district) errs.push(ctx.t('required'));
    if (!(v.goal >= 5000 && v.goal <= 100000000)) errs.push(ctx.t('errGoal'));
    if (errs.length) return page(ctx, { active: 'dashboard', body: M.newProject(ctx, { org: o, values: b, errors: errs }) }, 400);
    const id = Number(db.prepare(`INSERT INTO projects (org_id, title, title_ta, cause, district, goal_pence, ends_on, urgent, needs, needs_ta, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?)`)
      .run(o.id, v.title || v.title_ta, v.title_ta || null, v.cause, v.district, v.goal, v.ends_on, v.urgent, v.needs || v.needs_ta || null, v.needs_ta || null, nowIso()).lastInsertRowid);
    audit(db, ctx.user.id, 'project-create', `#${id}`);
    redirect(ctx, `/projects/${id}`, { kind: 'good', msg: ctx.t('projectPub') });
  });
  route('POST', '/dashboard/projects/:id/close', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    const r = db.prepare(`UPDATE projects SET status = 'closed' WHERE id = ? AND org_id = ?`).run(Number(ctx.params.id), o.id);
    if (!r.changes) throw new HttpError(404);
    redirect(ctx, '/dashboard', { kind: 'good', msg: ctx.t('projectClosed') });
  });

  route('GET', '/dashboard/reports', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    const reports = db.prepare('SELECT * FROM reports WHERE org_id = ? ORDER BY month DESC').all(o.id).map((r) => ({ ...r, spent: spentOf(r.id) }));
    page(ctx, { title: ctx.t('tReports'), active: 'dashboard', body: M.reportsList(ctx, { org: o, reports, required: requiredReportMonth() }) });
  });
  route('POST', '/dashboard/reports', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    const month = String(ctx.body.month || ''); const received = toPence(ctx.body.received);
    const errs = [];
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > new Date().toISOString().slice(0, 7)) errs.push(ctx.t('errMonth'));
    if (!(received >= 0)) errs.push(ctx.t('errReceived'));
    if (!errs.length && db.prepare('SELECT 1 FROM reports WHERE org_id = ? AND month = ?').get(o.id, month)) errs.push(ctx.t('errReportExists'));
    if (errs.length) {
      const reports = db.prepare('SELECT * FROM reports WHERE org_id = ? ORDER BY month DESC').all(o.id).map((r) => ({ ...r, spent: spentOf(r.id) }));
      return page(ctx, { active: 'dashboard', body: M.reportsList(ctx, { org: o, reports, required: requiredReportMonth(), errors: errs }) }, 400);
    }
    const id = Number(db.prepare(`INSERT INTO reports (org_id, month, received_pence, status) VALUES (?, ?, ?, 'draft')`).run(o.id, month, received).lastInsertRowid);
    redirect(ctx, `/dashboard/reports/${id}`);
  });
  const ownReport = (o, id) => { const r = db.prepare('SELECT * FROM reports WHERE id = ? AND org_id = ?').get(Number(id), o.id); if (!r) throw new HttpError(404); return r; };
  const reportItems = (rid) => db.prepare('SELECT * FROM expenses WHERE report_id = ? ORDER BY id').all(rid);
  route('GET', '/dashboard/reports/:id', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return; const r = ownReport(o, ctx.params.id);
    page(ctx, { title: ctx.t('tReports'), active: 'dashboard', body: M.reportEdit(ctx, { org: o, report: r, items: reportItems(r.id) }) });
  });
  route('POST', '/dashboard/reports/:id/expenses', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return; const r = ownReport(o, ctx.params.id);
    if (!['draft', 'returned'].includes(r.status)) throw new HttpError(409, 'locked');
    const b = ctx.body; const errs = [];
    const v = { description: clean(b.description, 200), description_ta: clean(b.description_ta, 200), category: CATEGORIES.includes(b.category) ? b.category : '', district: DISTRICTS.includes(b.district) ? b.district : '', amount: Math.round(Number(b.amount_lkr)) };
    if (!v.description || !v.category || !v.district) errs.push(ctx.t('required'));
    if (!(v.amount > 0 && v.amount < 1e10)) errs.push(ctx.t('errAmountLkr'));
    const f = ctx.files.find((x) => x.field === 'receipt');
    if (f) { const e = checkFile(f); if (e) errs.push(fileErr(ctx, e, f.filename)); }
    if (errs.length) return page(ctx, { active: 'dashboard', body: M.reportEdit(ctx, { org: o, report: r, items: reportItems(r.id), errors: errs }) }, 400);
    tx(() => {
      const eid = Number(db.prepare(`INSERT INTO expenses (report_id, description, description_ta, category, district, amount_lkr, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(r.id, v.description, v.description_ta || null, v.category, v.district, v.amount, nowIso()).lastInsertRowid);
      if (f) db.prepare('UPDATE expenses SET file_id = ? WHERE id = ?').run(saveFile('expense', eid, 'receipt', f), eid);
    });
    redirect(ctx, `/dashboard/reports/${r.id}`, { kind: 'good', msg: ctx.t('expAdded') });
  });
  route('POST', '/dashboard/reports/:id/expenses/:eid/delete', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return; const r = ownReport(o, ctx.params.id);
    if (!['draft', 'returned'].includes(r.status)) throw new HttpError(409, 'locked');
    const e = db.prepare('SELECT * FROM expenses WHERE id = ? AND report_id = ?').get(Number(ctx.params.eid), r.id); if (!e) throw new HttpError(404);
    tx(() => { db.prepare('DELETE FROM expenses WHERE id = ?').run(e.id); if (e.file_id) db.prepare('DELETE FROM files WHERE id = ?').run(e.file_id); });
    redirect(ctx, `/dashboard/reports/${r.id}`);
  });
  route('POST', '/dashboard/reports/:id/submit', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return; const r = ownReport(o, ctx.params.id);
    if (!['draft', 'returned'].includes(r.status) || !reportItems(r.id).length) throw new HttpError(409, 'cannot submit');
    db.prepare(`UPDATE reports SET status = 'pending', submitted_at = ?, note = NULL WHERE id = ?`).run(nowIso(), r.id);
    audit(db, ctx.user.id, 'report-submit', `#${r.id}`);
    redirect(ctx, '/dashboard/reports', { kind: 'good', msg: ctx.t('reportSent') });
  });

  route('GET', '/dashboard/students', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    page(ctx, { title: ctx.t('tStudents'), active: 'dashboard', body: M.students(ctx, { org: o, students: db.prepare('SELECT * FROM students WHERE org_id = ? ORDER BY id').all(o.id) }) });
  });
  route('POST', '/dashboard/students', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    const b = ctx.body; const v = { name: clean(b.name, 40), name_ta: clean(b.name_ta, 40), grade: Math.round(Number(b.grade)), district: DISTRICTS.includes(b.district) ? b.district : '', dream: clean(b.dream, 120), dream_ta: clean(b.dream_ta, 120), monthly: toPence(b.monthly) };
    const errs = [];
    if (!v.name || !v.district || !(v.grade >= 1 && v.grade <= 13)) errs.push(ctx.t('required'));
    if (/\s/.test(v.name)) errs.push(ctx.t('errFirstName'));
    if (!(v.monthly >= 100 && v.monthly <= 50000)) errs.push(ctx.t('errAmount'));
    if (errs.length) return page(ctx, { active: 'dashboard', body: M.students(ctx, { org: o, students: db.prepare('SELECT * FROM students WHERE org_id = ? ORDER BY id').all(o.id), errors: errs }) }, 400);
    db.prepare(`INSERT INTO students (org_id, name, name_ta, grade, district, dream, dream_ta, monthly_pence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(o.id, v.name, v.name_ta || null, v.grade, v.district, v.dream || null, v.dream_ta || null, v.monthly, nowIso());
    redirect(ctx, '/dashboard/students', { kind: 'good', msg: ctx.t('studentAdded') });
  });

  /* ---------------- admin ---------------- */
  route('GET', '/admin', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const apps = db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM files f WHERE f.owner_kind = 'application' AND f.owner_id = a.id) AS docs FROM applications a WHERE status = 'pending' ORDER BY id`).all();
    const reports = db.prepare(`SELECT r.*, o.name AS org_name, o.name_ta AS org_name_ta FROM reports r JOIN orgs o ON o.id = r.org_id WHERE r.status = 'pending' ORDER BY r.submitted_at`).all()
      .map((r) => ({ ...r, spent: spentOf(r.id), items: db.prepare('SELECT COUNT(*) n FROM expenses WHERE report_id = ?').get(r.id).n, docs: db.prepare('SELECT COUNT(*) n FROM expenses WHERE report_id = ? AND file_id IS NOT NULL').get(r.id).n }));
    const orgs = db.prepare(`SELECT id FROM orgs WHERE status = 'verified'`).all();
    const stats = { partners: orgs.length, late: orgs.filter((o) => isLate(o.id)).length, paid: db.prepare(`SELECT COALESCE(SUM(amount_pence),0) s FROM donations WHERE status = 'paid'`).get().s };
    page(ctx, { title: ctx.t('adH'), active: 'admin', body: M.admin(ctx, { apps, reports, stats, ...H.adminCommunityQueue() }) });
  });
  route('GET', '/admin/applications/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(Number(ctx.params.id)); if (!app) throw new HttpError(404);
    const files = db.prepare(`SELECT id, label, filename, size FROM files WHERE owner_kind = 'application' AND owner_id = ? ORDER BY id`).all(app.id);
    page(ctx, { title: app.name, active: 'admin', body: M.adminApplication(ctx, { app, files }) });
  });
  route('POST', '/admin/applications/:id/approve', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const a = db.prepare(`SELECT * FROM applications WHERE id = ? AND status = 'pending'`).get(Number(ctx.params.id)); if (!a) throw new HttpError(404);
    const colors = ['#0D6B5B', '#2E6FA8', '#8A4FB0', '#B5542D', '#9C7A12', '#4C7D2C', '#A0446B', '#3F5FA0'];
    tx(() => {
      let slug = slugify(a.name); let n = 2; while (db.prepare('SELECT 1 FROM orgs WHERE slug = ?').get(slug)) slug = `${slugify(a.name)}-${n++}`;
      const count = db.prepare('SELECT COUNT(*) n FROM orgs').get().n;
      const orgId = Number(db.prepare(`INSERT INTO orgs (slug, name, name_ta, type, country, place, cause, about, about_ta, status, since, color, contact_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)`)
        .run(slug, a.name, a.name_ta, a.type, a.country, a.area || a.town, a.causes.split(',')[0], a.about, a.about_ta, a.founded, colors[count % colors.length], a.email, nowIso()).lastInsertRowid);
      db.prepare(`INSERT OR IGNORE INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')`).run(orgId, a.user_id);
      db.prepare(`UPDATE applications SET status = 'approved', org_id = ?, reviewed_at = ? WHERE id = ?`).run(orgId, nowIso(), a.id);
      audit(db, ctx.user.id, 'application-approve', `#${a.id} -> org ${orgId}`);
    });
    redirect(ctx, '/admin', { kind: 'good', msg: ctx.t('appApproved') });
  });
  route('POST', '/admin/applications/:id/reject', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const reason = clean(ctx.body.reason, 500); if (!reason) throw new HttpError(400, 'reason required');
    const r = db.prepare(`UPDATE applications SET status = 'rejected', reason = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'`).run(reason, nowIso(), Number(ctx.params.id));
    if (!r.changes) throw new HttpError(404);
    audit(db, ctx.user.id, 'application-reject', `#${ctx.params.id}`);
    redirect(ctx, '/admin', { kind: 'good', msg: ctx.t('rejectedT') });
  });
  route('GET', '/admin/reports/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const report = db.prepare(`SELECT r.*, o.name AS org_name, o.name_ta AS org_name_ta FROM reports r JOIN orgs o ON o.id = r.org_id WHERE r.id = ?`).get(Number(ctx.params.id)); if (!report) throw new HttpError(404);
    page(ctx, { title: ctx.t('qReport'), active: 'admin', body: M.adminReport(ctx, { report, items: reportItems(report.id) }) });
  });
  route('POST', '/admin/reports/:id/approve', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const r = db.prepare(`UPDATE reports SET status = 'published', reviewed_at = ? WHERE id = ? AND status = 'pending'`).run(nowIso(), Number(ctx.params.id)); if (!r.changes) throw new HttpError(404);
    audit(db, ctx.user.id, 'report-publish', `#${ctx.params.id}`);
    redirect(ctx, '/admin', { kind: 'good', msg: ctx.t('approvedT') });
  });
  route('POST', '/admin/reports/:id/return', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const note = clean(ctx.body.note, 500); if (!note) throw new HttpError(400, 'note required');
    const r = db.prepare(`UPDATE reports SET status = 'returned', note = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'`).run(note, nowIso(), Number(ctx.params.id)); if (!r.changes) throw new HttpError(404);
    audit(db, ctx.user.id, 'report-return', `#${ctx.params.id}`);
    redirect(ctx, '/admin', { kind: 'good', msg: ctx.t('returnedT') });
  });
  route('GET', '/admin/partners', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const list = db.prepare('SELECT * FROM orgs ORDER BY name').all().map((o) => ({ ...o, late: isLate(o.id) }));
    page(ctx, { title: ctx.t('tPartners'), active: 'admin', body: M.adminPartners(ctx, { list }) });
  });
  for (const [act, status] of [['suspend', 'suspended'], ['reinstate', 'verified']]) {
    route('POST', `/admin/partners/:id/${act}`, (ctx) => {
      if (!requireAdmin(ctx)) return;
      const r = db.prepare('UPDATE orgs SET status = ? WHERE id = ?').run(status, Number(ctx.params.id)); if (!r.changes) throw new HttpError(404);
      audit(db, ctx.user.id, 'partner-' + act, `#${ctx.params.id}`);
      redirect(ctx, '/admin/partners', { kind: 'good', msg: ctx.t(act === 'suspend' ? 'suspendedT' : 'reinstatedT') });
    });
  }
  route('GET', '/admin/donations', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const list = db.prepare(`SELECT d.*, o.name AS org_name, o.name_ta AS org_name_ta FROM donations d JOIN orgs o ON o.id = d.org_id ORDER BY d.id DESC LIMIT 200`).all();
    page(ctx, { title: ctx.t('tDonations'), active: 'admin', body: M.adminDonations(ctx, { list }) });
  });

  /* ---------------- community hub ---------------- */
  registerCommunity(route, H);

  /* ---------------- request handling ---------------- */
  function serveStatic(ctx) {
    const rel = decodeURIComponent(ctx.url.pathname.slice('/static/'.length));
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    ctx.res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
    fs.createReadStream(file).pipe(ctx.res); return true;
  }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
    });
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const cookies = auth.parseCookies(req.headers.cookie);
    const lang = cookies.lang === 'ta' || cookies.lang === 'en' ? cookies.lang : (/^ta\b/i.test(req.headers['accept-language'] || '') ? 'ta' : 'en');
    const ctx = { req, res, url, query: url.searchParams, params: {}, body: {}, files: [], cookies: [], lang, t: makeT(lang), sid: cookies.sid, ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://cdn.jsdelivr.net; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      if (url.pathname.startsWith('/static/') && req.method === 'GET') { if (serveStatic(ctx)) return; throw new HttpError(404); }
      ctx.csrf = cookies.csrf && /^[a-f0-9]{48}$/.test(cookies.csrf) ? cookies.csrf : token();
      if (ctx.csrf !== cookies.csrf) ctx.cookies.push(auth.cookie('csrf', ctx.csrf, { maxAge: 7 * 86400, secure: secure(req) }));
      if (cookies.flash) { try { ctx.flash = JSON.parse(cookies.flash); } catch { /* ignore */ } ctx.cookies.push(auth.cookie('flash', '', { maxAge: 0 })); }
      ctx.user = auth.userFromSession(db, cookies.sid);
      if (req.method === 'POST') {
        const type = req.headers['content-type'] || '';
        if (type.startsWith('multipart/form-data')) { const parsed = parseMultipart(await readBody(req, MAX_UPLOAD), type); ctx.body = parsed.fields; ctx.files = parsed.files; }
        else {
          // urlencoded: repeated fields (checkbox groups) become arrays
          const body = {};
          for (const [k, v] of new URLSearchParams((await readBody(req, MAX_FORM)).toString('utf8'))) {
            if (body[k] === undefined) body[k] = v; else body[k] = [].concat(body[k], v);
          }
          ctx.body = body;
        }
        if (!cookies.csrf || ctx.body._csrf !== cookies.csrf) throw new HttpError(403, 'csrf');
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname); if (!m) continue;
        r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
        await r.handler(ctx);
        return;
      }
      throw new HttpError(404);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(new Date().toISOString(), req.method, url.pathname, err);
      if (res.headersSent) { res.end(); return; }
      const key = status === 404 ? 'notFound' : status === 403 ? (err.message === 'csrf' ? 'errCsrf' : 'forbidden') : status === 413 ? 'tooLarge' : 'serverError';
      if (!ctx.csrf) ctx.csrf = token();
      send(ctx, status, layout(ctx, { title: ctx.t(key), body: P.message(ctx, ctx.t(key), ctx.t(key + 'P'), ['/', ctx.t('backHome')]) }));
    }
  };
}

module.exports = { createApp, esc };
