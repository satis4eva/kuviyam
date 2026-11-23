'use strict';
const crypto = require('node:crypto');

const SESSION_DAYS = 30;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* ignore bad cookie */ } }
  });
  return out;
}
function cookie(name, value, { maxAge, secure, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

function createSession(db, userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, exp);
  return { id, maxAge: SESSION_DAYS * 86400 };
}
function destroySession(db, id) { if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id); }
function userFromSession(db, id) {
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const row = db.prepare(`SELECT u.id, u.email, u.name, u.role, u.tier, u.member_until, u.avatar_file_id, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id);
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) { destroySession(db, id); return null; }
  const orgs = db.prepare(`SELECT o.id, o.slug, o.name, o.name_ta, o.status, m.role FROM org_members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY o.id`).all(row.id);
  const tier = row.member_until && row.member_until > new Date().toISOString() ? row.tier : 'free';
  return { id: row.id, email: row.email, name: row.name, role: row.role, tier, member_until: row.member_until, avatar_file_id: row.avatar_file_id, orgs };
}

/* Simple in-memory throttle for login and registration attempts. */
const attempts = new Map();
function throttled(key, limit = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now); attempts.set(key, list);
  return list.length > limit;
}

module.exports = { hashPassword, verifyPassword, parseCookies, cookie, createSession, destroySession, userFromSession, throttled };
