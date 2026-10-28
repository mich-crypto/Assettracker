import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { evaluateAlerts, normalizeValues, validateFieldDefs } from '../public/js/fields.js';

// The generator definition shipped in the first migration.
const sql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
const generator = JSON.parse(sql.match(/'generator',\s*'Generator',\s*'(\[[\s\S]*?\])'/)[1]);

test('seeded generator type is valid and offers 30 / 350 kVA', () => {
  assert.deepEqual(validateFieldDefs(generator), []);
  assert.deepEqual(generator.find((f) => f.key === 'kva').options, ['30 kVA', '350 kVA']);
});

test('asset scope requires a valid kVA rating', () => {
  assert.ok(normalizeValues(generator, 'asset', {}).errors.kva);
  assert.ok(normalizeValues(generator, 'asset', { kva: '100 kVA' }).errors.kva);
  assert.deepEqual(normalizeValues(generator, 'asset', { kva: '350 kVA', junk: 1 }).values, { kva: '350 kVA' });
});

test('check scope coerces and range-checks values', () => {
  const ok = normalizeValues(generator, 'check', { fuel_level: '42,5', fuel_cube: 'false', alarms: ['Low fuel'] });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.values, { fuel_level: 42.5, fuel_cube: false, alarms: ['Low fuel'] });
  assert.ok(normalizeValues(generator, 'check', { fuel_level: 140, fuel_cube: true }).errors.fuel_level);
  assert.ok(normalizeValues(generator, 'check', { fuel_level: 50 }).errors.fuel_cube, 'fuel cube answer is required');
  assert.ok(normalizeValues(generator, 'check', { fuel_level: 50, fuel_cube: true, alarms: ['Fire'] }).errors.alarms);
});

test('alerts fire on low fuel and on any alarm', () => {
  const alerts = evaluateAlerts(generator, { fuel_level: 10, fuel_cube: true, alarms: ['Overload'] });
  assert.deepEqual(alerts.map((a) => a.key), ['fuel_level', 'alarms']);
  assert.deepEqual(evaluateAlerts(generator, { fuel_level: 80, fuel_cube: false, alarms: [] }), []);
});

test('field definition validation catches mistakes', () => {
  const errors = validateFieldDefs([
    { key: 'Bad Key', label: 'x', type: 'number', scope: 'check' },
    { key: 'pick', label: 'Pick', type: 'select', scope: 'asset', options: [] },
    { key: 'pick', label: 'Dup', type: 'colour', scope: 'nowhere' },
  ]);
  assert.equal(errors.length, 5);
});
