import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTemplate, matchOption, parseAssetRows, parseDate } from '../public/js/importer.js';

const types = [
  { id: 'generator', name: 'Generator', fields: [
    { key: 'kva', label: 'Rating', type: 'select', scope: 'asset', required: true, options: ['30 kVA', '350 kVA'] },
    { key: 'manufacturer', label: 'Manufacturer', type: 'text', scope: 'asset' },
    { key: 'inspection_due', label: 'Lifting points inspection due', type: 'date', scope: 'asset', required: true },
    { key: 'fuel_level', label: 'Fuel level', type: 'number', scope: 'check' },
  ] },
  { id: 'fuel-cube', name: 'Fuel cube', fields: [
    { key: 'size', label: 'Size', type: 'select', scope: 'asset', required: true, options: ['Large', 'Small'] },
    { key: 'inspection_due', label: 'Lifting points inspection due', type: 'date', scope: 'asset', required: true },
  ] },
];

test('ratings are matched loosely', () => {
  const o = ['30 kVA', '350 kVA'];
  assert.equal(matchOption(o, '350'), '350 kVA');
  assert.equal(matchOption(o, '350kva'), '350 kVA');
  assert.equal(matchOption(o, ' 30 KVA '), '30 kVA');
  assert.equal(matchOption(['Large', 'Small'], 'lar'), 'Large');
  assert.equal(matchOption(o, '100'), '100');   // unknown stays as typed, validation reports it
});

test('dates: European day-first, ISO, Excel serial; invalid stays as typed', () => {
  assert.equal(parseDate('31-12-2026'), '2026-12-31');
  assert.equal(parseDate('05/03/2027'), '2027-03-05');
  assert.equal(parseDate('7.8.27'), '2027-08-07');
  assert.equal(parseDate('2026-12-31'), '2026-12-31');
  assert.equal(parseDate('46387'), '2026-12-31');
  assert.equal(parseDate('31-02-2026'), '31-02-2026');
  assert.equal(parseDate(''), '');
});

test('template has one column per fixed detail and an example per type', () => {
  const t = buildTemplate(types).split('\r\n');
  assert.equal(t[0], 'Equipment type,Serial number,Rating,Manufacturer,Lifting points inspection due,Size');
  assert.match(t[1], /^Generator,SN-001,30 kVA,,31-12-2026,$/);
  assert.match(t[2], /^Fuel cube,SN-002,,,31-12-2026,Large$/);
});

test('reading a filled-in list', () => {
  const csv = 'Equipment type;Serial number;Rating;Lifting points inspection due;Size;Manufacturer\n' +
    'generator;gen-001;350;31-12-2026;;Cummins\n' +
    'Fuel cube;fc-1;;05/03/2027;small;\n' +
    'Pump;x1;;;;\n' +
    'Generator;;30;31-12-2026;;\n' +
    'Generator;gen-001;30;31-12-2026;;\n' +
    'Generator;gen-002;100;31-12-2026;;\n' +
    'Generator;gen-003;30;;;';
  const r = parseAssetRows(csv, types);
  assert.deepEqual(r.rows.map((x) => [x.type_id, x.serial]), [['generator', 'GEN-001'], ['fuel-cube', 'FC-1']]);
  assert.deepEqual(r.rows[0].attributes, { kva: '350 kVA', manufacturer: 'Cummins', inspection_due: '2026-12-31' });
  assert.deepEqual(r.rows[1].attributes, { size: 'Small', inspection_due: '2027-03-05' });
  const msgs = r.problems.map((p) => `${p.line}:${p.error}`).join(' | ');
  assert.match(msgs, /4:Unknown equipment type "Pump"/);
  assert.match(msgs, /5:Serial number is empty/);
  assert.match(msgs, /6:GEN-001 appears twice/);
  assert.match(msgs, /7:GEN-002: Rating must be one of/);
  assert.match(msgs, /8:GEN-003: Lifting points inspection due is required/);
});

test('missing columns are explained', () => {
  assert.match(parseAssetRows('a,b\n1,2', types).problems[0].error, /Equipment type.*Serial number/);
  assert.match(parseAssetRows('', types).problems[0].error, /empty/);
});

test('headers only need to be part of the field label', () => {
  const types = [{ id: 'g', name: 'Generator', fields: [
    { key: 'kva', label: 'Rating', type: 'select', scope: 'asset', required: true, options: ['30 kVA', '350 kVA'] },
    { key: 'inspection_due', label: 'Lifting points inspection due', type: 'date', scope: 'asset', required: true }] }];
  const r = parseAssetRows('type,serial,rating,inspection due\nGenerator,G-1,350,31-12-2027', types);
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].attributes.inspection_due, '2027-12-31');
});
