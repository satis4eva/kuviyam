'use strict';
const { h, raw, gbp, lkr, monthLabel, dateLabel, RATE_LKR_PER_GBP } = require('../util');
const { dt, CAUSES, CATEGORIES, DISTRICTS } = require('../i18n');
const { L, avatar, csrfField, options, errors } = require('./parts');

const statusChip = (ctx, s) => h`<span class="chip ${s === 'published' || s === 'verified' || s === 'paid' || s === 'live' ? 'good' : s === 'returned' || s === 'suspended' || s === 'failed' ? 'bad' : 'plain'}">${ctx.t('st_' + s)}</span>`;
const postBtn = (ctx, action, label, cls = '') => h`<form method="post" action="${action}" class="inline">${csrfField(ctx)}<button class="btn sm ${cls}">${label}</button></form>`;

/* ================= partner dashboard ================= */
function tabs(ctx, active) {
  const items = [['/dashboard', 'tOverview', 'overview'], ['/dashboard/reports', 'tReports', 'reports'], ['/dashboard/projects/new', 'tProject', 'project'], ['/dashboard/students', 'tStudents', 'students'], ['/dashboard/posts', 'tPosts', 'posts'], ['/dashboard/events', 'tEvents', 'events']];
  return h`<nav class="tabs" aria-label="${ctx.t('pdH')}">${items.map(([href, k, id]) => h`<a href="${href}" class="${active === id ? 'on' : ''}">${ctx.t(k)}</a>`)}</nav>`;
}
function dashHead(ctx, org) {
  return h`<section class="row between"><div class="row">${avatar(org)}<div><h1>${L(org, 'name', ctx.lang)}</h1><div class="small muted">${ctx.t('pdH')}</div></div></div><a class="btn" href="/partners/${org.slug}">${ctx.t('viewPublic')}</a></section>`;
}
function dashboard(ctx, d) {
  const { t, lang } = ctx; const o = d.org;
  return h`${dashHead(ctx, o)}${tabs(ctx, 'overview')}
  <section class="grid g4">
    <div class="card pad"><div class="small muted">${t('ovRaised')}</div><b class="num mid">${gbp(d.raised)}</b></div>
    <div class="card pad"><div class="small muted">${t('ovDonations')}</div><b class="num mid">${d.donationsCount}</b></div>
    <div class="card pad"><div class="small muted">${t('ovNext')}</div><b class="mid">${monthLabel(d.required, lang)}</b><div class="tiny ${d.late ? 'warn-t' : 'muted'}">${d.late ? t('late') : t('upToDate')}</div></div>
    <div class="card pad"><div class="small muted">${t('ovPending')}</div><b class="num mid">${d.pending}</b></div>
  </section>
  <section class="card tw"><table><thead><tr><th>${t('thProject')}</th><th class="r">${t('thRaised')}</th><th class="r">${t('thGoal')}</th><th class="r">${t('thDonors')}</th><th>${t('thStatus')}</th><th></th></tr></thead><tbody>
    ${d.projects.map((p) => h`<tr><td>${L(p, 'title', lang)}</td><td class="r">${gbp(p.raised_pence)}</td><td class="r">${gbp(p.goal_pence)}</td><td class="r">${p.donors}</td><td>${statusChip(ctx, p.status)}</td>
      <td class="row">${h`<a href="/projects/${p.id}">${t('view')}</a>`} ${p.status === 'live' ? postBtn(ctx, `/dashboard/projects/${p.id}/close`, t('closeProject'), 'ghost') : ''}</td></tr>`)}
    ${d.projects.length ? '' : h`<tr><td colspan="6" class="empty">${t('noProjects')}</td></tr>`}
  </tbody></table></section>
  <section class="card tw"><div class="pad"><h3>${t('recentDonations')}</h3></div><table><thead><tr><th>${t('date')}</th><th>${t('donor')}</th><th>${t('for')}</th><th class="r">${t('thAmount')}</th></tr></thead><tbody>
    ${d.donations.map((x) => h`<tr><td>${dateLabel(x.paid_at, lang)}</td><td>${x.anonymous ? t('anonymous') : x.donor_name}</td><td>${x.target}</td><td class="r">${gbp(x.amount_pence)}${x.monthly ? h` <span class="tiny muted">${t('perMonth')}</span>` : ''}</td></tr>`)}
    ${d.donations.length ? '' : h`<tr><td colspan="4" class="empty">${t('noDonations')}</td></tr>`}
  </tbody></table></section>`;
}

function newProject(ctx, d) {
  const { t, lang } = ctx; const v = d.values;
  return h`${dashHead(ctx, d.org)}${tabs(ctx, 'project')}
  <form class="card pad form measure-w" method="post" action="/dashboard/projects">${csrfField(ctx)}
    <h2>${t('newProjectH')}</h2><p class="tiny muted">${t('bothLang')}</p>${errors(ctx, d.errors)}
    <div class="f2"><label class="f">${t('titleEn')}<input name="title" value="${v.title || ''}" maxlength="160"></label><label class="f">${t('titleTa')}<input name="title_ta" value="${v.title_ta || ''}" lang="ta" maxlength="160"></label></div>
    <div class="f2"><label class="f">${t('cause')}<select name="cause">${options(CAUSES, v.cause, lang)}</select></label><label class="f">${t('district')}<select name="district">${options(DISTRICTS, v.district || 'Kilinochchi', lang)}</select></label></div>
    <div class="f2"><label class="f">${t('goal')}<input name="goal" inputmode="decimal" value="${v.goal || ''}" required></label><label class="f">${t('endDate')}<input name="ends_on" type="date" value="${v.ends_on || ''}"></label></div>
    <div class="f2"><label class="f">${t('buysEn')}<textarea name="needs">${v.needs || ''}</textarea></label><label class="f">${t('buysTa')}<textarea name="needs_ta" lang="ta">${v.needs_ta || ''}</textarea></label></div>
    <label class="check"><input type="checkbox" name="urgent" value="1"${v.urgent ? raw(' checked') : ''}> ${t('markUrgent')}</label>
    <div><button class="btn pri">${t('publishProject')}</button></div></form>`;
}

function reportsList(ctx, d) {
  const { t, lang } = ctx;
  return h`${dashHead(ctx, d.org)}${tabs(ctx, 'reports')}
  <section class="grid g2 top">
    <div class="card tw"><table><thead><tr><th>${t('thMonth')}</th><th class="r">${t('thReceived')}</th><th class="r">${t('thSpent')}</th><th>${t('thStatus')}</th><th></th></tr></thead><tbody>
      ${d.reports.map((r) => h`<tr><td>${monthLabel(r.month, lang)}</td><td class="r">${gbp(r.received_pence)}</td><td class="r">${lkr(r.spent, lang)}</td><td>${statusChip(ctx, r.status)}</td><td><a href="/dashboard/reports/${r.id}">${r.status === 'draft' || r.status === 'returned' ? t('edit') : t('view')}</a></td></tr>`)}
      ${d.reports.length ? '' : h`<tr><td colspan="5" class="empty">${t('noReportsYet')}</td></tr>`}
    </tbody></table></div>
    <form class="card pad form" method="post" action="/dashboard/reports">${csrfField(ctx)}<h3>${t('startReport')}</h3>${errors(ctx, d.errors)}
      <p class="tiny muted">${t('reportDue', { m: monthLabel(d.required, lang) })}</p>
      <div class="f2"><label class="f">${t('thMonth')}<input type="month" name="month" value="${d.required}" required></label><label class="f">${t('fundsThisMonth')}<input name="received" inputmode="decimal" required></label></div>
      <div><button class="btn pri">${t('startReportBtn')}</button></div></form>
  </section>`;
}

function reportEdit(ctx, d) {
  const { t, lang } = ctx; const r = d.report; const editable = r.status === 'draft' || r.status === 'returned';
  const total = d.items.reduce((a, i) => a + i.amount_lkr, 0);
  return h`${dashHead(ctx, d.org)}${tabs(ctx, 'reports')}
  <section class="row between"><div><h2>${monthLabel(r.month, lang)} · ${gbp(r.received_pence)} ${t('received').toLowerCase()}</h2><div class="small">${statusChip(ctx, r.status)}${r.note ? h` <span class="small">${t('reviewNote')}: ${r.note}</span>` : ''}</div></div>
    ${editable && d.items.length ? postBtn(ctx, `/dashboard/reports/${r.id}/submit`, t('submitReview'), 'pri') : ''}</section>
  ${errors(ctx, d.errors)}
  <section class="grid g2 top">
    <div class="card tw"><table><thead><tr><th>${t('thWhat')}</th><th>${t('thDist')}</th><th class="r">${t('amountLkr')}</th><th>${t('thProof')}</th><th></th></tr></thead><tbody>
      ${d.items.map((i) => h`<tr><td>${L(i, 'description', lang)}<div class="tiny muted">${dt(i.category, lang)}</div></td><td>${dt(i.district, lang)}</td><td class="r">${lkr(i.amount_lkr, lang)}</td>
        <td>${i.file_id ? h`<a class="doc" href="/files/${i.file_id}" target="_blank" rel="noopener">📎 ${t('receipt')}</a>` : h`<span class="warn-t tiny">${t('missing')}</span>`}</td>
        <td>${editable ? postBtn(ctx, `/dashboard/reports/${r.id}/expenses/${i.id}/delete`, t('remove'), 'ghost') : ''}</td></tr>`)}
      ${d.items.length ? h`<tr><td colspan="2"><b>${t('total')}</b></td><td class="r"><b>${lkr(total, lang)}</b></td><td colspan="2" class="tiny muted">≈ ${gbp(total / RATE_LKR_PER_GBP * 100)}</td></tr>` : h`<tr><td colspan="5" class="empty">${t('noExp')}</td></tr>`}
    </tbody></table><p class="pad tiny muted">${t('noProofFlag')}</p></div>
    ${editable ? h`<form class="card pad form" method="post" action="/dashboard/reports/${r.id}/expenses" enctype="multipart/form-data">${csrfField(ctx)}<h3>${t('addExp')}</h3>
      <div class="f2"><label class="f">${t('whatForEn')}<input name="description" required maxlength="200" placeholder="${t('whatForPh')}"></label><label class="f">${t('whatForTa')}<input name="description_ta" lang="ta" maxlength="200"></label></div>
      <div class="f2"><label class="f">${t('category')}<select name="category">${options(CATEGORIES, '', lang)}</select></label><label class="f">${t('district')}<select name="district">${options(DISTRICTS, d.org.place, lang)}</select></label></div>
      <div class="f2"><label class="f">${t('amountLkr')}<input name="amount_lkr" type="number" min="1" step="1" required></label><label class="f">${t('receiptFile')}<input type="file" name="receipt" accept=".pdf,image/jpeg,image/png,image/webp"></label></div>
      <div><button class="btn pri">${t('addExpBtn')}</button></div></form>` : h`<div class="card pad small muted">${t('reportLocked')}</div>`}
  </section>`;
}

function students(ctx, d) {
  const { t, lang } = ctx;
  return h`${dashHead(ctx, d.org)}${tabs(ctx, 'students')}
  <section class="grid g2 top">
    <div class="card tw"><table><thead><tr><th>${t('name')}</th><th>${t('gradeH')}</th><th>${t('district')}</th><th class="r">${t('perMonthH')}</th><th>${t('thStatus')}</th></tr></thead><tbody>
      ${d.students.map((s) => h`<tr><td>${L(s, 'name', lang)}</td><td>${s.grade}</td><td>${dt(s.district, lang)}</td><td class="r">${gbp(s.monthly_pence)}</td><td>${s.sponsored ? h`<span class="chip good">${t('sponsored')}</span>` : h`<span class="chip plain">${t('waiting')}</span>`}</td></tr>`)}
      ${d.students.length ? '' : h`<tr><td colspan="5" class="empty">${t('noStudents')}</td></tr>`}
    </tbody></table></div>
    <form class="card pad form" method="post" action="/dashboard/students">${csrfField(ctx)}<h3>${t('addStudent')}</h3><p class="tiny muted">${t('studentPrivacy')}</p>${errors(ctx, d.errors)}
      <div class="f2"><label class="f">${t('firstNameEn')}<input name="name" required maxlength="40"></label><label class="f">${t('firstNameTa')}<input name="name_ta" lang="ta" maxlength="40"></label></div>
      <div class="f2"><label class="f">${t('gradeH')}<input name="grade" type="number" min="1" max="13" required></label><label class="f">${t('district')}<select name="district">${options(DISTRICTS, d.org.place, lang)}</select></label></div>
      <div class="f2"><label class="f">${t('dreamEn')}<input name="dream" maxlength="120"></label><label class="f">${t('dreamTa')}<input name="dream_ta" lang="ta" maxlength="120"></label></div>
      <label class="f">${t('perMonthH')}<input name="monthly" inputmode="decimal" required value="15"></label>
      <div><button class="btn pri">${t('addStudentBtn')}</button></div></form>
  </section>`;
}

/* ================= admin ================= */
function adminTabs(ctx, active) {
  const items = [['/admin', 'tQueue', 'queue'], ['/admin/partners', 'tPartners', 'partners'], ['/admin/donations', 'tDonations', 'donations'], ['/admin/membership', 'tMembership', 'membership'], ['/admin/theme', 'tTheme', 'theme'], ['/admin/admins', 'tAdmins', 'admins']];
  return h`<nav class="tabs" aria-label="${ctx.t('adH')}">${items.map(([href, k, id]) => h`<a href="${href}" class="${active === id ? 'on' : ''}">${ctx.t(k)}</a>`)}</nav>`;
}
function admin(ctx, d) {
  const { t, lang } = ctx;
  return h`<section><h1>${t('adH')}</h1><p class="muted">${t('adP')}</p></section>
  <section class="grid g4">
    <div class="card pad"><div class="small muted">${t('waitingReview')}</div><b class="num mid">${d.apps.length + d.reports.length + d.events.length + d.memorials.length + d.flags.length + (d.notices || []).length}</b></div>
    <div class="card pad"><div class="small muted">${t('livePartners')}</div><b class="num mid">${d.stats.partners}</b></div>
    <div class="card pad"><div class="small muted">${t('donationsPaid')}</div><b class="num mid">${gbp(d.stats.paid)}</b></div>
    <div class="card pad"><div class="small muted">${t('lateReports')}</div><b class="num mid">${d.stats.late}</b></div>
  </section>${adminTabs(ctx, 'queue')}
  <section class="card">
    ${d.apps.map((a) => h`<div class="queue-item"><div><span class="chip plain">${t('qApp')}</span><div><b>${a.name}</b> ${a.name_ta ? h`<span class="muted" lang="ta">${a.name_ta}</span>` : ''}</div><div class="small muted">${dt(a.type, lang)} · ${a.town}, ${dt(a.country, lang)} · ${t('docsUploaded', { n: a.docs })} · ${t('submitted', { d: dateLabel(a.created_at, lang) })}</div></div><a class="btn sm" href="/admin/applications/${a.id}">${t('reviewApp')}</a></div>`)}
    ${d.reports.map((r) => h`<div class="queue-item"><div><span class="chip plain">${t('qReport')}</span><div><b>${L(r, 'org_name', lang)} · ${monthLabel(r.month, lang)}</b></div><div class="small muted">${t('expensesDocs', { n: r.items, a: lkr(r.spent, lang), d: r.docs })}</div></div><a class="btn sm" href="/admin/reports/${r.id}">${t('checkDocs')}</a></div>`)}
    ${d.events.map((e) => h`<div class="queue-item"><div><span class="chip plain">${t('qEvent')}</span><div><b>${L(e, 'title', lang)}</b></div><div class="small muted">${L(e, 'org_name', lang)} · ${dateLabel(e.starts_on, lang)} · ${L(e, 'place', lang)}</div></div>
      <div class="row">${postBtn(ctx, `/admin/events/${e.id}/approve`, t('approve'), 'pri')}${postBtn(ctx, `/admin/events/${e.id}/reject`, t('reject'))}</div></div>`)}
    ${d.memorials.map((m) => h`<div class="queue-item"><div><span class="chip plain">${t('qObit')}</span><div><b>${L(m, 'name', lang)}</b></div><div class="small muted">${m.years} · ${L(m, 'town', lang)}</div></div><a class="btn sm" href="/admin/memorials/${m.id}">${t('reviewApp')}</a></div>`)}
    ${(d.notices || []).map((n) => h`<div class="queue-item"><div><span class="chip plain">${t('qNotice')}</span><div><b>${L(n, 'name', lang)}</b> · ${t('nt_' + n.type)}</div><div class="small muted">${String(n.body).slice(0, 140)}</div></div>
      <div class="row">${postBtn(ctx, `/admin/notices/${n.id}/approve`, t('approve'), 'pri')}${postBtn(ctx, `/admin/notices/${n.id}/reject`, t('reject'))}</div></div>`)}
    ${d.flags.map((f) => h`<div class="queue-item"><div><span class="chip warn">${t('qFlag')}</span><div class="small">${(f.text || '').slice(0, 140)}</div>${f.reason ? h`<div class="tiny muted">${f.reason}</div>` : ''}</div>
      <div class="row">${postBtn(ctx, `/admin/flags/${f.id}/keep`, t('keepPost'))}${postBtn(ctx, `/admin/flags/${f.id}/remove`, t('removePost'), 'pri')}</div></div>`)}
    ${d.apps.length + d.reports.length + d.events.length + d.memorials.length + d.flags.length + (d.notices || []).length ? '' : h`<div class="empty">${t('allClear')}</div>`}
  </section>`;
}
function adminApplication(ctx, d) {
  const { t, lang } = ctx; const a = d.app;
  const label = { reg: 'docReg', gov: 'docGov', acc: 'docAcc', id: 'docId' };
  return h`${adminTabs(ctx, 'queue')}<section class="split"><div class="card pad stack"><h1>${a.name}</h1>${a.name_ta ? h`<div class="muted" lang="ta">${a.name_ta}</div>` : ''}
    <div class="small">${statusChip(ctx, a.status)} · ${t('submitted', { d: dateLabel(a.created_at, lang) })}</div>
    <dl class="kv"><dt>${t('orgType')}</dt><dd>${dt(a.type, lang)}</dd><dt>${t('country')}</dt><dd>${a.town}, ${dt(a.country, lang)}${a.area ? ' · ' + dt(a.area, lang) : ''}</dd><dt>${t('regNo')}</dt><dd>${a.reg_no}</dd><dt>${t('founded')}</dt><dd>${a.founded || '—'}</dd><dt>${t('website')}</dt><dd>${a.website || '—'}</dd>
      <dt>${t('contactName')}</dt><dd>${a.contact}${a.contact_role ? ` (${a.contact_role})` : ''}<br>${a.email} · ${a.phone || '—'}</dd><dt>${t('causes')}</dt><dd>${a.causes.split(',').map((c) => dt(c, lang)).join(', ')}</dd>
      <dt>${t('aboutEn')}</dt><dd>${a.about}</dd><dt>${t('aboutTa')}</dt><dd lang="ta">${a.about_ta || '—'}</dd>
      ${d.files.map((f) => h`<dt>${t(label[f.label] || 'thDocs')}</dt><dd><a class="doc" href="/files/${f.id}" target="_blank" rel="noopener">📄 ${f.filename}</a> <span class="tiny muted">${Math.ceil(f.size / 1024)} KB</span></dd>`)}</dl>
    </div>
    ${a.status === 'pending' ? h`<aside class="card pad stack sticky">
      <form method="post" action="/admin/applications/${a.id}/approve" class="stack">${csrfField(ctx)}<p class="small">${t('approveHint')}</p><button class="btn pri">${t('approve')}</button></form>
      <form method="post" action="/admin/applications/${a.id}/reject" class="stack">${csrfField(ctx)}<label class="f">${t('reason')}<textarea name="reason" required maxlength="500"></textarea></label><button class="btn">${t('reject')}</button></form>
    </aside>` : ''}</section>`;
}
function adminReport(ctx, d) {
  const { t, lang } = ctx; const r = d.report;
  const total = d.items.reduce((a, i) => a + i.amount_lkr, 0);
  return h`${adminTabs(ctx, 'queue')}<section class="row between"><div><h1>${L(r, 'org_name', lang)}</h1><p class="muted">${monthLabel(r.month, lang)} · ${t('receivedX', { a: gbp(r.received_pence) })} · ${statusChip(ctx, r.status)}</p></div></section>
  <section class="grid g2 top"><div class="card tw"><table><thead><tr><th>${t('thWhat')}</th><th>${t('thCat')}</th><th>${t('thDist')}</th><th class="r">${t('thAmount')}</th><th>${t('thProof')}</th></tr></thead><tbody>
    ${d.items.map((i) => h`<tr><td>${L(i, 'description', lang)}</td><td>${dt(i.category, lang)}</td><td>${dt(i.district, lang)}</td><td class="r">${lkr(i.amount_lkr, lang)}</td><td>${i.file_id ? h`<a class="doc" href="/files/${i.file_id}" target="_blank" rel="noopener">📄 ${t('receipt')}</a>` : h`<span class="chip warn">${t('noProof')}</span>`}</td></tr>`)}
    <tr><td colspan="3"><b>${t('total')}</b></td><td class="r"><b>${lkr(total, lang)}</b></td><td class="tiny muted">≈ ${gbp(total / RATE_LKR_PER_GBP * 100)}</td></tr></tbody></table></div>
  ${r.status === 'pending' ? h`<aside class="card pad stack">
    <form method="post" action="/admin/reports/${r.id}/approve">${csrfField(ctx)}<button class="btn pri">${t('approvePublish')}</button></form>
    <form method="post" action="/admin/reports/${r.id}/return" class="stack">${csrfField(ctx)}<label class="f">${t('reviewNote')}<textarea name="note" required maxlength="500"></textarea></label><button class="btn">${t('sendBack')}</button></form></aside>` : ''}</section>`;
}
function adminPartners(ctx, d) {
  const { t, lang } = ctx;
  return h`<section><h1>${t('adH')}</h1></section>${adminTabs(ctx, 'partners')}<section class="card tw"><table><thead><tr><th>${t('thPartner')}</th><th>${t('thType')}</th><th>${t('country')}</th><th>${t('thContact')}</th><th>${t('reporting')}</th><th>${t('thStatus')}</th><th></th></tr></thead><tbody>
    ${d.list.map((o) => h`<tr><td><div class="row nowrap">${avatar(o)}<div><b>${o.name}</b>${o.name_ta ? h`<div class="tiny muted" lang="ta">${o.name_ta}</div>` : ''}</div></div></td><td>${dt(o.type, lang)}</td><td>${dt(o.place, lang)}, ${dt(o.country, lang)}</td><td class="tiny">${o.contact_email || ''}</td>
      <td>${o.late ? h`<span class="chip warn">${t('late')}</span>` : h`<span class="chip good">${t('upToDate')}</span>`}</td><td>${statusChip(ctx, o.status)}</td>
      <td>${o.status === 'suspended' ? postBtn(ctx, `/admin/partners/${o.id}/reinstate`, t('reinstate')) : postBtn(ctx, `/admin/partners/${o.id}/suspend`, t('suspend'), 'ghost')}</td></tr>`)}
  </tbody></table></section>`;
}
function adminDonations(ctx, d) {
  const { t, lang } = ctx;
  return h`<section><h1>${t('adH')}</h1></section>${adminTabs(ctx, 'donations')}<section class="card tw"><table><thead><tr><th>${t('receiptRef')}</th><th>${t('date')}</th><th>${t('donor')}</th><th>${t('thPartner')}</th><th class="r">${t('thAmount')}</th><th class="r">${t('tipLine')}</th><th>${t('giftAidH')}</th><th>${t('thStatus')}</th></tr></thead><tbody>
    ${d.list.map((x) => h`<tr><td class="num">${x.ref}</td><td>${dateLabel(x.created_at, lang)}</td><td>${x.donor_name}<div class="tiny muted">${x.donor_email}</div></td><td>${L(x, 'org_name', lang)}</td><td class="r">${gbp(x.amount_pence)}${x.monthly ? h` <span class="tiny muted">${t('perMonth')}</span>` : ''}</td><td class="r">${gbp(x.tip_pence)}</td><td>${x.gift_aid ? '✓' : ''}</td><td>${statusChip(ctx, x.status)}</td></tr>`)}
    ${d.list.length ? '' : h`<tr><td colspan="8" class="empty">${t('noDonations')}</td></tr>`}
  </tbody></table></section>`;
}

function adminAdmins(ctx, d) {
  const { t, lang } = ctx;
  return h`<section><h1>${t('adH')}</h1><p class="muted">${t('admP')}</p></section>${adminTabs(ctx, 'admins')}
  <section class="card tw"><table><thead><tr><th>${t('name')}</th><th>${t('email')}</th><th>${t('admSince')}</th><th></th></tr></thead><tbody>
    ${d.list.map((u) => h`<tr><td><b>${u.name}</b>${u.id === ctx.user.id ? h` <span class="chip plain">${t('admYou')}</span>` : ''}</td><td class="tiny">${u.email}</td><td class="tiny">${dateLabel(u.created_at, lang)}</td>
      <td>${u.id !== ctx.user.id && d.list.length > 1 ? postBtn(ctx, `/admin/admins/${u.id}/remove`, t('admRemove'), 'ghost') : ''}</td></tr>`)}
  </tbody></table></section>
  <section class="narrow"><form class="card pad form" method="post" action="/admin/admins">${csrfField(ctx)}
    <h2>${t('admAddH')}</h2><p class="small muted">${t('admAddP')}</p>${errors(ctx, d.errors)}
    <label class="f">${t('email')}<input type="email" name="email" value="${d.email || ''}" required></label>
    <label class="f">${t('name')}<input name="name" value="${d.name || ''}"></label>
    <label class="f">${t('admTempPw')}<input type="password" name="password" minlength="12" autocomplete="new-password"></label>
    <button class="btn pri">${t('admAddBtn')}</button></form></section>`;
}
module.exports = { adminTabs, adminAdmins, dashHead, tabs, dashboard, newProject, reportsList, reportEdit, students, admin, adminApplication, adminReport, adminPartners, adminDonations };
