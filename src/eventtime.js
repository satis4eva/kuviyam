'use strict';
/* Event times: entered in the event's own time zone, turned into exact moments for reminders and the Join button. */

const ZONES = [
  ['Europe/London', 'UK', 'ஐக்கிய இராச்சியம்'], ['Asia/Colombo', 'Sri Lanka', 'இலங்கை'], ['Asia/Kolkata', 'India', 'இந்தியா'],
  ['Asia/Kuala_Lumpur', 'Malaysia', 'மலேசியா'], ['Asia/Singapore', 'Singapore', 'சிங்கப்பூர்'], ['America/Toronto', 'Toronto / New York', 'ரொறன்ரோ / நியூயோர்க்'],
  ['America/Vancouver', 'Vancouver / Los Angeles', 'வன்கூவர் / லொஸ் ஏஞ்சல்ஸ்'], ['Europe/Paris', 'Paris / Central Europe', 'பாரிஸ் / மத்திய ஐரோப்பா'],
  ['Europe/Zurich', 'Switzerland', 'சுவிற்சர்லாந்து'], ['Europe/Berlin', 'Germany', 'ஜேர்மனி'], ['Europe/Oslo', 'Norway', 'நோர்வே'], ['Europe/Copenhagen', 'Denmark', 'டென்மார்க்'],
  ['Europe/Stockholm', 'Sweden', 'சுவீடன்'], ['Europe/Amsterdam', 'Netherlands', 'நெதர்லாந்து'], ['Europe/Rome', 'Italy', 'இத்தாலி'], ['Europe/Dublin', 'Ireland', 'அயர்லாந்து'],
  ['Asia/Dubai', 'UAE / Oman', 'ஐக்கிய அரபு அமீரகம் / ஓமான்'], ['Asia/Qatar', 'Qatar / Bahrain', 'கத்தார் / பஹ்ரைன்'], ['Asia/Riyadh', 'Saudi Arabia / Kuwait', 'சவூதி / குவைத்'],
  ['Indian/Mauritius', 'Mauritius / Réunion / Seychelles', 'மொரிசியஸ் / ரீயூனியன் / சீசெல்சு'], ['Africa/Johannesburg', 'South Africa', 'தென்னாபிரிக்கா'],
  ['Asia/Yangon', 'Myanmar', 'மியான்மார்'], ['Asia/Bangkok', 'Thailand / Indonesia (Jakarta)', 'தாய்லாந்து / இந்தோனேசியா'], ['Asia/Tokyo', 'Japan', 'ஜப்பான்'],
  ['Australia/Perth', 'Perth', 'பேர்த்'], ['Australia/Sydney', 'Sydney / Melbourne', 'சிட்னி / மெல்பேர்ண்'], ['Pacific/Auckland', 'New Zealand', 'நியூசிலாந்து'],
  ['Pacific/Fiji', 'Fiji', 'பிஜி'], ['America/Guyana', 'Guyana', 'கயானா'], ['America/Port_of_Spain', 'Trinidad / Guadeloupe / Martinique', 'திரினிடாட் / குவாதலூப்பு / மர்த்தினிக்கு']
];
const ZONE_IDS = ZONES.map((z) => z[0]);
const DEFAULT_TZ = 'Europe/London';

/** Milliseconds the zone is ahead of UTC at the given moment. */
function offset(ms, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
}
/** '2026-12-02' + '18:30' in 'Europe/London' -> Date (UTC moment). */
function toUtc(date, time, tz = DEFAULT_TZ) {
  const [y, m, d] = date.split('-').map(Number); const [hh, mm] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offset(guess, tz);
  const again = guess - offset(t, tz);
  if (again !== t) t = again;
  return new Date(t);
}
/** When the event starts and ends, as exact moments. Without a time we assume 9:00 to 21:00 on the day. */
function window(e) {
  const tz = ZONE_IDS.includes(e.tz) ? e.tz : DEFAULT_TZ;
  const start = toUtc(e.starts_on, e.start_time || '09:00', tz);
  let end = e.end_time ? toUtc(e.starts_on, e.end_time, tz) : new Date(start.getTime() + (e.start_time ? 3 : 12) * 3600e3);
  if (end <= start) end = new Date(end.getTime() + 864e5); // ends after midnight
  return { start, end, tz, hasTime: !!e.start_time };
}
const zoneLabel = (tz, lang) => { const z = ZONES.find((x) => x[0] === tz) || ZONES[0]; return lang === 'ta' ? z[2] : z[1]; };
/** "6:30 pm – 8:00 pm (London time)" */
function timeLabel(e, t, lang) {
  if (!e.start_time) return '';
  const fmt = (hm) => { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  return `${fmt(e.start_time)}${e.end_time ? ' – ' + fmt(e.end_time) : ''} ${t('zoneTime', { z: zoneLabel(e.tz || DEFAULT_TZ, lang) })}`;
}
/** 'soon' (within 15 minutes of starting), 'live', 'over' or 'later'. */
function phase(e, now = Date.now()) {
  const w = window(e);
  if (now > w.end.getTime()) return 'over';
  if (now >= w.start.getTime()) return 'live';
  if (now >= w.start.getTime() - 15 * 60e3) return 'soon';
  return 'later';
}

module.exports = { ZONES, ZONE_IDS, DEFAULT_TZ, toUtc, window, timeLabel, phase, zoneLabel };
