import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedBy, conditionOf, effectiveCheck, alertsFor } from '../public/js/equipment.js';

const type = { id: 'g', name: 'Generator', fields: [
  { key: 'inspection_due', label: 'Lifting points inspection due', type: 'date', scope: 'asset', dueWarnDays: 30 },
  { key: 'alarms', label: 'Alarms', type: 'multiselect', scope: 'check', options: ['a'], alert: { any: true } },
] };
const today = new Date(2026, 10, 4);

test('defect and overdue inspection block use', () => {
  assert.equal(blockedBy({ attributes: { inspection_due: '2027-01-01' } }, type, today), null);
  assert.equal(blockedBy({ defect: 1, defect_note: 'leak', attributes: {} }, type, today).kind, 'defect');
  assert.equal(blockedBy({ attributes: { inspection_due: '2026-11-03' } }, type, today).kind, 'expired');
  assert.equal(blockedBy({ attributes: { inspection_due: '2026-11-04' } }, type, today), null); // due today is still allowed
});
test('condition: red, orange, ok', () => {
  assert.equal(conditionOf({ defect: 1, attributes: {} }, type, today), 'blocked');
  assert.equal(conditionOf({ attributes: { inspection_due: '2026-11-20' } }, type, today), 'warning');
  assert.equal(conditionOf({ attributes: { inspection_due: '2028-01-01' } }, type, today), 'ok');
});
test('a service after the last scan clears its alarms', () => {
  const a = { attributes: {}, check: { recorded_at: '2026-11-01T10:00:00Z', data: { alarms: ['a'] } } };
  assert.equal(alertsFor(a, type, today).length, 1);
  assert.equal(alertsFor({ ...a, serviced_at: '2026-11-02T10:00:00Z' }, type, today).length, 0);
  assert.equal(effectiveCheck({ ...a, serviced_at: '2026-10-30T10:00:00Z' }, type).data.alarms.length, 1);
});

test('a refuel after the last scan clears a low fuel alarm but keeps other alarms', () => {
  const t = { fields: [{ key: 'alarms', label: 'Alarms', type: 'multiselect', scope: 'check', options: ['Low fuel', 'Overload'], alert: { any: true } }] };
  const a = { attributes: {}, check: { recorded_at: '2026-11-01T10:00:00Z', data: { alarms: ['Low fuel', 'Overload'] } }, refueled_at: '2026-11-02T10:00:00Z' };
  assert.deepEqual(effectiveCheck(a, t).data.alarms, ['Overload']);
  assert.deepEqual(effectiveCheck({ ...a, refueled_at: '2026-10-30T10:00:00Z' }, t).data.alarms, ['Low fuel', 'Overload']);
});
