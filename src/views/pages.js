'use strict';
const { h, raw, gbp, lkr, monthLabel, dateLabel, RATE_LKR_PER_GBP } = require('../util');
const { dt, CAUSES, TYPES, DISTRICTS, COUNTRIES } = require('../i18n');
const { L, pct, avatar, verifiedTag, art, projectCard, csrfField, options, errors, shareBar, memberAvatar } = require('./parts');
const C = require('./community');

/* ---------------- home ---------------- */
/*
 * Home: a short welcome, then large white boxes, one per part of the site. Each box shows something live
 * (the most urgent project, the newest post, the next event) so the page always looks current.
 * Every label is shown in both Tamil and English, whichever language is selected.
 */
function homeBox(ctx, { href, key, icon, en, ta, live, extra = '', cls = '' }) {
  const { lang } = ctx;
  const [first, second] = lang === 'ta' ? [ta, en] : [en, ta];
  return h`<a class="hbox s-${key} ${cls}" href="${href}">
    <span class="hb-top"><span class="hb-ic" aria-hidden="true">${icon}</span><span class="hb-name"><b>${first}</b><span lang="${lang === 'ta' ? 'en' : 'ta'}">${second}</span></span><span class="hb-go" aria-hidden="true">→</span></span>
    ${extra}<span class="hb-live">${live}</span></a>`;
}
function home(ctx, d) {
  const { t, lang, user } = ctx; const b = d.box;
  const top = b.top;
  const lp = b.latestPost;
  const lpWho = lp ? (lp.org_id ? L(lp, 'org_name', lang) : lp.author) : '';
  const lpText = lp ? String(L(lp, 'text', lang) || '').slice(0, 90) : '';
  const ev = b.nextEvent;
  const BI = (en, ta) => ({ en, ta });
  const label = { projects: BI('Projects', 'திட்டங்கள்'), sponsor: BI('Sponsor a student', 'மாணவர் அனுசரணை'), feed: BI('Community feed', 'சமூகப் பதிவுகள்'), people: BI('People', 'மக்கள்'),
    events: BI('Events', 'நிகழ்வுகள்'), notices: BI('Notices', 'அறிவித்தல்கள்'), partners: BI('Partners', 'பங்காளர்கள்'), spend: BI('Where money goes', 'பணம் எங்கே செல்கிறது'), join: BI('Join free', 'இலவசமாக இணைக'), me: BI('Your space', 'உங்கள் பகுதி') };
  const boxes = [
    homeBox(ctx, { href: top ? `/projects/${top.id}` : '/projects', key: 'projects', icon: '🤝', ...label.projects, cls: 'wide',
      extra: top ? h`<span class="hb-feature">${top.urgent ? h`<span class="chip bad">${t('urgent')}</span> ` : ''}<b>${L(top, 'title', lang)}</b><span class="prog" role="progressbar" aria-valuenow="${pct(top)}" aria-valuemin="0" aria-valuemax="100" aria-label="${t('funded', { p: pct(top) })}"><i style="width:${pct(top)}%"></i></span><span class="small muted num">${t('ofGoal', { r: gbp(top.raised_pence), g: gbp(top.goal_pence) })} · ${t('donors', { n: top.donors })}</span></span>` : '',
      live: t('hbProjects', { n: d.projects }) }),
    homeBox(ctx, { href: '/sponsor', key: 'sponsor', icon: '🎓', ...label.sponsor, live: b.waiting.n ? t('hbWaiting', { n: b.waiting.n, p: gbp(b.waiting.m) }) : t('hbAllSponsored', { n: d.sponsored }) }),
    homeBox(ctx, { href: '/community', key: 'feed', icon: '💬', ...label.feed,
      extra: lp ? h`<span class="hb-quote"><b>${lpWho}:</b> “${lpText}${lpText.length >= 90 ? '…' : ''}”</span>` : '',
      live: h`${b.faces.length ? h`<span class="faces">${b.faces.map((f) => memberAvatar(f, 'sm'))}</span>` : ''}${b.postsToday ? t('hbPostsToday', { n: b.postsToday }) : t('hbSeeFeed')}` }),
    homeBox(ctx, { href: '/members', key: 'people', icon: '👥', ...label.people, live: b.towns.length ? t('hbPeopleTowns', { n: b.members, p: b.towns.join(', ') }) : t('hbPeople', { n: b.members }) }),
    homeBox(ctx, { href: ev ? `/events#event-${ev.id}` : '/events', key: 'events', icon: '📅', ...label.events,
      live: ev ? h`<b>${dateLabel(ev.starts_on, lang)}</b> · ${L(ev, 'title', lang)}${ev.going ? h` · ${t('going', { n: ev.going })}` : ''}` : t('hbNoEvents') }),
    homeBox(ctx, { href: '/memorials', key: 'notices', icon: '🪔', ...label.notices,
      live: b.notices ? t('hbNotices', { n: b.notices }) : b.latestNotice ? t('hbLatestNotice', { n: L(b.latestNotice, 'name', lang) }) : t('hbNoticesNone') }),
    homeBox(ctx, { href: '/partners', key: 'partners', icon: '🏫', ...label.partners, live: t('hbPartners', { n: d.partners }) }),
    homeBox(ctx, { href: '/transparency', key: 'spend', icon: '🧾', ...label.spend,
      live: b.spent ? t('hbSpent', { a: lkr(b.spent.lkr.s, lang), m: monthLabel(b.spent.month, lang), n: b.spent.lkr.docs }) : t('hbSpendNone') })
  ];
  // First box: a personal one for members, an invitation for visitors.
  const counts = ctx.counts || {};
  const first = user
    ? homeBox(ctx, { href: counts.msgs ? '/messages' : counts.notes ? '/notifications' : `/members/${user.id}`, key: 'me', icon: '⭐', ...label.me, cls: 'hb-me',
        extra: h`<span class="row nowrap">${memberAvatar(user)}<b>${t('hiName', { n: String(user.name).split(' ')[0] })}</b></span>`,
        live: counts.msgs || counts.notes ? t('hbMine', { m: counts.msgs || 0, n: counts.notes || 0 }) : user.tier === 'free' ? t('hbUpgrade') : t('hbMember', { t: t('tier_' + user.tier) }) })
    : homeBox(ctx, { href: '/membership', key: 'join', icon: '⭐', ...label.join, cls: 'hb-join', live: t('hbJoin') });
  return h`
  <section class="welcome">
    <div class="w-text">
      <p class="w-hello" lang="ta">வணக்கம்</p>
      <h1>${user ? t('welcomeBack', { n: String(user.name).split(' ')[0] }) : t('heroH')}</h1>
      <p class="lead">${t('homeLead')}</p>
      <form class="search" action="/projects" method="get" role="search"><label for="q" class="sr">${t('searchLbl')}</label><input id="q" name="q" placeholder="${t('searchPh')}"><button class="btn">${t('search')}</button></form>
    </div>
    <div class="w-side">
      <a class="btn give big-btn" href="${top ? `/donate?kind=project&id=${top.id}` : '/projects'}">${t('giveNow')}</a>
      <div class="w-stats"><span><b class="num">${gbp(d.raised)}</b> ${t('stRaised')}</span><span><b class="num">${d.sponsored}</b> ${t('stStudents')}</span><span><b class="num">${d.partners}</b> ${t('stPartners')}</span></div>
    </div>
  </section>
  <section class="hgrid" aria-label="${t('homeBoxes')}">${first}${boxes}</section>
  <section><div class="sec-h"><h2>${t('urgentNeeds')}</h2><a href="/projects">${t('allProjects')}</a></div>
    <div class="grid g3">${d.urgent.map((p) => projectCard(ctx, p))}</div></section>
  ${d.posts.length ? h`<section><div class="sec-h"><h2>${t('fromCommunity')}</h2><a href="/community">${t('openFeed')}</a></div>
    <div class="grid g3">${d.posts.map((p) => C.postCard(ctx, p, { full: false }))}</div></section>` : ''}
  ${d.events.length ? h`<section><div class="sec-h"><h2>${t('upcomingEvents')}</h2><a href="/events">${t('allEvents')}</a></div><div class="grid g3">${d.events.map((e) => C.eventCard(ctx, e, false))}</div></section>` : ''}`;
}

/* ---------------- projects ---------------- */
function projects(ctx, d) {
  const { t, lang } = ctx; const f = d.filters; const active = f.q || f.cause || f.district;
  return h`<section><div class="sec-h"><div><h1>${f.q ? t('resultsFor', { q: f.q }) : t('projectsH')}</h1><p class="muted">${t('nOpen', { n: d.list.length })}</p></div></div>
    <form class="filters mb" method="get" action="/projects" role="search">
      <label class="sr" for="fq">${t('searchLbl')}</label><input id="fq" name="q" value="${f.q}" placeholder="${t('searchPh')}">
      <label class="sr" for="fc">${t('cause')}</label><select id="fc" name="cause">${options(CAUSES, f.cause, lang, t('allCauses'))}</select>
      <label class="sr" for="fd">${t('district')}</label><select id="fd" name="district">${options(d.districts, f.district, lang, t('allDistricts'))}</select>
      <button class="btn sm pri">${t('search')}</button>${active ? h`<a class="btn sm ghost" href="/projects">${t('clearFilters')}</a>` : ''}
    </form>
    ${d.partnerHits.length ? h`<div class="card pad stack mb"><h3>${t('partnersMatching')}</h3><div class="row">${d.partnerHits.map((o) => h`<a class="chip plain" href="/partners/${o.slug}">${L(o, 'name', lang)} · ${dt(o.place, lang)}</a>`)}</div></div>` : ''}
    <div class="grid g3">${d.list.length ? d.list.map((p) => projectCard(ctx, p)) : h`<div class="empty">${t('noMatch')}</div>`}</div></section>`;
}

function project(ctx, d) {
  const { t, lang } = ctx; const p = d.project; const o = d.org;
  const needs = (L(p, 'needs', lang) || '').split('\n').filter(Boolean);
  return h`<div class="split">
    <div class="stack gap20">
      <div class="card"><div class="thumb wide">${art(p.id, p.cause)}</div></div>
      <div class="stack"><div class="row"><span class="chip">${dt(p.cause, lang)}</span>${p.urgent ? h`<span class="chip bad">${t('urgent')}</span>` : ''}<span class="chip plain">${dt(p.district, lang)}, ${dt(o.country, lang)}</span>${p.status !== 'live' ? h`<span class="chip warn">${t('closed')}</span>` : ''}</div>
      <h1>${L(p, 'title', lang)}</h1>
      <a href="/partners/${o.slug}" class="row plain">${avatar(o)}<span><b>${L(o, 'name', lang)}</b><br>${verifiedTag(ctx, o)}</span></a></div>
      ${needs.length ? h`<div class="card pad stack"><h3>${t('buys')}</h3><ul>${needs.map((n) => h`<li>${n}</li>`)}</ul></div>` : ''}
      <div class="card pad stack"><h3>${t('proofDistrict')}</h3>
        ${d.docs.length ? h`<div class="row">${d.docs.map((x) => h`<a class="doc" href="/files/${x.id}" target="_blank" rel="noopener">📄 ${x.filename}</a>`)}</div>` : h`<p class="small muted">${t('noProofYet')}</p>`}
        <a class="small" href="/transparency/${o.slug}">${t('fullReport')}</a></div>
    </div>
    <aside class="card pad stack sticky">
      <div class="num"><b class="big">${gbp(p.raised_pence)}</b> <span class="muted">${t('raisedOf', { g: gbp(p.goal_pence) })}</span></div>
      <div class="prog"><i style="width:${pct(p)}%"></i></div>
      <div class="row between small muted num"><span>${t('funded', { p: pct(p) })}</span><span>${t('donors', { n: p.donors })}</span>${p.ends_on ? h`<span>${t('ends', { d: dateLabel(p.ends_on, lang) })}</span>` : ''}</div>
      ${p.status === 'live' ? h`<a class="btn give" href="/donate?kind=project&amp;id=${p.id}">${t('donateNow')}</a><a class="btn" href="/donate?kind=project&amp;id=${p.id}&amp;monthly=1">${t('giveMonthly')}</a>` : ''}
      <p class="tiny muted">${t('giftAidNote')}</p>
      ${shareBar(ctx, `/projects/${p.id}`, L(p, 'title', lang))}
    </aside></div>`;
}

/* ---------------- partners ---------------- */
function partners(ctx, d) {
  const { t, lang } = ctx; const f = d.filters; const active = f.q || f.type || f.cause || f.country;
  return h`<section><div class="sec-h"><div><h1>${t('partnersH')}</h1><p class="muted measure">${t('partnersP')}</p></div><a class="btn give sm" href="/join">${t('nav_join')}</a></div>
    <form class="filters mb" method="get" action="/partners" role="search">
      <label class="sr" for="pq">${t('searchPartners')}</label><input id="pq" name="q" value="${f.q}" placeholder="${t('searchPartnersPh')}">
      <label class="sr" for="pt">${t('thType')}</label><select id="pt" name="type">${options(d.opts.types, f.type, lang, t('allTypes'))}</select>
      <label class="sr" for="pc">${t('cause')}</label><select id="pc" name="cause">${options(d.opts.causes, f.cause, lang, t('allCauses'))}</select>
      <label class="sr" for="pn">${t('country')}</label><select id="pn" name="country">${options(d.opts.countries, f.country, lang, t('allCountries'))}</select>
      <button class="btn sm pri">${t('search')}</button>${active ? h`<a class="btn sm ghost" href="/partners">${t('clearFilters')}</a>` : ''}
    </form>
    <p class="small muted mb">${t('nShowing', { n: d.list.length, total: d.total })}</p>
    ${d.list.length ? '' : h`<div class="empty card">${t('noMatch')}</div>`}
    <div class="grid g2">${d.list.map((o) => h`<a class="card pad stack plain" href="/partners/${o.slug}">
      <div class="row nowrap">${avatar(o)}<div><h3>${L(o, 'name', lang)}</h3><div class="small muted">${dt(o.place, lang)}, ${dt(o.country, lang)} · ${t('since', { y: o.since || '' })}</div></div></div>
      <p class="small">${L(o, 'about', lang)}</p>
      <div class="row"><span class="chip">${dt(o.cause, lang)}</span><span class="chip plain">${dt(o.type, lang)}</span>${verifiedTag(ctx, o)}<span class="chip plain">${t('nProjects', { n: o.projects })}</span>${o.late ? h`<span class="chip warn">${t('reportLate')}</span>` : ''}</div></a>`)}</div></section>`;
}

function partner(ctx, d) {
  const { t, lang } = ctx; const o = d.org;
  return h`<section class="card pad row top">${avatar(o, true)}
    <div class="stack grow"><h1>${L(o, 'name', lang)}</h1><div class="row small muted">${dt(o.type, lang)} · ${dt(o.place, lang)}, ${dt(o.country, lang)} · ${dt(o.cause, lang)} · ${t('since', { y: o.since || '' })} ${verifiedTag(ctx, o)}</div><p>${L(o, 'about', lang)}</p></div>
    <div class="stack"><div class="row"><a class="btn give" href="/donate?kind=org&amp;id=${o.id}">${t('donate')}</a><a class="btn" href="/transparency/${o.slug}">${t('monthlySpend')}</a></div>${shareBar(ctx, `/partners/${o.slug}`, L(o, 'name', lang))}</div></section>
  <section><h2 class="mb">${t('projects')}</h2><div class="grid g3">${d.projects.length ? d.projects.map((p) => projectCard(ctx, p)) : h`<div class="empty">${t('noProjects')}</div>`}</div></section>
  ${d.students.length ? h`<section><h2 class="mb">${t('sponsorH')}</h2><div class="grid g3">${d.students.map((s) => studentCard(ctx, s, o))}</div></section>` : ''}`;
}

/* ---------------- sponsorship ---------------- */
function studentCard(ctx, s, o) {
  const { t, lang } = ctx;
  return h`<article class="card pad stack">
    <div class="row nowrap"><span class="avatar" style="background:${raw(/^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : '#0D6B5B')}" aria-hidden="true">${String(L(s, 'name', lang)).slice(0, 1)}</span><div><h3>${L(s, 'name', lang)}</h3><div class="small muted">${t('grade', { n: s.grade })} · ${dt(s.district, lang)}</div></div></div>
    <p class="small">${L(s, 'dream', lang)}</p><div class="small muted">${t('through', { c: L(o, 'name', lang) })}</div>
    <div class="row between"><b class="num">${gbp(s.monthly_pence)} <span class="muted small">${t('perMonth')}</span></b>
    ${s.sponsored ? h`<span class="chip good">${t('sponsored')}</span>` : h`<a class="btn give sm" href="/donate?kind=student&amp;id=${s.id}">${t('sponsorBtn')}</a>`}</div></article>`;
}
function sponsor(ctx, d) {
  const { t } = ctx;
  return h`<section><div class="sec-h"><div><h1>${t('sponsorH')}</h1><p class="muted measure">${t('sponsorP')}</p></div></div>
    <div class="grid g3">${d.list.length ? d.list.map((s) => studentCard(ctx, s, s.org)) : h`<div class="empty">${t('noStudents')}</div>`}</div></section>`;
}

/* ---------------- transparency ---------------- */
function transparency(ctx, d) {
  const { t, lang } = ctx;
  return h`<section><h1>${t('trPageH')}</h1><p class="muted measure">${t('trPageP')}</p></section>
  <div class="card tw"><table><thead><tr><th>${t('thPartner')}</th><th>${t('thLatest')}</th><th class="r">${t('thReceived')}</th><th class="r">${t('thSpent')}</th><th class="r">${t('thDocs')}</th><th>${t('thStatus')}</th><th></th></tr></thead><tbody>
  ${d.rows.map((r) => h`<tr><td><b>${L(r.org, 'name', lang)}</b><div class="tiny muted">${dt(r.org.country, lang)}</div></td>
    <td>${r.latest ? monthLabel(r.latest.month, lang) : '—'}</td><td class="r">${r.latest ? gbp(r.latest.received_pence) : '—'}</td><td class="r">${r.latest ? lkr(r.latest.spent, lang) : '—'}</td><td class="r">${r.latest ? r.latest.docs : 0}</td>
    <td>${r.late ? h`<span class="chip warn">${t('late')}</span>` : r.underReview ? h`<span class="chip plain">${t('underReview')}</span>` : h`<span class="chip good">✓ ${t('upToDate')}</span>`}</td>
    <td>${r.latest ? h`<a href="/transparency/${r.org.slug}">${t('open')}</a>` : ''}</td></tr>`)}
  </tbody></table></div><p class="tiny muted">${t('rateNote', { r: RATE_LKR_PER_GBP })}</p>`;
}

function bars(ctx, obj) {
  const tot = Object.values(obj).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => h`<div class="hbar"><span>${dt(k, ctx.lang)}</span><span class="t"><i style="width:${(v / tot * 100).toFixed(1)}%"></i></span><span class="num r">${Math.round(v / tot * 100)}%</span></div>`);
}
function report(ctx, d) {
  const { t, lang } = ctx; const o = d.org; const reps = d.reports;
  if (!reps.length) return h`<section class="card pad stack"><h1>${L(o, 'name', lang)}</h1><p class="muted">${t('noReports')}</p></section>`;
  const rec = reps.reduce((a, r) => a + r.received_pence, 0);
  const spent = reps.reduce((a, r) => a + r.spent, 0);
  const byCat = {}, byDist = {};
  d.items.forEach((i) => { byCat[i.category] = (byCat[i.category] || 0) + i.amount_lkr; byDist[i.district] = (byDist[i.district] || 0) + i.amount_lkr; });
  const admin = byCat.Admin || 0;
  const maxV = Math.max(...reps.map((r) => Math.max(r.received_pence / 100, r.spent / RATE_LKR_PER_GBP)), 1);
  return h`<section class="row between"><div class="stack"><div class="row">${avatar(o)}<h1>${L(o, 'name', lang)}</h1></div>
    <p class="muted">${t('reportSub', { a: monthLabel(reps[0].month, lang), b: monthLabel(reps[reps.length - 1].month, lang) })} ${verifiedTag(ctx, o)} ${d.late ? h`<span class="chip warn">${t('latestLate')}</span>` : h`<span class="chip good">${t('upToDate')}</span>`}</p></div>
    <a class="btn give" href="/donate?kind=org&amp;id=${o.id}">${t('donate')}</a></section>
  <section class="grid g4">
    <div class="card pad"><div class="small muted">${t('fundsReceived')}</div><b class="num mid">${gbp(rec)}</b></div>
    <div class="card pad"><div class="small muted">${t('spentInCountry')}</div><b class="num mid">${lkr(spent, lang)}</b><div class="tiny muted num">≈ ${gbp(spent / RATE_LKR_PER_GBP * 100)}</div></div>
    <div class="card pad"><div class="small muted">${t('onProgrammes')}</div><b class="num mid">${spent ? Math.round((1 - admin / spent) * 100) : 0}%</b><div class="tiny muted">${t('restAdmin')}</div></div>
    <div class="card pad"><div class="small muted">${t('docsPub')}</div><b class="num mid">${d.items.filter((i) => i.file_id).length}</b></div>
  </section>
  <section class="grid g2">
    <div class="card pad stack"><div class="row between"><h3>${t('recVsSpent')}</h3><span class="row tiny"><i class="key brand"></i>${t('received')} <i class="key accent"></i>${t('spent')}</span></div>
      <div class="months">${reps.map((r) => h`<div class="month"><div class="pair"><i class="b brand" style="height:${(r.received_pence / 100 / maxV * 100).toFixed(1)}%" title="${gbp(r.received_pence)}"></i><i class="b accent" style="height:${(r.spent / RATE_LKR_PER_GBP / maxV * 100).toFixed(1)}%" title="${lkr(r.spent, lang)}"></i></div><span class="tiny muted">${monthLabel(r.month, lang)}</span></div>`)}</div></div>
    <div class="stack gap16"><div class="card pad stack"><h3>${t('byCat')}</h3>${bars(ctx, byCat)}</div><div class="card pad stack"><h3>${t('byDist')}</h3>${bars(ctx, byDist)}</div></div>
  </section>
  <section class="card"><div class="pad"><h3>${t('everyExpense')}</h3></div><div class="tw"><table><thead><tr><th>${t('thMonth')}</th><th>${t('thWhat')}</th><th>${t('thCat')}</th><th>${t('thDist')}</th><th class="r">${t('thAmount')}</th><th>${t('thProof')}</th></tr></thead><tbody>
    ${d.items.map((i) => h`<tr><td>${monthLabel(i.month, lang)}</td><td>${L(i, 'description', lang)}</td><td>${dt(i.category, lang)}</td><td>${dt(i.district, lang)}</td><td class="r">${lkr(i.amount_lkr, lang)}</td><td>${i.file_id ? h`<a class="doc" href="/files/${i.file_id}" target="_blank" rel="noopener">📄 ${t('receipt')}</a>` : h`<span class="chip warn">${t('noProof')}</span>`}</td></tr>`)}
  </tbody></table></div></section>`;
}

/* ---------------- donate flow ---------------- */
function donateForm(ctx, d) {
  const { t } = ctx; const v = d.values;
  const presets = d.kind === 'student' ? [d.fixed / 100] : [10, 25, 50, 100];
  return h`<section class="narrow"><form class="card pad form" method="post" action="/donate">${csrfField(ctx)}
    <input type="hidden" name="kind" value="${d.kind}"><input type="hidden" name="id" value="${d.id}">
    <h1>${t('dTitle')}</h1><p class="muted">${d.targetName}</p>
    ${errors(ctx, d.errors)}
    ${d.kind === 'student' ? h`<p class="small">${t('monthlyCancel')}</p><input type="hidden" name="monthly" value="1">` :
      h`<fieldset class="seg"><legend class="sr">${t('frequency')}</legend><label><input type="radio" name="monthly" value="0"${v.monthly ? '' : raw(' checked')}> ${t('once')}</label><label><input type="radio" name="monthly" value="1"${v.monthly ? raw(' checked') : ''}> ${t('monthly')}</label></fieldset>`}
    <fieldset class="amounts"><legend class="sr">${t('amount')}</legend>${presets.map((a) => h`<label><input type="radio" name="preset" value="${a}"${Number(v.amount) === a ? raw(' checked') : ''}> £${a}</label>`)}</fieldset>
    <label class="f">${t('otherAmt')}<input name="amount" inputmode="decimal" value="${v.amount}" required></label>
    <div class="f2"><label class="f">${t('name')}<input name="donor_name" value="${v.donor_name}" required maxlength="120" autocomplete="name"></label><label class="f">${t('emailReceipt')}<input type="email" name="donor_email" value="${v.donor_email}" required maxlength="200" autocomplete="email"></label></div>
    <label class="check"><input type="checkbox" name="gift_aid" value="1"${v.gift_aid ? raw(' checked') : ''}> ${t('giftAidShort')}</label>
    <label class="check"><input type="checkbox" name="tip" value="1"${v.tip ? raw(' checked') : ''}> ${t('tipShort')}</label>
    <label class="check"><input type="checkbox" name="anonymous" value="1"${v.anonymous ? raw(' checked') : ''}> ${t('anon')}</label>
    <button class="btn give">${t('continue')}</button>
    <p class="tiny muted">${t('presetHint')}</p>
  </form></section>`;
}
function pay(ctx, d) {
  const { t } = ctx; const x = d.donation;
  return h`<section class="narrow"><form class="card pad form" method="post" action="/pay/${x.ref}">${csrfField(ctx)}
    <h1>${t('payment')}</h1><p class="muted">${d.targetName}</p>
    <table class="small"><tbody><tr><td>${t('yourGift')}${x.monthly ? t('aMonth') : ''}</td><td class="r">${gbp(x.amount_pence)}</td></tr>${x.tip_pence ? h`<tr><td>${t('tipLine')}</td><td class="r">${gbp(x.tip_pence)}</td></tr>` : ''}<tr><td><b>${t('total')}</b></td><td class="r"><b>${gbp(x.amount_pence + x.tip_pence)}</b></td></tr></tbody></table>
    ${d.testMode ? h`<div class="flash warn">${t('testModeNote')}</div>
      <label class="f">${t('card')}<input value="4242 4242 4242 4242" readonly></label>` : ''}
    <button class="btn give">${t('pay', { a: gbp(x.amount_pence + x.tip_pence) })}</button>
    <a class="small" href="/">${t('cancel')}</a>
  </form></section>`;
}
function thanks(ctx, d) {
  const { t } = ctx; const x = d.donation;
  return h`<section class="narrow"><div class="card pad stack"><span class="chip good">✓ ${t('paid')}</span><h1>${t('thanks')}</h1>
    <p>${t(x.monthly ? 'confirmedM' : 'confirmed', { a: gbp(x.amount_pence), t: d.targetName })}</p>
    <div class="card pad small stack soft"><div>${t('receiptRef')} <b class="num">${x.ref}</b></div><div>${t('receiptEmail', { e: x.donor_email })}</div>${x.gift_aid ? h`<div>${t('giftAidAdds', { a: gbp(Math.round(x.amount_pence * 0.25)) })}</div>` : ''}<div>${t('seeSpent')}</div></div>
    <div><a class="btn pri" href="/">${t('done')}</a></div></div></section>`;
}

/* ---------------- accounts ---------------- */
function login(ctx, d) {
  const { t } = ctx;
  return h`<section class="narrow"><form class="card pad form" method="post" action="/login">${csrfField(ctx)}<input type="hidden" name="next" value="${d.next || ''}">
    <h1>${t('login')}</h1>${errors(ctx, d.errors)}
    <label class="f">${t('email')}<input type="email" name="email" value="${d.email || ''}" required autocomplete="email"></label>
    <label class="f">${t('password')}<input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn pri">${t('login')}</button>
    <p class="small">${t('noAccount')} <a href="/register${d.next ? raw('?next=' + encodeURIComponent(d.next)) : ''}">${t('register')}</a></p>
    ${process.env.DEMO_MODE === '1' && process.env.DEMO_PASSWORD ? h`<p class="tiny muted">${t('demoLogin')} partner@demo.kuviyam.org · ${process.env.DEMO_PASSWORD}</p>` : ''}
  </form></section>`;
}
function register(ctx, d) {
  const { t } = ctx;
  return h`<section class="narrow"><form class="card pad form" method="post" action="/register">${csrfField(ctx)}<input type="hidden" name="next" value="${d.next || ''}">
    <h1>${t('register')}</h1>${errors(ctx, d.errors)}
    <label class="f">${t('name')}<input name="name" value="${d.name || ''}" required maxlength="120" autocomplete="name"></label>
    <label class="f">${t('email')}<input type="email" name="email" value="${d.email || ''}" required maxlength="200" autocomplete="email"></label>
    <label class="f">${t('password')}<input type="password" name="password" required minlength="10" autocomplete="new-password"><span class="tiny muted">${t('pwHint')}</span></label>
    <button class="btn pri">${t('register')}</button>
    <p class="small">${t('haveAccount')} <a href="/login">${t('login')}</a></p>
  </form></section>`;
}
function setup(ctx, d) {
  const { t } = ctx;
  return h`<section class="narrow"><form class="card pad form" method="post" action="/setup">${csrfField(ctx)}
    <h1>${t('setupH')}</h1><p class="small muted">${t('setupP')}</p>${errors(ctx, d.errors)}
    <label class="f">${t('setupCode')}<input name="code" required autocomplete="off"></label>
    <label class="f">${t('name')}<input name="name" value="${d.name || ''}" required></label>
    <label class="f">${t('email')}<input type="email" name="email" value="${d.email || ''}" required></label>
    <label class="f">${t('password')}<input type="password" name="password" required minlength="12" autocomplete="new-password"></label>
    <button class="btn pri">${t('setupBtn')}</button></form></section>`;
}

/* ---------------- partner application ---------------- */
function joinIntro(ctx) {
  const { t } = ctx;
  return h`<section class="split"><div class="card pad stack"><h1>${t('joinPageH')}</h1><p class="muted">${t('joinPageP')}</p>
    <p>${t('joinNeedAccount')}</p><div class="row"><a class="btn pri" href="/register?next=/join">${t('register')}</a><a class="btn" href="/login?next=/join">${t('login')}</a></div></div>
    ${joinAside(ctx)}</section>`;
}
function joinAside(ctx) {
  const { t, lang } = ctx;
  return h`<aside class="card pad stack sticky"><h3>${t('whatYouGet')}</h3><ul class="small">${['b1', 'b2', 'b3', 'b4'].map((b) => h`<li>${t(b)}</li>`)}</ul><p class="tiny muted">${TYPES.map((x) => dt(x, lang)).join(' · ')}</p></aside>`;
}
function joinForm(ctx, d) {
  const { t, lang } = ctx; const v = d.values;
  const causes = Array.isArray(v.causes) ? v.causes : (v.causes ? [v.causes] : []);
  return h`<div class="split"><form class="card pad form" method="post" action="/join" enctype="multipart/form-data">${csrfField(ctx)}
    <h1>${t('joinPageH')}</h1><p class="muted small">${t('joinPageP')}</p>${errors(ctx, d.errors)}
    <fieldset class="stack"><legend class="lbl">${t('orgType')} *</legend><div class="types">${TYPES.map((x) => h`<label><input type="radio" name="type" value="${x}"${v.type === x ? raw(' checked') : ''} required> ${dt(x, lang)}</label>`)}</div></fieldset>
    <div class="f2"><label class="f">${t('nameEn')} *<input name="name" value="${v.name || ''}" required maxlength="160"></label><label class="f">${t('nameTa')}<input name="name_ta" value="${v.name_ta || ''}" lang="ta" maxlength="160"></label></div>
    <div class="f2"><label class="f">${t('country')} *<select name="country">${options(COUNTRIES, v.country || 'Sri Lanka', lang)}</select></label><label class="f">${t('town')} *<input name="town" value="${v.town || ''}" required maxlength="120"></label></div>
    <div class="f2"><label class="f">${t('regNo')} *<input name="reg_no" value="${v.reg_no || ''}" required maxlength="80"><span class="tiny muted">${t('regNoHelp')}</span></label><label class="f">${t('founded')}<input name="founded" type="number" min="1900" max="2100" value="${v.founded || ''}"></label></div>
    <label class="f">${t('website')}<input name="website" value="${v.website || ''}" maxlength="200"></label>
    <div class="f2"><label class="f">${t('contactName')} *<input name="contact" value="${v.contact || ''}" required maxlength="120"></label><label class="f">${t('role')}<input name="contact_role" value="${v.contact_role || ''}" maxlength="80"></label></div>
    <div class="f2"><label class="f">${t('email')} *<input type="email" name="email" value="${v.email || ''}" required maxlength="200"></label><label class="f">${t('phone')}<input name="phone" value="${v.phone || ''}" maxlength="40"></label></div>
    <fieldset class="stack"><legend class="lbl">${t('causes')} *</legend><div class="ticks">${CAUSES.map((x) => h`<label><input type="checkbox" name="causes" value="${x}"${causes.includes(x) ? raw(' checked') : ''}> ${dt(x, lang)}</label>`)}</div></fieldset>
    <label class="f">${t('areas')}<select name="area">${options(DISTRICTS, v.area || '', lang, '—')}</select></label>
    <label class="f">${t('aboutEn')} *<textarea name="about" required maxlength="2000">${v.about || ''}</textarea></label>
    <label class="f">${t('aboutTa')}<textarea name="about_ta" lang="ta" maxlength="2000">${v.about_ta || ''}</textarea></label>
    <h3>${t('s3')}</h3><p class="tiny muted">${t('docNote')}</p>
    <div class="f2"><label class="f">${t('docReg')} *<input type="file" name="doc_reg" accept=".pdf,image/jpeg,image/png,image/webp" required></label><label class="f">${t('docGov')} *<input type="file" name="doc_gov" accept=".pdf,image/jpeg,image/png,image/webp" required></label></div>
    <div class="f2"><label class="f">${t('docAcc')}<input type="file" name="doc_acc" accept=".pdf,image/jpeg,image/png,image/webp"></label><label class="f">${t('docId')} *<input type="file" name="doc_id" accept=".pdf,image/jpeg,image/png,image/webp" required></label></div>
    <label class="check"><input type="checkbox" name="agree1" value="1" required> ${t('agreeReport')}</label>
    <label class="check"><input type="checkbox" name="agree2" value="1" required> ${t('agreeTerms')}</label>
    <button class="btn give">${t('submitApp')}</button>
  </form>${joinAside(ctx)}</div>`;
}
function joinStatus(ctx, d) {
  const { t, lang } = ctx;
  return h`<section class="narrow stack"><h1>${t('myApplications')}</h1>
    ${d.apps.map((a) => h`<div class="card pad stack"><div class="row between"><b>${a.name}</b><span class="chip ${a.status === 'approved' ? 'good' : a.status === 'rejected' ? 'bad' : 'plain'}">${t('app_' + a.status)}</span></div>
      <div class="small muted">${dt(a.type, lang)} · ${a.town}, ${dt(a.country, lang)} · ${t('submitted', { d: dateLabel(a.created_at, lang) })}</div>
      ${a.status === 'rejected' && a.reason ? h`<p class="small">${t('reason')}: ${a.reason}</p>` : ''}
      ${a.status === 'approved' ? h`<a class="btn pri" href="/dashboard">${t('openDashboard')}</a>` : ''}</div>`)}
    <p class="small"><a href="/join?new=1">${t('newApp')}</a></p></section>`;
}

function message(ctx, title, text, link) {
  return h`<section class="narrow"><div class="card pad stack"><h1>${title}</h1><p class="muted">${text}</p>${link ? h`<div><a class="btn" href="${link[0]}">${link[1]}</a></div>` : ''}</div></section>`;
}

module.exports = { home, projects, project, partners, partner, sponsor, transparency, report, donateForm, pay, thanks, login, register, setup, joinIntro, joinForm, joinStatus, message };
