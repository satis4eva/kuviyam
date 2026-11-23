'use strict';
const { h, raw, gbp } = require('../util');
const { dt } = require('../i18n');

const L = (row, field, lang) => (lang === 'ta' && row[field + '_ta'] ? row[field + '_ta'] : row[field]);
const pct = (p) => Math.min(100, Math.round((p.raised_pence / Math.max(1, p.goal_pence)) * 100));
const initials = (n) => String(n).split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).slice(0, 2).join('');

function avatar(org, lg) {
  return h`<span class="avatar${lg ? ' lg' : ''}" style="background:${raw(/^#[0-9a-f]{6}$/i.test(org.color || '') ? org.color : '#0D6B5B')}" aria-hidden="true">${initials(org.name)}</span>`;
}
function verifiedTag(ctx, org) {
  return org.status === 'verified' ? h`<span class="verified">✓ ${ctx.t('verified')}</span>` : h`<span class="chip warn">${ctx.t('verPending')}</span>`;
}

const PAL = [['#0D6B5B', '#7FC8B5'], ['#2E6FA8', '#9CC6EA'], ['#B5542D', '#F0B48E'], ['#8A4FB0', '#D3B4E6'], ['#9C7A12', '#EBD089'], ['#4C7D2C', '#B7DB98']];
/** Simple illustration per cause, so projects look distinct before partners upload photos. */
function art(seed, cause) {
  const [a, b] = PAL[seed % PAL.length];
  let shape;
  if (cause === 'Clean water') shape = '<path d="M160 40c30 40 46 66 46 88a46 46 0 0 1-92 0c0-22 16-48 46-88z" fill="#fff" opacity=".85"/>';
  else if (cause === 'Libraries') shape = '<rect x="96" y="58" width="30" height="84" rx="3" fill="#fff" opacity=".9"/><rect x="132" y="48" width="30" height="94" rx="3" fill="#fff" opacity=".7"/><rect x="168" y="64" width="30" height="78" rx="3" fill="#fff" opacity=".85"/><rect x="204" y="54" width="22" height="88" rx="3" fill="#fff" opacity=".6"/>';
  else if (cause === 'Livelihoods') shape = '<circle cx="160" cy="92" r="40" fill="none" stroke="#fff" stroke-width="10" opacity=".85"/><path d="M120 92h80" stroke="#fff" stroke-width="8" opacity=".85"/>';
  else if (cause === 'Agriculture') shape = '<path d="M160 150V80" stroke="#fff" stroke-width="8"/><path d="M160 82c-30-22-58-18-74-4 26 0 50 6 74 4zM160 82c30-22 58-18 74-4-26 0-50 6-74 4zM160 80c-14-26-38-36-58-34 20 12 40 22 58 34zM160 80c14-26 38-36 58-34-20 12-40 22-58 34z" fill="#fff" opacity=".85"/>';
  else if (cause === 'Infrastructure') shape = `<path d="M100 96 160 50l60 46v52H100z" fill="#fff" opacity=".85"/><rect x="146" y="112" width="28" height="36" fill="${a}"/>`;
  else shape = '<path d="M90 80 160 50l70 30-70 30z" fill="#fff" opacity=".9"/><path d="M118 94v26c14 12 70 12 84 0V94l-42 18z" fill="#fff" opacity=".7"/>';
  return raw(`<svg viewBox="0 0 320 180" role="img" aria-hidden="true"><rect width="320" height="180" fill="${b}"/><rect width="320" height="180" fill="${a}" opacity=".35"/><circle cx="${250 - (seed * 7) % 60}" cy="40" r="18" fill="#F6C453" opacity=".9"/>${shape}<path d="M0 150c60-30 120-20 170 0s110 10 150-10v40H0z" fill="${a}" opacity=".55"/></svg>`);
}

function projectCard(ctx, p) {
  const { t, lang } = ctx;
  return h`<article class="card">
  <a class="thumb" href="/projects/${p.id}" tabindex="-1">${art(p.id, p.cause)}</a>
  <div class="pad stack">
    <div class="row between"><span class="chip">${dt(p.cause, lang)}</span>${p.urgent ? h`<span class="chip bad">${t('urgent')}</span>` : ''}</div>
    <h3><a class="plain" href="/projects/${p.id}">${L(p, 'title', lang)}</a></h3>
    <div class="small muted">${lang === 'ta' && p.org_name_ta ? p.org_name_ta : p.org_name} · ${dt(p.district, lang)}, ${dt(p.org_country, lang)}</div>
    <div class="prog" role="progressbar" aria-valuenow="${pct(p)}" aria-valuemin="0" aria-valuemax="100" aria-label="${t('funded', { p: pct(p) })}"><i style="width:${pct(p)}%"></i></div>
    <div class="row between small num"><b>${t('ofGoal', { r: gbp(p.raised_pence), g: gbp(p.goal_pence) })}</b><span class="muted">${t('donors', { n: p.donors })}</span></div>
    <a class="btn give" href="/donate?kind=project&amp;id=${p.id}">${t('donate')}</a>
  </div></article>`;
}

function csrfField(ctx) { return h`<input type="hidden" name="_csrf" value="${ctx.csrf}">`; }
function options(list, selected, lang, blank) {
  return h`${blank !== undefined ? h`<option value="">${blank}</option>` : ''}${list.map((x) => h`<option value="${x}"${x === selected ? raw(' selected') : ''}>${dt(x, lang)}</option>`)}`;
}
function errors(ctx, list) {
  if (!list || !list.length) return '';
  return h`<div class="flash bad" role="alert"><b>${ctx.t('fixThese')}</b><ul>${list.map((e) => h`<li>${e}</li>`)}</ul></div>`;
}

module.exports = { L, pct, avatar, verifiedTag, art, projectCard, csrfField, options, errors };
