'use strict';
const http = require('node:http');
const { open } = require('./src/db');
const { seedDemo, seedCommunity, seedNotices, seedMembers } = require('./src/seed');
const { createApp } = require('./src/app');

const db = open();
if (process.env.SEED_DEMO === '1') {
  if (seedDemo(db)) console.log('Seeded demo data.');
  if (seedCommunity(db)) console.log('Seeded community demo data.');
  if (seedNotices(db)) console.log('Seeded demo notice details.');
  if (seedMembers(db)) console.log('Seeded demo members.');
}

// Admin bootstrap: set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) to create
// that admin, or to make an existing account admin and reset its password.
// Remove both variables once you can sign in.
{
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = String(process.env.ADMIN_PASSWORD || '');
  if (email && pw) {
    if (pw.length < 12) console.warn('ADMIN_PASSWORD must be at least 12 characters; admin not set.');
    else {
      const { hashPassword } = require('./src/auth');
      const { nowIso } = require('./src/util');
      const { audit } = require('./src/db');
      const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      let id;
      if (row) {
        db.prepare(`UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?`).run(hashPassword(pw), row.id);
        id = Number(row.id);
      } else {
        id = Number(db.prepare(`INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)`)
          .run(email, 'Admin', hashPassword(pw), nowIso()).lastInsertRowid);
      }
      audit(db, id, 'env-admin');
      console.log(`Admin account ready: ${email}`);
    }
  }
}

const server = http.createServer(createApp(db));
server.requestTimeout = 60_000;
const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Kuviyam running on port ${port}`));

const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
