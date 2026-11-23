'use strict';
/* Community hub: partner feed (photos, videos, text), events with RSVP, obituaries and memorials. */
const { nowIso, clean } = require('./util');
const { checkFile } = require('./multipart');
const { audit } = require('./db');
const auth = require('./auth');
const C = require('./views/community');

const MODES = ['inperson', 'online', 'tickets', 'volunteers'];
const NOTICE_TYPES = ['obituary', 'sudden', 'thanks', 'r31', 'r1', 'r5', 'r10', 'tribute'];
const EVENT_KINDS = ['viewing', 'service', 'cremation', 'burial', 'prayer', 'other'];
const today = () => new Date().toISOString().slice(0, 10);

function registerCommunity(route, H) {
  const { db, page, redirect, requireUser, partnerOrg, requireAdmin, saveFile, tx, HttpError, fileErr } = H;
  const back = H.back = (ctx, fallback) => { const r = ctx.req.headers.referer; try { const u = new URL(r); if (u.pathname.startsWith('/')) return u.pathname + u.search; } catch { /* no referer */ } return fallback; };

  /* ---------------- feed ---------------- */
  // Posts come from partners (org_id set) or from members (org_id NULL, author in users).
  const POST_SQL = `SELECT p.*, o.name AS org_name, o.name_ta AS org_name_ta, o.slug AS org_slug, o.color AS org_color,
      u.name AS author_name, u.avatar_file_id AS author_avatar, u.tier AS author_tier, u.member_until AS author_until,
      pr.title AS project_title, pr.title_ta AS project_title_ta, pr.cause AS project_cause, pr.status AS project_status
    FROM posts p LEFT JOIN orgs o ON o.id = p.org_id LEFT JOIN users u ON u.id = p.user_id LEFT JOIN projects pr ON pr.id = p.project_id`;
  const VISIBLE = `p.status = 'live' AND (p.org_id IS NULL OR o.status = 'verified')`;
  H.VISIBLE = VISIBLE;
  const loadPosts = (ctx, where, args, limit = 30) => {
    let sql = `${POST_SQL} WHERE (${where})`; const a = [...args];
    if (ctx.user) { sql += ` AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ? UNION SELECT user_id FROM blocks WHERE blocked_id = ?)`; a.push(ctx.user.id, ctx.user.id); }
    const list = db.prepare(`${sql} ORDER BY p.created_at DESC LIMIT ${limit}`).all(...a);
    const liked = new Set(ctx.user ? db.prepare('SELECT post_id FROM post_likes WHERE user_id = ?').all(ctx.user.id).map((r) => r.post_id) : []);
    const now = nowIso();
    return list.map((p) => ({ ...p, liked: liked.has(p.id), author_tier: p.author_until && p.author_until > now ? p.author_tier : 'free',
      comments: db.prepare(`SELECT c.*, u.name AS user_name, u.avatar_file_id AS user_avatar FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.post_id = ? AND c.status = 'live' ORDER BY c.id`).all(p.id) }));
  };
  H.loadPosts = loadPosts;
  route('GET', '/community', (ctx) => {
    const view = ctx.user && ctx.query.get('view') === 'following' ? 'following' : 'all';
    const posts = view === 'following'
      ? loadPosts(ctx, `${VISIBLE} AND (p.user_id = ? OR (p.org_id IS NULL AND p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)))`, [ctx.user.id, ctx.user.id], 50)
      : loadPosts(ctx, VISIBLE, [], 50);
    page(ctx, { title: ctx.t('communityH'), active: 'community', body: C.feed(ctx, { posts, view, can: H.can }) });
  });
  route('GET', '/community/posts/:id', (ctx) => {
    const post = loadPosts(ctx, `p.id = ? AND ${VISIBLE}`, [Number(ctx.params.id)], 1)[0];
    if (!post) throw new HttpError(404);
    const text = (ctx.lang === 'ta' && post.text_ta) || post.text;
    const who = post.org_id ? (ctx.lang === 'ta' && post.org_name_ta) || post.org_name : post.author_name;
    page(ctx, { title: who, active: 'community', body: C.postPage(ctx, { post }),
      og: { title: who, description: text.slice(0, 200), path: `/community/posts/${post.id}`, image: post.file_id && post.kind === 'photo' ? `/files/${post.file_id}` : null } });
  });
  const livePost = (id) => { const p = db.prepare(`SELECT p.* FROM posts p LEFT JOIN orgs o ON o.id = p.org_id WHERE p.id = ? AND ${VISIBLE}`).get(Number(id)); if (!p) throw new HttpError(404); return p; };
  route('POST', '/community/posts/:id/like', (ctx) => {
    if (!requireUser(ctx)) return; const p = livePost(ctx.params.id);
    tx(() => {
      const had = db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(p.id, ctx.user.id).changes;
      if (!had) { db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(p.id, ctx.user.id); H.notify(p.user_id, ctx.user.id, 'like', p.id); }
      db.prepare('UPDATE posts SET likes = MAX(0, likes + ?) WHERE id = ?').run(had ? -1 : 1, p.id);
    });
    redirect(ctx, `${back(ctx, '/community')}#post-${p.id}`);
  });
  route('POST', '/community/posts/:id/comment', (ctx) => {
    if (!requireUser(ctx)) return; const p = livePost(ctx.params.id);
    const body = clean(ctx.body.body, 500);
    if (!body) return redirect(ctx, `${back(ctx, '/community')}#post-${p.id}`, { kind: 'bad', msg: ctx.t('errComment') });
    if (auth.throttled('comment:' + ctx.user.id, 30, 10 * 60 * 1000)) return redirect(ctx, back(ctx, '/community'), { kind: 'bad', msg: ctx.t('errThrottle') });
    db.prepare(`INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`).run(p.id, ctx.user.id, body, nowIso());
    H.notify(p.user_id, ctx.user.id, 'comment', p.id);
    redirect(ctx, `${back(ctx, '/community')}#post-${p.id}`);
  });
  for (const kind of ['post', 'comment']) {
    route('POST', `/community/${kind}s/:id/report`, (ctx) => {
      const id = Number(ctx.params.id);
      const exists = kind === 'post' ? db.prepare(`SELECT 1 FROM posts WHERE id = ? AND status = 'live'`).get(id) : db.prepare(`SELECT 1 FROM comments WHERE id = ? AND status = 'live'`).get(id);
      if (!exists) throw new HttpError(404);
      if (!auth.throttled('report:' + ctx.ip, 20) && !db.prepare(`SELECT 1 FROM flags WHERE kind = ? AND target_id = ? AND status = 'open'`).get(kind, id)) {
        db.prepare(`INSERT INTO flags (kind, target_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)`).run(kind, id, ctx.user ? ctx.user.id : null, clean(ctx.body.reason, 200) || null, nowIso());
      }
      redirect(ctx, back(ctx, '/community'), { kind: 'good', msg: ctx.t('reportedT') });
    });
  }

  /* ---------------- events ---------------- */
  route('GET', '/events', (ctx) => {
    const list = db.prepare(`SELECT e.*, o.name AS org_name, o.name_ta AS org_name_ta, o.slug AS org_slug FROM events e JOIN orgs o ON o.id = e.org_id
      WHERE e.status = 'live' AND o.status = 'verified' AND e.starts_on >= ? ORDER BY e.starts_on`).all(today());
    const mine = new Set(ctx.user ? db.prepare('SELECT event_id FROM rsvps WHERE user_id = ?').all(ctx.user.id).map((r) => r.event_id) : []);
    page(ctx, { title: ctx.t('eventsH'), active: 'community', body: C.events(ctx, { list: list.map((e) => ({ ...e, going_me: mine.has(e.id) })) }) });
  });
  route('POST', '/events/:id/rsvp', (ctx) => {
    if (!requireUser(ctx)) return;
    const e = db.prepare(`SELECT e.id FROM events e JOIN orgs o ON o.id = e.org_id WHERE e.id = ? AND e.status = 'live' AND o.status = 'verified'`).get(Number(ctx.params.id)); if (!e) throw new HttpError(404);
    let on = false;
    tx(() => {
      const had = db.prepare('DELETE FROM rsvps WHERE event_id = ? AND user_id = ?').run(e.id, ctx.user.id).changes;
      if (!had) { db.prepare('INSERT INTO rsvps (event_id, user_id) VALUES (?, ?)').run(e.id, ctx.user.id); on = true; }
      db.prepare('UPDATE events SET going = MAX(0, going + ?) WHERE id = ?').run(had ? -1 : 1, e.id);
    });
    redirect(ctx, `/events#event-${e.id}`, { kind: 'good', msg: ctx.t(on ? 'rsvpOn' : 'rsvpOff') });
  });

  /* ---------------- memorials (notices like a Tamil obituary board) ---------------- */
  const projectsForMemorial = () => db.prepare(`SELECT p.id, p.title, p.title_ta FROM projects p JOIN orgs o ON o.id = p.org_id WHERE p.status = 'live' AND o.status = 'verified' ORDER BY p.title`).all();
  route('GET', '/memorials', (ctx) => {
    const f = { q: clean(ctx.query.get('q'), 80), type: NOTICE_TYPES.includes(ctx.query.get('type')) ? ctx.query.get('type') : '' };
    let list = db.prepare(`SELECT n.id AS notice_id, n.type, n.created_at AS notice_at, m.*, (SELECT COUNT(*) FROM condolences c WHERE c.memorial_id = m.id AND c.status = 'live') AS messages
      FROM memorial_notices n JOIN memorials m ON m.id = n.memorial_id WHERE n.status = 'live' AND m.status = 'live' ORDER BY n.created_at DESC LIMIT 300`).all();
    if (f.type) list = list.filter((x) => x.type === f.type);
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter((x) => [x.name, x.name_ta, x.birthplace, x.birthplace_ta, x.lived_in, x.lived_in_ta, x.town, x.town_ta].join(' ').toLowerCase().includes(q)); }
    page(ctx, { title: ctx.t('memH'), active: 'community', body: C.memorials(ctx, { list, filters: f }) });
  });
  route('GET', '/memorials/new', (ctx) => {
    if (!requireUser(ctx)) return;
    page(ctx, { title: ctx.t('postNotice'), active: 'community', body: C.memorialForm(ctx, { values: { informed_by: ctx.t('family') }, projects: projectsForMemorial() }) });
  });
  const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const httpUrl = (v) => { try { const u = new URL(String(v || '').trim()); return /^https?:$/.test(u.protocol) ? u.href.slice(0, 300) : null; } catch { return null; } };
  const readEvents = (b) => [0, 1, 2].map((i) => ({ kind: EVENT_KINDS.includes(b[`ev_kind_${i}`]) ? b[`ev_kind_${i}`] : '', on_date: isoDate(b[`ev_date_${i}`]), start_time: /^\d{2}:\d{2}$/.test(b[`ev_start_${i}`] || '') ? b[`ev_start_${i}`] : null,
    end_time: /^\d{2}:\d{2}$/.test(b[`ev_end_${i}`] || '') ? b[`ev_end_${i}`] : null, venue: clean(b[`ev_venue_${i}`], 160), address: clean(b[`ev_address_${i}`], 240), stream_url: httpUrl(b[`ev_stream_${i}`]) }))
    .filter((e) => e.kind && e.on_date && e.venue);
  const imageFiles = (ctx, field, max, errs) => ctx.files.filter((x) => x.field === field).slice(0, max).filter((f) => { const e = checkFile(f, 'media'); if (e || f.mime === 'video/mp4') { errs.push(fileErr(ctx, e || 'bad_media', f.filename)); return false; } return true; });
  route('POST', '/memorials', (ctx) => {
    if (!requireUser(ctx)) return;
    const b = ctx.body; const errs = [];
    const v = { name: clean(b.name, 120), name_ta: clean(b.name_ta, 120), born_on: isoDate(b.born_on), died_on: isoDate(b.died_on), birthplace: clean(b.birthplace, 120), birthplace_ta: clean(b.birthplace_ta, 120),
      lived_in: clean(b.lived_in, 200), lived_in_ta: clean(b.lived_in_ta, 200), informed_by: clean(b.informed_by, 120), contacts: clean(b.contacts, 800),
      type: NOTICE_TYPES.includes(b.type) ? b.type : 'obituary', body: clean(b.body, 4000), body_ta: clean(b.body_ta, 4000), project_id: Number(b.project_id) || null };
    if (!v.name || !v.died_on || !v.birthplace || (!v.body && !v.body_ta)) errs.push(ctx.t('required'));
    if (v.born_on && v.died_on && v.born_on > v.died_on) errs.push(ctx.t('errDates'));
    if (v.project_id && !projectsForMemorial().some((p) => p.id === v.project_id)) v.project_id = null;
    const main = imageFiles(ctx, 'photo', 1, errs)[0]; const gallery = imageFiles(ctx, 'gallery', 6, errs);
    const events = readEvents(b);
    if (errs.length) return page(ctx, { active: 'community', body: C.memorialForm(ctx, { values: b, projects: projectsForMemorial(), errors: errs }) }, 400);
    const years = `${v.born_on ? v.born_on.slice(0, 4) : ''}${v.born_on ? ' – ' : ''}${v.died_on.slice(0, 4)}`;
    tx(() => {
      const id = Number(db.prepare(`INSERT INTO memorials (user_id, name, name_ta, years, town, town_ta, tribute, tribute_ta, project_id, status, created_at, born_on, died_on, birthplace, birthplace_ta, lived_in, lived_in_ta, informed_by, contacts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ctx.user.id, v.name, v.name_ta || null, years, v.lived_in || v.birthplace, v.lived_in_ta || v.birthplace_ta || null,
        v.body || v.body_ta, v.body_ta || null, v.project_id, nowIso(), v.born_on, v.died_on, v.birthplace, v.birthplace_ta || null, v.lived_in || null, v.lived_in_ta || null, v.informed_by || null, v.contacts || null).lastInsertRowid);
      db.prepare(`INSERT INTO memorial_notices (memorial_id, user_id, type, body, body_ta, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`).run(id, ctx.user.id, v.type, v.body || v.body_ta, v.body_ta || null, nowIso());
      for (const e of events) db.prepare(`INSERT INTO memorial_events (memorial_id, kind, on_date, start_time, end_time, venue, address, stream_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, e.kind, e.on_date, e.start_time, e.end_time, e.venue, e.address || null, e.stream_url);
      if (main) db.prepare('UPDATE memorials SET file_id = ? WHERE id = ?').run(saveFile('memorial', id, 'photo', main), id);
      for (const g of gallery) saveFile('memorial', id, 'gallery', g);
      audit(db, ctx.user.id, 'memorial-create', `#${id}`);
    });
    redirect(ctx, '/memorials', { kind: 'good', msg: ctx.t('tributeSent') });
  });
  const memorialById = (id, allowPending) => {
    const m = db.prepare(`SELECT m.*, p.title AS project_title, p.title_ta AS project_title_ta, p.status AS project_status FROM memorials m LEFT JOIN projects p ON p.id = m.project_id WHERE m.id = ?`).get(Number(id));
    if (!m || (m.status !== 'live' && !allowPending)) throw new HttpError(404); return m;
  };
  const memorialDetail = (m, includePending) => ({
    notices: db.prepare(`SELECT * FROM memorial_notices WHERE memorial_id = ? AND status IN (${includePending ? "'live','pending'" : "'live'"}) ORDER BY created_at DESC`).all(m.id),
    events: db.prepare('SELECT * FROM memorial_events WHERE memorial_id = ? ORDER BY on_date, start_time').all(m.id),
    gallery: db.prepare(`SELECT id FROM files WHERE owner_kind = 'memorial' AND owner_id = ? AND label = 'gallery' ORDER BY id`).all(m.id)
  });
  H.memorialDetail = memorialDetail;
  /* The family (whoever posted the person) can add later notices: 31st day, yearly remembrance, thank-you. */
  route('POST', '/memorials/:id/notices', (ctx) => {
    if (!requireUser(ctx)) return; const m = memorialById(ctx.params.id);
    if (m.user_id !== ctx.user.id && ctx.user.role !== 'admin') throw new HttpError(403);
    const type = NOTICE_TYPES.includes(ctx.body.type) ? ctx.body.type : ''; const body = clean(ctx.body.body, 4000); const bodyTa = clean(ctx.body.body_ta, 4000);
    if (!type || (!body && !bodyTa)) return redirect(ctx, `/memorials/${m.id}#add-notice`, { kind: 'bad', msg: ctx.t('required') });
    db.prepare(`INSERT INTO memorial_notices (memorial_id, user_id, type, body, body_ta, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`).run(m.id, ctx.user.id, type, body || bodyTa, bodyTa || null, nowIso());
    redirect(ctx, `/memorials/${m.id}`, { kind: 'good', msg: ctx.t('noticeSent') });
  });
  const candleKey = (ctx) => (ctx.user ? 'u' + ctx.user.id : 'c' + ctx.csrf);
  route('GET', '/memorials/:id', (ctx) => {
    const m = memorialById(ctx.params.id);
    const condol = db.prepare(`SELECT * FROM condolences WHERE memorial_id = ? AND status = 'live' ORDER BY id`).all(m.id);
    const lit = !!db.prepare('SELECT 1 FROM candles WHERE memorial_id = ? AND who = ?').get(m.id, candleKey(ctx));
    const isOwner = ctx.user && (ctx.user.id === m.user_id || ctx.user.role === 'admin');
    page(ctx, { title: m.name, active: 'community', body: C.memorial(ctx, { m, condol, lit, isOwner, ...memorialDetail(m, isOwner) }) });
  });
  route('POST', '/memorials/:id/candle', (ctx) => {
    const m = memorialById(ctx.params.id);
    tx(() => { const r = db.prepare('INSERT OR IGNORE INTO candles (memorial_id, who) VALUES (?, ?)').run(m.id, candleKey(ctx)); if (r.changes) db.prepare('UPDATE memorials SET candles = candles + 1 WHERE id = ?').run(m.id); });
    redirect(ctx, `/memorials/${m.id}`, { kind: 'good', msg: ctx.t('candleT') });
  });
  route('POST', '/memorials/:id/condolence', (ctx) => {
    if (!requireUser(ctx)) return; const m = memorialById(ctx.params.id);
    const name = clean(ctx.body.name, 120) || ctx.user.name; const body = clean(ctx.body.body, 1000);
    if (!body) return redirect(ctx, `/memorials/${m.id}`, { kind: 'bad', msg: ctx.t('errComment') });
    if (auth.throttled('condol:' + ctx.user.id, 20, 10 * 60 * 1000)) return redirect(ctx, `/memorials/${m.id}`, { kind: 'bad', msg: ctx.t('errThrottle') });
    db.prepare(`INSERT INTO condolences (memorial_id, user_id, name, body, created_at) VALUES (?, ?, ?, ?, ?)`).run(m.id, ctx.user.id, name, body, nowIso());
    redirect(ctx, `/memorials/${m.id}#condolences`, { kind: 'good', msg: ctx.t('msgPosted') });
  });

  /* ---------------- partner dashboard: posts and events ---------------- */
  const orgProjects = (o) => db.prepare(`SELECT id, title, title_ta FROM projects WHERE org_id = ? AND status = 'live' ORDER BY created_at DESC`).all(o.id);
  route('GET', '/dashboard/posts', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    page(ctx, { title: ctx.t('tPosts'), active: 'dashboard', body: C.dashPosts(ctx, { org: o, projects: orgProjects(o), posts: loadPosts(ctx, `p.org_id = ? AND p.status = 'live'`, [o.id], 50), values: {} }) });
  });
  route('POST', '/dashboard/posts', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    const b = ctx.body; const errs = [];
    const v = { text: clean(b.text, 1500), text_ta: clean(b.text_ta, 1500), project_id: Number(b.project_id) || null };
    if (!v.text && !v.text_ta) errs.push(ctx.t('errPostText'));
    if (v.project_id && !orgProjects(o).some((p) => p.id === v.project_id)) v.project_id = null;
    const f = ctx.files.find((x) => x.field === 'media');
    if (f) { const e = checkFile(f, 'media'); if (e) errs.push(fileErr(ctx, e, f.filename)); }
    if (errs.length) return page(ctx, { active: 'dashboard', body: C.dashPosts(ctx, { org: o, projects: orgProjects(o), posts: loadPosts(ctx, `p.org_id = ? AND p.status = 'live'`, [o.id], 50), values: b, errors: errs }) }, 400);
    tx(() => {
      const id = Number(db.prepare(`INSERT INTO posts (org_id, user_id, text, text_ta, project_id, kind, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'live', ?)`)
        .run(o.id, ctx.user.id, v.text || v.text_ta, v.text_ta || null, v.project_id, f ? (f.mime === 'video/mp4' ? 'video' : 'photo') : 'text', nowIso()).lastInsertRowid);
      if (f) db.prepare('UPDATE posts SET file_id = ? WHERE id = ?').run(saveFile('post', id, f.mime === 'video/mp4' ? 'video' : 'photo', f), id);
    });
    redirect(ctx, '/community', { kind: 'good', msg: ctx.t('postedT') });
  });
  route('POST', '/dashboard/posts/:id/delete', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    const r = db.prepare(`UPDATE posts SET status = 'removed' WHERE id = ? AND org_id = ?`).run(Number(ctx.params.id), o.id); if (!r.changes) throw new HttpError(404);
    redirect(ctx, '/dashboard/posts', { kind: 'good', msg: ctx.t('postRemoved') });
  });
  route('GET', '/dashboard/events', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    page(ctx, { title: ctx.t('tEvents'), active: 'dashboard', body: C.dashEvents(ctx, { org: o, events: db.prepare('SELECT * FROM events WHERE org_id = ? ORDER BY starts_on DESC').all(o.id), values: { place: o.place } }) });
  });
  route('POST', '/dashboard/events', (ctx) => {
    const o = partnerOrg(ctx); if (!o) return;
    const b = ctx.body; const errs = [];
    const v = { title: clean(b.title, 160), title_ta: clean(b.title_ta, 160), starts_on: String(b.starts_on || ''), place: clean(b.place, 160), place_ta: clean(b.place_ta, 160), mode: MODES.includes(b.mode) ? b.mode : '', price: clean(b.price, 30), details: clean(b.details, 1500), details_ta: clean(b.details_ta, 1500) };
    if (!v.title && !v.title_ta) errs.push(ctx.t('errTitle'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.starts_on) || v.starts_on < today()) errs.push(ctx.t('errEventDate'));
    if (!v.place || !v.mode) errs.push(ctx.t('required'));
    if (errs.length) return page(ctx, { active: 'dashboard', body: C.dashEvents(ctx, { org: o, events: db.prepare('SELECT * FROM events WHERE org_id = ? ORDER BY starts_on DESC').all(o.id), values: b, errors: errs }) }, 400);
    db.prepare(`INSERT INTO events (org_id, title, title_ta, starts_on, place, place_ta, mode, price, details, details_ta, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(o.id, v.title || v.title_ta, v.title_ta || null, v.starts_on, v.place, v.place_ta || null, v.mode, v.mode === 'tickets' ? v.price || null : null, v.details || null, v.details_ta || null, nowIso());
    redirect(ctx, '/dashboard/events', { kind: 'good', msg: ctx.t('eventSent') });
  });

  /* ---------------- admin moderation ---------------- */
  H.adminCommunityQueue = () => ({
    events: db.prepare(`SELECT e.*, o.name AS org_name, o.name_ta AS org_name_ta FROM events e JOIN orgs o ON o.id = e.org_id WHERE e.status = 'pending' ORDER BY e.created_at`).all(),
    memorials: db.prepare(`SELECT * FROM memorials WHERE status = 'pending' ORDER BY created_at`).all(),
    notices: db.prepare(`SELECT n.*, m.name, m.name_ta FROM memorial_notices n JOIN memorials m ON m.id = n.memorial_id WHERE n.status = 'pending' AND m.status = 'live' ORDER BY n.created_at`).all(),
    flags: db.prepare(`SELECT * FROM flags WHERE status = 'open' ORDER BY created_at`).all().map((f) => ({ ...f,
      text: f.kind === 'post' ? (db.prepare('SELECT text FROM posts WHERE id = ?').get(f.target_id) || {}).text : (db.prepare('SELECT body FROM comments WHERE id = ?').get(f.target_id) || {}).body }))
  });
  for (const [act, status] of [['approve', 'live'], ['reject', 'rejected']]) {
    route('POST', `/admin/events/:id/${act}`, (ctx) => {
      if (!requireAdmin(ctx)) return;
      const r = db.prepare(`UPDATE events SET status = ?, reason = ? WHERE id = ? AND status = 'pending'`).run(status, clean(ctx.body.reason, 300) || null, Number(ctx.params.id)); if (!r.changes) throw new HttpError(404);
      audit(db, ctx.user.id, 'event-' + act, `#${ctx.params.id}`);
      redirect(ctx, '/admin', { kind: 'good', msg: ctx.t(act === 'approve' ? 'approvedT' : 'rejectedT') });
    });
    route('POST', `/admin/memorials/:id/${act}`, (ctx) => {
      if (!requireAdmin(ctx)) return;
      const r = db.prepare(`UPDATE memorials SET status = ?, reason = ? WHERE id = ? AND status = 'pending'`).run(status, clean(ctx.body.reason, 300) || null, Number(ctx.params.id)); if (!r.changes) throw new HttpError(404);
      db.prepare(`UPDATE memorial_notices SET status = ? WHERE memorial_id = ? AND status = 'pending'`).run(status, Number(ctx.params.id));
      audit(db, ctx.user.id, 'memorial-' + act, `#${ctx.params.id}`);
      redirect(ctx, '/admin', { kind: 'good', msg: ctx.t(act === 'approve' ? 'approvedT' : 'rejectedT') });
    });
  }
  for (const [act, status] of [['approve', 'live'], ['reject', 'rejected']]) {
    route('POST', `/admin/notices/:id/${act}`, (ctx) => {
      if (!requireAdmin(ctx)) return;
      const r = db.prepare(`UPDATE memorial_notices SET status = ?, reason = ? WHERE id = ? AND status = 'pending'`).run(status, clean(ctx.body.reason, 300) || null, Number(ctx.params.id)); if (!r.changes) throw new HttpError(404);
      audit(db, ctx.user.id, 'notice-' + act, `#${ctx.params.id}`);
      redirect(ctx, '/admin', { kind: 'good', msg: ctx.t(act === 'approve' ? 'approvedT' : 'rejectedT') });
    });
  }
  route('GET', '/admin/memorials/:id', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const m = memorialById(ctx.params.id, true);
    page(ctx, { title: ctx.t('qObit'), active: 'admin', body: C.adminMemorial(ctx, { m, ...memorialDetail(m, true) }) });
  });
  for (const act of ['keep', 'remove']) {
    route('POST', `/admin/flags/:id/${act}`, (ctx) => {
      if (!requireAdmin(ctx)) return;
      const f = db.prepare(`SELECT * FROM flags WHERE id = ? AND status = 'open'`).get(Number(ctx.params.id)); if (!f) throw new HttpError(404);
      tx(() => {
        if (act === 'remove') db.prepare(`UPDATE ${f.kind === 'post' ? 'posts' : 'comments'} SET status = 'removed' WHERE id = ?`).run(f.target_id);
        db.prepare(`UPDATE flags SET status = ? WHERE kind = ? AND target_id = ? AND status = 'open'`).run(act === 'remove' ? 'removed' : 'kept', f.kind, f.target_id);
      });
      audit(db, ctx.user.id, 'flag-' + act, `${f.kind} #${f.target_id}`);
      redirect(ctx, '/admin', { kind: 'good', msg: ctx.t(act === 'remove' ? 'removedT' : 'keptT') });
    });
  }
}

module.exports = { registerCommunity, MODES, NOTICE_TYPES, EVENT_KINDS };
