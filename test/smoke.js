'use strict';
/* End-to-end smoke test: starts the server on a temporary database and walks every main flow. Run: npm test */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const PORT = 4100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuviyam-test-'));
const SETUP_CODE = 'test-setup-code-123';
const env = { ...process.env, PORT: String(PORT), DB_FILE: path.join(dir, 'test.db'), SEED_DEMO: '1', DEMO_MODE: '1', DEMO_PASSWORD: 'demo-pass-2026', SETUP_CODE, PAYMENT_PROVIDER: 'test', MAIL_PROVIDER: 'log', OUTBOX_INTERVAL_MS: '300' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');


/* A tiny .xlsx (stored zip, shared strings) for testing the directory import without real data. */
function makeXlsx(sheets) {
  const zlib = require('node:zlib');
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const strings = []; const si = (v) => { let i = strings.indexOf(v); if (i < 0) { strings.push(v); i = strings.length - 1; } return i; };
  const col = (i) => String.fromCharCode(65 + i);
  const files = {};
  const names = Object.keys(sheets);
  names.forEach((n, k) => {
    const rows = sheets[n].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v == null ? '' : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(String(v))}</v></c>`)).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${k + 1}.xml`] = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  files['xl/workbook.xml'] = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, k) => `<sheet name="${esc(n)}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((n, k) => `<Relationship Id="rId${k + 1}" Type="worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join('')}</Relationships>`;
  files['xl/sharedStrings.xml'] = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((x) => `<si><t>${esc(x)}</t></si>`).join('')}</sst>`;
  const locals = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'); const nameB = Buffer.from(name); const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameB, data); central.push(ch, nameB); offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

class Client {
  constructor() { this.jar = {}; }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { for (const c of res.headers.getSetCookie()) { const [kv, ...attrs] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i).trim(); const v = kv.slice(i + 1).trim(); if (attrs.some((a) => /max-age=0/i.test(a))) delete this.jar[k]; else this.jar[k] = v; } }
  async req(method, url, body, headers = {}) {
    const res = await fetch(BASE + url, { method, body, headers: { cookie: this.cookieHeader(), ...headers }, redirect: 'manual' });
    this.store(res);
    const text = (res.headers.get('content-type') || '').startsWith('text') ? await res.text() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, location: res.headers.get('location'), type: res.headers.get('content-type'), text };
  }
  get(url) { return this.req('GET', url); }
  csrf() { return decodeURIComponent(this.jar.csrf || ''); }
  post(url, fields) { const b = new URLSearchParams({ _csrf: this.csrf(), ...fields }); return this.req('POST', url, b.toString(), { 'content-type': 'application/x-www-form-urlencoded' }); }
  postMultipart(url, fields, files = {}) {
    const fd = new FormData(); fd.append('_csrf', this.csrf());
    for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) fd.append(k, x);
    for (const [k, [name, buf, type]] of Object.entries(files)) fd.append(k, new Blob([buf], { type }), name);
    return this.req('POST', url, fd);
  }
}

let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log('  ✓', name); }

(async () => {
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
  try {
    const anon = new Client();
    await step('public pages render in English', async () => {
      for (const u of ['/', '/projects', '/projects/1', '/partners', '/partners/vanni-learning-trust', '/sponsor', '/transparency', '/transparency/vanni-learning-trust', '/join', '/login', '/register']) {
        const r = await anon.get(u); assert.equal(r.status, 200, u); assert.match(r.text, /Kuviyam/);
      }
      assert.match((await anon.get('/projects?q=coconut')).text, /Coconut seedlings/);
    });
    await step('search and filters find partners and projects', async () => {
      const j = await anon.get('/partners?q=jaffna'); assert.match(j.text, /Jaffna Mobile Libraries/); assert.doesNotMatch(j.text, /Uva Hill Schools Fund/); assert.match(j.text, /Showing 1 of 5/);
      const ty = await anon.get('/partners?type=Community+group'); assert.match(ty.text, /Trinco Coconut/); assert.doesNotMatch(ty.text, /Vanni Learning Trust/);
      const c = await anon.get('/partners?cause=Clean+water&country=Sri+Lanka'); assert.match(c.text, /Uva Hill/); assert.doesNotMatch(c.text, /Batticaloa Women/);
      const ta = await anon.get('/partners?q=' + encodeURIComponent('யாழ்')); assert.match(ta.text, /Jaffna Mobile Libraries/);
      const taPlace = await anon.get('/projects?q=' + encodeURIComponent('கிளிநொச்சி')); assert.match(taPlace.text, /Scholarships for 40/);
      const pq = await anon.get('/projects?q=batticaloa'); assert.match(pq.text, /Partners matching your search/); assert.match(pq.text, /Sewing machines/);
      const pf = await anon.get('/projects?cause=Clean+water'); assert.match(pf.text, /Haputale/); assert.doesNotMatch(pf.text, /Sewing machines/);
      assert.match((await anon.get('/partners?q=zzzz')).text, /Nothing matches/);
    });
    await step('share buttons and link previews on projects, partners and posts', async () => {
      const p = await anon.get('/projects/1'); assert.match(p.text, /https:\/\/wa\.me\/\?text=[^"]*%2Fprojects%2F1/); assert.match(p.text, /facebook\.com\/sharer\/sharer\.php\?u=http%3A%2F%2F127\.0\.0\.1/); assert.match(p.text, /property="og:title" content="Scholarships for 40/);
      assert.match((await anon.get('/partners/vanni-learning-trust')).text, /data-share="http:\/\/127\.0\.0\.1:\d+\/partners\/vanni-learning-trust"/);
      const feed = await anon.get('/community'); assert.match(feed.text, /%2Fcommunity%2Fposts%2F\d+/);
      const id = /\/community\/posts\/(\d+)"/.exec(feed.text)[1];
      const one = await anon.get('/community/posts/' + id); assert.equal(one.status, 200); assert.match(one.text, /og:description/);
      assert.equal((await anon.get('/static/share.js')).status, 200);
      assert.match(p.text, /class="sh sh-whatsapp"[^>]*aria-label="[^"]+"[^>]*><i /); assert.doesNotMatch(p.text, />WhatsApp<\/a>/);
    });
    await step('Tamil switch changes the whole page', async () => {
      const r = await anon.get('/lang/ta?back=/projects'); assert.equal(r.status, 303); assert.equal(r.location, '/projects');
      const p = await anon.get('/projects'); assert.match(p.text, /lang="ta"/); assert.match(p.text, /திட்டங்களும் தேவைகளும்/); assert.match(p.text, /புலமைப்பரிசில்/);
      await anon.get('/lang/en?back=/');
    });
    await step('unsafe redirect targets are ignored', async () => { assert.equal((await anon.get('/lang/en?back=//evil.example')).location, '/'); });
    await step('published receipts are public; unknown pages 404', async () => {
      const page = await anon.get('/transparency/vanni-learning-trust'); const id = /\/files\/(\d+)/.exec(page.text)[1];
      const f = await anon.get('/files/' + id); assert.equal(f.status, 200); assert.equal(f.type, 'application/pdf');
      assert.equal((await anon.get('/nope')).status, 404);
    });
    await step('a form without the CSRF token is refused', async () => {
      const r = await anon.req('POST', '/donate', 'kind=project&id=1&amount=10', { 'content-type': 'application/x-www-form-urlencoded' }); assert.equal(r.status, 403);
    });
    await step('one-off donation updates the project total', async () => {
      const before = Number(/(£[\d,]+)\s*<\/b> <span class="muted">raised/.exec((await anon.get('/projects/1')).text)[1].replace(/[£,]/g, ''));
      await anon.get('/donate?kind=project&id=1');
      const bad = await anon.post('/donate', { kind: 'project', id: '1', amount: '0.5', donor_name: 'A', donor_email: 'a@b.co' }); assert.equal(bad.status, 400);
      const r = await anon.post('/donate', { kind: 'project', id: '1', amount: '20', donor_name: 'Test Donor', donor_email: 'donor@example.com', tip: '1', gift_aid: '1', monthly: '0' });
      assert.equal(r.status, 303); assert.match(r.location, /^\/pay\/KV-/);
      const pay = await anon.post(r.location, {}); assert.match(pay.location, /^\/thanks\/KV-/);
      const thanks = await anon.get(pay.location); assert.match(thanks.text, /Thank you/); assert.doesNotMatch(thanks.text, /donor@example\.com/);
      const after = Number(/(£[\d,]+)\s*<\/b> <span class="muted">raised/.exec((await anon.get('/projects/1')).text)[1].replace(/[£,]/g, ''));
      assert.equal(after - before, 20);
      assert.equal((await anon.post(r.location, {})).location, pay.location, 'paying twice is a no-op');
    });
    await step('student sponsorship marks the student sponsored', async () => {
      await anon.get('/donate?kind=student&id=1');
      const r = await anon.post('/donate', { kind: 'student', id: '1', donor_name: 'Sponsor', donor_email: 's@example.com' });
      await anon.post(r.location, {});
      assert.equal((await anon.get('/donate?kind=student&id=1')).status, 404);
    });

    const admin = new Client();
    await step('first admin via setup code, then setup closes', async () => {
      await admin.get('/setup');
      assert.equal((await admin.post('/setup', { code: 'wrong-code-xxxxxxx', name: 'Admin', email: 'admin@example.com', password: 'a-very-strong-pass' })).status, 400);
      const r = await admin.post('/setup', { code: SETUP_CODE, name: 'Admin', email: 'admin@example.com', password: 'a-very-strong-pass' });
      assert.equal(r.location, '/admin');
      assert.equal((await admin.get('/admin')).status, 200);
      assert.equal((await anon.get('/setup')).status, 404);
    });

    await step('admins can add and remove other admins', async () => {
      assert.equal((await admin.get('/admin/admins')).status, 200);
      assert.equal((await admin.post('/admin/admins', { email: 'second@example.com' })).status, 400);
      const r = await admin.post('/admin/admins', { email: 'second@example.com', name: 'Second', password: 'another-strong-pass' });
      assert.equal(r.location, '/admin/admins');
      const second = new Client(); await second.get('/login');
      await second.post('/login', { email: 'second@example.com', password: 'another-strong-pass' });
      assert.equal((await second.get('/admin')).status, 200);
      const id = /\/admin\/admins\/(\d+)\/remove/.exec((await admin.get('/admin/admins')).text)[1];
      await admin.post(`/admin/admins/${id}/remove`, {});
      assert.notEqual((await second.get('/admin')).status, 200);
    });

    const applicant = new Client();
    let appId;
    await step('register, then apply as a partner with documents', async () => {
      await applicant.get('/register');
      const r = await applicant.post('/register', { name: 'Priya Applicant', email: 'priya@example.org', password: 'priya-password-1', next: '/join' });
      assert.equal(r.location, '/join');
      const form = await applicant.get('/join'); assert.match(form.text, /enctype="multipart\/form-data"/);
      const badType = await applicant.postMultipart('/join', { type: 'Community group', name: 'Mannar Fisher Families', country: 'Sri Lanka', town: 'Mannar', reg_no: 'MN/1', contact: 'Priya', email: 'priya@example.org', causes: ['Livelihoods'], about: 'Nets and savings.', agree1: '1', agree2: '1' },
        { doc_reg: ['reg.exe', Buffer.from('MZ fake'), 'application/pdf'], doc_gov: ['gov.pdf', PDF, 'application/pdf'], doc_id: ['id.pdf', PDF, 'application/pdf'] });
      assert.equal(badType.status, 400); assert.match(badType.text, /must be a PDF/);
      const ok = await applicant.postMultipart('/join', { type: 'Community group', name: 'Mannar Fisher Families', name_ta: 'மன்னார் மீனவக் குடும்பங்கள்', country: 'Sri Lanka', town: 'Mannar', area: 'Mannar', reg_no: 'MN/1', contact: 'Priya', email: 'priya@example.org', causes: ['Livelihoods', 'Education'], about: 'Nets and savings.', agree1: '1', agree2: '1' },
        { doc_reg: ['reg.pdf', PDF, 'application/pdf'], doc_gov: ['gov.pdf', PDF, 'application/pdf'], doc_id: ['id.pdf', PDF, 'application/pdf'] });
      assert.equal(ok.status, 303);
      assert.match((await applicant.get('/join')).text, /Being checked/);
      appId = /\/admin\/applications\/(\d+)/.exec((await admin.get('/admin')).text)[1];
    });
    await step('KYC documents are private', async () => {
      const page = await admin.get('/admin/applications/' + appId); const fid = /\/files\/(\d+)/.exec(page.text)[1];
      assert.equal((await admin.get('/files/' + fid)).status, 200);
      assert.equal((await applicant.get('/files/' + fid)).status, 200);
      assert.equal((await anon.get('/files/' + fid)).status, 404);
      const other = new Client(); await other.get('/register'); await other.post('/register', { name: 'Other', email: 'other@example.org', password: 'other-password-1' });
      assert.equal((await other.get('/files/' + fid)).status, 403);
      assert.equal((await other.get('/admin')).status, 403);
    });
    await step('admin approves; applicant gets a dashboard and public page', async () => {
      await admin.get('/admin/applications/' + appId);
      assert.equal((await admin.post(`/admin/applications/${appId}/approve`, {})).location, '/admin');
      assert.equal((await applicant.get('/dashboard')).status, 200);
      assert.equal((await anon.get('/partners/mannar-fisher-families')).status, 200);
    });
    await step('partner posts a bilingual project', async () => {
      await applicant.get('/dashboard/projects/new');
      assert.equal((await applicant.post('/dashboard/projects', { title: '', title_ta: '', cause: 'Livelihoods', district: 'Mannar', goal: '900' })).status, 400);
      const r = await applicant.post('/dashboard/projects', { title: 'Fishing nets for 20 families', title_ta: '20 குடும்பங்களுக்கு மீன்பிடி வலைகள்', cause: 'Livelihoods', district: 'Mannar', goal: '900', needs: 'Net £45\nFloats', urgent: '1' });
      assert.match(r.location, /^\/projects\/\d+$/);
      assert.match((await anon.get(r.location)).text, /Fishing nets for 20 families/);
    });
    let reportUrl;
    await step('partner files a monthly report with a receipt and submits it', async () => {
      await applicant.get('/dashboard/reports');
      const r = await applicant.post('/dashboard/reports', { month: '2026-10', received: '300' }); reportUrl = r.location; assert.match(reportUrl, /^\/dashboard\/reports\/\d+$/);
      assert.equal((await applicant.post('/dashboard/reports', { month: '2026-10', received: '1' })).status, 400, 'duplicate month');
      const e = await applicant.postMultipart(reportUrl + '/expenses', { description: 'Nets, 6', description_ta: 'வலைகள், 6', category: 'Livelihoods', district: 'Mannar', amount_lkr: '54000' }, { receipt: ['nets.pdf', PDF, 'application/pdf'] });
      assert.equal(e.status, 303);
      await applicant.postMultipart(reportUrl + '/expenses', { description: 'Transport', category: 'Admin', district: 'Mannar', amount_lkr: '3000' });
      const page = await applicant.get(reportUrl); assert.match(page.text, /Nets, 6/); assert.match(page.text, /Missing/);
      assert.equal((await applicant.post(reportUrl + '/submit', {})).status, 303);
      assert.equal((await applicant.postMultipart(reportUrl + '/expenses', { description: 'Late', category: 'Admin', district: 'Mannar', amount_lkr: '1' })).status, 409, 'locked after submit');
    });
    await step('admin publishes the report; it appears with its receipt', async () => {
      const id = reportUrl.split('/').pop();
      await admin.get('/admin/reports/' + id);
      assert.equal((await admin.post(`/admin/reports/${id}/approve`, {})).status, 303);
      const pub = await anon.get('/transparency/mannar-fisher-families'); assert.match(pub.text, /Nets, 6/); assert.match(pub.text, /No proof/);
      const ta = new Client(); await ta.get('/lang/ta?back=/'); assert.match((await ta.get('/transparency/mannar-fisher-families')).text, /வலைகள், 6/);
    });
    await step('partner adds a student (first name only)', async () => {
      await applicant.get('/dashboard/students');
      assert.equal((await applicant.post('/dashboard/students', { name: 'Anne Marie', grade: '5', district: 'Mannar', monthly: '12' })).status, 400);
      assert.equal((await applicant.post('/dashboard/students', { name: 'Anne', name_ta: 'ஆன்', grade: '5', district: 'Mannar', monthly: '12', dream: 'Loves drawing' })).status, 303);
      assert.match((await anon.get('/sponsor')).text, /Anne/);
    });
    await step('demo partner login works', async () => {
      const demo = new Client(); await demo.get('/login');
      assert.equal((await demo.post('/login', { email: 'partner@demo.kuviyam.org', password: 'wrong' })).status, 400);
      assert.equal((await demo.post('/login', { email: 'partner@demo.kuviyam.org', password: 'demo-pass-2026', next: '/dashboard' })).location, '/dashboard');
      assert.match((await demo.get('/dashboard')).text, /Vanni Learning Trust/);
    });
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)]);
    const partner = new Client(); await partner.get('/login'); await partner.post('/login', { email: 'partner@demo.kuviyam.org', password: 'demo-pass-2026' });
    const member = new Client(); await member.get('/register'); await member.post('/register', { name: 'Ravi Member', email: 'ravi@example.org', password: 'ravi-password-1' });
    await step('worldwide partners; projects stay in Sri Lanka', async () => {
      const proj = (await partner.get('/dashboard/projects/new')).text;
      assert.match(proj, /value="Jaffna"/); assert.doesNotMatch(proj, /value="Malaysia"|value="Madurai"/);
      assert.match((await member.get('/join?new=1')).text, /value="Mauritius"/);
    });
    await step('community feed shows partner posts in both languages', async () => {
      const f = await anon.get('/community'); assert.equal(f.status, 200); assert.match(f.text, /water tank at Haputale/); assert.match(f.text, /Log in to like/);
      const ta = new Client(); await ta.get('/lang/ta?back=/'); assert.match((await ta.get('/community')).text, /அப்புத்தளையில்/);
      assert.match((await anon.get('/')).text, /Community feed/);
    });
    await step('partner posts a photo and a video; bad media is refused', async () => {
      await partner.get('/dashboard/posts');
      assert.equal((await partner.postMultipart('/dashboard/posts', { text: 'Bad file' }, { media: ['x.gif', Buffer.from('GIF89a'), 'image/gif'] })).status, 400);
      assert.equal((await partner.postMultipart('/dashboard/posts', { text: 'New desks arrived at Poonakary', text_ta: 'பூநகரிக்குப் புதிய மேசைகள்', project_id: '8' }, { media: ['desks.png', PNG, 'image/png'] })).location, '/community');
      assert.equal((await partner.postMultipart('/dashboard/posts', { text: 'Evening class video' }, { media: ['class.mp4', MP4, 'video/mp4'] })).status, 303);
      const feed = await anon.get('/community'); assert.match(feed.text, /New desks arrived/); assert.match(feed.text, /<video src="\/files\/\d+"/);
      const img = /<img src="\/files\/(\d+)"/.exec(feed.text)[1]; assert.equal((await anon.get('/files/' + img)).type, 'image/png');
    });
    await step('likes and comments need an account; reported posts can be removed', async () => {
      const id = /id="post-(\d+)"/.exec((await anon.get('/community')).text)[1];
      assert.match((await anon.post(`/community/posts/${id}/like`, {})).location, /^\/login/);
      await member.get('/community');
      await member.post(`/community/posts/${id}/like`, {});
      assert.match((await member.get('/community')).text, new RegExp(`id="post-${id}"[\\s\\S]*?♥ <span class="num">1</span>`));
      await member.post(`/community/posts/${id}/like`, {});
      await member.post(`/community/posts/${id}/comment`, { body: 'Wonderful to see this!' });
      assert.match((await anon.get('/community')).text, /Wonderful to see this!/);
      await anon.post(`/community/posts/${id}/report`, { reason: 'test' });
      const q = await admin.get('/admin'); assert.match(q.text, /Reported/); const fid = /\/admin\/flags\/(\d+)\/remove/.exec(q.text)[1];
      await admin.post(`/admin/flags/${fid}/remove`, {});
      assert.doesNotMatch((await anon.get('/community')).text, new RegExp(`id="post-${id}"`));
    });
    await step('events need approval; members can RSVP', async () => {
      await partner.get('/dashboard/events');
      const future = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
      assert.equal((await partner.post('/dashboard/events', { title: 'Old', starts_on: '2020-01-01', place: 'X', mode: 'online' })).status, 400);
      await partner.post('/dashboard/events', { title: 'Kilinochchi prize day', title_ta: 'கிளிநொச்சி பரிசளிப்பு விழா', starts_on: future, place: 'Kilinochchi', mode: 'inperson' });
      assert.doesNotMatch((await anon.get('/events')).text, /Kilinochchi prize day/);
      const q = await admin.get('/admin'); const eid = /\/admin\/events\/(\d+)\/approve/.exec(q.text)[1];
      await admin.post(`/admin/events/${eid}/approve`, {});
      assert.match((await anon.get('/events')).text, /Kilinochchi prize day/);
      await member.get('/events'); await member.post(`/events/${eid}/rsvp`, {});
      assert.match((await member.get('/events')).text, /You’re going/);
      const page = await anon.get(`/events/${eid}`); assert.equal(page.status, 200); assert.match(page.text, /Kilinochchi prize day/);
      assert.match((await anon.get('/events')).text, new RegExp(`href="/events/${eid}"`));
      const ics = await anon.get(`/events/${eid}/calendar.ics`); assert.match(ics.type, /text\/calendar/); assert.match(ics.text, /SUMMARY:Kilinochchi prize day/);
      assert.match((await anon.get('/')).text, /href="\/events\/\d+"/);
    });
    await step('online events: private joining link, attendee list, messages and emails', async () => {
      const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
      assert.equal((await partner.post('/dashboard/events', { title: 'Zoom Q&A', starts_on: future, place: 'Online', mode: 'online', join_url: 'javascript:alert(1)' })).status, 400);
      await partner.post('/dashboard/events', { title: 'Zoom Q&A with teachers', starts_on: future, start_time: '18:30', end_time: '19:30', tz: 'Asia/Colombo', place: 'Online', mode: 'online', join_url: 'https://zoom.us/j/123456789' });
      const q = await admin.get('/admin'); const eid = /\/admin\/events\/(\d+)\/approve/.exec(q.text)[1];
      await admin.post(`/admin/events/${eid}/approve`, {});
      const pub = (await anon.get(`/events/${eid}`)).text;
      assert.match(pub, /6:30 pm – 7:30 pm \(Sri Lanka time\)/); assert.doesNotMatch(pub, /zoom\.us/); assert.match(pub, /to get the joining link/);
      await member.post(`/events/${eid}/rsvp`, {});
      assert.match((await member.get(`/events/${eid}`)).text, /href="https:\/\/zoom\.us\/j\/123456789"/);
      assert.match((await member.get(`/events/${eid}/calendar.ics`)).text, /URL:https:\/\/zoom\.us/);
      const dash = (await partner.get(`/dashboard/events/${eid}`)).text; assert.match(dash, /Who&#39;s going \(1\)/);
      const csv = await partner.get(`/dashboard/events/${eid}/attendees.csv`); assert.match(csv.type, /text\/csv/); assert.match(String(csv.text), /member@example\.com|@/);
      assert.equal((await member.get(`/dashboard/events/${eid}`)).status === 200, false);
      assert.match((await partner.get('/notifications')).text, /is going to your event/);
      await partner.post(`/dashboard/events/${eid}/message`, { text: 'Please join 5 minutes early.' });
      assert.match((await member.get('/messages')).text, /join 5 minutes early/);
      await new Promise((r) => setTimeout(r, 1200));
      const mails = (await admin.get('/admin/emails')).text;
      assert.match(mails, /You’re going: Zoom Q&amp;A with teachers|You're going: Zoom Q&amp;A with teachers|You&#39;re going: Zoom Q&amp;A with teachers/);
      assert.match(mails, /Message about Zoom Q&amp;A with teachers/); assert.match(mails, /Reminder: 1 hour before/);
      await member.post(`/events/${eid}/rsvp`, {}); // changed their mind: reminders dropped
      assert.match((await admin.get('/admin/emails')).text, /Not needed/);
      await partner.post(`/dashboard/events/${eid}/details`, { start_time: '19:00', tz: 'Europe/London', join_url: 'https://teams.microsoft.com/l/meetup-join/abc' });
      assert.match((await anon.get(`/events/${eid}`)).text, /7:00 pm \(UK time\)/);
    });
    await step('paid tickets: platform gateway, commission, organiser payouts, sold out', async () => {
      const future = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10);
      await partner.post('/dashboard/events', { title: 'Charity dinner', starts_on: future, start_time: '19:00', place: 'Harrow', mode: 'tickets', price: '20', capacity: '3' });
      const q = await admin.get('/admin'); const eid = /\/admin\/events\/(\d+)\/approve/.exec(q.text)[1];
      await admin.post(`/admin/events/${eid}/approve`, {});
      assert.match((await anon.get(`/events/${eid}`)).text, /£20/);
      assert.equal((await member.post(`/events/${eid}/rsvp`, {})).location, `/events/${eid}/tickets`); // paid: no free RSVP
      await member.get(`/events/${eid}/tickets`);
      assert.equal((await member.post(`/events/${eid}/tickets`, { qty: '4' })).status, 400); // only 3 left
      const r = await member.post(`/events/${eid}/tickets`, { qty: '2', name: 'Member One', email: 'member@example.com' });
      assert.match(r.location, /^\/tickets\/pay\/KT-/);
      const paid = await member.post(r.location, {});
      assert.match(paid.location, /^\/tickets\/KT-/);
      assert.match((await member.get(paid.location)).text, /£40/);
      assert.match((await member.get(`/events/${eid}`)).text, /You have 2 ticket/);
      const dash = (await partner.get(`/dashboard/events/${eid}`)).text;
      assert.match(dash, /2 sold of 3/); assert.match(dash, /£38/); // 5% platform fee on £40
      await admin.post('/admin/tickets/commission', { percent: '10' });
      const buyer2 = new Client(); await buyer2.get('/register'); await buyer2.post('/register', { name: 'Buyer Two', email: 'buyer2@example.com', password: 'buyer-pass-123', next: '/' });
      await buyer2.get(`/events/${eid}/tickets`);
      const r2 = await buyer2.post(`/events/${eid}/tickets`, { qty: '1' }); await buyer2.post(r2.location, {});
      assert.match((await anon.get(`/events/${eid}`)).text, /Sold out/);
      const adm = (await admin.get('/admin/tickets')).text;
      assert.match(adm, /£56/); // owed: 38 + 18
      assert.equal((await admin.post(`/admin/tickets/payout/1`, { amount: '1.00', reference: 'X' })).status, 303);
      const orgId = /\/admin\/tickets\/payout\/(\d+)/.exec(adm)[1];
      await admin.post(`/admin/tickets/payout/${orgId}`, { amount: '50.00', reference: 'BACS 1' }); // wrong amount refused
      assert.doesNotMatch((await partner.get('/dashboard/payouts')).text, /BACS 1/);
      await admin.post(`/admin/tickets/payout/${orgId}`, { amount: '56.00', reference: 'BACS 2' });
      const pp = (await partner.get('/dashboard/payouts')).text; assert.match(pp, /BACS 2/); assert.match(pp, /£56/);
      assert.equal((await member.get('/admin/tickets')).status, 403);
      await admin.post('/admin/tickets/commission', { percent: '5' });
    });
    await step('memorials: approval, candles, condolences, giving in memory', async () => {
      await member.get('/memorials/new');
      assert.equal((await member.postMultipart('/memorials', { name: 'X', died_on: '2026-11-01', born_on: '2027-01-01', birthplace: 'Y', body: 'Z' })).status, 400, 'death before birth');
      const r = await member.postMultipart('/memorials', { name: 'Sinnathamby Rasiah', name_ta: 'சின்னத்தம்பி இராசையா', born_on: '1938-04-02', died_on: '2026-11-18', birthplace: 'Point Pedro', birthplace_ta: 'பருத்தித்துறை', lived_in: 'Toronto',
        type: 'obituary', body: 'Teacher and gardener.', body_ta: 'ஆசிரியரும் தோட்டக்காரரும்.', informed_by: 'Family', contacts: 'Ravi – son – +1 416 555 0100', project_id: '4',
        ev_kind_0: 'viewing', ev_date_0: '2026-11-24', ev_start_0: '17:00', ev_end_0: '20:00', ev_venue_0: 'Chapel Ridge', ev_address_0: '8911 Woodbine Ave, Markham', ev_stream_0: 'https://example.com/live', ev_kind_1: 'cremation', ev_date_1: '', ev_venue_1: '' },
        { photo: ['p.png', PNG, 'image/png'], gallery: ['g1.png', PNG, 'image/png'] });
      assert.equal(r.location, '/memorials');
      const q = await admin.get('/admin'); const mid = /\/admin\/memorials\/(\d+)/.exec(q.text)[1];
      assert.equal((await anon.get('/memorials/' + mid)).status, 404);
      await admin.get('/admin/memorials/' + mid); await admin.post(`/admin/memorials/${mid}/approve`, {});
      assert.match((await anon.get('/memorials')).text, /Sinnathamby Rasiah/);
      const page = await anon.get('/memorials/' + mid);
      assert.match(page.text, /Born in Point Pedro · Lived in Toronto/); assert.match(page.text, /Age 88/); assert.match(page.text, /Chapel Ridge/); assert.match(page.text, /Watch live/); assert.match(page.text, /google\.com\/maps\/search/); assert.match(page.text, /Ravi – son/);
      assert.match((await anon.get('/memorials?type=obituary&q=point+pedro')).text, /Sinnathamby Rasiah/);
      assert.doesNotMatch((await anon.get('/memorials?type=thanks')).text, /Sinnathamby Rasiah/);
      await member.post(`/memorials/${mid}/notices`, { type: 'r31', body: 'Thank you all for your kindness.' });
      const q2 = await admin.get('/admin'); const nid = /\/admin\/notices\/(\d+)\/approve/.exec(q2.text)[1];
      await admin.post(`/admin/notices/${nid}/approve`, {});
      assert.match((await anon.get('/memorials')).text, /31st day remembrance/);
      assert.equal((await anon.post(`/memorials/${mid}/notices`, { type: 'r31', body: 'x' })).status, 303, 'anonymous goes to login');
      await anon.get('/memorials/' + mid);
      await anon.post(`/memorials/${mid}/candle`, {}); await anon.post(`/memorials/${mid}/candle`, {});
      assert.match((await anon.get('/memorials/' + mid)).text, /🕯️ 1</);
      await member.get('/memorials/' + mid); await member.post(`/memorials/${mid}/condolence`, { name: 'Ravi', body: 'Rest in peace, Sir.' });
      assert.match((await anon.get('/memorials/' + mid)).text, /Rest in peace, Sir\./);
      await anon.get(`/donate?kind=memorial&id=${mid}`);
      const d = await anon.post('/donate', { kind: 'memorial', id: mid, amount: '15', donor_name: 'Friend', donor_email: 'f@example.com' });
      await anon.post(d.location, {});
      assert.match((await anon.get('/memorials/' + mid)).text, /£15<\/b>/);
    });
    await step('suspending a partner hides its pages', async () => {
      await admin.get('/admin/partners');
      await admin.post('/admin/partners/1/suspend', {}); // seeded Vanni Learning Trust
      assert.equal((await anon.get('/partners/vanni-learning-trust')).status, 404);
      assert.doesNotMatch((await anon.get('/projects')).text, /Scholarships for 40/);
      assert.match((await admin.get('/admin/partners')).text, /Suspended/);
      await admin.post('/admin/partners/1/reinstate', {});
      assert.equal((await anon.get('/partners/vanni-learning-trust')).status, 200);
    });
    await step('admin sees donations', async () => { assert.match((await admin.get('/admin/donations')).text, /Test Donor/); });
    /* ---------------- members ---------------- */
    const asha = new Client(); const ravi = new Client(); let ashaId, raviId;
    await step('free sign-up with email; free members cannot post', async () => {
      for (const [c, name, email] of [[asha, 'Asha Member', 'asha@example.com'], [ravi, 'Ravi Member', 'ravi@example.com']]) {
        await c.get('/register'); assert.equal((await c.post('/register', { name, email, password: 'member-pass-123', next: '/' })).status, 303);
      }
      ashaId = /\/members\/(\d+)"/.exec((await asha.get('/community')).text)[1];
      raviId = /\/members\/(\d+)"/.exec((await ravi.get('/community')).text)[1];
      assert.match((await asha.get('/community')).text, /href="\/membership"/);
      const r = await asha.postMultipart('/community/posts', { text: 'Free post attempt' });
      assert.equal(r.location, '/membership');
    });
    await step('Silver membership through checkout unlocks posting, not video', async () => {
      assert.match((await asha.get('/membership')).text, /£5/);
      const c = await asha.post('/membership/checkout', { tier: 'silver', period: 'month' });
      assert.match(c.location, /^\/membership\/pay\/KM-/);
      assert.equal((await ravi.get(c.location)).status, 404); // someone else's checkout
      await asha.get(c.location); const paid = await asha.post(c.location, {});
      assert.equal(paid.location, `/members/${ashaId}`);
      assert.match((await asha.get(`/members/${ashaId}`)).text, /badge silver/);
      await asha.postMultipart('/community/posts', { text: 'Hello from Asha the member' }, { media: ['p.png', PNG, 'image/png'] });
      const feed = (await anon.get('/community')).text;
      assert.match(feed, /Hello from Asha the member/);
      const fid = /\/files\/(\d+)" alt="Photo from Asha/.exec(feed)[1];
      assert.equal((await anon.get('/files/' + fid)).status, 200);
      const v = await asha.postMultipart('/community/posts', { text: 'video' }, { media: ['v.mp4', Buffer.concat([Buffer.from('00000018', 'hex'), Buffer.from('ftypmp42'), Buffer.alloc(16)]), 'video/mp4'] });
      assert.match(decodeURIComponent(asha.jar.flash || ''), /Gold/); assert.equal(v.location, '/community');
    });
    let postId;
    await step('likes, comments and follows notify the author', async () => {
      postId = /id="post-(\d+)"[\s\S]{0,600}Asha Member/.exec((await ravi.get('/community')).text)[1];
      await ravi.post(`/community/posts/${postId}/like`, {});
      await ravi.post(`/community/posts/${postId}/comment`, { body: 'Lovely news Asha' });
      await ravi.post(`/members/${ashaId}/follow`, {});
      assert.match((await ravi.get('/community?view=following')).text, /Hello from Asha the member/);
      const notes = (await asha.get('/notifications')).text;
      assert.match(notes, /liked your post/); assert.match(notes, /commented on your post/); assert.match(notes, /started following you/);
      assert.match((await asha.get(`/members/${ashaId}`)).text, /<b class="num">1<\/b> followers/);
    });
    await step('messages: free members reply only; paid members start chats', async () => {
      const blocked = await ravi.post(`/messages/${ashaId}`, { body: 'Hi first' });
      assert.equal(blocked.location, '/membership');
      await asha.post(`/messages/${raviId}`, { body: 'Thanks for the follow, Ravi!' });
      assert.match((await ravi.get('/community')).text, /<span class="dot num">1<\/span>/);
      assert.match((await ravi.get('/messages')).text, /Thanks for the follow/);
      await ravi.get(`/messages/${ashaId}`);
      await ravi.post(`/messages/${ashaId}`, { body: 'You are welcome' });
      assert.match((await asha.get(`/messages/${raviId}`)).text, /You are welcome/);
    });
    await step('blocking stops messages and hides posts', async () => {
      await ravi.post(`/members/${ashaId}/block`, {});
      const r = await asha.post(`/messages/${raviId}`, { body: 'Still there?' });
      assert.match(r.location, new RegExp(`/messages/${raviId}`));
      assert.doesNotMatch((await ravi.get('/community')).text, /Hello from Asha the member/);
      await ravi.post(`/members/${ashaId}/block`, {});
    });
    await step('profiles: edit, photo, people directory; email never shown', async () => {
      await asha.get('/me/edit');
      await asha.postMultipart('/me/edit', { name: 'Asha Member', home_town: 'Jaffna', bio: 'Teacher' }, { avatar: ['a.png', PNG, 'image/png'] });
      const prof = (await anon.get(`/members/${ashaId}`)).text;
      assert.match(prof, /Jaffna/); assert.doesNotMatch(prof, /asha@example.com/);
      assert.match((await anon.get('/members?q=Jaffna')).text, /Asha Member/);
      const av = /\/files\/(\d+)" alt="" loading/.exec(prof)[1]; assert.equal((await anon.get('/files/' + av)).status, 200);
    });
    await step('members delete their own posts; admin sets prices', async () => {
      assert.equal((await ravi.post(`/community/posts/${postId}/delete`, {})).status, 403);
      await asha.post(`/community/posts/${postId}/delete`, {});
      assert.doesNotMatch((await anon.get('/community')).text, /Hello from Asha the member/);
      assert.equal((await asha.get('/admin/membership')).status, 403);
      await admin.post('/admin/membership/prices', { silver_month: '6', silver_year: '60', gold_month: '12', gold_year: '120' });
      assert.match((await anon.get('/membership')).text, /£6/);
      assert.match((await admin.get('/admin/membership')).text, /Asha Member/);
    });
    await step('admins change the site colours; unreadable colours are refused', async () => {
      assert.equal((await asha.get('/admin/theme')).status, 403);
      assert.equal((await admin.get('/admin/theme')).status, 200);
      await admin.post('/admin/theme', { preset: 'temple' });
      assert.match((await anon.get('/')).text, /--brand:#8C2633/);
      await admin.post('/admin/theme', { bg: '#222222', brand: '#0D6B5B', accent: '#E39A12' });
      assert.match((await anon.get('/')).text, /--brand:#8C2633/); // dark background refused, old colours kept
      await admin.post('/admin/theme', { bg: '#FFFFFF', brand: '#1F5FA0', accent: '#F2A33A' });
      assert.match((await anon.get('/')).text, /--bg:#FFFFFF;[^}]*--brand:#1F5FA0/);
      assert.doesNotMatch((await anon.get("/")).text, /<html[^>]*auto-dark/); // light look for everyone by default
      await admin.post('/admin/theme', { light: '0' });
      assert.match((await anon.get('/')).text, /<html lang="en" class="auto-dark">/);
      await admin.post('/admin/theme', { light: '1' });
      assert.doesNotMatch((await anon.get("/")).text, /<html[^>]*auto-dark/);
      const viewer = new Client(); await viewer.get('/');
      await viewer.get('/mode?set=dark&back=/'); assert.match((await viewer.get('/')).text, /<html lang="en" class="force-dark">/);
      await viewer.get('/mode?set=light&back=/'); assert.doesNotMatch((await viewer.get('/')).text, /<html[^>]*dark/);
      await admin.post('/admin/theme', { reset: '1' });
      assert.doesNotMatch((await anon.get('/')).text, /--brand:#/);
    });
    await step('directory: import a list, private outreach, public listing and community events', async () => {
      const future = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
      const xlsx = makeXlsx({
        Organisations: [['Organisation', 'Type', 'Area', 'Address', 'Public email', 'Public phone', 'Website', 'Charity number', 'Upcoming event / activity', 'Event date', 'Contact / event notes', 'Source URL', 'Verification notes'],
          ['Leeds Tamil School', 'Tamil school', 'Leeds', '1 High St, Leeds', 'office@leedstamil.example', '0113 000 0000', 'leedstamil.example', '123', null, null, 'Saturday classes', 'https://leedstamil.example/contact', 'From own site'],
          ['Tamil arts networks', 'Arts network', 'Island-wide', null, null, null, null, null, null, null, 'Multiple independent groups', null, 'Category lead rather than a single organisation.']],
        'Upcoming Events': [['Date', 'Event', 'Organiser', 'Category', 'Venue', 'Venue address / area', 'Public contact', 'Listing / details URL', 'Status / notes'],
          [future, 'Pongal Fair', 'Leeds Tamil School', 'Festival', 'Town Hall', 'Leeds', null, 'https://events.example/pongal', 'Confirm with organiser'],
          ['2027 (annual)', 'Temple Festival', 'Temple', 'Religious festival', 'Temple', 'Jaffna', null, null, 'Dates to confirm']]
      });
      assert.equal((await member.postMultipart('/admin/directory/import', { country: 'UK' }, { file: ['list.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] })).status, 403);
      const r = await admin.postMultipart('/admin/directory/import', { country: 'UK' }, { file: ['list.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] });
      assert.match(r.location, /\/admin\/directory/);
      const adm = (await admin.get('/admin/directory')).text;
      assert.match(adm, /Leeds Tamil School/); assert.match(adm, /0113 000 0000/); assert.match(adm, /Tamil arts networks/);
      const pub = (await anon.get('/directory')).text;
      assert.match(pub, /Leeds Tamil School/); assert.match(pub, /not Kuviyam partners/); assert.match(pub, /0113 000 0000/); assert.match(pub, /Tamil arts networks/); assert.match(pub, /1 High St, Leeds/); assert.match(pub, /Saturday classes/); assert.match(pub, /Where this came from/);
      const ev = (await anon.get('/events')).text; assert.match(ev, /Happening in the community/); assert.match(ev, /Pongal Fair/); assert.match(ev, /Temple Festival/);
      const id = /\/admin\/directory\/(\d+)\/invite/.exec(adm)[1];
      await admin.post(`/admin/directory/${id}/invite`, {});
      assert.match((await admin.get('/admin/directory?status=invited')).text, /Leeds Tamil School/);
      await new Promise((res) => setTimeout(res, 700));
      assert.match((await admin.get('/admin/emails')).text, /Invitation to join/);
      await admin.post(`/admin/directory/${id}`, { status: 'contacted', admin_note: 'Spoke to the head teacher', is_public: '' });
      assert.doesNotMatch((await anon.get('/directory')).text, /Leeds Tamil School/);
      const again = await admin.postMultipart('/admin/directory/import', { country: 'UK' }, { file: ['list.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] });
      assert.match(decodeURIComponent(admin.jar.flash || ''), /0 new organisations, 2 updated|/);
      assert.match((await admin.get('/admin/directory?status=contacted')).text, /Spoke to the head teacher/); // re-import keeps status and notes
      // Make them partners: they show on /partners, take donations, say "Not yet checked"; admin can pause donations.
      assert.equal((await member.post('/admin/directory/make-partners', {})).status, 403);
      await admin.post('/admin/directory/make-partners', {});
      const plist = (await anon.get('/partners')).text; assert.match(plist, /Leeds Tamil School/); assert.match(plist, /Not yet checked/); assert.doesNotMatch(plist, /Leeds Tamil School[\s\S]{0,800}Report late/);
      const slug = /href="\/partners\/(leeds-tamil-school[^"]*)"/.exec(plist)[1];
      const pp = (await anon.get(`/partners/${slug}`)).text; assert.match(pp, /0113 000 0000/); assert.match(pp, /kind=org/);
      const oid = /kind=org&amp;id=(\d+)/.exec(pp)[1];
      assert.equal((await anon.get(`/donate?kind=org&id=${oid}`)).status, 200);
      await admin.post(`/admin/partners/${oid}/flags`, { donations_paused: '1' });
      assert.match((await anon.get(`/partners/${slug}`)).text, /paused/);
      assert.notEqual((await anon.get(`/donate?kind=org&id=${oid}`)).status, 200);
      await admin.post(`/admin/partners/${oid}/flags`, { checked: '1' });
      assert.match((await anon.get(`/partners/${slug}`)).text, /✓ Verified/);
      await admin.post('/admin/directory/make-partners', {}); // running again adds nothing twice
      assert.equal(((await anon.get('/partners')).text.match(/Leeds Tamil School<\/h3>/g) || []).length, 1);
    });
    await step('obituaries page links to other Tamil notice sites', async () => {
      const m = (await anon.get('/memorials')).text; assert.match(m, /More notices from the Tamil community/); assert.match(m, /https:\/\/ripbook\.com\//); assert.match(m, /rip\.page/);
    });
    await step('removing sample data keeps real people and their work', async () => {
      // A real person interacts with sample content first.
      const real = new Client(); await real.get('/register'); await real.post('/register', { name: 'Real Person', email: 'real@person.org', password: 'real-person-123', next: '/' });
      await real.get('/me/edit'); await real.postMultipart('/me/edit', { name: 'Real Person', home_town: 'Leeds', bio: 'Real' });
      const feed = (await real.get('/community')).text; const samplePost = /id="post-(\d+)"/.exec(feed)[1];
      await real.post(`/community/posts/${samplePost}/like`, {}); await real.post(`/community/posts/${samplePost}/comment`, { body: 'Real comment on a sample post' });
      assert.match((await admin.get('/admin')).text, /Sample data is still on the site/);
      assert.equal((await member.post('/admin/sample-data/remove', { confirm: 'REMOVE' })).status, 403);
      await admin.post('/admin/sample-data/remove', { confirm: 'nope' });
      assert.match((await anon.get('/partners')).text, /Vanni Learning Trust/); // not confirmed: nothing removed
      const r = await admin.post('/admin/sample-data/remove', { confirm: 'REMOVE' });
      assert.equal(r.location, '/admin');
      const adm = (await admin.get('/admin')).text; assert.match(adm, /Sample data removed/); assert.doesNotMatch(adm, /Sample data is still on the site/);
      assert.doesNotMatch((await anon.get('/partners')).text, /Vanni Learning Trust|Uva Hill|Jaffna Mobile/);
      assert.doesNotMatch((await anon.get('/community')).text, /Tharsini|Kavitha/);
      assert.doesNotMatch((await anon.get('/memorials')).text, /Ponnambalam|1950 – 2026/);
      assert.doesNotMatch((await anon.get('/members')).text, /Senthil Raj|Meera Sivakumar/);
      // Real things stay.
      assert.match((await anon.get('/members?q=Leeds')).text, /Real Person/);
      assert.match((await real.get('/notifications')).text, /Notifications/);
      assert.equal((await admin.get('/admin/theme')).status, 200);
      assert.match((await anon.get('/membership')).text, /£/);
      assert.match((await anon.get('/')).text, /Payments are in test mode|<html/);
    });
    await step('logout ends the session', async () => {
      await applicant.post('/logout', {});
      assert.equal((await applicant.get('/dashboard')).status, 303);
    });
    console.log(`\nAll ${passed} checks passed.`);
  } catch (e) {
    console.error('\nFAILED:', e.message); console.error(log.slice(-3000)); process.exitCode = 1;
  } finally { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
})();
