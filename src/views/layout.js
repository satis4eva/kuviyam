'use strict';
const { h, raw } = require('../util');

/** Layout shared by every page. */
function layout(ctx, { title, body, active = '' }) {
  const { t, lang, user, csrf, flash } = ctx;
  const isPartner = user && user.orgs.some((o) => o.status === 'verified');
  const nav = [['/', 'nav_home', 'home'], ['/projects', 'nav_projects', 'projects'], ['/partners', 'nav_partners', 'partners'], ['/sponsor', 'nav_sponsor', 'sponsor'], ['/transparency', 'nav_transparency', 'transparency']];
  if (isPartner) nav.push(['/dashboard', 'nav_dashboard', 'dashboard']);
  else nav.push(['/join', 'nav_join', 'join']);
  if (user && user.role === 'admin') nav.push(['/admin', 'nav_admin', 'admin']);
  const back = encodeURIComponent(ctx.url.pathname + ctx.url.search);
  return h`<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? title + ' · ' : ''}${t('brand')}</title>
<meta name="description" content="${t('metaDescription')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;500;600;700&family=Noto+Sans+Tamil:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/styles.css">
<link rel="icon" href="/static/logo.svg" type="image/svg+xml">
</head>
<body>
${process.env.DEMO_MODE === '1' ? h`<div class="demo">${t('demoBanner')}</div>` : ''}
<header class="bar"><div class="bar-in">
  <a class="logo" href="/"><img src="/static/logo.svg" alt="" width="32" height="32"><span><b>${t('brand')}</b><small>${t('tagline')}</small></span></a>
  <nav class="nav" aria-label="Main">${nav.map(([href, key, id]) => h`<a href="${href}" class="${active === id ? 'on' : ''}">${t(key)}</a>`)}</nav>
  <div class="tools">
    <div class="lang" role="group" aria-label="Language / மொழி">
      <a href="/lang/en?back=${raw(back)}" class="${lang === 'en' ? 'on' : ''}" hreflang="en">English</a><a href="/lang/ta?back=${raw(back)}" class="${lang === 'ta' ? 'on' : ''}" hreflang="ta">தமிழ்</a>
    </div>
    ${user ? h`<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><span class="small muted">${user.name}</span> <button class="btn sm ghost">${t('logout')}</button></form>`
           : h`<a class="btn sm" href="/login">${t('login')}</a>`}
  </div>
</div></header>
<main id="main">
${flash ? h`<div class="flash ${flash.kind || ''}" role="status">${flash.msg}</div>` : ''}
${body}
</main>
<footer class="foot">${t('footer')}</footer>
</body>
</html>`;
}

module.exports = { layout };
