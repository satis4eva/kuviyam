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
  `CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_org ON reports(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_report ON expenses(report_id)`,
  `CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_kind, owner_id)`
];

function migrate(db) { for (const s of SCHEMA) db.exec(s); }

const audit = (db, userId, action, detail) =>
  db.prepare('INSERT INTO audit (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)').run(userId ?? null, action, detail ? String(detail).slice(0, 500) : null, nowIso());

module.exports = { open, audit };
