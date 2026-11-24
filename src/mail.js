'use strict';
/*
 * Sending email. Pick one with environment variables (Hostinger hPanel > Node.js > Environment variables):
 *
 *   Hostinger mailbox (or any SMTP):  SMTP_HOST=smtp.hostinger.com  SMTP_PORT=465
 *                                     SMTP_USER=noreply@kuviyam.net  SMTP_PASS=...  MAIL_FROM=noreply@kuviyam.net
 *   Resend:                           RESEND_API_KEY=re_...  MAIL_FROM=noreply@kuviyam.net
 *
 * With neither set, emails are written to the app log instead of being sent ("log" mode), so the site
 * works the same while email is being set up. No packages needed: SMTP is spoken directly over TLS.
 */
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

function provider() {
  if (process.env.MAIL_PROVIDER === 'log') return 'log';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  return 'log';
}
const fromAddress = () => process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@kuviyam.net';
const fromName = () => process.env.MAIL_FROM_NAME || 'Kuviyam';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

function buildMime({ to, subject, text, html }) {
  const boundary = 'kv' + crypto.randomBytes(12).toString('hex');
  const domain = fromAddress().split('@')[1] || 'kuviyam.org';
  return [
    `From: ${encWord(fromName())} <${fromAddress()}>`, `To: <${to}>`, `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text), '',
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html), '',
    `--${boundary}--`, ''
  ].join('\r\n');
}

/** A small SMTP client: implicit TLS on 465, or STARTTLS on 587/25. */
function smtpSend(msg) {
  const host = process.env.SMTP_HOST; const port = Number(process.env.SMTP_PORT) || 465;
  const user = process.env.SMTP_USER; const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' : port === 465; // TLS from the start (465) or STARTTLS (587)
  return new Promise((resolve, reject) => {
    let sock; let buf = ''; let waiter = null; let done = false;
    const fail = (e) => { if (done) return; done = true; try { sock.destroy(); } catch { /* closed */ } reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error('SMTP timeout')), 30000);
    const onData = (d) => {
      buf += d.toString('utf8');
      // A full reply ends with a line "NNN text" (space after the code, not a dash).
      const m = buf.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
      if (m && waiter) { const reply = buf; buf = ''; const w = waiter; waiter = null; w(Number(m[1]), reply); }
    };
    const expect = (codes) => new Promise((res, rej) => { waiter = (code, reply) => (codes.includes(code) ? res(reply) : rej(new Error(`SMTP ${code}: ${reply.trim().slice(0, 200)}`))); });
    const cmd = (line, codes) => { const p = expect(codes); sock.write(line + '\r\n'); return p; };
    const attach = (s) => { sock = s; s.on('data', onData); s.on('error', fail); };
    const run = async () => {
      await expect([220]);
      await cmd(`EHLO ${fromAddress().split('@')[1] || 'kuviyam'}`, [250]);
      if (!secure) {
        await cmd('STARTTLS', [220]);
        sock.removeListener('data', onData);
        await new Promise((res, rej) => { const t = tls.connect({ socket: sock, servername: host }, res); t.on('error', rej); attach(t); });
        await cmd(`EHLO ${fromAddress().split('@')[1] || 'kuviyam'}`, [250]);
      }
      await cmd('AUTH LOGIN', [334]);
      await cmd(Buffer.from(user).toString('base64'), [334]);
      await cmd(Buffer.from(pass).toString('base64'), [235]);
      await cmd(`MAIL FROM:<${fromAddress()}>`, [250]);
      await cmd(`RCPT TO:<${msg.to}>`, [250, 251]);
      await cmd('DATA', [354]);
      const body = buildMime(msg).replace(/\r\n\./g, '\r\n..');
      await cmd(body + '\r\n.', [250]);
      await cmd('QUIT', [221]).catch(() => {});
      done = true; clearTimeout(timer); sock.end(); resolve({ id: null });
    };
    const s = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    attach(s);
    run().catch((e) => { clearTimeout(timer); fail(e); });
  });
}

async function resendSend(msg) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${fromName()} <${fromAddress()}>`, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html })
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Sends one email. Resolves when accepted by the provider; rejects with a readable error otherwise. */
async function send(msg) {
  const p = provider();
  if (p === 'smtp') return smtpSend(msg);
  if (p === 'resend') return resendSend(msg);
  console.log(`[mail:log] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
  return { id: 'log' };
}

module.exports = { send, provider, fromAddress, buildMime };
