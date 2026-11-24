'use strict';
/* Views for the directory of Tamil organisations (from public sources, not partners). */
const { h, raw, dateLabel } = require('../util');
const { dt } = require('../i18n');
const { csrfField } = require('./parts');
const { hubTabs } = require('./community');

/** "Leeds, UK"; just "UK" when the area already names the country. */
const where = (o, lang) => { const a = String(o.area || '').trim(); const c = dt(o.country, lang); return !a ? c : a.toLowerCase().includes(String(o.country).toLowerCase()) || a.toLowerCase().includes(String(c).toLowerCase()) ? a : `${a}, ${c}`; };
const site = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const statusChip = (ctx, s) => h`<span class="chip ${s === 'joined' ? 'good' : s === 'invited' ? 'warn' : s === 'declined' ? 'bad' : 'plain'}">${ctx.t('ds_' + s)}</span>`;

function publicList(ctx, d) {
  const { t, lang, user } = ctx; const f = d.f;
  return h`<section class="sec-h"><div><h1>${t('dirH')}</h1><p class="muted measure">${t('dirP')}</p></div><a class="btn pri" href="/join">${t('dirYours')}</a></section>
    ${hubTabs(ctx, 'directory')}
    <div class="flash">${t('dirNotice')}</div>
    <form class="row msearch" method="get" action="/directory"><label class="sr" for="dq">${t('search')}</label><input id="dq" name="q" value="${f.q || ''}" placeholder="${t('dirSearchPh')}">
      <label class="sr" for="dc">${t('country')}</label><select id="dc" name="country"><option value="">${t('dirAllCountries')}</option>${d.countries.map((c) => h`<option value="${c.country}"${f.country === c.country ? raw(' selected') : ''}>${dt(c.country, lang)} (${c.n})</option>`)}</select>
      <button class="btn">${t('search')}</button></form>
    <p class="small muted">${t('dirCount', { n: d.list.length })}</p>
    <div class="grid g3">${d.list.length ? d.list.map((o) => h`<article class="card pad stack6 dir-card">
        <b>${o.name}</b>${o.slug ? h` <a class="chip good" href="/partners/${o.slug}">${t('dirPartnerPage')} →</a>` : o.status === 'joined' ? h` <span class="chip good">${t('dirOnKuviyam')}</span>` : ''}
        <span class="small muted">${o.type || ''}</span>
        <span class="small">📍 ${where(o, lang)}</span>
        ${o.address ? h`<span class="small muted">${o.address}</span>` : ''}
        ${o.phone ? h`<span class="small">☎ ${o.phone}</span>` : ''}
        ${o.email ? h`<a class="small" href="mailto:${o.email}">✉ ${o.email}</a>` : ''}
        ${o.website ? h`<a class="small" href="${o.website}" target="_blank" rel="noopener nofollow">🌐 ${site(o.website)}</a>` : ''}
        ${o.reg_no ? h`<span class="tiny muted">${t('dirReg')} ${o.reg_no}</span>` : ''}
        ${o.activity ? h`<span class="small dir-act">📅 ${o.activity}${o.event_date ? h` · <b>${/^\d{4}-\d{2}-\d{2}$/.test(o.event_date) ? dateLabel(o.event_date, lang) : o.event_date}</b>` : ''}</span>` : ''}
        ${o.notes ? h`<span class="tiny">${o.notes}</span>` : ''}
        ${o.verification ? h`<span class="tiny muted">${o.verification}</span>` : ''}
        ${o.source_url ? h`<a class="tiny" href="${o.source_url}" target="_blank" rel="noopener nofollow">${t('dirSource')} ↗</a>` : ''}
      </article>`) : h`<div class="empty">${t('dirNone')}</div>`}</div>
    <p class="tiny muted">${t('dirCorrections')}</p>`;
}

function admin(ctx, d) {
  const { t, lang } = ctx; const { adminTabs } = require('./manage'); const f = d.f;
  const total = Object.values(d.totals).reduce((a, n) => a + n, 0);
  return h`<section><h1>${t('adH')}</h1></section>${adminTabs(ctx, 'directory')}
  <section class="grid g4">${['new', 'contacted', 'invited', 'joined'].map((s) => h`<a class="card pad plain" href="/admin/directory?status=${s}"><div class="tiny muted">${t('ds_' + s)}</div><div class="big num">${d.totals[s] || 0}</div></a>`)}</section>
  ${d.unlinked ? h`<section class="card pad row between"><div><h2>${t('dirMakeAllH')}</h2><p class="small muted">${t('dirMakeAllP', { n: d.unlinked })}</p></div>
    <form method="post" action="/admin/directory/make-partners">${csrfField(ctx)}<button class="btn pri">${t('dirMakeAllBtn', { n: d.unlinked })}</button></form></section>` : ''}
  <section class="split">
    <div class="stack">
      <form class="row msearch dir-search" method="get" action="/admin/directory"><input name="q" value="${f.q || ''}" placeholder="${t('dirSearchPh')}">
        <select name="country"><option value="">${t('dirAllCountries')} (${total})</option>${d.countries.map((c) => h`<option value="${c.country}"${f.country === c.country ? raw(' selected') : ''}>${dt(c.country, lang)} (${c.n})</option>`)}</select>
        <select name="status"><option value="">${t('dirAnyStatus')}</option>${d.statuses.map((s) => h`<option value="${s}"${f.status === s ? raw(' selected') : ''}>${t('ds_' + s)}</option>`)}</select>
        <button class="btn">${t('search')}</button></form>
      <p class="small muted">${t('dirCount', { n: d.list.length })}</p>
      ${d.list.length ? d.list.map((o) => h`<article class="card pad stack6 dir-admin" id="d${o.id}">
        <div class="row between"><div><b>${o.name}</b> ${statusChip(ctx, o.status)}${o.is_public ? '' : h` <span class="chip plain">${t('dirHidden')}</span>`}<div class="tiny muted">${o.type || ''} · ${where(o, lang)}${o.reg_no ? ' · ' + t('dirReg') + ' ' + o.reg_no : ''}</div></div>
          <div class="row">${o.org_id && d.slugs[o.org_id] ? h`<a class="btn sm" href="/partners/${d.slugs[o.org_id]}">${t('dirPartnerPage')} →</a>` : h`<form method="post" action="/admin/directory/${o.id}/make-partner">${csrfField(ctx)}<button class="btn sm">${t('dirMakeOne')}</button></form>`}
          ${o.email && o.status !== 'joined' ? h`<form method="post" action="/admin/directory/${o.id}/invite">${csrfField(ctx)}<button class="btn sm${o.status === 'invited' ? '' : ' pri'}">✉ ${t(o.status === 'invited' ? 'dirInviteAgain' : 'dirInvite')}</button></form>` : ''}</div></div>
        <div class="small dir-contacts">${o.email ? h`<a href="mailto:${o.email}">✉ ${o.email}</a>` : ''}${o.phone ? h`<span>☎ ${o.phone}</span>` : ''}${o.website ? h`<a href="${o.website}" target="_blank" rel="noopener nofollow">🌐 ${site(o.website)}</a>` : ''}${o.address ? h`<span>📍 ${o.address}</span>` : ''}</div>
        ${o.activity || o.notes || o.verification ? h`<div class="tiny muted">${o.activity ? h`<b>${t('dirActivity')}:</b> ${o.activity}<br>` : ''}${o.notes || ''}${o.verification ? h`<br><i>${o.verification}</i>` : ''}${o.source_url ? h` · <a href="${o.source_url}" target="_blank" rel="noopener nofollow">${t('dirSource')}</a>` : ''}</div>` : ''}
        <form class="row dir-edit" method="post" action="/admin/directory/${o.id}">${csrfField(ctx)}
          <select name="status" aria-label="${t('thStatus')}">${d.statuses.map((s) => h`<option value="${s}"${o.status === s ? raw(' selected') : ''}>${t('ds_' + s)}</option>`)}</select>
          <input name="admin_note" value="${o.admin_note || ''}" maxlength="600" placeholder="${t('dirNotePh')}">
          <label class="small"><input type="checkbox" name="is_public" value="1"${o.is_public ? raw(' checked') : ''}> ${t('dirShowPublic')}</label>
          <button class="btn sm">${t('save')}</button></form>
        ${o.invited_at ? h`<div class="tiny muted">${t('dirInvitedOn', { d: dateLabel(o.invited_at, lang) })}</div>` : ''}
      </article>`) : h`<div class="empty">${t('dirNone')}</div>`}
    </div>
    <div class="stack">
      <form class="card pad form" method="post" action="/admin/directory/import" enctype="multipart/form-data">${csrfField(ctx)}<h2>${t('dirImportH')}</h2><p class="tiny muted">${t('dirImportP')}</p>
        <label class="f">${t('dirImportFile')}<input type="file" name="file" accept=".xlsx" required></label>
        <label class="f">${t('dirImportCountry')}<select name="country" required><option value="">—</option>${d.allCountries.map((c) => h`<option value="${c}">${dt(c, lang)}</option>`)}</select></label>
        <button class="btn pri">${t('dirImportBtn')}</button></form>
      <div class="card pad stack6" id="events"><h2>${t('dirEventsH')}</h2><p class="tiny muted">${t('dirEventsP')}</p>
        ${d.events.length ? d.events.map((e) => h`<div class="dir-ev"><div class="small"><b>${e.title}</b><div class="tiny muted">${e.on_date ? dateLabel(e.on_date, lang) : e.date_text || ''} · ${e.venue || e.area || ''} · ${dt(e.country, lang)}${e.organiser ? ' · ' + e.organiser : ''}</div></div>
          <form method="post" action="/admin/directory/events/${e.id}" class="row">${csrfField(ctx)}<label class="tiny"><input type="checkbox" name="is_public" value="1"${e.is_public ? raw(' checked') : ''}> ${t('dirShowPublic')}</label><button class="btn sm ghost">${t('save')}</button></form>
          <form method="post" action="/admin/directory/events/${e.id}">${csrfField(ctx)}<input type="hidden" name="delete" value="1"><button class="btn sm ghost">${t('delete')}</button></form></div>`) : h`<p class="small muted">${t('dirNoEvents')}</p>`}
      </div>
    </div>
  </section>`;
}

/* "Happening in the community" on the Events page: public listings, not Kuviyam events. */
function communityEvents(ctx, list) {
  const { t, lang } = ctx;
  if (!list.length) return '';
  const dated = list.filter((e) => e.on_date); const annual = list.filter((e) => !e.on_date);
  const row = (e) => h`<div class="card pad row top nowrap dir-evcard">${e.on_date ? h`<span class="date"><b>${+e.on_date.slice(8)}</b><span class="tiny">${dateLabel(e.on_date, lang).replace(/^\d+\s/, '')}</span></span>` : h`<span class="date">🪔</span>`}
    <div class="stack6"><b>${e.title}</b><span class="small muted">${[e.venue, e.area].filter(Boolean).join(', ')}${e.venue || e.area ? ' · ' : ''}${dt(e.country, lang)}${e.category ? ' · ' + e.category : ''}</span>
      ${e.organiser ? h`<span class="small">${t('hostedBy')} ${e.organiser}</span>` : ''}${e.date_text ? h`<span class="tiny muted">${e.date_text}</span>` : ''}
      ${e.contact ? h`<span class="small">☎ ${e.contact}</span>` : ''}${e.notes ? h`<span class="tiny muted">${e.notes}</span>` : ''}
      ${e.url ? h`<a class="small" href="${e.url}" target="_blank" rel="noopener nofollow">${t('dirEventListing')} ↗</a>` : ''}</div></div>`;
  return h`<section class="stack"><div class="sec-h"><div><h2>${t('dirCommunityH')}</h2><p class="small muted">${t('dirCommunityP')}</p></div></div>
    ${dated.length ? h`<div class="grid g2">${dated.map(row)}</div>` : ''}
    ${annual.length ? h`<h3>${t('dirAnnualH')}</h3><div class="grid g2">${annual.map(row)}</div>` : ''}</section>`;
}

module.exports = { publicList, admin, communityEvents };
