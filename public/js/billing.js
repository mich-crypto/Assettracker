// Billing rules, shared by the Worker and the browser. Money is whole cents.
export const VAT_MODES = ['standard', 'reverse', 'exempt'];
export const VAT_NOTES = {
  reverse: 'VAT reverse charged (Article 196, Directive 2006/112/EC).',
  exempt: 'VAT not applicable.',
};
export const MAX_CATCH_UP = 12;

export const isoDate = (d) => d.toISOString().slice(0, 10);
export const monthKey = (date) => String(date).slice(0, 7);

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function nextMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The months that should have an invoice by `today` but have none yet.
 * Billed in advance: the current month is due as soon as it starts. Billing runs from the
 * month of `start` to the month of `end` (or today), and catches up at most MAX_CATCH_UP months.
 */
export function duePeriods({ start, end = null, today, existing = [] }) {
  if (!start || start > today) return [];
  const last = end && monthKey(end) < monthKey(today) ? monthKey(end) : monthKey(today);
  const have = new Set(existing);
  const out = [];
  for (let k = monthKey(start); k <= last; k = nextMonth(k)) if (!have.has(k)) out.push(k);
  return out.slice(-MAX_CATCH_UP);
}

/** Invoice lines for a subscription month. The startup fee goes on the first month's invoice. */
export function buildLines({ project, period }) {
  const lines = [];
  if (period === monthKey(project.billing_start || '') && project.billing_startup_cents > 0) {
    lines.push({ description: `AssetTracker startup fee, ${project.name}`, qty: 1, unit_cents: project.billing_startup_cents });
  }
  if (project.billing_monthly_cents > 0) {
    lines.push({ description: `AssetTracker subscription, ${project.name}, ${monthLabel(period)}`, qty: 1, unit_cents: project.billing_monthly_cents });
  }
  return lines;
}

export const lineTotal = (l) => Math.round(Number(l.qty) * Number(l.unit_cents));

export function totals(lines, vatPercent, vatMode = 'standard') {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const pct = vatMode === 'standard' ? Number(vatPercent) || 0 : 0;
  const vat = Math.round((subtotal * pct) / 100);
  return { subtotal_cents: subtotal, vat_percent: pct, vat_cents: vat, total_cents: subtotal + vat, vat_note: VAT_NOTES[vatMode] || null };
}

export const invoiceNumber = (prefix, year, n) => `${prefix || ''}${year}-${String(n).padStart(4, '0')}`;

export function fmtMoney(cents, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format((cents || 0) / 100);
  } catch {
    return `${currency} ${((cents || 0) / 100).toFixed(2)}`;
  }
}

/** "1.250,50", "1,250.50", "1250" or "12,5" -> cents; null if not a number. */
export function parseMoney(text) {
  let s = String(text ?? '').trim().replace(/[\s€$£]/g, '');
  if (!s) return null;
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  if (comma > -1 && dot > -1) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (comma > -1) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export const isOverdue = (inv, today) => (inv.status === 'issued' || inv.status === 'sent') && inv.due_date && inv.due_date < today;

export function validLines(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 50) return 'An invoice needs 1 to 50 lines';
  for (const l of lines) {
    if (!String(l.description || '').trim()) return 'Every line needs a description';
    if (!(Number(l.qty) > 0) || Number(l.qty) > 100000) return 'Every line needs a quantity above 0';
    if (!Number.isInteger(l.unit_cents) || Math.abs(l.unit_cents) > 1e10) return 'Every line needs a price';
  }
  return null;
}
