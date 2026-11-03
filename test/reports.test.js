import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertsFor, kindOf } from '../public/js/equipment.js';
import { evaluateDueAlerts } from '../public/js/fields.js';
import { fuelRows, serviceRows } from '../public/js/reports.js';

const today = new Date(2026, 10, 3); // 3 Nov 2026 (local)
const generator = { id: 'generator', name: 'Generator', fields: [
  { key: 'kva', label: 'Rating', type: 'select', scope: 'asset', options: ['30 kVA', '350 kVA'] },
  { key: 'inspection_due', label: 'Lifting points inspection due', type: 'date', scope: 'asset', dueWarnDays: 30 },
  { key: 'fuel_level', label: 'Fuel level', type: 'number', scope: 'check', unit: '%', max: 100, alert: { atMost: 25 } },
  { key: 'alarms', label: 'Active alarms', type: 'multiselect', scope: 'check', options: ['Defect'], alert: { any: true } },
] };
const mk = (id, due, fuel, alarms, loc = 'WTG A01', kind = 'WTG') => ({
  id, type_id: 'generator', serial: `S-${id}`, attributes: { kva: '350 kVA', inspection_due: due },
  last: { location_name: loc, location_kind: kind, location_id: loc },
  check: { recorded_at: '2026-11-03T08:00:00Z', data: { fuel_level: fuel, alarms } },
});

test('due dates: overdue, soon, far away', () => {
  const d = (v) => evaluateDueAlerts(generator.fields, { inspection_due: v }, today);
  assert.equal(d('2026-10-20')[0].days, -14);
  assert.match(d('2026-10-20')[0].text, /overdue \(14 d\)/);
  assert.match(d('2026-11-03')[0].text, /due today/);
  assert.match(d('2026-11-20')[0].text, /due in 17 d/);
  assert.deepEqual(d('2027-03-01'), []);
  assert.deepEqual(d(undefined), []);
});

test('kind name', () => assert.equal(kindOf(mk('a', null), generator), 'Generator 350 kVA'));

test('service report: overdue first, then alarms; healthy units left out', () => {
  const assets = [mk('ok', '2027-06-01', 75, []), mk('alarm', '2027-06-01', 75, ['Defect'], 'WTG B02'), mk('late', '2026-10-01', 75, [], 'WTG C01'), mk('soon', '2026-11-10', 75, [], 'WTG A03')];
  const rows = serviceRows(assets, [generator], today);
  assert.deepEqual(rows.map((r) => r.id), ['late', 'alarm', 'soon']);
  assert.match(rows[0].reasons[0], /overdue/);
  assert.equal(rows[1].reasons[0], 'Alarm: Defect');
});

test('refuel planning: turbines only, lowest first', () => {
  const assets = [mk('a', null, 50, [], 'WTG A02'), mk('b', null, 25, [], 'WTG A03'), mk('c', null, 0, [], 'WTG B01'), mk('d', null, 25, [], 'SOV 1', 'SOV'), mk('e', null, 100, [], 'WTG A01')];
  assert.deepEqual(fuelRows(assets, [generator], 50).map((r) => r.id), ['c', 'b', 'a']);
  assert.deepEqual(fuelRows(assets, [generator], 25).map((r) => r.id), ['c', 'b']);
});

test('alertsFor merges check and due warnings', () => {
  const a = mk('x', '2026-11-05', 25, ['Defect']);
  assert.equal(alertsFor(a, generator, today).length, 3);
});
