// What a unit of equipment is called and which warnings it has. Shared by the
// overview, the warehouse page and the reports.
import { evaluateAlerts, evaluateDueAlerts } from './fields.js';

export const typeById = (types, id) => types.find((t) => t.id === id) || { id, name: id, fields: [] };

/** What people call a unit: its type plus its fixed choices, e.g. "Generator 350 kVA" or "Fuel cube Large". */
export function kindOf(asset, type) {
  const extras = type.fields
    .filter((f) => f.scope === 'asset' && f.type === 'select' && asset.attributes?.[f.key])
    .map((f) => asset.attributes[f.key]);
  return [type.name, ...extras].join(' ');
}

/** The numeric field shown as the fuel / level bar: the fuel field, else the first percentage field. */
export function levelField(type) {
  const nums = type.fields.filter((f) => f.scope === 'check' && f.type === 'number');
  return nums.find((f) => /fuel/i.test(f.key)) || nums.find((f) => f.unit === '%') || null;
}

/** Warnings: from the latest check (low fuel, alarms) and from due dates (lifting points inspection). */
export function alertsFor(asset, type, today = new Date()) {
  const fromCheck = asset.check ? evaluateAlerts(type.fields, asset.check.data) : [];
  return [...fromCheck, ...evaluateDueAlerts(type.fields, asset.attributes, today)];
}
