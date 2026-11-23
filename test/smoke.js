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
const env = { ...process.env, PORT: String(PORT), DB_FILE: path.join(dir, 'test.db'), SEED_DEMO: '1', DEMO_MODE: '1', DEMO_PASSWORD: 'demo-pass-2026', SETUP_CODE, PAYMENT_PROVIDER: 'test' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

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
    await step('community feed shows partner posts in both languages', async () => {
      const f = await anon.get('/community'); assert.equal(f.status, 200); assert.match(f.text, /water tank at Haputale/); assert.match(f.text, /Log in to like/);
      const ta = new Client(); await ta.get('/lang/ta?back=/'); assert.match((await ta.get('/community')).text, /அப்புத்தளையில்/);
      assert.match((await anon.get('/')).text, /From the community/);
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
    });
    await step('memorials: approval, candles, condolences, giving in memory', async () => {
      await member.get('/memorials/new');
      const r = await member.postMultipart('/memorials', { name: 'Sinnathamby Rasiah', years: '1938 – 2026', town: 'Point Pedro', tribute: 'Teacher and gardener.', project_id: '4' }, { photo: ['p.png', PNG, 'image/png'] });
      assert.equal(r.location, '/memorials');
      const q = await admin.get('/admin'); const mid = /\/admin\/memorials\/(\d+)/.exec(q.text)[1];
      assert.equal((await anon.get('/memorials/' + mid)).status, 404);
      await admin.get('/admin/memorials/' + mid); await admin.post(`/admin/memorials/${mid}/approve`, {});
      assert.match((await anon.get('/memorials')).text, /Sinnathamby Rasiah/);
      await anon.get('/memorials/' + mid);
      await anon.post(`/memorials/${mid}/candle`, {}); await anon.post(`/memorials/${mid}/candle`, {});
      assert.match((await anon.get('/memorials/' + mid)).text, /1 candles lit/);
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
    await step('logout ends the session', async () => {
      await applicant.post('/logout', {});
      assert.equal((await applicant.get('/dashboard')).status, 303);
    });
    console.log(`\nAll ${passed} checks passed.`);
  } catch (e) {
    console.error('\nFAILED:', e.message); console.error(log.slice(-3000)); process.exitCode = 1;
  } finally { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
})();
