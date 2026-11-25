'use strict';
/*
 * Members: free and paid memberships (Silver, Gold), member profiles, posting in the feed,
 * follows, one-to-one messages, notifications and blocking.
 *
 * Free:   profile, follow, like, comment, reply to messages someone else started.
 * Silver: everything free + post text and photos, start conversations, Silver badge.
 * Gold:   everything Silver + post short videos, Gold badge.
 * Admins and verified partner staff can post and message without a membership.
 */
const { nowIso, clean, ref, toPence } = require('./util');
const { checkFile } = require('./multipart');
const { provider } = require('./payments');
const { audit } = require('./db');
const auth = require('./auth');
const S = require('./views/social');

const TIERS = ['silver', 'gold'];
const PERIODS = ['month', 'year'];
const DEFAULT_PRICES = { silver_month: 500, silver_year: 5000, gold_month: 1000, gold_year: 10000 };

const isPartner = (u) => !!(u && u.orgs && u.orgs.some((o) => o.status === 'verified'));
const isPaid = (u) => !!(u && TIERS.includes(u.tier));
const can = {
  post: (u) => !!u && (u.role === 'admin' || isPartner(u) || isPaid(u)),
  video: (u) => !!u && (u.role === 'admin' || isPartner(u) || u.tier === 'gold'),
  startChat: (u) => !!u && (u.role === 'admin' || isPartner(u) || isPaid(u))
};
const activeTier = (row) => (row && row.member_until && row.member_until > nowIso() && TIERS.includes(row.tier) ? row.tier : 'free');

function registerSocial(route, H) {
  const { db, page, redirect, requireUser, requireAdmin, saveFile, tx, HttpError, fileErr } = H;

  /* ---------------- settings: prices ---------------- */
  const prices = () => {
    const out = { ...DEFAULT_PRICES };
    for (const r of db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'price_%'`).all()) {
      const k = r.key.slice(6); if (k in out && Number(r.value) >= 0) out[k] = Number(r.value);
    }
    return out;
  };
  H.prices = prices;

  /* ---------------- notifications ---------------- */
  const notify = (userId, actorId, kind, targetId) => {
    if (!userId || userId === actorId) return;
    if (actorId && db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').get(userId, actorId)) return;
    // Collapse repeats (e.g. like, unlike, like) into one unread notification.
    if (db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND actor_id IS ? AND kind = ? AND target_id IS ? AND read_at IS NULL').get(userId, actorId ?? null, kind, targetId ?? null)) return;
    db.prepare('INSERT INTO notifications (user_id, actor_id, kind, target_id, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, actorId ?? null, kind, targetId ?? null, nowIso());
  };
  H.notify = notify;
  H.counts = (u) => (u ? {
    notes: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(u.id).n,
    msgs: db.prepare('SELECT COUNT(*) n FROM messages WHERE to_id = ? AND read_at IS NULL').get(u.id).n
  } : null);

  const blocked = (a, b) => !!db.prepare('SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)').get(a, b, b, a);
  const memberById = (id) => {
    const m = db.prepare('SELECT id, name, email, role, bio, home_town, avatar_file_id, tier, member_until, created_at FROM users WHERE id = ?').get(Number(id));
    if (!m) throw new HttpError(404);
    return { ...m, tier: activeTier(m) };
  };

  /* ---------------- membership plans and checkout ---------------- */
  route('GET', '/membership', (ctx) => {
    page(ctx, { title: ctx.t('mbH'), active: 'membership', body: S.plans(ctx, { prices: prices() }) });
  });
  route('POST', '/membership/checkout', (ctx) => {
    if (!requireUser(ctx)) return;
    const tier = TIERS.includes(ctx.body.tier) ? ctx.body.tier : null; const period = PERIODS.includes(ctx.body.period) ? ctx.body.period : null;
    if (!tier || !period) throw new HttpError(400);
    // A Gold member can't buy Silver over it while Gold is still running.
    if (ctx.user.tier === 'gold' && tier === 'silver') return redirect(ctx, '/membership', { kind: 'warn', msg: ctx.t('mbDowngrade') });
    const amount = prices()[`${tier}_${period}`];
    if (!(amount >= 100)) throw new HttpError(400);
    const pv = provider(); const r = ref('CM');
    db.prepare(`INSERT INTO memberships (ref, user_id, tier, period, amount_pence, status, provider, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`).run(r, ctx.user.id, tier, period, amount, pv.name, nowIso());
    const start = pv.start({ ref: r, amount_pence: amount, kind: 'membership' });
    redirect(ctx, start.redirect.replace(/^\/pay\//, '/membership/pay/'));
  });
  const membershipByRef = (ctx, r) => {
    const m = db.prepare('SELECT * FROM memberships WHERE ref = ?').get(String(r));
    if (!m || !ctx.user || m.user_id !== ctx.user.id) throw new HttpError(404);
    return m;
  };
  route('GET', '/membership/pay/:ref', (ctx) => {
    if (!requireUser(ctx)) return;
    const m = membershipByRef(ctx, ctx.params.ref);
    if (m.status === 'paid') return redirect(ctx, `/members/${ctx.user.id}`);
    page(ctx, { title: ctx.t('payment'), body: S.pay(ctx, { m, testMode: provider().testMode }) });
  });
  route('POST', '/membership/pay/:ref', (ctx) => {
    if (!requireUser(ctx)) return;
    const m = membershipByRef(ctx, ctx.params.ref);
    if (m.status === 'paid') return redirect(ctx, `/members/${ctx.user.id}`);
    const result = provider().confirm(m, ctx.req);
    if (!result.ok) { db.prepare(`UPDATE memberships SET status = 'failed' WHERE id = ?`).run(m.id); return redirect(ctx, `/membership/pay/${m.ref}`, { kind: 'bad', msg: ctx.t('payFailed') }); }
    tx(() => {
      const upd = db.prepare(`UPDATE memberships SET status = 'paid', provider_ref = ?, paid_at = ? WHERE id = ? AND status = 'pending'`).run(result.providerRef, nowIso(), m.id);
      if (upd.changes !== 1) return;
      const u = db.prepare('SELECT tier, member_until FROM users WHERE id = ?').get(m.user_id);
      // Renewing the same tier adds time to what is left; switching tier starts from today.
      const from = activeTier(u) === m.tier ? new Date(u.member_until) : new Date();
      if (m.period === 'year') from.setUTCFullYear(from.getUTCFullYear() + 1); else from.setUTCMonth(from.getUTCMonth() + 1);
      db.prepare('UPDATE users SET tier = ?, member_until = ? WHERE id = ?').run(m.tier, from.toISOString(), m.user_id);
      audit(db, m.user_id, 'membership-paid', `${m.tier}/${m.period} ${m.ref}`);
    });
    redirect(ctx, `/members/${ctx.user.id}`, { kind: 'good', msg: ctx.t('mbWelcome', { t: ctx.t('tier_' + m.tier) }) });
  });

  /* ---------------- members: directory, profiles, editing ---------------- */
  route('GET', '/members', (ctx) => {
    const q = clean(ctx.query.get('q'), 80);
    // Only people who have filled in a profile or posted are listed, so donors who just gave once stay out of view.
    const args = []; let where = `u.role != 'admin' AND (u.bio IS NOT NULL OR u.home_town IS NOT NULL OR u.avatar_file_id IS NOT NULL OR u.id IN (SELECT user_id FROM posts WHERE org_id IS NULL AND status = 'live'))`;
    if (q) { where = `(${where}) AND (u.name LIKE ? OR u.home_town LIKE ?)`; args.push(`%${q}%`, `%${q}%`); }
    const list = db.prepare(`SELECT u.id, u.name, u.home_town, u.avatar_file_id, u.tier, u.member_until, (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
      FROM users u WHERE ${where} ORDER BY followers DESC, u.name LIMIT 60`).all(...args).map((m) => ({ ...m, tier: activeTier(m) }));
    page(ctx, { title: ctx.t('membersH'), active: 'community', body: S.members(ctx, { list, q }) });
  });
  route('GET', '/members/:id', (ctx) => {
    const m = memberById(ctx.params.id);
    const me = ctx.user;
    const rel = me && me.id !== m.id ? {
      following: !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(me.id, m.id),
      followsMe: !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(m.id, me.id),
      iBlocked: !!db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').get(me.id, m.id),
      blockedMe: !!db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').get(m.id, me.id)
    } : null;
    const stats = {
      followers: db.prepare('SELECT COUNT(*) n FROM follows WHERE followee_id = ?').get(m.id).n,
      following: db.prepare('SELECT COUNT(*) n FROM follows WHERE follower_id = ?').get(m.id).n,
      posts: db.prepare(`SELECT COUNT(*) n FROM posts WHERE user_id = ? AND org_id IS NULL AND status = 'live'`).get(m.id).n
    };
    const posts = rel && rel.blockedMe ? [] : H.loadPosts(ctx, `p.user_id = ? AND p.org_id IS NULL AND p.status = 'live'`, [m.id], 30);
    const memberships = me && me.id === m.id ? db.prepare(`SELECT * FROM memberships WHERE user_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 5`).all(m.id) : [];
    page(ctx, { title: m.name, active: 'community', body: S.profile(ctx, { m, rel, stats, posts, memberships, isMe: me && me.id === m.id }) });
  });
  route('GET', '/members/:id/:which', (ctx) => {
    const which = ctx.params.which; if (which !== 'followers' && which !== 'following') throw new HttpError(404);
    const m = memberById(ctx.params.id);
    const list = db.prepare(which === 'followers'
      ? 'SELECT u.id, u.name, u.home_town, u.avatar_file_id, u.tier, u.member_until FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? ORDER BY f.created_at DESC'
      : 'SELECT u.id, u.name, u.home_town, u.avatar_file_id, u.tier, u.member_until FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? ORDER BY f.created_at DESC').all(m.id).map((x) => ({ ...x, tier: activeTier(x) }));
    page(ctx, { title: m.name, active: 'community', body: S.followList(ctx, { m, which, list }) });
  });
  route('GET', '/me', (ctx) => { if (!requireUser(ctx)) return; redirect(ctx, `/members/${ctx.user.id}`); });
  route('GET', '/me/edit', (ctx) => {
    if (!requireUser(ctx)) return;
    page(ctx, { title: ctx.t('editProfile'), active: 'community', body: S.editProfile(ctx, { values: memberById(ctx.user.id) }) });
  });
  route('POST', '/me/edit', (ctx) => {
    if (!requireUser(ctx)) return;
    const b = ctx.body; const errs = [];
    const v = { name: clean(b.name, 120), bio: clean(b.bio, 500), home_town: clean(b.home_town, 120) };
    if (!v.name) errs.push(ctx.t('errName'));
    const f = (ctx.files || []).find((x) => x.field === 'avatar' && x.data.length);
    if (f) { const e = checkFile(f, 'media'); if (e || f.mime === 'video/mp4' || f.mime === 'application/pdf') errs.push(fileErr(ctx, e || 'bad_media', f.filename)); }
    if (errs.length) return page(ctx, { active: 'community', body: S.editProfile(ctx, { values: { ...memberById(ctx.user.id), ...v }, errors: errs }) }, 400);
    tx(() => {
      db.prepare('UPDATE users SET name = ?, bio = ?, home_town = ? WHERE id = ?').run(v.name, v.bio || null, v.home_town || null, ctx.user.id);
      if (f) {
        const old = db.prepare('SELECT avatar_file_id FROM users WHERE id = ?').get(ctx.user.id).avatar_file_id;
        db.prepare('UPDATE users SET avatar_file_id = ? WHERE id = ?').run(saveFile('avatar', ctx.user.id, 'avatar', f), ctx.user.id);
        if (old) db.prepare(`DELETE FROM files WHERE id = ? AND owner_kind = 'avatar'`).run(old);
      }
      if (b.remove_avatar === '1' && !f) {
        const old = db.prepare('SELECT avatar_file_id FROM users WHERE id = ?').get(ctx.user.id).avatar_file_id;
        db.prepare('UPDATE users SET avatar_file_id = NULL WHERE id = ?').run(ctx.user.id);
        if (old) db.prepare(`DELETE FROM files WHERE id = ? AND owner_kind = 'avatar'`).run(old);
      }
    });
    redirect(ctx, `/members/${ctx.user.id}`, { kind: 'good', msg: ctx.t('profileSaved') });
  });

  /* ---------------- follow and block ---------------- */
  route('POST', '/members/:id/follow', (ctx) => {
    if (!requireUser(ctx)) return;
    const m = memberById(ctx.params.id); if (m.id === ctx.user.id) throw new HttpError(400);
    if (blocked(ctx.user.id, m.id)) return redirect(ctx, `/members/${m.id}`, { kind: 'bad', msg: ctx.t('blockedNote') });
    let on = false;
    tx(() => {
      const had = db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(ctx.user.id, m.id).changes;
      if (!had) { db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(ctx.user.id, m.id, nowIso()); on = true; notify(m.id, ctx.user.id, 'follow', null); }
    });
    redirect(ctx, H.back(ctx, `/members/${m.id}`), { kind: 'good', msg: ctx.t(on ? 'followOn' : 'followOff', { n: m.name }) });
  });
  route('POST', '/members/:id/block', (ctx) => {
    if (!requireUser(ctx)) return;
    const m = memberById(ctx.params.id); if (m.id === ctx.user.id || m.role === 'admin') throw new HttpError(400);
    let on = false;
    tx(() => {
      const had = db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(ctx.user.id, m.id).changes;
      if (!had) {
        db.prepare('INSERT INTO blocks (user_id, blocked_id) VALUES (?, ?)').run(ctx.user.id, m.id); on = true;
        db.prepare('DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)').run(ctx.user.id, m.id, m.id, ctx.user.id);
      }
    });
    redirect(ctx, `/members/${m.id}`, { kind: 'good', msg: ctx.t(on ? 'blockOn' : 'blockOff', { n: m.name }) });
  });

  /* ---------------- member posts ---------------- */
  route('POST', '/community/posts', (ctx) => {
    if (!requireUser(ctx)) return;
    if (!can.post(ctx.user)) return redirect(ctx, '/membership', { kind: 'warn', msg: ctx.t('needPaidPost') });
    const text = clean(ctx.body.text, 2000);
    const f = (ctx.files || []).find((x) => x.field === 'media' && x.data.length);
    let err = null;
    if (!text && !f) err = ctx.t('errPostText');
    if (f) { const e = checkFile(f, 'media'); if (e) err = fileErr(ctx, e, f.filename); else if (f.mime === 'video/mp4' && !can.video(ctx.user)) err = ctx.t('needGoldVideo'); }
    if (!err && auth.throttled('post:' + ctx.user.id, 20, 60 * 60 * 1000)) err = ctx.t('errThrottle');
    if (err) return redirect(ctx, '/community', { kind: 'bad', msg: err });
    tx(() => {
      const kind = f ? (f.mime === 'video/mp4' ? 'video' : 'photo') : 'text';
      const id = Number(db.prepare(`INSERT INTO posts (org_id, user_id, text, kind, status, created_at) VALUES (NULL, ?, ?, ?, 'live', ?)`).run(ctx.user.id, text || '', kind, nowIso()).lastInsertRowid);
      if (f) db.prepare('UPDATE posts SET file_id = ? WHERE id = ?').run(saveFile('post', id, kind, f), id);
    });
    redirect(ctx, '/community', { kind: 'good', msg: ctx.t('postedT') });
  });
  route('POST', '/community/posts/:id/delete', (ctx) => {
    if (!requireUser(ctx)) return;
    const p = db.prepare(`SELECT id, user_id, org_id FROM posts WHERE id = ? AND status = 'live'`).get(Number(ctx.params.id)); if (!p) throw new HttpError(404);
    if (!(ctx.user.role === 'admin' || (p.org_id === null && p.user_id === ctx.user.id))) throw new HttpError(403);
    db.prepare(`UPDATE posts SET status = 'removed' WHERE id = ?`).run(p.id);
    if (ctx.user.role === 'admin') audit(db, ctx.user.id, 'post-remove', `#${p.id}`);
    redirect(ctx, H.back(ctx, '/community'), { kind: 'good', msg: ctx.t('postRemoved') });
  });
  route('POST', '/community/comments/:id/delete', (ctx) => {
    if (!requireUser(ctx)) return;
    const c = db.prepare(`SELECT c.id, c.user_id, c.post_id, p.user_id AS post_user, p.org_id FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ? AND c.status = 'live'`).get(Number(ctx.params.id)); if (!c) throw new HttpError(404);
    const mayDelete = ctx.user.role === 'admin' || c.user_id === ctx.user.id || (c.org_id === null && c.post_user === ctx.user.id);
    if (!mayDelete) throw new HttpError(403);
    db.prepare(`UPDATE comments SET status = 'removed' WHERE id = ?`).run(c.id);
    redirect(ctx, `${H.back(ctx, '/community')}#post-${c.post_id}`);
  });

  /* ---------------- messages ---------------- */
  route('GET', '/messages', (ctx) => {
    if (!requireUser(ctx)) return;
    const me = ctx.user.id;
    const threads = db.prepare(`SELECT other, MAX(created_at) AS last_at, SUM(unread) AS unread FROM (
        SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other, created_at, CASE WHEN to_id = ? AND read_at IS NULL THEN 1 ELSE 0 END AS unread
        FROM messages WHERE from_id = ? OR to_id = ?) GROUP BY other ORDER BY last_at DESC LIMIT 100`).all(me, me, me, me)
      .map((t) => {
        const u = db.prepare('SELECT id, name, avatar_file_id, tier, member_until FROM users WHERE id = ?').get(t.other);
        const last = db.prepare('SELECT body, from_id FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT 1').get(me, t.other, t.other, me);
        return u && { ...t, user: { ...u, tier: activeTier(u) }, last };
      }).filter(Boolean);
    page(ctx, { title: ctx.t('messagesH'), active: 'messages', body: S.inbox(ctx, { threads, canStart: can.startChat(ctx.user) }) });
  });
  const mayMessage = (me, other) => {
    if (blocked(me.id, other.id)) return 'blockedNote';
    if (can.startChat(me)) return null;
    // Free members can reply once the other person has written to them.
    return db.prepare('SELECT 1 FROM messages WHERE from_id = ? AND to_id = ?').get(other.id, me.id) ? null : 'needPaidMsg';
  };
  route('GET', '/messages/:id', (ctx) => {
    if (!requireUser(ctx)) return;
    const other = memberById(ctx.params.id); if (other.id === ctx.user.id) return redirect(ctx, '/messages');
    const list = db.prepare('SELECT * FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT 200').all(ctx.user.id, other.id, other.id, ctx.user.id).reverse();
    db.prepare('UPDATE messages SET read_at = ? WHERE from_id = ? AND to_id = ? AND read_at IS NULL').run(nowIso(), other.id, ctx.user.id);
    db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND actor_id = ? AND kind = 'message' AND read_at IS NULL`).run(nowIso(), ctx.user.id, other.id);
    page(ctx, { title: other.name, active: 'messages', body: S.thread(ctx, { other, list, blockReason: mayMessage(ctx.user, other) }) });
  });
  route('POST', '/messages/:id', (ctx) => {
    if (!requireUser(ctx)) return;
    const other = memberById(ctx.params.id); if (other.id === ctx.user.id) throw new HttpError(400);
    const why = mayMessage(ctx.user, other);
    if (why) return redirect(ctx, why === 'needPaidMsg' ? '/membership' : `/messages/${other.id}`, { kind: 'warn', msg: ctx.t(why) });
    const body = clean(ctx.body.body, 2000);
    if (!body) return redirect(ctx, `/messages/${other.id}`);
    if (auth.throttled('msg:' + ctx.user.id, 60, 10 * 60 * 1000)) return redirect(ctx, `/messages/${other.id}`, { kind: 'bad', msg: ctx.t('errThrottle') });
    db.prepare('INSERT INTO messages (from_id, to_id, body, created_at) VALUES (?, ?, ?, ?)').run(ctx.user.id, other.id, body, nowIso());
    notify(other.id, ctx.user.id, 'message', null);
    redirect(ctx, `/messages/${other.id}#end`);
  });

  /* ---------------- notifications ---------------- */
  route('GET', '/notifications', (ctx) => {
    if (!requireUser(ctx)) return;
    const list = db.prepare(`SELECT n.*, u.name AS actor_name, u.avatar_file_id AS actor_avatar, p.text AS post_text, ev.title AS event_title FROM notifications n
      LEFT JOIN users u ON u.id = n.actor_id LEFT JOIN posts p ON p.id = n.target_id AND n.kind IN ('like','comment') LEFT JOIN events ev ON ev.id = n.target_id AND n.kind = 'rsvp'
      WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`).all(ctx.user.id);
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), ctx.user.id);
    page(ctx, { title: ctx.t('notesH'), active: 'notes', body: S.notifications(ctx, { list }) });
  });

  /* ---------------- admin: membership prices and members ---------------- */
  route('GET', '/admin/membership', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const members = db.prepare(`SELECT id, name, email, tier, member_until FROM users WHERE member_until > ? AND tier IN ('silver','gold') ORDER BY member_until`).all(nowIso());
    const payments = db.prepare(`SELECT m.*, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.status = 'paid' ORDER BY m.id DESC LIMIT 100`).all();
    const totals = { free: db.prepare('SELECT COUNT(*) n FROM users').get().n - members.length, silver: members.filter((m) => m.tier === 'silver').length, gold: members.filter((m) => m.tier === 'gold').length };
    page(ctx, { title: ctx.t('tMembership'), active: 'admin', body: S.adminMembership(ctx, { prices: prices(), members, payments, totals }) });
  });
  route('POST', '/admin/membership/prices', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const next = {}; const errs = [];
    for (const k of Object.keys(DEFAULT_PRICES)) {
      const p = toPence(ctx.body[k]);
      if (!(p >= 100 && p <= 100000)) errs.push(ctx.t('errPrice')); else next[k] = p;
    }
    if (errs.length) return redirect(ctx, '/admin/membership', { kind: 'bad', msg: errs[0] });
    tx(() => { for (const [k, v] of Object.entries(next)) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('price_' + k, String(v)); });
    audit(db, ctx.user.id, 'prices', JSON.stringify(next));
    redirect(ctx, '/admin/membership', { kind: 'good', msg: ctx.t('pricesSaved') });
  });
}

module.exports = { registerSocial, can, activeTier, isPaid, TIERS, DEFAULT_PRICES };
