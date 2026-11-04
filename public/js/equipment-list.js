// Shared by the overview and the warehouse: a unit with its status, fuel and warnings,
// and the search / filter / sort bar above a list of units.
import { esc } from './app.js';
import { alertsFor, blockedBy, effectiveCheck, kindOf, levelField, levelFields } from './equipment.js';
import { formatValue } from './fields.js';

/** A unit from GET /assets plus what the lists need: kind, warnings, why it is blocked, fuel level. */
export function enrich(a, type) {
  const f = levelField(type);
  const c = effectiveCheck(a, type);
  const v = f && c ? c.data[f.key] : null;
  const alerts = alertsFor(a, type);
  const block = blockedBy(a, type);
  // All levels (fuel, battery): [{ f, v }]. `fuel` stays the main level used for sorting.
  const levels = levelFields(type).map((lf) => ({ f: lf, v: c ? c.data[lf.key] ?? null : null }));
  const battery = levels.find((l) => /batter/i.test(l.f.key))?.v ?? null;
  return { ...a, type, kind: kindOf(a, type), alerts, block, status: block ? 'blocked' : alerts.length ? 'warning' : 'ok', levelField: f, fuel: v, battery, levels };
}

function levelBar(a, { f, v }, label) {
  if (v == null) return `<span class="fuel">${label ? `<span class="lvl-label">${label}</span>` : ''}<span class="muted">—</span></span>`;
  const pct = f.max ? Math.max(0, Math.min(100, (v / f.max) * 100)) : v;
  const low = a.alerts.some((x) => x.key === f.key);
  return `<span class="fuel">${label ? `<span class="lvl-label">${label}</span>` : ''}<span class="fuel-bar${low ? ' low' : ''}" aria-hidden="true"><span style="width:${pct}%"></span></span>${esc(formatValue(f, v))}</span>`;
}

/** The level column: one bar, or one per level (fuel and battery) for a hybrid generator. */
export function fuelCell(a) {
  if (!a.levels.length || a.levels.every((l) => l.v == null)) return '<span class="muted">—</span>';
  if (a.levels.length === 1) return levelBar(a, a.levels[0]);
  return a.levels.map((l) => `<div>${levelBar(a, l, /batter/i.test(l.f.key) ? 'Battery' : 'Fuel')}</div>`).join('');
}

/** Red: may not be used. Orange: warning. Nothing when all is well. */
export function statusCell(a) {
  if (a.block) return `<span class="stat-blocked" title="${esc(a.block.text)}"><span aria-hidden="true">⛔</span> ${esc(a.block.short)}</span>`;
  if (a.alerts.length) {
    const text = a.alerts.map((x) => x.text).join('; ');
    return `<span class="warn-sym" title="${esc(text)}" role="img" aria-label="Warning: ${esc(text)}">⚠</span><span class="warn-text">${esc(a.alerts[0].text)}${a.alerts.length > 1 ? ` +${a.alerts.length - 1}` : ''}</span>`;
  }
  return '';
}

export const rowClass = (a) => `clickable${a.block ? ' is-blocked' : ''}`;

const natural = (x, y) => String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
const rank = { blocked: 0, warning: 1, ok: 2 };
const SORTS = {
  kind: ['Sort: equipment', (x, y) => natural(x.kind, y.kind) || natural(x.serial, y.serial)],
  wtg: ['Sort: turbine', (x, y) => natural(x.last?.location_name, y.last?.location_name) || natural(x.kind, y.kind)],
  status: ['Sort: problems first', (x, y) => rank[x.status] - rank[y.status] || natural(x.kind, y.kind)],
  'fuel-asc': ['Sort: fuel, low first', (x, y) => (x.fuel ?? 1e9) - (y.fuel ?? 1e9) || natural(x.kind, y.kind)],
  'battery-asc': ['Sort: battery, low first', (x, y) => (x.battery ?? 1e9) - (y.battery ?? 1e9) || natural(x.kind, y.kind)],
  'fuel-desc': ['Sort: fuel, high first', (x, y) => (y.fuel ?? -1) - (x.fuel ?? -1) || natural(x.kind, y.kind)],
  checked: ['Sort: longest not checked', (x, y) => String(x.check?.recorded_at ?? '').localeCompare(String(y.check?.recorded_at ?? ''))],
};

const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');
const haystack = (a) => norm([a.kind, a.last?.location_name, a.serial, a.name, ...a.tags.map((t) => t.code), ...a.alerts.map((x) => x.text), a.block?.text].join(' '));

/**
 * Fills a toolbar element (search, kind, status, sort) and returns its controller.
 * `sorts` lists the sort keys offered, the first one is the default.
 */
export function initToolbar(el, { sorts = ['kind', 'status', 'fuel-asc', 'battery-asc', 'fuel-desc', 'checked'], onChange }) {
  el.classList.add('toolbar');
  el.innerHTML = `<input type="search" data-f="q" placeholder="Search" aria-label="Search">
    <select data-f="kind" aria-label="Equipment type"><option value="">All equipment</option></select>
    <select data-f="status" aria-label="Status"><option value="">All statuses</option><option value="blocked">Defect / not usable</option><option value="warning">Warning</option><option value="ok">OK</option></select>
    <select data-f="sort" aria-label="Sort">${sorts.map((k) => `<option value="${k}">${SORTS[k][0]}</option>`).join('')}</select>`;
  const get = (f) => el.querySelector(`[data-f=${f}]`);
  el.querySelectorAll('[data-f]').forEach((x) => x.addEventListener('input', onChange));
  return {
    state: () => ({ q: norm(get('q').value), kind: get('kind').value, status: get('status').value, sort: get('sort').value }),
    /** Offer the kinds that exist (keeps the current choice when it still exists). */
    setKinds(kinds) {
      const sel = get('kind'), cur = sel.value;
      const list = [...new Set(kinds)].sort(natural);
      sel.innerHTML = '<option value="">All equipment</option>' + list.map((k) => `<option${k === cur ? ' selected' : ''}>${esc(k)}</option>`).join('');
    },
  };
}

export function applyFilters(units, { q, kind, status, sort }) {
  return units
    .filter((a) => (!kind || a.kind === kind) && (!status || a.status === status) && (!q || haystack(a).includes(q)))
    .sort(SORTS[sort]?.[1] || SORTS.kind[1]);
}
