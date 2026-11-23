'use strict';
/*
 * Site colours chosen by admins (Admin > Theme). Three colours drive the whole look:
 *   background  the page behind the boxes
 *   main        buttons, links, menus (teal by default)
 *   give        the Give and Donate buttons (saffron by default)
 * They apply to the light look; people whose phone is in dark mode keep the dark colours.
 */
const { audit } = require('./db');
const { clean } = require('./util');

const DEFAULTS = { bg: '#F8FAF9', brand: '#0D6B5B', accent: '#E39A12' };
const PRESETS = [
  { key: 'kuviyam', en: 'Kuviyam teal', ta: 'குவியம் பச்சை', bg: '#F8FAF9', brand: '#0D6B5B', accent: '#E39A12' },
  { key: 'white', en: 'Clean white', ta: 'வெண்மை', bg: '#FFFFFF', brand: '#0D6B5B', accent: '#E39A12' },
  { key: 'ocean', en: 'Ocean blue', ta: 'கடல் நீலம்', bg: '#F7FAFD', brand: '#1F5FA0', accent: '#F2A33A' },
  { key: 'temple', en: 'Temple maroon', ta: 'கோயில் செம்மண்', bg: '#FCF9F6', brand: '#8C2633', accent: '#E0A21B' },
  { key: 'palmyra', en: 'Palmyra green', ta: 'பனை பச்சை', bg: '#F9FBF6', brand: '#3E6B2A', accent: '#D98A1F' },
  { key: 'lotus', en: 'Lotus purple', ta: 'தாமரை ஊதா', bg: '#FBF9FD', brand: '#5B3E96', accent: '#E8A33D' },
  { key: 'saffron', en: 'Warm saffron', ta: 'காவி', bg: '#FFFBF5', brand: '#B4531B', accent: '#1E7A66' }
];
const HEX = /^#[0-9a-f]{6}$/i;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, w) => '#' + rgb(a).map((v, i) => Math.round(v * w + rgb(b)[i] * (1 - w)).toString(16).padStart(2, '0')).join('');
const luminance = (hex) => { const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
/** Dark or white text, whichever reads better on the colour. */
const inkOn = (hex) => (contrast(hex, '#FFFFFF') >= contrast(hex, '#1B1300') ? '#FFFFFF' : '#1B1300');

function registerTheme(route, H) {
  const { db, page, redirect, requireAdmin } = H;
  const read = () => {
    const out = { ...DEFAULTS };
    for (const r of db.prepare(`SELECT key, value FROM settings WHERE key IN ('theme_bg','theme_brand','theme_accent')`).all()) {
      if (HEX.test(r.value)) out[r.key.slice(6)] = r.value.toUpperCase();
    }
    return out;
  };
  // Read on every page (one tiny query) so all server processes show a change at once.
  H.theme = read;
  /** CSS for the chosen colours; empty when they are the defaults. */
  H.themeCss = () => {
    const t = H.theme();
    if (t.bg === DEFAULTS.bg && t.brand === DEFAULTS.brand && t.accent === DEFAULTS.accent) return '';
    const line = mix(t.bg, '#13232B', 0.86);
    return `@media not (prefers-color-scheme:dark){:root{--bg:${t.bg};--line:${line};--brand:${t.brand};--brand-soft:${mix(t.brand, '#FFFFFF', 0.12)};--accent:${t.accent};--accent-ink:${inkOn(t.accent)}}.btn.pri,.lang a.on,.seg a.on,.tsize[aria-pressed="true"]{color:${inkOn(t.brand)}}}`;
  };

  route('GET', '/admin/theme', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const S = require('./views/social');
    page(ctx, { title: ctx.t('tTheme'), active: 'admin', body: S.adminTheme(ctx, { theme: H.theme(), presets: PRESETS, defaults: DEFAULTS, warn: null }) });
  });
  route('POST', '/admin/theme', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const b = ctx.body;
    let next;
    if (b.preset) {
      const p = PRESETS.find((x) => x.key === b.preset); if (!p) return redirect(ctx, '/admin/theme');
      next = { bg: p.bg, brand: p.brand, accent: p.accent };
    } else if (b.reset === '1') {
      next = { ...DEFAULTS };
    } else {
      next = { bg: clean(b.bg, 7), brand: clean(b.brand, 7), accent: clean(b.accent, 7) };
      if (!Object.values(next).every((v) => HEX.test(v))) return redirect(ctx, '/admin/theme', { kind: 'bad', msg: ctx.t('errColour') });
      // Keep the site readable: the background must stay light, and the main colour must show up on it.
      if (luminance(next.bg) < 0.75) return redirect(ctx, '/admin/theme', { kind: 'bad', msg: ctx.t('errBgDark') });
      if (contrast(next.brand, next.bg) < 3) return redirect(ctx, '/admin/theme', { kind: 'bad', msg: ctx.t('errBrandLight') });
    }
    const save = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(next)) save.run('theme_' + k, v.toUpperCase());
    audit(db, ctx.user.id, 'theme', JSON.stringify(next));
    redirect(ctx, '/admin/theme', { kind: 'good', msg: ctx.t('themeSaved') });
  });
}

module.exports = { registerTheme, DEFAULTS, PRESETS };
