'use strict';
/*
 * Reads the sheets of an .xlsx file (Excel, Google Sheets download) into rows of plain values,
 * with no packages: an .xlsx is a zip of XML files, read here with the zip directory and zlib.
 * Enough for importing lists (text, numbers, dates); formulas come back as their saved values.
 */
const zlib = require('node:zlib');

function unzip(buf) {
  // Find the end of the central directory, then walk its entries.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not_xlsx');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('not_xlsx');
    const method = buf.readUInt16LE(p + 10); const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28); const extraLen = buf.readUInt16LE(p + 30); const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42); const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    if (/\.(xml|rels)$/.test(name)) files[name] = method === 8 ? zlib.inflateRawSync(raw).toString('utf8') : raw.toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unesc = (s) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e.toLowerCase()]
  ?? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
const textOf = (xml) => unesc((xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, '')).join(''));
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** { sheetName: [[cell, ...], ...] } with rows in order; empty cells are null. */
function readXlsx(buf) {
  const f = unzip(buf);
  const shared = (f['xl/sharedStrings.xml'] || '').match(/<si>[\s\S]*?<\/si>/g)?.map(textOf) || [];
  const rels = {};
  for (const m of (f['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]); const target = /Target="([^"]+)"/.exec(m[0]);
    if (id && target) rels[id[1]] = target[1].replace(/^\/?(xl\/)?/, 'xl/');
  }
  const out = {};
  for (const m of (f['xl/workbook.xml'] || '').matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc((/name="([^"]*)"/.exec(m[0]) || [])[1] || '');
    const rid = (/r:id="([^"]+)"/.exec(m[0]) || [])[1];
    const xml = f[rels[rid]]; if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]; const body = c[2] || '';
        const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1]; const type = (/t="([^"]+)"/.exec(attrs) || [])[1];
        const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        let val = null;
        if (type === 's') val = shared[Number(v)] ?? null;
        else if (type === 'inlineStr') val = textOf(body);
        else if (type === 'str' || type === 'e') val = v != null ? unesc(v) : null;
        else if (type === 'b') val = v === '1';
        else if (v != null) val = Number(v);
        const i = ref ? colIndex(ref) : row.length;
        while (row.length < i) row.push(null);
        row[i] = typeof val === 'string' ? val.trim() || null : val;
      }
      rows.push(row);
    }
    out[name] = rows;
  }
  return out;
}

/** Excel stores dates as days since 1899-12-30. */
const excelDate = (n) => new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10);

module.exports = { readXlsx, excelDate };
