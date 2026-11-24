'use strict';
/* Views for paid event tickets: buying, paying, the ticket itself, partner payouts and admin payouts. */
const { h, raw, gbp, dateLabel } = require('../util');
const { L, csrfField, errors } = require('./parts');
const ET = require('../eventtime');

const pct = (bps) => (bps / 100).toFixed(2).replace(/\.?0+$/, '');

function eventLine(ctx, e) {
  const { t, lang } = ctx;
  return h`<span class="muted">${dateLabel(e.starts_on, lang)}${e.start_time ? ' · ' + ET.timeLabel(e, t, lang) : ''} · ${L(e, 'place', lang)}</span>`;
}

function buy(ctx, d) {
  const { t, lang, user } = ctx; const e = d.event; const v = d.values || {};
  const max = d.left === null ? d.max : Math.min(d.max, d.left);
  return h`<section class="narrow"><form class="card pad form" method="post" action="/events/${e.id}/tickets">${csrfField(ctx)}
    <a class="small" href="/events/${e.id}">← ${L(e, 'title', lang)}</a>
    <h1>${t('buyTickets')}</h1>${eventLine(ctx, e)}${errors(ctx, d.errors)}
    <div class="row between price-row"><span>${t('ticketEach')}</span><b class="mid">${gbp(e.price_pence)}</b></div>
    ${d.left !== null ? h`<p class="small ${d.left < 10 ? 'warn-t' : 'muted'}">${d.left ? t('ticketsLeft', { n: d.left }) : t('soldOut')}</p>` : ''}
    ${max > 0 ? h`<label class="f">${t('howMany')}<select name="qty" id="qty" data-price="${e.price_pence}">${Array.from({ length: max }, (_, i) => i + 1).map((n) => h`<option value="${n}"${Number(v.qty) === n ? raw(' selected') : ''}>${n}</option>`)}</select></label>
      <label class="f">${t('nameOnTickets')}<input name="name" value="${v.name || user.name}" maxlength="120" required></label>
      <label class="f">${t('sendTicketsTo')}<input type="email" name="email" value="${v.email || user.email}" maxlength="200" required></label>
      <p class="tiny muted">${t('ticketsGoTo', { o: L(e, 'org_name', lang) })}</p>
      <button class="btn give big-btn">${t('continueToPay')}</button>` : ''}
  </form></section>`;
}
function pay(ctx, d) {
  const { t, lang } = ctx; const o = d.order; const e = d.event;
  return h`<section class="narrow"><form class="card pad form" method="post" action="/tickets/pay/${o.ref}">${csrfField(ctx)}
    <h1>${t('payment')}</h1><p class="muted">${L(e, 'title', lang)} · ${dateLabel(e.starts_on, lang)}</p>
    <table class="small"><tbody><tr><td>${t('ticketsX', { n: o.qty })} × ${gbp(o.unit_pence)}</td><td class="r">${gbp(o.gross_pence)}</td></tr>
      <tr><td><b>${t('total')}</b></td><td class="r"><b>${gbp(o.gross_pence)}</b></td></tr></tbody></table>
    ${d.testMode ? h`<div class="flash warn">${t('testModeNote')}</div><label class="f">${t('card')}<input value="4242 4242 4242 4242" readonly></label>` : ''}
    <button class="btn give">${t('pay', { a: gbp(o.gross_pence) })}</button>
    <a class="small" href="/events/${e.id}">${t('cancel')}</a>
  </form></section>`;
}
function ticket(ctx, d) {
  const { t, lang } = ctx; const o = d.order; const e = d.event;
  return h`<section class="narrow stack"><div class="card ticket">
    <div class="ticket-top"><span class="chip good">✓ ${t('paid')}</span><h1>${L(e, 'title', lang)}</h1>${eventLine(ctx, e)}<span class="small">${t('hostedBy')} ${L(e, 'org_name', lang)}</span></div>
    <div class="ticket-cut" aria-hidden="true"></div>
    <div class="pad stack"><div class="row between"><span class="muted">${t('ticketNumber')}</span><b class="ticket-ref">${o.ref}</b></div>
      <div class="row between"><span class="muted">${t('ticketsLabel')}</span><b>${o.qty}</b></div>
      <div class="row between"><span class="muted">${t('nameOnTickets')}</span><b>${o.buyer_name}</b></div>
      <div class="row between"><span class="muted">${t('total')}</span><b>${gbp(o.gross_pence)}</b></div>
      <p class="small muted">${t('showAtDoor', { e: o.buyer_email })}</p>
      <div class="row"><a class="btn pri" href="/events/${e.id}">${t('openEvent')}</a><a class="btn" href="/events/${e.id}/calendar.ics">📅 ${t('addToCalendar')}</a></div></div>
  </div></section>`;
}

function partnerPayouts(ctx, d) {
  const { t, lang } = ctx; const { dashHead, tabs } = require('./manage');
  const tot = d.events.reduce((a, e) => ({ gross: a.gross + e.gross, commission: a.commission + e.commission, net: a.net + e.net, owed: a.owed + e.owed }), { gross: 0, commission: 0, net: 0, owed: 0 });
  return h`${dashHead(ctx, d.org)}${tabs(ctx, 'payouts')}
  <section class="grid g4">
    <div class="card pad"><div class="tiny muted">${t('ticketSales')}</div><div class="big num">${gbp(tot.gross)}</div></div>
    <div class="card pad"><div class="tiny muted">${t('platformFee')}</div><div class="big num">${gbp(tot.commission)}</div></div>
    <div class="card pad"><div class="tiny muted">${t('yourShare')}</div><div class="big num">${gbp(tot.net)}</div></div>
    <div class="card pad"><div class="tiny muted">${t('toBePaid')}</div><div class="big num">${gbp(tot.owed)}</div></div>
  </section>
  <p class="small muted">${t('payoutsHow')}</p>
  <section class="card tw"><table><thead><tr><th>${t('eventNameEn')}</th><th class="r">${t('ticketsLabel')}</th><th class="r">${t('ticketSales')}</th><th class="r">${t('platformFee')}</th><th class="r">${t('yourShare')}</th><th class="r">${t('toBePaid')}</th></tr></thead><tbody>
    ${d.events.length ? d.events.map((e) => h`<tr><td><a href="/dashboard/events/${e.id}">${L(e, 'title', lang)}</a><div class="tiny muted">${dateLabel(e.starts_on, lang)}</div></td><td class="r">${e.tickets}</td><td class="r">${gbp(e.gross)}</td><td class="r">${gbp(e.commission)}</td><td class="r"><b>${gbp(e.net)}</b></td><td class="r">${gbp(e.owed)}</td></tr>`)
      : h`<tr><td colspan="6" class="empty">${t('noTicketSales')}</td></tr>`}</tbody></table></section>
  <section class="card tw"><h2 class="pad">${t('payoutsReceived')}</h2><table><thead><tr><th>${t('date')}</th><th class="r">${t('thAmount')}</th><th>${t('payoutRef')}</th></tr></thead><tbody>
    ${d.payouts.length ? d.payouts.map((p) => h`<tr><td>${dateLabel(p.created_at, lang)}</td><td class="r"><b>${gbp(p.amount_pence)}</b> <span class="tiny muted">(${t('ordersN', { n: p.orders })})</span></td><td class="small">${p.reference}</td></tr>`)
      : h`<tr><td colspan="3" class="empty">${t('noPayoutsYet')}</td></tr>`}</tbody></table></section>`;
}

function admin(ctx, d) {
  const { t, lang } = ctx; const { adminTabs } = require('./manage');
  return h`<section><h1>${t('adH')}</h1></section>${adminTabs(ctx, 'tickets')}
  <section class="split">
    <div class="card tw"><h2 class="pad">${t('owedToOrganisers')}</h2><table><thead><tr><th>${t('thPartner')}</th><th class="r">${t('ticketSales')}</th><th class="r">${t('platformFee')}</th><th class="r">${t('owedNow')}</th><th></th></tr></thead><tbody>
      ${d.orgs.length ? d.orgs.map((o) => h`<tr><td><b>${o.name}</b><div class="tiny muted">${o.contact_email || ''}</div></td><td class="r">${gbp(o.gross)}</td><td class="r">${gbp(o.commission)}</td><td class="r"><b>${gbp(o.owed)}</b>${o.unpaid_orders ? h`<div class="tiny muted">${t('ordersN', { n: o.unpaid_orders })}</div>` : ''}</td>
        <td>${o.owed > 0 ? h`<details><summary class="btn sm">${t('recordPayout')}</summary><form class="stack6 payout-form" method="post" action="/admin/tickets/payout/${o.id}">${csrfField(ctx)}<input type="hidden" name="amount" value="${(o.owed / 100).toFixed(2)}">
          <span class="tiny">${t('payoutConfirm', { a: gbp(o.owed), o: o.name })}</span><input name="reference" required maxlength="120" placeholder="${t('payoutRefPh')}"><input name="note" maxlength="300" placeholder="${t('noteOptional')}"><button class="btn sm pri">${t('markPaid')}</button></form></details>` : h`<span class="chip good">${t('allPaid')}</span>`}</td></tr>`)
        : h`<tr><td colspan="5" class="empty">${t('noTicketSales')}</td></tr>`}</tbody></table></div>
    <div class="stack">
      <form class="card pad form" method="post" action="/admin/tickets/commission">${csrfField(ctx)}<h2>${t('commissionH')}</h2><p class="tiny muted">${t('commissionP')}</p>
        <label class="f">${t('commissionLabel')}<span class="row nowrap"><input name="percent" inputmode="decimal" value="${pct(d.bps)}" style="max-width:110px"> %</span></label>
        <p class="tiny muted">${t('commissionExample', { p: gbp(1000), c: gbp(Math.round(1000 * d.bps / 10000)), n: gbp(1000 - Math.round(1000 * d.bps / 10000)) })}</p>
        <button class="btn pri">${t('save')}</button></form>
      <div class="card pad stack"><h3>${t('ticketGateway')}</h3>${d.provider.testMode ? h`<div class="flash warn">${t('ticketGatewayTest')}</div>` : h`<div class="flash good">${t('ticketGatewayLive', { p: d.provider.name })}</div>`}<p class="tiny muted">${t('gatewaysSeparate')}</p></div>
    </div>
  </section>
  <section class="card tw"><h2 class="pad">${t('recentTicketSales')}</h2><table><thead><tr><th>${t('date')}</th><th>${t('eventNameEn')}</th><th>${t('buyer')}</th><th class="r">${t('ticketsLabel')}</th><th class="r">${t('ticketSales')}</th><th class="r">${t('platformFee')}</th><th class="r">${t('organiserShare')}</th><th>${t('thStatus')}</th></tr></thead><tbody>
    ${d.recent.length ? d.recent.map((o) => h`<tr><td class="tiny">${dateLabel(o.paid_at, lang)}<div class="muted">${o.ref}</div></td><td>${o.title}<div class="tiny muted">${o.org_name}</div></td><td class="tiny">${o.buyer_name}<div class="muted">${o.buyer_email}</div></td><td class="r">${o.qty}</td><td class="r">${gbp(o.gross_pence)}</td><td class="r">${gbp(o.commission_pence)} <span class="tiny muted">(${pct(o.commission_bps)}%)</span></td><td class="r">${gbp(o.net_pence)}</td><td>${o.payout_id ? h`<span class="chip good">${t('paidOut')}</span>` : h`<span class="chip warn">${t('owedNow')}</span>`}${o.provider === 'test' ? h` <span class="chip plain">${t('testShort')}</span>` : ''}</td></tr>`)
      : h`<tr><td colspan="8" class="empty">${t('noTicketSales')}</td></tr>`}</tbody></table></section>
  <section class="card tw"><h2 class="pad">${t('payoutsMade')}</h2><table><thead><tr><th>${t('date')}</th><th>${t('thPartner')}</th><th class="r">${t('thAmount')}</th><th>${t('payoutRef')}</th></tr></thead><tbody>
    ${d.payouts.length ? d.payouts.map((p) => h`<tr><td>${dateLabel(p.created_at, lang)}</td><td>${p.org_name}</td><td class="r"><b>${gbp(p.amount_pence)}</b></td><td class="small">${p.reference}${p.note ? h`<div class="tiny muted">${p.note}</div>` : ''}</td></tr>`)
      : h`<tr><td colspan="4" class="empty">${t('noPayoutsYet')}</td></tr>`}</tbody></table></section>`;
}

module.exports = { buy, pay, ticket, partnerPayouts, admin };
