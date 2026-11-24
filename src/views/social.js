'use strict';
/* Views for members: plans, profiles, people, messages, notifications, admin membership. */
const { h, gbp, dateLabel } = require('../util');
const { csrfField, errors, memberAvatar, tierBadge } = require('./parts');
const { hubTabs, timeAgo, postCard, postBtn } = require('./community');

const money = (p) => (p % 100 ? gbp(p) : '£' + (p / 100).toLocaleString('en-GB'));

/* ---------------- plans ---------------- */
function plans(ctx, d) {
  const { t, user } = ctx; const pr = d.prices;
  const current = user ? user.tier : null;
  const perk = (k, on = true) => h`<li class="${on ? '' : 'off'}">${on ? '✓' : '–'} ${t(k)}</li>`;
  const buy = (tier) => {
    if (!user) return h`<a class="btn pri" href="/register?next=/membership">${t('joinFree')}</a><p class="tiny muted">${t('mbLoginFirst')}</p>`;
    if (current === 'gold' && tier === 'silver') return h`<p class="tiny muted">${t('mbHaveGold')}</p>`;
    return h`<form method="post" action="/membership/checkout" class="stack6">${csrfField(ctx)}<input type="hidden" name="tier" value="${tier}">
      <button class="btn ${tier === 'gold' ? 'give' : 'pri'}" name="period" value="month">${t(current === tier ? 'mbRenewMonth' : 'mbMonthly', { p: money(pr[tier + '_month']) })}</button>
      <button class="btn" name="period" value="year">${t(current === tier ? 'mbRenewYear' : 'mbYearly', { p: money(pr[tier + '_year']) })}</button></form>`;
  };
  return h`<section class="narrow wide2 center"><h1>${t('mbH')}</h1><p class="muted">${t('mbP')}</p>
    ${user && current !== 'free' ? h`<p><span class="badge ${current}">★ ${t('tier_' + current)}</span> ${t('mbUntil', { d: dateLabel(user.member_until, ctx.lang) })}</p>` : ''}</section>
  <section class="grid g3 plans">
    <article class="card pad stack plan"><h2>${t('tier_free')}</h2><div class="price">£0</div><p class="small muted">${t('mbFreeP')}</p>
      <ul class="perks">${perk('pkProfile')}${perk('pkFollow')}${perk('pkLike')}${perk('pkReply')}${perk('pkPost', false)}${perk('pkChat', false)}</ul>
      ${user ? h`<p class="small"><b>${current === 'free' ? t('mbYouAreHere') : ''}</b></p>` : h`<a class="btn" href="/register?next=/community">${t('joinFree')}</a>`}</article>
    <article class="card pad stack plan silver"><h2>${tierBadge(ctx, 'silver')}</h2><div class="price">${money(pr.silver_month)}<small>${t('perMonth')}</small></div><p class="small muted">${t('mbSilverP')}</p>
      <ul class="perks">${perk('pkAllFree')}${perk('pkPost')}${perk('pkChat')}${perk('pkBadgeS')}${perk('pkVideo', false)}</ul>${buy('silver')}</article>
    <article class="card pad stack plan gold"><h2>${tierBadge(ctx, 'gold')}</h2><div class="price">${money(pr.gold_month)}<small>${t('perMonth')}</small></div><p class="small muted">${t('mbGoldP')}</p>
      <ul class="perks">${perk('pkAllSilver')}${perk('pkVideo')}${perk('pkBadgeG')}${perk('pkSupport')}</ul>${buy('gold')}</article>
  </section>
  <p class="center tiny muted">${t('mbNote')}</p>`;
}
function pay(ctx, d) {
  const { t } = ctx; const m = d.m;
  return h`<section class="narrow"><form class="card pad form" method="post" action="/membership/pay/${m.ref}">${csrfField(ctx)}
    <h1>${t('payment')}</h1><p class="muted">${t('mbPayFor', { t: t('tier_' + m.tier), p: t(m.period === 'year' ? 'oneYear' : 'oneMonth') })}</p>
    <table class="small"><tbody><tr><td><b>${t('total')}</b></td><td class="r"><b>${gbp(m.amount_pence)}</b></td></tr></tbody></table>
    ${d.testMode ? h`<div class="flash warn">${t('testModeNote')}</div><label class="f">${t('card')}<input value="4242 4242 4242 4242" readonly></label>` : ''}
    <button class="btn give">${t('pay', { a: gbp(m.amount_pence) })}</button>
    <a class="small" href="/membership">${t('cancel')}</a>
  </form></section>`;
}

/* ---------------- people ---------------- */
const personRow = (ctx, u, extra = '') => h`<a class="card pad row nowrap person plain" href="/members/${u.id}">${memberAvatar(u)}<span class="grow0"><b>${u.name}</b> ${tierBadge(ctx, u.tier)}${u.home_town ? h`<span class="tiny muted block">📍 ${u.home_town}</span>` : ''}</span>${extra}</a>`;
function members(ctx, d) {
  const { t } = ctx;
  return h`<section class="sec-h"><div><h1>${t('membersH')}</h1><p class="muted">${t('membersP')}</p></div>${ctx.user ? h`<a class="btn" href="/me/edit">${t('editProfile')}</a>` : h`<a class="btn pri" href="/register?next=/me/edit">${t('joinFree')}</a>`}</section>
    ${hubTabs(ctx, 'members')}
    <form class="row msearch" method="get" action="/members"><label class="sr" for="mq">${t('searchMembers')}</label><input id="mq" name="q" value="${d.q || ''}" placeholder="${t('searchMembersPh')}"><button class="btn">${t('search')}</button></form>
    <div class="grid g3">${d.list.length ? d.list.map((u) => personRow(ctx, u, h`<span class="tiny muted num">${t('nFollowers', { n: u.followers })}</span>`)) : h`<div class="empty">${t('noMembers')}</div>`}</div>`;
}
function profile(ctx, d) {
  const { t, user } = ctx; const { m, rel, stats } = d;
  const actions = d.isMe
    ? h`<a class="btn" href="/me/edit">${t('editProfile')}</a>${m.tier === 'free' ? h`<a class="btn give" href="/membership">${t('upgrade')}</a>` : h`<a class="btn" href="/membership">${t('mbManage')}</a>`}`
    : !user ? h`<a class="btn pri" href="/login?next=/members/${m.id}">${t('follow')}</a>`
    : rel.iBlocked ? postBtn(ctx, `/members/${m.id}/block`, t('unblock'))
    : rel.blockedMe ? ''
    : h`${postBtn(ctx, `/members/${m.id}/follow`, rel.following ? t('followingBtn') : rel.followsMe ? t('followBack') : t('follow'), rel.following ? '' : 'pri')}
        <a class="btn sm" href="/messages/${m.id}">✉ ${t('message')}</a>
        ${m.role !== 'admin' ? h`<details class="more"><summary class="btn sm ghost" aria-label="${t('more')}">⋯</summary><div class="card pad">${postBtn(ctx, `/members/${m.id}/block`, t('block'), 'ghost')}<p class="tiny muted">${t('blockHint')}</p></div></details>` : ''}`;
  return h`<section class="card profile-h">
      <div class="cover"></div>
      <div class="pad row top between">
        <div class="row top nowrap">${memberAvatar(m, 'xl')}<div class="stack6"><h1>${m.name} ${tierBadge(ctx, m.tier)}</h1>
          ${m.home_town ? h`<span class="small muted">📍 ${m.home_town}</span>` : ''}
          <span class="small"><a href="/members/${m.id}/followers"><b class="num">${stats.followers}</b> ${t('followers')}</a> · <a href="/members/${m.id}/following"><b class="num">${stats.following}</b> ${t('followingLbl')}</a> · <b class="num">${stats.posts}</b> ${t('postsLbl')}</span>
          ${rel && rel.followsMe ? h`<span class="chip plain">${t('followsYou')}</span>` : ''}</div></div>
        <div class="row">${actions}</div>
      </div>
      ${m.bio ? h`<p class="pad-x bio">${m.bio}</p>` : d.isMe ? h`<p class="pad-x small muted">${t('addBioHint')} <a href="/me/edit">${t('editProfile')}</a></p>` : ''}
      <p class="pad-x tiny muted">${t('memberSince', { d: dateLabel(m.created_at, ctx.lang) })}${d.isMe && m.tier !== 'free' ? ' · ' + t('mbUntil', { d: dateLabel(m.member_until, ctx.lang) }) : ''}</p>
    </section>
    ${rel && rel.iBlocked ? h`<div class="flash warn">${t('youBlocked')}</div>` : ''}
    <section class="feedcol stack"><h2>${t('postsLbl')}</h2>
      ${d.posts.length ? d.posts.map((p) => postCard(ctx, p)) : h`<div class="empty">${d.isMe ? h`${t('noOwnPosts')} <a href="/community">${t('goToFeed')}</a>` : t('noMemberPosts')}</div>`}
    </section>
    ${d.memberships.length ? h`<section class="feedcol card pad"><h2>${t('mbPayments')}</h2><table class="small"><tbody>${d.memberships.map((x) => h`<tr><td>${dateLabel(x.paid_at, ctx.lang)}</td><td>${t('tier_' + x.tier)} · ${t(x.period === 'year' ? 'oneYear' : 'oneMonth')}</td><td class="r">${gbp(x.amount_pence)}</td><td class="tiny muted">${x.ref}</td></tr>`)}</tbody></table></section>` : ''}`;
}
function followList(ctx, d) {
  const { t } = ctx;
  return h`<section class="narrow wide2 stack"><a class="small" href="/members/${d.m.id}">← ${d.m.name}</a>
    <h1>${t(d.which === 'followers' ? 'followersOf' : 'followingOf', { n: d.m.name })}</h1>
    ${d.list.length ? d.list.map((u) => personRow(ctx, u)) : h`<div class="empty">${t('nobodyYet')}</div>`}</section>`;
}
function editProfile(ctx, d) {
  const { t } = ctx; const v = d.values;
  return h`<section class="narrow"><form class="card pad form" method="post" action="/me/edit" enctype="multipart/form-data">${csrfField(ctx)}
    <h1>${t('editProfile')}</h1>${errors(ctx, d.errors)}
    <div class="row nowrap">${memberAvatar(v, 'lg')}<label class="f grow0">${t('profilePhoto')}<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp"><span class="tiny muted">${t('profilePhotoHint')}</span></label></div>
    ${v.avatar_file_id ? h`<label class="small"><input type="checkbox" name="remove_avatar" value="1"> ${t('removePhoto')}</label>` : ''}
    <label class="f">${t('name')}<input name="name" value="${v.name || ''}" required maxlength="120"></label>
    <label class="f">${t('homeTown')}<input name="home_town" value="${v.home_town || ''}" maxlength="120" placeholder="${t('homeTownPh')}"></label>
    <label class="f">${t('aboutYou')}<textarea name="bio" rows="4" maxlength="500">${v.bio || ''}</textarea><span class="tiny muted">${t('publicHint')}</span></label>
    <button class="btn pri">${t('save')}</button></form></section>`;
}

/* ---------------- messages ---------------- */
function inbox(ctx, d) {
  const { t } = ctx;
  return h`<section class="narrow wide2 stack"><div class="sec-h"><h1>${t('messagesH')}</h1><a class="btn" href="/members">${t('newMessage')}</a></div>
    ${!d.canStart ? h`<div class="flash">${t('freeMsgNote')} <a href="/membership">${t('seePlans')}</a></div>` : ''}
    ${d.threads.length ? h`<div class="card list">${d.threads.map((x) => h`<a class="row nowrap thread plain${x.unread ? ' unread' : ''}" href="/messages/${x.user.id}">${memberAvatar(x.user)}
        <span class="grow0"><b>${x.user.name}</b> ${tierBadge(ctx, x.user.tier)}<span class="small muted block clip">${x.last.from_id === ctx.user.id ? t('youPrefix') : ''}${x.last.body}</span></span>
        <span class="tiny muted">${timeAgo(ctx, x.last_at)}</span>${x.unread ? h`<span class="dot num">${x.unread}</span>` : ''}</a>`)}</div>`
      : h`<div class="empty">${t('noMessages')}</div>`}</section>`;
}
function thread(ctx, d) {
  const { t } = ctx; const o = d.other;
  return h`<section class="narrow wide2 stack"><a class="small" href="/messages">← ${t('messagesH')}</a>
    <div class="card"><a class="row nowrap pad plain thread-h" href="/members/${o.id}">${memberAvatar(o)}<b>${o.name}</b> ${tierBadge(ctx, o.tier)}</a>
      <div class="chat" role="log" aria-live="polite">${d.list.length ? d.list.map((m) => h`<div class="msg ${m.from_id === ctx.user.id ? 'me' : 'them'}"><div class="b">${m.body}</div><span class="tiny muted">${timeAgo(ctx, m.created_at)}${m.from_id === ctx.user.id && m.read_at ? ' · ' + t('seen') : ''}</span></div>`) : h`<p class="empty">${t('sayHello', { n: o.name })}</p>`}<span id="end"></span></div>
      ${d.blockReason ? h`<div class="pad"><div class="flash warn">${t(d.blockReason)}${d.blockReason === 'needPaidMsg' ? h` <a href="/membership">${t('seePlans')}</a>` : ''}</div></div>`
        : h`<form class="cform pad" method="post" action="/messages/${o.id}">${csrfField(ctx)}<label class="sr" for="mbody">${t('writeMessage')}</label><input id="mbody" name="body" maxlength="2000" required autocomplete="off" placeholder="${t('writeMessage')}" autofocus><button class="btn pri">${t('send')}</button></form>`}
    </div></section>`;
}

/* ---------------- notifications ---------------- */
function notifications(ctx, d) {
  const { t } = ctx;
  const line = (n) => {
    const who = h`<b>${n.actor_name || t('someone')}</b>`;
    const href = n.kind === 'follow' ? `/members/${n.actor_id}` : n.kind === 'message' ? `/messages/${n.actor_id}` : n.kind === 'rsvp' ? `/dashboard/events/${n.target_id}` : `/community/posts/${n.target_id}`;
    const what = t('nt_' + n.kind);
    return h`<a class="row nowrap thread plain${n.read_at ? '' : ' unread'}" href="${href}">${memberAvatar({ id: n.actor_id, name: n.actor_name || '?', avatar_file_id: n.actor_avatar })}
      <span class="grow0">${who} ${what}${n.event_title ? h`<span class="small muted block clip">📅 ${n.event_title}</span>` : ''}${n.post_text ? h`<span class="small muted block clip">“${n.post_text}”</span>` : ''}</span><span class="tiny muted">${timeAgo(ctx, n.created_at)}</span></a>`;
  };
  return h`<section class="narrow wide2 stack"><h1>${t('notesH')}</h1>
    ${d.list.length ? h`<div class="card list">${d.list.map(line)}</div>` : h`<div class="empty">${t('noNotes')}</div>`}</section>`;
}

/* ---------------- admin ---------------- */
function adminMembership(ctx, d) {
  const { t } = ctx; const pr = d.prices; const { adminTabs } = require('./manage');
  const field = (k, label) => h`<label class="f">${label}<input name="${k}" inputmode="decimal" value="${(pr[k] / 100).toFixed(2)}" required></label>`;
  return h`<section><h1>${t('adH')}</h1></section>${adminTabs(ctx, 'membership')}
    <section class="grid g4">
      <div class="card pad"><div class="tiny muted">${t('tier_free')}</div><div class="big num">${d.totals.free}</div></div>
      <div class="card pad"><div class="tiny muted">${t('tier_silver')}</div><div class="big num">${d.totals.silver}</div></div>
      <div class="card pad"><div class="tiny muted">${t('tier_gold')}</div><div class="big num">${d.totals.gold}</div></div>
    </section>
    <section class="split">
      <div class="card tw"><h2 class="pad">${t('mbPayments')}</h2><table><thead><tr><th>${t('date')}</th><th>${t('name')}</th><th>${t('plan')}</th><th class="r">${t('thAmount')}</th><th>${t('receiptRef')}</th></tr></thead><tbody>
        ${d.payments.length ? d.payments.map((x) => h`<tr><td>${dateLabel(x.paid_at, ctx.lang)}</td><td><a href="/members/${x.user_id}">${x.name}</a><div class="tiny muted">${x.email}</div></td><td>${t('tier_' + x.tier)} · ${t(x.period === 'year' ? 'oneYear' : 'oneMonth')}</td><td class="r">${gbp(x.amount_pence)}</td><td class="tiny">${x.ref}${x.provider === 'test' ? h` <span class="chip warn">${t('testShort')}</span>` : ''}</td></tr>`) : h`<tr><td colspan="5" class="muted">${t('noPayments')}</td></tr>`}
      </tbody></table></div>
      <form class="card pad form" method="post" action="/admin/membership/prices">${csrfField(ctx)}<h2>${t('pricesH')}</h2><p class="tiny muted">${t('pricesP')}</p>
        ${field('silver_month', t('priceSM'))}${field('silver_year', t('priceSY'))}${field('gold_month', t('priceGM'))}${field('gold_year', t('priceGY'))}
        <button class="btn pri">${t('save')}</button></form>
    </section>
    <section class="card tw"><h2 class="pad">${t('paidMembers')}</h2><table><thead><tr><th>${t('name')}</th><th>${t('email')}</th><th>${t('plan')}</th><th>${t('activeUntil')}</th></tr></thead><tbody>
      ${d.members.length ? d.members.map((m) => h`<tr><td><a href="/members/${m.id}">${m.name}</a></td><td class="tiny">${m.email}</td><td>${tierBadge(ctx, m.tier)}</td><td>${dateLabel(m.member_until, ctx.lang)}</td></tr>`) : h`<tr><td colspan="4" class="muted">${t('noPaidMembers')}</td></tr>`}
    </tbody></table></section>`;
}

function adminTheme(ctx, d) {
  const { t, lang } = ctx; const th = d.theme; const { adminTabs } = require('./manage');
  const current = d.presets.find((p) => p.bg === th.bg && p.brand === th.brand && p.accent === th.accent);
  const pick = (name, label, hint) => h`<label class="f">${label}<span class="colour"><input type="color" name="${name}" value="${th[name]}" data-preview="${name}" aria-label="${label}"><span class="tiny muted">${hint}<br><code data-hex="${name}">${th[name]}</code></span></span></label>`;
  return h`<section><h1>${t('adH')}</h1></section>${adminTabs(ctx, 'theme')}
  <section class="stack"><div><h2>${t('themeSets')}</h2><p class="small muted">${t('themeSetsP')}</p></div>
    <div class="swatches">${d.presets.map((p) => h`<form method="post" action="/admin/theme">${csrfField(ctx)}<input type="hidden" name="preset" value="${p.key}">
      <button class="swatch${current && current.key === p.key ? ' on' : ''}"><span class="sw-demo" style="background:${p.bg}"><i class="w"></i><i style="background:${p.brand};width:70%"></i><i style="background:${p.accent};width:45%"></i></span>
      <b>${lang === 'ta' ? p.ta : p.en}</b>${current && current.key === p.key ? h`<span class="tiny muted">${t('themeInUse')}</span>` : ''}</button></form>`)}</div></section>
  <section class="split">
    <form class="card pad form" method="post" action="/admin/theme" id="themeform">${csrfField(ctx)}<h2>${t('themeOwn')}</h2><p class="tiny muted">${t('themeOwnP')}</p>
      ${pick('bg', t('colBg'), t('colBgHint'))}${pick('brand', t('colBrand'), t('colBrandHint'))}${pick('accent', t('colAccent'), t('colAccentHint'))}
      <button class="btn pri">${t('save')}</button></form>
    <div class="stack"><h2>${t('themePreview')}</h2>
      <div class="preview" id="themepreview" style="background:${th.bg}">
        <div class="card pad stack"><b>${t('homeH')}</b><span class="small muted">${t('homeLead')}</span>
          <span class="row"><span class="btn" data-role="accent" style="background:${th.accent};border-color:${th.accent}">${t('giveNow')}</span><span class="btn" data-role="brand" style="background:${th.brand};border-color:${th.brand};color:#fff">${t('joinFree')}</span><a data-role="link" style="color:${th.brand}">${t('allProjects')}</a></span></div>
      </div>
      <form method="post" action="/admin/theme">${csrfField(ctx)}<input type="hidden" name="reset" value="1"><button class="btn sm ghost">${t('themeReset')}</button></form>
      <div class="card pad stack"><h3>${t('lightH')}</h3>
        <p class="small muted">${t(th.light ? 'lightOnP' : 'lightOffP')}</p>
        <form method="post" action="/admin/theme">${csrfField(ctx)}<input type="hidden" name="light" value="${th.light ? '0' : '1'}">
          <span class="row between"><span class="chip ${th.light ? 'good' : 'plain'}">${t(th.light ? 'lightIsOn' : 'lightIsOff')}</span><button class="btn sm">${t(th.light ? 'lightTurnOff' : 'lightTurnOn')}</button></span></form></div></div>
  </section>
  <script src="/static/theme-admin.js" defer></script>`;
}

function adminEmails(ctx, d) {
  const { t, lang } = ctx; const { adminTabs } = require('./manage');
  const kinds = { rsvp_confirm: 'mkConfirm', reminder_day: 'mkDay', reminder_hour: 'mkHour', event_msg: 'mkMsg', partner_digest: 'mkDigest', test: 'mkTest', directory_invite: 'mkInvite', ticket_confirm: 'mkTicket' };
  const chip = (st) => h`<span class="chip ${st === 'sent' ? 'good' : st === 'failed' ? 'bad' : st === 'queued' || st === 'sending' ? 'warn' : 'plain'}">${t('ms_' + st)}</span>`;
  return h`<section><h1>${t('adH')}</h1></section>${adminTabs(ctx, 'emails')}
  <section class="split">
    <div class="card tw"><h2 class="pad">${t('recentEmails')}</h2><table><thead><tr><th>${t('mailWhat')}</th><th>${t('email')}</th><th>${t('thStatus')}</th><th>${t('date')}</th></tr></thead><tbody>
      ${d.list.length ? d.list.map((m) => h`<tr><td>${t(kinds[m.kind] || m.kind)}${m.subject ? h`<div class="tiny muted">${m.subject}</div>` : ''}${m.last_error ? h`<div class="tiny bad-t">${m.last_error}</div>` : ''}</td><td class="tiny">${m.to_email}</td><td>${chip(m.status)}</td>
        <td class="tiny muted">${m.status === 'sent' ? dateLabel(m.sent_at, lang) : m.status === 'queued' ? t('mailDue', { d: dateLabel(m.send_after, lang) }) : dateLabel(m.created_at, lang)}</td></tr>`) : h`<tr><td colspan="4" class="empty">${t('noEmailsYet')}</td></tr>`}
    </tbody></table></div>
    <div class="stack">
      <div class="card pad stack"><h2>${t('mailSetup')}</h2>
        ${d.provider === 'log' ? h`<div class="flash warn">${t('mailLogMode')}</div>` : h`<div class="flash good">${t('mailOn', { p: d.provider === 'smtp' ? 'SMTP' : 'Resend', f: d.from })}</div>`}
        <p class="small">${t('mailHowTo')}</p>
        <pre class="code">SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=noreply@kuviyam.net
SMTP_PASS=…
MAIL_FROM=noreply@kuviyam.net</pre>
        <form method="post" action="/admin/emails/test">${csrfField(ctx)}<button class="btn">${t('sendTest')}</button></form></div>
      <div class="card pad"><div class="tiny muted">${t('ms_sent')}: <b>${d.counts.sent || 0}</b> · ${t('ms_queued')}: <b>${d.counts.queued || 0}</b> · ${t('ms_failed')}: <b>${d.counts.failed || 0}</b></div></div>
    </div>
  </section>`;
}

module.exports = { adminEmails, adminTheme, plans, pay, members, profile, followList, editProfile, inbox, thread, notifications, adminMembership };
