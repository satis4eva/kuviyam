'use strict';
const { h, raw } = require('../util');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* A short fingerprint of each static file, added to its link, so browsers fetch the new version after every deploy. */
const stamp = {};
for (const f of ['styles.css', 'share.js']) {
  try { stamp[f] = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, '..', '..', 'public', f))).digest('hex').slice(0, 10); } catch { stamp[f] = String(Date.now()); }
}

/** Classes on <html>: bigger text, and light or dark (the visitor's own choice wins over the site default). */
function htmlClass(ctx) {
  const c = [];
  if (ctx.big) c.push('big');
  if (ctx.mode === 'dark') c.push('force-dark');
  else if (ctx.mode !== 'light' && ctx.autoDark) c.push('auto-dark');
  return c.length ? raw(` class="${c.join(' ')}"`) : '';
}

/** Layout shared by every page. */
function layout(ctx, { title, body, active = '', og }) {
  const { absUrl, memberAvatar } = require('./parts');
  const { t, lang, user, csrf, flash } = ctx;
  const isPartner = user && user.orgs.some((o) => o.status === 'verified');
  const nav = [['/', 'nav_home', 'home'], ['/projects', 'nav_projects', 'projects'], ['/partners', 'nav_partners', 'partners'], ['/sponsor', 'nav_sponsor', 'sponsor'], ['/community', 'nav_community', 'community'], ['/transparency', 'nav_transparency', 'transparency']];
  if (isPartner) nav.push(['/dashboard', 'nav_dashboard', 'dashboard']);
  else nav.push(['/join', 'nav_join', 'join']);
  if (user && user.role === 'admin') nav.push(['/admin', 'nav_admin', 'admin']);
  const back = encodeURIComponent(ctx.url.pathname + ctx.url.search);
  return h`<!DOCTYPE html>
<html lang="${lang}"${htmlClass(ctx)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${ctx.mode === 'dark' ? 'dark' : ctx.mode === 'light' || !ctx.autoDark ? 'light' : 'light dark'}">
<title>${title ? title + ' · ' : ''}${t('brand')}</title>
<meta name="description" content="${t('metaDescription')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;500;600;700&family=Noto+Sans+Tamil:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/styles.css?v=${stamp['styles.css']}">
<link rel="icon" href="/static/logo.svg" type="image/svg+xml">
${ctx.themeCss ? h`<style>${raw(ctx.themeCss)}</style>` : ''}
<meta property="og:site_name" content="${t('brand')}">
<meta property="og:type" content="website">
<meta property="og:title" content="${og ? og.title : (title || t('brand'))}">
<meta property="og:description" content="${og && og.description ? og.description : t('metaDescription')}">
<meta property="og:url" content="${absUrl(ctx, og && og.path ? og.path : ctx.url.pathname)}">
${og && og.image ? h`<meta property="og:image" content="${absUrl(ctx, og.image)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<script src="/static/share.js?v=${stamp['share.js']}" defer></script>
</head>
<body>
${process.env.DEMO_MODE === '1' ? h`<div class="demo">${t(ctx.sampleRemoved ? 'testPayBanner' : 'demoBanner')}</div>` : ''}
<header class="bar"><div class="bar-in">
  <a class="logo" href="/"><img src="/static/logo.svg" alt="" width="32" height="32"><span><b>${t('brand')}</b><small>${t('tagline')}</small></span></a>
  <nav class="nav" aria-label="Main">${nav.map(([href, key, id]) => h`<a href="${href}" class="${active === id ? 'on' : ''}${id === 'dashboard' || id === 'admin' ? ' keep' : ''}">${t(key)}</a>`)}</nav>
  <div class="tools">
    <a class="mode to-dark" href="/mode?set=dark&amp;back=${raw(back)}" aria-label="${t('toDark')}" title="${t('toDark')}">🌙</a><a class="mode to-light" href="/mode?set=light&amp;back=${raw(back)}" aria-label="${t('toLight')}" title="${t('toLight')}">☀️</a>
    <a class="tsize" href="/textsize?big=${ctx.big ? '0' : '1'}&amp;back=${raw(back)}" aria-label="${t(ctx.big ? 'textSmaller' : 'textBigger')}" title="${t(ctx.big ? 'textSmaller' : 'textBigger')}" aria-pressed="${ctx.big ? 'true' : 'false'}">A<span>A</span></a>
    <div class="lang" role="group" aria-label="Language / மொழி">
      <a href="/lang/en?back=${raw(back)}" class="${lang === 'en' ? 'on' : ''}" hreflang="en">English</a><a href="/lang/ta?back=${raw(back)}" class="${lang === 'ta' ? 'on' : ''}" hreflang="ta">தமிழ்</a>
    </div>
    ${user ? h`<a class="ico${active === 'messages' ? ' on' : ''}" href="/messages" aria-label="${t('messagesH')}" title="${t('messagesH')}">✉${ctx.counts && ctx.counts.msgs ? h`<span class="dot num">${ctx.counts.msgs}</span>` : ''}</a>
      <a class="ico${active === 'notes' ? ' on' : ''}" href="/notifications" aria-label="${t('notesH')}" title="${t('notesH')}">🔔${ctx.counts && ctx.counts.notes ? h`<span class="dot num">${ctx.counts.notes}</span>` : ''}</a>
      <a class="me plain" href="/members/${user.id}" title="${t('myProfile')}">${memberAvatar(user, 'sm')}<span class="small">${user.name}</span></a>
      <form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn sm ghost">${t('logout')}</button></form>`
           : h`<a class="btn sm ghost" href="/login">${t('login')}</a><a class="btn sm pri" href="/membership">${t('joinFree')}</a>`}
  </div>
</div></header>
<main id="main">
${flash ? h`<div class="flash ${flash.kind || ''}" role="status">${flash.msg}</div>` : ''}
${body}
</main>
${tabbar(ctx, active)}
<footer class="foot">${require('../socials').footerIcons(ctx, ctx.socials)}${t('footer')} · <a href="/membership">${t('nav_membership')}</a> · <a href="/join">${t('nav_join')}</a> · <a href="/transparency">${t('nav_transparency')}</a><br>${t('charityNo')}</footer>
</body>
</html>`;
}

/* Bottom bar on phones: the five things people do most, always one tap away. */
function tabbar(ctx, active) {
  const { t, user } = ctx; const c = ctx.counts || {};
  const items = [['/', '🏠', 'tabHome', active === 'home'], ['/community', '💬', 'tabFeed', active === 'community'], ['/projects', '🤝', 'tabGive', active === 'projects' || active === 'sponsor'],
    user ? ['/messages', '✉️', 'tabMessages', active === 'messages', c.msgs] : ['/membership', '⭐', 'tabJoin', active === 'membership'],
    user ? [`/members/${user.id}`, '👤', 'tabMe', false, c.notes] : ['/login', '👤', 'login', false]];
  return h`<nav class="tabbar" aria-label="${t('quickMenu')}">${items.map(([href, icon, key, on, n]) => h`<a href="${href}" class="${on ? 'on' : ''}"><span class="tb-ic" aria-hidden="true">${icon}${n ? h`<span class="dot num">${n}</span>` : ''}</span><span>${t(key)}</span></a>`)}</nav>`;
}

module.exports = { layout };
