// Reports for the warehouse supervisor and site manager: equipment that needs
// service, and where to bring fuel. Pure functions over the overview data.
import { alertsFor, kindOf, levelField, typeById } from './equipment.js';

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/**
 * Equipment that needs service: lifting points inspection due or overdue, and units
 * reporting an alarm. Most urgent first. `assets` come from GET /assets (with `check`, `last`).
 */
export function serviceRows(assets, types, today = new Date()) {
  const rows = [];
  for (const a of assets) {
    const type = typeById(types, a.type_id);
    const reasons = [];
    let urgency = Infinity;
    if (a.defect) { reasons.push(a.defect_note ? `Defect: ${a.defect_note}` : 'Defect'); urgency = -1e6; }
    for (const w of alertsFor(a, type, today)) {
      const field = type.fields.find((f) => f.key === w.key);
      if (field?.type === 'date') { reasons.push(w.text); urgency = Math.min(urgency, w.days); }
      else if (field?.type === 'multiselect') { reasons.push(`Alarm: ${w.value.join(', ')}`); urgency = Math.min(urgency, 0); }
    }
    if (!reasons.length) continue;
    rows.push({
      id: a.id, urgency, reasons,
      kind: kindOf(a, type), serial: a.serial,
      location: a.last?.location_name || (a.last ? 'Elsewhere' : 'Not placed'),
      servicedAt: a.serviced_at || null,
    });
  }
  return rows.sort((x, y) => x.urgency - y.urgency || natural(x.location, y.location) || natural(x.kind, y.kind));
}

/** Units on turbines at or below a fuel level, lowest first: where to bring fuel. */
export function fuelRows(assets, types, maxLevel = 50) {
  const rows = [];
  for (const a of assets) {
    if (a.last?.location_kind !== 'WTG') continue;
    const type = typeById(types, a.type_id);
    const f = levelField(type);
    const v = f && a.check ? a.check.data[f.key] : null;
    if (v == null || v > maxLevel) continue;
    rows.push({ id: a.id, level: v, unit: f.unit || '', kind: kindOf(a, type), serial: a.serial, location: a.last.location_name, at: a.check.recorded_at });
  }
  return rows.sort((x, y) => x.level - y.level || natural(x.location, y.location));
}

export function rowsToText(title, header, lines) {
  return [title, '', header.join(' | '), ...lines.map((l) => l.join(' | '))].join('\n');
}

export function rowsToCsv(header, lines) {
  const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [header, ...lines].map((l) => l.map(cell).join(',')).join('\n');
}
