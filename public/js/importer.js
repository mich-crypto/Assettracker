// Importing the existing fleet from Excel / CSV: a template generated from the
// equipment types, and a tolerant reader (ratings like "350", European dates).
import { normalizeValues } from './fields.js';
import { parseTable } from './coords.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const digits = (s) => String(s ?? '').replace(/\D+/g, '');

/** Fixed details to ask for per type: required first. */
const assetFields = (type) => type.fields.filter((f) => f.scope === 'asset');

/** A CSV template (opens in Excel): one example row per equipment type. */
export function buildTemplate(types) {
  const labels = [];
  for (const t of types) for (const f of assetFields(t)) if (!labels.includes(f.label)) labels.push(f.label);
  const header = ['Equipment type', 'Serial number', ...labels];
  const example = (f) => {
    if (f.type === 'select') return f.options[0];
    if (f.type === 'date') return '31-12-2026';
    if (f.type === 'number') return '0';
    if (f.type === 'boolean') return 'yes';
    return '';
  };
  const rows = types.map((t, i) => [t.name, `SN-00${i + 1}`, ...labels.map((l) => {
    const f = assetFields(t).find((x) => x.label === l);
    return f ? example(f) : '';
  })]);
  const cell = (v) => (/[",;\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** "350", "350kva", "350 KVA" -> the option "350 kVA". Returns the original text when nothing matches. */
export function matchOption(options, value) {
  const v = norm(value);
  if (!v) return '';
  const exact = options.find((o) => norm(o) === v);
  if (exact) return exact;
  const byDigits = digits(v) ? options.filter((o) => digits(o) === digits(v)) : [];
  if (byDigits.length === 1) return byDigits[0];
  const starts = options.filter((o) => norm(o).startsWith(v));
  return starts.length === 1 ? starts[0] : String(value).trim();
}

/** 31-12-2026, 31/12/2026, 31.12.2026 (day first, as in Europe), 2026-12-31, or an Excel serial number -> YYYY-MM-DD. */
export function parseDate(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y; let mo; let d;
  if (m) [, y, mo, d] = m;
  else if ((m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/))) {
    [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
  } else if (/^\d{5}$/.test(v)) {
    const t = Date.UTC(1899, 11, 30) + Number(v) * 86400e3; // Excel day number
    const dt = new Date(t);
    [y, mo, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else return v;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const back = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(back.getTime()) && back.getUTCDate() === Number(d) ? iso : v;
}

/**
 * Reads the filled-in template. Returns { rows: [{ line, type_id, serial, attributes }], problems: [{ line, error }] }.
 * Columns are found by their names in the header row, in any order.
 */
export function parseAssetRows(text, types) {
  const table = parseTable(text);
  const rows = [];
  const problems = [];
  if (table.length < 2) return { rows, problems: [{ line: 0, error: 'The list is empty. Fill in the template first.' }] };
  const head = table[0].map(norm);
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const typeCol = col('equipment type', 'type', 'equipment');
  const serialCol = col('serial number', 'serial', 'serial no', 'sn');
  if (typeCol < 0 || serialCol < 0) return { rows, problems: [{ line: 1, error: 'The first row must contain "Equipment type" and "Serial number" columns.' }] };
  const seen = new Set();
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const line = i + 1;
    const typeText = norm(cells[typeCol]);
    const type = types.find((t) => norm(t.name) === typeText || norm(t.id) === typeText);
    if (!type) { problems.push({ line, error: `Unknown equipment type "${cells[typeCol] || ''}"` }); continue; }
    const serial = String(cells[serialCol] ?? '').trim().toUpperCase();
    if (!serial) { problems.push({ line, error: 'Serial number is empty' }); continue; }
    const key = `${type.id}\u001e${serial}`;
    if (seen.has(key)) { problems.push({ line, error: `${serial} appears twice` }); continue; }
    seen.add(key);
    const raw = {};
    for (const f of assetFields(type)) {
      const c = head.indexOf(norm(f.label));
      let v = c >= 0 ? String(cells[c] ?? '').trim() : '';
      if (v && f.type === 'select') v = matchOption(f.options, v);
      if (v && f.type === 'date') v = parseDate(v);
      if (v) raw[f.key] = v;
    }
    const { values, errors } = normalizeValues(type.fields, 'asset', raw);
    if (Object.keys(errors).length) { problems.push({ line, error: `${serial}: ${Object.values(errors).join('; ')}` }); continue; }
    rows.push({ line, type_id: type.id, serial, attributes: values });
  }
  return { rows, problems };
}
