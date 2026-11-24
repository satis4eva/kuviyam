'use strict';
/*
 * Social media links in the site footer. Admin > Social links holds one web address per network;
 * an icon appears in the footer once its address is filled in.
 */
const { h, raw, clean } = require('./util');
const { csrfField } = require('./views/parts');

// Simple round icons: brand colour behind a white mark (24 x 24).
const SOCIALS = [
  { key: 'facebook', name: 'Facebook', color: '#1877F2', mark: '<path fill="#fff" d="M13.6 8.2H15V5.6h-2c-2.3 0-3.6 1.4-3.6 3.7V11H7.6v2.6h1.8V20h2.8v-6.4h2.1l.4-2.6h-2.5V9.5c0-.8.4-1.3 1.4-1.3z"/>' },
  { key: 'instagram', name: 'Instagram', color: '#D6297B', mark: '<rect x="6.5" y="6.5" width="11" height="11" rx="3.2" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="12" cy="12" r="2.7" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="15.2" cy="8.8" r=".9" fill="#fff"/>' },
  { key: 'youtube', name: 'YouTube', color: '#FF0000', mark: '<rect x="5.5" y="7.5" width="13" height="9" rx="2.6" fill="#fff"/><path fill="#FF0000" d="M10.6 9.8v4.4l3.8-2.2z"/>' },
  { key: 'tiktok', name: 'TikTok', color: '#111111', mark: '<path fill="#fff" d="M13.4 5.5h2.2c.2 1.6 1.3 2.7 2.9 2.9v2.3c-1.1 0-2.1-.3-2.9-.9v4.5a3.9 3.9 0 1 1-3.9-3.9h.2v2.3h-.2a1.6 1.6 0 1 0 1.7 1.6z"/>' },
  { key: 'x', name: 'X', color: '#111111', mark: '<path fill="#fff" d="M6.6 6h3.2l3 4.2L16.4 6h1.7l-4.5 5.2L18.4 18h-3.2l-3.3-4.6L7.8 18H6.1l5-5.7z"/>' },
  { key: 'whatsapp', name: 'WhatsApp', color: '#25D366', mark: '<path fill="none" stroke="#fff" stroke-width="1.6" d="M7.2 16.8l.6-2.3a5.6 5.6 0 1 1 2 2z"/><path fill="#fff" d="M10.2 9.4c.2-.3.6-.3.7 0l.5 1.1c.1.2 0 .4-.1.6l-.3.3c.4.8 1 1.4 1.8 1.8l.3-.3c.2-.1.4-.2.6-.1l1.1.5c.3.1.3.5 0 .7-.5.5-1.2.7-1.9.4a5.5 5.5 0 0 1-3.1-3.1c-.3-.7-.1-1.4.4-1.9z"/>' },
  { key: 'linkedin', name: 'LinkedIn', color: '#0A66C2', mark: '<circle cx="8.6" cy="7.9" r="1.3" fill="#fff"/><rect x="7.5" y="10" width="2.2" height="7" fill="#fff"/><path fill="#fff" d="M11.3 10h2.1v1c.4-.7 1.2-1.2 2.3-1.2 1.9 0 2.8 1.2 2.8 3.2v4h-2.2v-3.7c0-1-.4-1.6-1.3-1.6s-1.5.6-1.5 1.6V17h-2.2z"/>' },
  { key: 'telegram', name: 'Telegram', color: '#229ED9', mark: '<path fill="#fff" d="M6 11.6l11-4.3c.5-.2 1 .1.8.9l-1.9 8.9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.3-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.3-.8z"/>' }
];
const icon = (s, size = 34) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="12" fill="${s.color}"/>${s.mark}</svg>`);
const webUrl = (v) => { const x = String(v || '').trim(); if (!x) return ''; try { const u = new URL(/^https?:\/\//i.test(x) ? x : 'https://' + x); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href.slice(0, 300) : null; } catch { return null; } };

function registerSocials(route, H) {
  const { db, page, redirect, requireAdmin } = H;
  const links = () => Object.fromEntries(db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'social_%'`).all().map((r) => [r.key.slice(7), r.value]));
  H.socialLinks = () => { const l = links(); return SOCIALS.filter((s) => l[s.key]).map((s) => ({ ...s, url: l[s.key] })); };

  route('GET', '/admin/socials', (ctx) => {
    if (!requireAdmin(ctx)) return;
    page(ctx, { title: ctx.t('tSocials'), active: 'admin', body: adminPage(ctx, links()) });
  });
  route('POST', '/admin/socials', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const bad = [];
    const save = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const del = db.prepare('DELETE FROM settings WHERE key = ?');
    for (const s of SOCIALS) {
      const u = webUrl(clean(ctx.body[s.key], 300));
      if (u === null) { bad.push(s.name); continue; }
      if (u) save.run('social_' + s.key, u); else del.run('social_' + s.key);
    }
    redirect(ctx, '/admin/socials', bad.length ? { kind: 'bad', msg: ctx.t('socialsBad', { n: bad.join(', ') }) } : { kind: 'good', msg: ctx.t('socialsSaved') });
  });
}

function adminPage(ctx, l) {
  const { t } = ctx; const { adminTabs } = require('./views/manage');
  return h`<section><h1>${t('adH')}</h1></section>${adminTabs(ctx, 'socials')}
  <form class="card pad stack" method="post" action="/admin/socials">${csrfField(ctx)}
    <div><h2>${t('socialsH')}</h2><p class="small muted">${t('socialsP')}</p></div>
    ${SOCIALS.map((s) => h`<label class="f social-f"><span class="row nowrap">${icon(s, 28)} <b>${s.name}</b></span><input name="${s.key}" value="${l[s.key] || ''}" placeholder="https://" inputmode="url"></label>`)}
    <div><button class="btn pri">${t('save')}</button></div></form>`;
}

/** Footer row of icons (empty until links are added). */
function footerIcons(ctx, list) {
  if (!list || !list.length) return '';
  return h`<nav class="socials" aria-label="${ctx.t('socialsFollow')}">${list.map((s) => h`<a href="${s.url}" target="_blank" rel="noopener" title="${s.name}" aria-label="${s.name}">${icon(s)}</a>`)}</nav>`;
}

module.exports = { registerSocials, footerIcons, SOCIALS, icon };
