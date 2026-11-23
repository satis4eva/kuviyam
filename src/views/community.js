'use strict';
const { h, raw, gbp, dateLabel, MON } = require('../util');
const { dt } = require('../i18n');
const { L, avatar, art, csrfField, options, errors, shareBar } = require('./parts');

const timeAgo = (ctx, iso) => {
  const mins = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return ctx.t('agoM', { n: mins });
  const hrs = Math.round(mins / 60); if (hrs < 48) return ctx.t('agoH', { n: hrs });
  return dateLabel(iso, ctx.lang);
};
const postBtn = (ctx, action, label, cls = '') => h`<form method="post" action="${action}" class="inline">${csrfField(ctx)}<button class="btn sm ${cls}">${label}</button></form>`;
const modeLabel = (ctx, e) => ctx.t('m_' + e.mode, { p: e.price || '' }).trim();

function hubTabs(ctx, active) {
  const items = [['/community', 'tFeed', 'feed'], ['/events', 'tEvents', 'events'], ['/memorials', 'tMemorials', 'memorials']];
  return h`<nav class="tabs" aria-label="${ctx.t('communityH')}">${items.map(([href, k, id]) => h`<a href="${href}" class="${active === id ? 'on' : ''}">${ctx.t(k)}</a>`)}</nav>`;
}

/* ---------------- feed ---------------- */
function postCard(ctx, p, { full = true } = {}) {
  const { t, lang } = ctx;
  const org = { name: p.org_name, color: p.org_color };
  const media = p.file_id ? (p.kind === 'video' ? h`<video src="/files/${p.file_id}" controls preload="metadata"></video>` : h`<img src="/files/${p.file_id}" alt="${t('photoBy', { o: L(p, 'org_name', lang) })}" loading="lazy">`)
    : art(p.project_id || p.id, p.project_cause || 'Education');
  return h`<article class="card post" id="post-${p.id}">
    <div class="post-h">${avatar(org)}<div class="grow0"><a class="plain" href="/partners/${p.org_slug}"><b class="small">${L(p, 'org_name', lang)}</b></a><div class="tiny muted">${timeAgo(ctx, p.created_at)} · ${t(p.kind === 'video' ? 'video' : p.kind === 'photo' ? 'photo' : 'update')}</div></div></div>
    <div class="thumb">${media}</div>
    <div class="pad stack"><p class="small">${full ? L(p, 'text', lang) : h`<a class="plain" href="/community/posts/${p.id}">${L(p, 'text', lang)}</a>`}</p>${p.project_id && p.project_status === 'live' ? h`<a class="small" href="/projects/${p.project_id}">🔗 ${lang === 'ta' && p.project_title_ta ? p.project_title_ta : p.project_title}</a>` : ''}</div>
    ${full ? h`<div class="post-a">
      ${postBtn(ctx, `/community/posts/${p.id}/like`, h`${p.liked ? '♥' : '♡'} <span class="num">${p.likes}</span>`, 'ghost')}
      ${p.project_id && p.project_status === 'live' ? h`<a class="btn sm give" href="/donate?kind=project&amp;id=${p.project_id}">${t('donate')}</a>` : ''}
      <span class="push"></span>${postBtn(ctx, `/community/posts/${p.id}/report`, t('report'), 'ghost')}
    </div>
    <div class="pad-x">${shareBar(ctx, `/community/posts/${p.id}`, `${L(p, 'org_name', lang)}: ${String(L(p, 'text', lang)).slice(0, 100)}`)}</div>
    <div class="comments">${p.comments.map((c) => h`<div class="cmt"><b>${c.user_name || t('member')}</b> ${c.body} ${postBtn(ctx, `/community/comments/${c.id}/report`, t('reportShort'), 'link')}</div>`)}
      ${ctx.user ? h`<form method="post" action="/community/posts/${p.id}/comment" class="cform">${csrfField(ctx)}<label class="sr" for="c${p.id}">${t('writeComment')}</label><input id="c${p.id}" name="body" maxlength="500" required placeholder="${t('writeComment')}"><button class="btn sm">${t('post')}</button></form>`
                 : h`<a class="tiny" href="/login?next=/community">${t('loginToComment')}</a>`}
    </div>` : ''}
  </article>`;
}
function feed(ctx, d) {
  const { t, user } = ctx;
  const isPartner = user && user.orgs.some((o) => o.status === 'verified');
  return h`<section class="sec-h"><div><h1>${t('communityH')}</h1><p class="muted measure">${t('communityP')}</p></div>${isPartner ? h`<a class="btn pri" href="/dashboard/posts">${t('postMedia')}</a>` : ''}</section>
    ${hubTabs(ctx, 'feed')}
    <div class="grid g3">${d.posts.length ? d.posts.map((p) => postCard(ctx, p)) : h`<div class="empty">${t('noPosts')}</div>`}</div>`;
}

/* ---------------- events ---------------- */
function eventCard(ctx, e, withRsvp = true) {
  const { t, lang } = ctx; const [y, m, dd] = e.starts_on.split('-');
  return h`<article class="card pad row top nowrap" id="event-${e.id}">
    <div class="date"><b>${+dd}</b><span class="tiny">${MON[lang][+m - 1]} ${y.slice(2)}</span></div>
    <div class="stack grow0"><h3>${L(e, 'title', lang)}</h3><div class="small muted">${L(e, 'place', lang)} · ${modeLabel(ctx, e)}</div>
      ${L(e, 'details', lang) ? h`<p class="small">${L(e, 'details', lang)}</p>` : ''}
      <div class="small">${t('hostedBy')} <a href="/partners/${e.org_slug}">${L(e, 'org_name', lang)}</a></div>
      ${withRsvp ? h`<div class="row between"><span class="small muted num">${t('going', { n: e.going })}</span>
        ${ctx.user ? postBtn(ctx, `/events/${e.id}/rsvp`, e.going_me ? t('youGoing') : t('rsvp'), e.going_me ? 'pri' : '') : h`<a class="btn sm" href="/login?next=/events">${t('rsvp')}</a>`}</div>` : ''}
    </div></article>`;
}
function events(ctx, d) {
  const { t, user } = ctx;
  const isPartner = user && user.orgs.some((o) => o.status === 'verified');
  return h`<section class="sec-h"><div><h1>${t('eventsH')}</h1><p class="muted">${t('eventsP')}</p></div>${isPartner ? h`<a class="btn pri" href="/dashboard/events">${t('listEvent')}</a>` : ''}</section>
    ${hubTabs(ctx, 'events')}
    <div class="grid g2">${d.list.length ? d.list.map((e) => eventCard(ctx, e)) : h`<div class="empty">${t('noEvents')}</div>`}</div>`;
}

/* ---------------- memorials (notices) ---------------- */
const NOTICE_TYPES = ['obituary', 'sudden', 'thanks', 'r31', 'r1', 'r5', 'r10', 'tribute'];
const EVENT_KINDS = ['viewing', 'service', 'cremation', 'burial', 'prayer', 'other'];
const fullDate = (d, lang) => (d ? dateLabel(d, lang) : '');
const ageAt = (born, died) => { if (!born || !died) return null; const b = new Date(born), d = new Date(died); let a = d.getUTCFullYear() - b.getUTCFullYear(); if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) a--; return a; };
const places = (ctx, m) => {
  const { t, lang } = ctx; const born = L(m, 'birthplace', lang); const lived = L(m, 'lived_in', lang);
  return [born ? t('bornIn', { p: born }) : '', lived ? t('livedIn', { p: lived }) : ''].filter(Boolean).join(' · ') || L(m, 'town', lang);
};
const typeChip = (ctx, type) => h`<span class="chip ${type === 'obituary' || type === 'sudden' ? 'dark' : 'plain'}">${ctx.t('nt_' + type)}</span>`;

function memorials(ctx, d) {
  const { t, lang } = ctx; const f = d.filters;
  return h`<section class="sec-h"><div><h1>${t('memH')}</h1><p class="muted measure">${t('memP')}</p></div><a class="btn pri" href="/memorials/new">${t('postNotice')}</a></section>
    ${hubTabs(ctx, 'memorials')}
    <form class="filters" method="get" action="/memorials" role="search"><label class="sr" for="mq">${t('searchLbl')}</label><input id="mq" name="q" value="${f.q}" placeholder="${t('searchNoticesPh')}">
      <label class="sr" for="mt">${t('noticeType')}</label><select id="mt" name="type"><option value="">${t('allNotices')}</option>${NOTICE_TYPES.map((x) => h`<option value="${x}"${f.type === x ? raw(' selected') : ''}>${t('nt_' + x)}</option>`)}</select>
      <button class="btn sm pri">${t('search')}</button>${f.q || f.type ? h`<a class="btn sm ghost" href="/memorials">${t('clearFilters')}</a>` : ''}</form>
    <div class="notices">${d.list.length ? d.list.map((m) => h`<a class="card notice plain" href="/memorials/${m.id}#notice-${m.notice_id}">
      <span class="nphoto">${m.file_id ? h`<img src="/files/${m.file_id}" alt="" loading="lazy">` : h`<span class="nph">${String(L(m, 'name', lang)).slice(0, 1)}</span>`}</span>
      <span class="stack6 grow0">${typeChip(ctx, m.type)}<b class="nname">${L(m, 'name', lang)}</b><span class="small muted">${m.years}</span><span class="small">${places(ctx, m)}</span>
        <span class="tiny muted">${timeAgo(ctx, m.notice_at)} · 🕯️ ${m.candles} · ${t('tributesN', { n: m.messages })}</span></span></a>`) : h`<div class="empty">${t('noMemorials')}</div>`}</div>`;
}

function memorial(ctx, d) {
  const { t, lang } = ctx; const m = d.m; const age = ageAt(m.born_on, m.died_on);
  const maps = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const contacts = String(m.contacts || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return h`<div class="split"><div class="stack gap20">
    <section class="card pad memorial mhead">
      ${m.file_id ? h`<img class="mphoto lg" src="/files/${m.file_id}" alt="${L(m, 'name', lang)}">` : h`<span class="mphoto lg nph big">${String(L(m, 'name', lang)).slice(0, 1)}</span>`}
      <div class="stack6"><span class="small muted">${t('inMemory')}</span><h1>${L(m, 'name', lang)}</h1>${lang !== 'ta' && m.name_ta ? h`<div class="muted" lang="ta">${m.name_ta}</div>` : ''}
        <div class="dates">${m.born_on ? h`<span>${t('born')}: <b>${fullDate(m.born_on, lang)}</b></span>` : ''}<span>${t('died')}: <b>${fullDate(m.died_on, lang) || m.years}</b></span>${age !== null ? h`<span>${t('ageN', { n: age })}</span>` : ''}</div>
        <div class="small">${places(ctx, m)}</div>
        <div class="row">${d.lit ? h`<span class="chip good">✓ ${t('candleLit')}</span>` : postBtn(ctx, `/memorials/${m.id}/candle`, t('lightCandle'))}<span class="small muted">🕯️ ${m.candles}</span></div>
        ${shareBar(ctx, `/memorials/${m.id}`, t('inMemOf', { n: L(m, 'name', lang) }))}</div></section>

    ${d.notices.map((n) => h`<section class="card pad stack" id="notice-${n.id}"><div class="row between">${typeChip(ctx, n.type)}<span class="tiny muted">${dateLabel(n.created_at, lang)}${n.status === 'pending' ? h` · <span class="warn-t">${t('awaitingApproval')}</span>` : ''}</span></div>
      ${n.body && n.body !== n.body_ta ? h`<div class="nbody">${n.body}</div>` : ''}${n.body_ta ? h`<div class="nbody" lang="ta">${n.body_ta}</div>` : ''}
      ${m.informed_by ? h`<p class="small muted">${t('informedBy')}: ${m.informed_by}</p>` : ''}</section>`)}

    ${d.events.length ? h`<section class="card pad stack"><h3>${t('eventsTitle')}</h3>${d.events.map((e) => h`<div class="mevent"><div class="date"><b>${+e.on_date.slice(8, 10)}</b><span class="tiny">${dateLabel(e.on_date, lang).split(' ').slice(1).join(' ')}</span></div>
      <div class="stack6"><b>${t('ek_' + e.kind)}</b><span class="small">${e.start_time ? e.start_time + (e.end_time ? ' – ' + e.end_time : '') + ' · ' : ''}${e.venue}</span>${e.address ? h`<span class="small muted">${e.address}</span>` : ''}
        <span class="row">${h`<a class="btn sm" href="${maps(e.address || e.venue)}" target="_blank" rel="noopener">📍 ${t('directions')}</a>`}${e.stream_url ? h`<a class="btn sm pri" href="${e.stream_url}" target="_blank" rel="noopener">▶ ${t('liveStream')}</a>` : ''}</span></div></div>`)}</section>` : ''}

    ${d.gallery.length ? h`<section class="card pad stack"><h3>${t('photos')}</h3><div class="gallery">${d.gallery.map((g) => h`<a href="/files/${g.id}" target="_blank" rel="noopener"><img src="/files/${g.id}" alt="" loading="lazy"></a>`)}</div></section>` : ''}
    ${contacts.length ? h`<section class="card pad stack"><h3>${t('contactsTitle')}</h3><ul class="small">${contacts.map((c) => h`<li>${c}</li>`)}</ul></section>` : ''}

    <section class="card pad stack" id="condolences"><h3>${t('tributesTitle', { n: d.condol.length })}</h3>
      ${d.condol.length ? d.condol.map((c) => h`<div class="condol"><p>${c.body}</p><div class="tiny muted">${c.name} · ${dateLabel(c.created_at, lang)}</div></div>`) : h`<p class="muted small">${t('beFirst')}</p>`}
      ${ctx.user ? h`<form class="form" method="post" action="/memorials/${m.id}/condolence">${csrfField(ctx)}<label class="f">${t('yourName')}<input name="name" value="${ctx.user.name}" maxlength="120"></label><label class="f">${t('message')}<textarea name="body" required maxlength="1000"></textarea></label><div><button class="btn pri">${t('postMessage')}</button></div></form>`
                 : h`<a class="btn" href="/login?next=/memorials/${m.id}">${t('loginToCondole')}</a>`}</section>

    ${d.isOwner ? h`<section class="card pad stack" id="add-notice"><h3>${t('addNotice')}</h3><p class="tiny muted">${t('addNoticeP')}</p>
      <form class="form" method="post" action="/memorials/${m.id}/notices">${csrfField(ctx)}<label class="f">${t('noticeType')}<select name="type">${NOTICE_TYPES.filter((x) => x !== 'obituary' && x !== 'sudden').map((x) => h`<option value="${x}">${t('nt_' + x)}</option>`)}</select></label>
        <label class="f">${t('noticeEn')}<textarea name="body" maxlength="4000"></textarea></label><label class="f">${t('noticeTa')}<textarea name="body_ta" lang="ta" maxlength="4000"></textarea></label><div><button class="btn pri">${t('sendApproval')}</button></div></form></section>` : ''}
  </div>
  <aside class="stack sticky">
    ${m.project_id && m.project_status === 'live' ? h`<div class="card pad stack"><h3>${t('giveInMemory')}</h3><p class="small muted">${t('familyChose')}</p><a href="/projects/${m.project_id}"><b>${lang === 'ta' && m.project_title_ta ? m.project_title_ta : m.project_title}</b></a>
      <div class="num"><b class="mid">${gbp(m.raised_pence)}</b> <span class="small muted">${t('givenMemShort')}</span></div>
      <a class="btn give" href="/donate?kind=memorial&amp;id=${m.id}">${t('donateInMemory')}</a><p class="tiny muted">${t('familyNote')}</p></div>` : ''}
    <a class="card pad plain small" href="/memorials/new">${t('postNoticeCta')}</a>
  </aside></div>`;
}

function memorialForm(ctx, d) {
  const { t, lang } = ctx; const v = d.values;
  const evRow = (i) => h`<div class="evrow"><label class="f">${t('eventType')}<select name="ev_kind_${i}"><option value="">—</option>${EVENT_KINDS.map((k) => h`<option value="${k}"${v['ev_kind_' + i] === k ? raw(' selected') : ''}>${t('ek_' + k)}</option>`)}</select></label>
    <label class="f">${t('date')}<input type="date" name="ev_date_${i}" value="${v['ev_date_' + i] || ''}"></label><label class="f">${t('from')}<input type="time" name="ev_start_${i}" value="${v['ev_start_' + i] || ''}"></label><label class="f">${t('to')}<input type="time" name="ev_end_${i}" value="${v['ev_end_' + i] || ''}"></label>
    <label class="f span2">${t('venue')}<input name="ev_venue_${i}" value="${v['ev_venue_' + i] || ''}" maxlength="160"></label><label class="f span2">${t('address')}<input name="ev_address_${i}" value="${v['ev_address_' + i] || ''}" maxlength="240"></label>
    <label class="f span4">${t('streamUrl')}<input name="ev_stream_${i}" value="${v['ev_stream_' + i] || ''}" maxlength="300" placeholder="https://"></label></div>`;
  return h`<section class="narrow wide2"><form class="card pad form" method="post" action="/memorials" enctype="multipart/form-data">${csrfField(ctx)}
    <h1>${t('postNotice')}</h1><p class="small muted">${t('tributeCheck')}</p>${errors(ctx, d.errors)}
    <h3>${t('aboutPerson')}</h3>
    <div class="f2"><label class="f">${t('fullNameEn')} *<input name="name" value="${v.name || ''}" required maxlength="120"></label><label class="f">${t('fullNameTa')}<input name="name_ta" value="${v.name_ta || ''}" lang="ta" maxlength="120"></label></div>
    <div class="f2"><label class="f">${t('born')}<input type="date" name="born_on" value="${v.born_on || ''}"></label><label class="f">${t('died')} *<input type="date" name="died_on" value="${v.died_on || ''}" required></label></div>
    <div class="f2"><label class="f">${t('birthplaceEn')} *<input name="birthplace" value="${v.birthplace || ''}" required maxlength="120" placeholder="${t('birthplacePh')}"></label><label class="f">${t('birthplaceTa')}<input name="birthplace_ta" value="${v.birthplace_ta || ''}" lang="ta" maxlength="120"></label></div>
    <div class="f2"><label class="f">${t('livedInEn')}<input name="lived_in" value="${v.lived_in || ''}" maxlength="200" placeholder="${t('livedInPh')}"></label><label class="f">${t('livedInTa')}<input name="lived_in_ta" value="${v.lived_in_ta || ''}" lang="ta" maxlength="200"></label></div>
    <div class="f2"><label class="f">${t('mainPhoto')}<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label><label class="f">${t('morePhotos')}<input type="file" name="gallery" accept="image/jpeg,image/png,image/webp" multiple></label></div>
    <h3>${t('theNotice')}</h3>
    <label class="f">${t('noticeType')}<select name="type">${NOTICE_TYPES.map((x) => h`<option value="${x}"${v.type === x ? raw(' selected') : ''}>${t('nt_' + x)}</option>`)}</select></label>
    <label class="f">${t('noticeEn')}<textarea name="body" maxlength="4000" rows="6">${v.body || ''}</textarea></label>
    <label class="f">${t('noticeTa')}<textarea name="body_ta" lang="ta" maxlength="4000" rows="6">${v.body_ta || ''}</textarea></label>
    <div class="f2"><label class="f">${t('informedBy')}<input name="informed_by" value="${v.informed_by || ''}" maxlength="120"></label><label class="f">${t('memCause')}<select name="project_id"><option value="">${t('noCause')}</option>${d.projects.map((p) => h`<option value="${p.id}"${String(v.project_id) === String(p.id) ? raw(' selected') : ''}>${lang === 'ta' && p.title_ta ? p.title_ta : p.title}</option>`)}</select></label></div>
    <h3>${t('eventsTitle')}</h3><p class="tiny muted">${t('eventsHint')}</p>${[0, 1, 2].map(evRow)}
    <h3>${t('contactsTitle')}</h3><label class="f">${t('contactsHint')}<textarea name="contacts" maxlength="800" placeholder="${t('contactsPh')}">${v.contacts || ''}</textarea></label>
    <button class="btn pri">${t('sendApproval')}</button></form></section>`;
}

/* ---------------- dashboard ---------------- */
function dashPosts(ctx, d) {
  const { t, lang } = ctx; const v = d.values; const { dashHead, tabs } = require('./manage');
  return h`${dashHead(ctx, d.org)}${tabs(ctx, 'posts')}
  <section class="grid g2 top">
    <form class="card pad form" method="post" action="/dashboard/posts" enctype="multipart/form-data">${csrfField(ctx)}<h3>${t('postToFeed')}</h3>${errors(ctx, d.errors)}
      <label class="f">${t('photoVideo')}<input type="file" name="media" accept="image/jpeg,image/png,image/webp,video/mp4"><span class="tiny muted">${t('mediaHint')}</span></label>
      <label class="f">${t('captionEn')}<textarea name="text" maxlength="1500" placeholder="${t('captionPh')}">${v.text || ''}</textarea></label>
      <label class="f">${t('captionTa')}<textarea name="text_ta" lang="ta" maxlength="1500">${v.text_ta || ''}</textarea></label>
      <label class="f">${t('linkProject')}<select name="project_id"><option value="">${t('none')}</option>${d.projects.map((p) => h`<option value="${p.id}">${lang === 'ta' && p.title_ta ? p.title_ta : p.title}</option>`)}</select></label>
      <div><button class="btn pri">${t('publishPost')}</button></div></form>
    <div class="stack">${d.posts.length ? d.posts.map((p) => h`<div class="card pad row between"><div class="small grow"><b>${timeAgo(ctx, p.created_at)}</b> · ${L(p, 'text', lang).slice(0, 90)}</div><span class="tiny muted">♥ ${p.likes} · 💬 ${p.comments.length}</span>${postBtn(ctx, `/dashboard/posts/${p.id}/delete`, t('remove'), 'ghost')}</div>`) : h`<div class="card empty">${t('noPosts')}</div>`}</div>
  </section>`;
}
function dashEvents(ctx, d) {
  const { t, lang } = ctx; const v = d.values; const { dashHead, tabs } = require('./manage');
  const modes = ['inperson', 'online', 'tickets', 'volunteers'];
  return h`${dashHead(ctx, d.org)}${tabs(ctx, 'events')}
  <section class="grid g2 top">
    <form class="card pad form" method="post" action="/dashboard/events">${csrfField(ctx)}<h3>${t('listEvent')}</h3><p class="tiny muted">${t('eventCheck')}</p>${errors(ctx, d.errors)}
      <div class="f2"><label class="f">${t('eventNameEn')}<input name="title" value="${v.title || ''}" maxlength="160"></label><label class="f">${t('eventNameTa')}<input name="title_ta" value="${v.title_ta || ''}" lang="ta" maxlength="160"></label></div>
      <div class="f2"><label class="f">${t('date')} *<input type="date" name="starts_on" value="${v.starts_on || ''}" required></label><label class="f">${t('type')} *<select name="mode">${modes.map((m) => h`<option value="${m}"${v.mode === m ? raw(' selected') : ''}>${t('m_' + m, { p: '' })}</option>`)}</select></label></div>
      <div class="f2"><label class="f">${t('placeEn')} *<input name="place" value="${v.place || ''}" required maxlength="160" placeholder="${t('placePh')}"></label><label class="f">${t('placeTa')}<input name="place_ta" value="${v.place_ta || ''}" lang="ta" maxlength="160"></label></div>
      <label class="f">${t('ticketPrice')}<input name="price" value="${v.price || ''}" maxlength="30" placeholder="£35"></label>
      <div class="f2"><label class="f">${t('detailsEn')}<textarea name="details" maxlength="1500">${v.details || ''}</textarea></label><label class="f">${t('detailsTa')}<textarea name="details_ta" lang="ta" maxlength="1500">${v.details_ta || ''}</textarea></label></div>
      <div><button class="btn pri">${t('sendApproval')}</button></div></form>
    <div class="card tw"><table><thead><tr><th>${t('date')}</th><th>${t('eventNameEn')}</th><th>${t('thStatus')}</th><th class="r">${t('goingH')}</th></tr></thead><tbody>
      ${d.events.map((e) => h`<tr><td>${dateLabel(e.starts_on, lang)}</td><td>${L(e, 'title', lang)}${e.reason ? h`<div class="tiny muted">${t('reason')}: ${e.reason}</div>` : ''}</td><td><span class="chip ${e.status === 'live' ? 'good' : e.status === 'rejected' ? 'bad' : 'plain'}">${t('st_' + e.status)}</span></td><td class="r">${e.going}</td></tr>`)}
      ${d.events.length ? '' : h`<tr><td colspan="4" class="empty">${t('noEvents')}</td></tr>`}</tbody></table></div>
  </section>`;
}

/* ---------------- admin ---------------- */
function adminMemorial(ctx, d) {
  const { t } = ctx; const m = d.m;
  return h`<section class="split"><div class="stack">${memorialPreview(ctx, d)}</div>
    ${m.status === 'pending' ? h`<aside class="card pad stack sticky">
      <form method="post" action="/admin/memorials/${m.id}/approve">${csrfField(ctx)}<button class="btn pri">${t('approve')}</button></form>
      <form method="post" action="/admin/memorials/${m.id}/reject" class="stack">${csrfField(ctx)}<label class="f">${t('reason')}<textarea name="reason" maxlength="300"></textarea></label><button class="btn">${t('reject')}</button></form></aside>` : h`<aside class="card pad"><span class="chip">${t('st_' + m.status)}</span></aside>`}</section>`;
}
function memorialPreview(ctx, d) {
  const { t, lang } = ctx; const m = d.m;
  return h`<div class="card pad stack memorial">${m.file_id ? h`<img class="mphoto lg" src="/files/${m.file_id}" alt="">` : ''}<h1>${m.name}</h1>${m.name_ta ? h`<div class="muted" lang="ta">${m.name_ta}</div>` : ''}
    <div class="small">${t('born')}: ${fullDate(m.born_on, lang) || '—'} · ${t('died')}: ${fullDate(m.died_on, lang) || m.years}</div><div class="small">${places(ctx, m)}</div>
    ${d.notices.map((n) => h`<div class="stack6">${typeChip(ctx, n.type)}<div class="nbody">${n.body}</div>${n.body_ta ? h`<div class="nbody" lang="ta">${n.body_ta}</div>` : ''}</div>`)}
    ${d.events.map((e) => h`<div class="small">${t('ek_' + e.kind)} · ${dateLabel(e.on_date, lang)} ${e.start_time || ''} · ${e.venue}${e.stream_url ? ' · ' + e.stream_url : ''}</div>`)}
    ${m.contacts ? h`<div class="small"><b>${t('contactsTitle')}:</b> ${m.contacts}</div>` : ''}
    ${d.gallery.length ? h`<div class="gallery">${d.gallery.map((g) => h`<img src="/files/${g.id}" alt="">`)}</div>` : ''}
    <div class="small">${t('memCause')}: ${m.project_title || '—'}</div></div>`;
}

function postPage(ctx, d) {
  return h`<section class="narrow wide2 stack"><a class="small" href="/community">← ${ctx.t('backToFeed')}</a>${postCard(ctx, d.post)}</section>`;
}

module.exports = { postPage, postCard, eventCard, feed, events, memorials, memorial, memorialForm, dashPosts, dashEvents, adminMemorial, postBtn };
