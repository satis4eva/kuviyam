'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { nowIso } = require('./util');

/*
 * Storage: one SQLite file kept OUTSIDE the deployed app folder, so redeploys never wipe it.
 * DATA_DIR defaults to ~/kuviyam-data. Uploaded documents are stored in the database (BLOB)
 * so backups are a single file. Swap this module for PostgreSQL when traffic grows.
 */
function open(file) {
  const dataDir = process.env.DATA_DIR || path.join(os.homedir(), 'kuviyam-data');
  const dbFile = file || process.env.DB_FILE || path.join(dataDir, 'kuviyam.db');
  if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
     password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'donor', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS orgs (
     id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_ta TEXT, type TEXT NOT NULL,
     country TEXT NOT NULL, place TEXT NOT NULL, cause TEXT NOT NULL, about TEXT, about_ta TEXT,
     status TEXT NOT NULL DEFAULT 'verified', since INTEGER, color TEXT, contact_email TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS org_members (
     org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL DEFAULT 'owner', PRIMARY KEY (org_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS applications (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL, name TEXT NOT NULL, name_ta TEXT,
     country TEXT NOT NULL, town TEXT NOT NULL, area TEXT, reg_no TEXT NOT NULL, founded INTEGER, website TEXT,
     contact TEXT NOT NULL, contact_role TEXT, email TEXT NOT NULL, phone TEXT, causes TEXT NOT NULL, about TEXT NOT NULL, about_ta TEXT,
     status TEXT NOT NULL DEFAULT 'pending', reason TEXT, org_id INTEGER, created_at TEXT NOT NULL, reviewed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS files (
     id INTEGER PRIMARY KEY, owner_kind TEXT NOT NULL, owner_id INTEGER NOT NULL, label TEXT NOT NULL,
     filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS projects (
     id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), title TEXT NOT NULL, title_ta TEXT,
     cause TEXT NOT NULL, district TEXT NOT NULL, goal_pence INTEGER NOT NULL, raised_pence INTEGER NOT NULL DEFAULT 0,
     donors INTEGER NOT NULL DEFAULT 0, ends_on TEXT, urgent INTEGER NOT NULL DEFAULT 0, needs TEXT, needs_ta TEXT,
     status TEXT NOT NULL DEFAULT 'live', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS students (
     id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), name TEXT NOT NULL, name_ta TEXT, grade INTEGER NOT NULL,
     district TEXT NOT NULL, dream TEXT, dream_ta TEXT, monthly_pence INTEGER NOT NULL, sponsored INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS donations (
     id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, target_id INTEGER NOT NULL, org_id INTEGER NOT NULL,
     amount_pence INTEGER NOT NULL, tip_pence INTEGER NOT NULL DEFAULT 0, gift_aid INTEGER NOT NULL DEFAULT 0, monthly INTEGER NOT NULL DEFAULT 0,
     donor_name TEXT NOT NULL, donor_email TEXT NOT NULL, anonymous INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
     provider TEXT NOT NULL, provider_ref TEXT, user_id INTEGER, created_at TEXT NOT NULL, paid_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS reports (
     id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), month TEXT NOT NULL, received_pence INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'draft', note TEXT, submitted_at TEXT, reviewed_at TEXT, UNIQUE (org_id, month))`,
  `CREATE TABLE IF NOT EXISTS expenses (
     id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE, description TEXT NOT NULL, description_ta TEXT,
     category TEXT NOT NULL, district TEXT NOT NULL, amount_lkr INTEGER NOT NULL, file_id INTEGER, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL)`,
  /* ---- community hub ---- */
  `CREATE TABLE IF NOT EXISTS posts (
     id INTEGER PRIMARY KEY, org_id INTEGER REFERENCES orgs(id), user_id INTEGER NOT NULL, text TEXT NOT NULL, text_ta TEXT,
     project_id INTEGER, file_id INTEGER, kind TEXT NOT NULL DEFAULT 'text', status TEXT NOT NULL DEFAULT 'live', likes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS post_likes (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, PRIMARY KEY (post_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS comments (
     id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, body TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'live', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS flags (
     id INTEGER PRIMARY KEY, kind TEXT NOT NULL, target_id INTEGER NOT NULL, user_id INTEGER, reason TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), title TEXT NOT NULL, title_ta TEXT, starts_on TEXT NOT NULL, place TEXT NOT NULL, place_ta TEXT,
     mode TEXT NOT NULL, price TEXT, details TEXT, details_ta TEXT, status TEXT NOT NULL DEFAULT 'pending', reason TEXT, going INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rsvps (event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, PRIMARY KEY (event_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS memorials (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, name_ta TEXT, years TEXT NOT NULL, town TEXT NOT NULL, town_ta TEXT,
     tribute TEXT NOT NULL, tribute_ta TEXT, project_id INTEGER, file_id INTEGER, status TEXT NOT NULL DEFAULT 'pending', reason TEXT,
     candles INTEGER NOT NULL DEFAULT 0, raised_pence INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS candles (memorial_id INTEGER NOT NULL REFERENCES memorials(id) ON DELETE CASCADE, who TEXT NOT NULL, PRIMARY KEY (memorial_id, who))`,
  `CREATE TABLE IF NOT EXISTS condolences (
     id INTEGER PRIMARY KEY, memorial_id INTEGER NOT NULL REFERENCES memorials(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'live', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS memorial_notices (
     id INTEGER PRIMARY KEY, memorial_id INTEGER NOT NULL REFERENCES memorials(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, type TEXT NOT NULL,
     body TEXT NOT NULL, body_ta TEXT, status TEXT NOT NULL DEFAULT 'pending', reason TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS memorial_events (
     id INTEGER PRIMARY KEY, memorial_id INTEGER NOT NULL REFERENCES memorials(id) ON DELETE CASCADE, kind TEXT NOT NULL, on_date TEXT NOT NULL,
     start_time TEXT, end_time TEXT, venue TEXT NOT NULL, address TEXT, stream_url TEXT)`,
  /* ---- members: memberships, follows, messages, notifications ---- */
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS memberships (
     id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, tier TEXT NOT NULL, period TEXT NOT NULL,
     amount_pence INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', provider TEXT NOT NULL, provider_ref TEXT, created_at TEXT NOT NULL, paid_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS follows (
     follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL, PRIMARY KEY (follower_id, followee_id))`,
  `CREATE TABLE IF NOT EXISTS blocks (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (user_id, blocked_id))`,
  `CREATE TABLE IF NOT EXISTS messages (
     id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS notifications (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL, target_id INTEGER, created_at TEXT NOT NULL, read_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(from_id, to_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id, read_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, starts_on)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_org ON reports(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_report ON expenses(report_id)`,
  `CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_kind, owner_id)`
];

const COLUMNS = { users: [['bio', 'TEXT'], ['home_town', 'TEXT'], ['avatar_file_id', 'INTEGER'], ['tier', "TEXT NOT NULL DEFAULT 'free'"], ['member_until', 'TEXT']],
  memorials: [['born_on', 'TEXT'], ['died_on', 'TEXT'], ['birthplace', 'TEXT'], ['birthplace_ta', 'TEXT'], ['lived_in', 'TEXT'], ['lived_in_ta', 'TEXT'], ['informed_by', 'TEXT'], ['contacts', 'TEXT']] };
function migrate(db) {
  // Members can post too, so a post no longer needs a partner: rebuild posts with org_id optional (one-off).
  const orgCol = db.prepare(`SELECT "notnull" AS nn FROM pragma_table_info('posts') WHERE name = 'org_id'`).get();
  if (orgCol && orgCol.nn) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`CREATE TABLE posts_new (
        id INTEGER PRIMARY KEY, org_id INTEGER REFERENCES orgs(id), user_id INTEGER NOT NULL, text TEXT NOT NULL, text_ta TEXT,
        project_id INTEGER, file_id INTEGER, kind TEXT NOT NULL DEFAULT 'text', status TEXT NOT NULL DEFAULT 'live', likes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
      db.exec('INSERT INTO posts_new SELECT id, org_id, user_id, text, text_ta, project_id, file_id, kind, status, likes, created_at FROM posts');
      db.exec('DROP TABLE posts');
      db.exec('ALTER TABLE posts_new RENAME TO posts');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
  }
  for (const s of SCHEMA) db.exec(s);
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of cols) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  // Older memorials kept their text in memorials.tribute: give each one an obituary notice.
  db.exec(`INSERT INTO memorial_notices (memorial_id, user_id, type, body, body_ta, status, created_at)
    SELECT m.id, m.user_id, 'obituary', m.tribute, m.tribute_ta, CASE m.status WHEN 'live' THEN 'live' WHEN 'pending' THEN 'pending' ELSE 'rejected' END, m.created_at
    FROM memorials m WHERE NOT EXISTS (SELECT 1 FROM memorial_notices n WHERE n.memorial_id = m.id)`);
}

const audit = (db, userId, action, detail) =>
  db.prepare('INSERT INTO audit (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)').run(userId ?? null, action, detail ? String(detail).slice(0, 500) : null, nowIso());

module.exports = { open, audit };
