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
