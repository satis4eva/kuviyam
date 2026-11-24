'use strict';
/*
 * Removing the sample data that seeding put on the staging site, so real data can start.
 *
 * Sample data is recognised by how seeding made it, never by guesswork:
 *   partners  the seeded slugs with an @example.org contact address
 *   people    accounts @demo.kuviyam.org and @members.demo.kuviyam.org
 *   notices   memorials with user_id 0 (seeded ones have no owner)
 * and everything that hangs off those: projects, students, reports, receipts, events, RSVPs, tickets,
 * posts, likes, comments, follows, messages, notifications, donations to them, files.
 * Real accounts (the admin, anyone who registered), settings and anything real people made are kept.
 *
 * A full copy of the database is saved next to it first, so it can be restored.
 * Afterwards a setting stops seeding from ever running again, even with SEED_DEMO=1.
 */
const path = require('node:path');
const { nowIso } = require('./util');

const SAMPLE_SLUGS = ['vanni-learning-trust', 'uva-hill-schools-fund', 'jaffna-mobile-libraries', 'batticaloa-womens-livelihoods', 'trinco-coconut-growers'];

const isRemoved = (db) => !!db.prepare(`SELECT 1 FROM settings WHERE key = 'sample_data_removed'`).get();

function sampleIds(db) {
  const ph = SAMPLE_SLUGS.map(() => '?').join(',');
  return {
    orgs: db.prepare(`SELECT id FROM orgs WHERE slug IN (${ph}) AND contact_email LIKE '%@example.org'`).all(...SAMPLE_SLUGS).map((r) => r.id),
    users: db.prepare(`SELECT id FROM users WHERE (email LIKE '%@demo.kuviyam.org' OR email LIKE '%@members.demo.kuviyam.org') AND role != 'admin'`).all().map((r) => r.id),
    memorials: db.prepare('SELECT id FROM memorials WHERE user_id = 0').all().map((r) => r.id)
  };
}

/** How much sample data there is, for the admin page. */
function sampleCounts(db) {
  if (isRemoved(db)) return null;
  const s = sampleIds(db);
  if (!s.orgs.length && !s.users.length && !s.memorials.length) return null;
  const inList = (ids) => (ids.length ? ids.join(',') : '-1');
  const one = (sql) => db.prepare(sql).get().n;
  return {
    partners: s.orgs.length, people: s.users.length, notices: s.memorials.length,
    projects: one(`SELECT COUNT(*) n FROM projects WHERE org_id IN (${inList(s.orgs)})`),
    students: one(`SELECT COUNT(*) n FROM students WHERE org_id IN (${inList(s.orgs)})`),
    events: one(`SELECT COUNT(*) n FROM events WHERE org_id IN (${inList(s.orgs)})`),
    posts: one(`SELECT COUNT(*) n FROM posts WHERE org_id IN (${inList(s.orgs)}) OR (org_id IS NULL AND user_id IN (${inList(s.users)}))`)
  };
}

function removeSampleData(db, adminId) {
  // 1. Back up the whole database first.
  const file = (db.prepare('PRAGMA database_list').all().find((d) => d.name === 'main') || {}).file;
  let backup = null;
  if (file) {
    backup = path.join(path.dirname(file), `backup-before-removing-sample-data-${nowIso().replace(/[:.]/g, '-')}.db`);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  }
  const s = sampleIds(db);
  const L = (ids) => (ids.length ? ids.join(',') : '-1');
  const O = L(s.orgs); const U = L(s.users); const M = L(s.memorials);
  const ids = (sql) => L(db.prepare(sql).all().map((r) => r.id));
  const counts = {};
  const run = (label, sql) => { const n = db.prepare(sql).run().changes; counts[label] = (counts[label] || 0) + n; };

  db.exec('BEGIN');
  try {
    const projects = ids(`SELECT id FROM projects WHERE org_id IN (${O})`);
    const students = ids(`SELECT id FROM students WHERE org_id IN (${O})`);
    const reports = ids(`SELECT id FROM reports WHERE org_id IN (${O})`);
    const expenses = ids(`SELECT id FROM expenses WHERE report_id IN (${reports})`);
    const events = ids(`SELECT id FROM events WHERE org_id IN (${O})`);
    // Seeded notices, plus any that point at a sample project.
    const memorials = L([...new Set([...s.memorials, ...db.prepare(`SELECT id FROM memorials WHERE project_id IN (${projects})`).all().map((r) => r.id)])]);
    const posts = ids(`SELECT id FROM posts WHERE org_id IN (${O}) OR (org_id IS NULL AND user_id IN (${U}))`);
    const comments = ids(`SELECT id FROM comments WHERE post_id IN (${posts}) OR user_id IN (${U})`);

    // Files that belong to what is going.
    run('files', `DELETE FROM files WHERE (owner_kind = 'expense' AND owner_id IN (${expenses})) OR (owner_kind = 'post' AND owner_id IN (${posts}))
      OR (owner_kind = 'memorial' AND owner_id IN (${memorials})) OR (owner_kind = 'avatar' AND owner_id IN (${U}))`);
    // Money and tickets tied to sample partners (all test payments).
    run('ticket orders', `DELETE FROM ticket_orders WHERE org_id IN (${O}) OR event_id IN (${events})`);
    run('payouts', `DELETE FROM payouts WHERE org_id IN (${O})`);
    run('donations', `DELETE FROM donations WHERE org_id IN (${O}) OR (kind = 'memorial' AND target_id IN (${memorials}))`);
    // Community.
    run('flags', `DELETE FROM flags WHERE (kind = 'post' AND target_id IN (${posts})) OR (kind = 'comment' AND target_id IN (${comments})) OR user_id IN (${U})`);
    run('likes', `DELETE FROM post_likes WHERE post_id IN (${posts}) OR user_id IN (${U})`);
    run('comments', `DELETE FROM comments WHERE id IN (${comments})`);
    run('notifications', `DELETE FROM notifications WHERE user_id IN (${U}) OR actor_id IN (${U}) OR (kind IN ('like','comment') AND target_id IN (${posts})) OR (kind = 'rsvp' AND target_id IN (${events}))`);
    run('posts', `DELETE FROM posts WHERE id IN (${posts})`);
    run('RSVPs', `DELETE FROM rsvps WHERE event_id IN (${events}) OR user_id IN (${U})`);
    run('emails', `DELETE FROM outbox WHERE event_id IN (${events}) OR org_id IN (${O}) OR user_id IN (${U})`);
    run('events', `DELETE FROM events WHERE id IN (${events})`);
    // Notices.
    run('candles', `DELETE FROM candles WHERE memorial_id IN (${memorials})`);
    run('condolences', `DELETE FROM condolences WHERE memorial_id IN (${memorials}) OR user_id IN (${U})`);
    run('notice events', `DELETE FROM memorial_events WHERE memorial_id IN (${memorials})`);
    run('notice posts', `DELETE FROM memorial_notices WHERE memorial_id IN (${memorials})`);
    run('notices', `DELETE FROM memorials WHERE id IN (${memorials})`);
    // Partners' own records.
    run('receipts', `DELETE FROM expenses WHERE id IN (${expenses})`);
    run('reports', `DELETE FROM reports WHERE id IN (${reports})`);
    run('students', `DELETE FROM students WHERE id IN (${students})`);
    run('projects', `DELETE FROM projects WHERE id IN (${projects})`);
    run('partner links', `DELETE FROM org_members WHERE org_id IN (${O}) OR user_id IN (${U})`);
    run('applications', `DELETE FROM applications WHERE org_id IN (${O}) OR user_id IN (${U})`);
    run('partners', `DELETE FROM orgs WHERE id IN (${O})`);
    // Sample people.
    run('follows', `DELETE FROM follows WHERE follower_id IN (${U}) OR followee_id IN (${U})`);
    run('blocks', `DELETE FROM blocks WHERE user_id IN (${U}) OR blocked_id IN (${U})`);
    run('messages', `DELETE FROM messages WHERE from_id IN (${U}) OR to_id IN (${U})`);
    run('memberships', `DELETE FROM memberships WHERE user_id IN (${U})`);
    run('sessions', `DELETE FROM sessions WHERE user_id IN (${U})`);
    run('people', `DELETE FROM users WHERE id IN (${U})`);
    // Keep real people's counts true: likes and going counts from what is left.
    db.exec(`UPDATE posts SET likes = (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id)`);
    db.exec(`UPDATE events SET going = (SELECT COUNT(*) FROM rsvps WHERE event_id = events.id)`);
    db.prepare(`INSERT INTO settings (key, value) VALUES ('sample_data_removed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(nowIso());
    db.prepare('INSERT INTO audit (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)').run(adminId, 'remove-sample-data', JSON.stringify(counts).slice(0, 900), nowIso());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { counts, backup: backup ? path.basename(backup) : null };
}

module.exports = { removeSampleData, sampleCounts, isRemoved };
