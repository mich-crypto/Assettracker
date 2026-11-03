import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCoordinate, parseLocationRows, parseTable } from '../public/js/coords.js';

test('coordinates in the notations clients use', () => {
  assert.equal(parseCoordinate('54.0123'), 54.0123);
  assert.equal(parseCoordinate('54,0123'), 54.0123);
  assert.equal(parseCoordinate('-6.5'), -6.5);
  assert.equal(parseCoordinate('54.5 N'), 54.5);
  assert.equal(parseCoordinate('6.25 W'), -6.25);
  assert.equal(parseCoordinate("54°30'N"), 54.5);
  assert.equal(parseCoordinate("54°00.738'N"), 54.0123);
  assert.equal(parseCoordinate('N54 0 44.28'), 54.0123);
  assert.equal(parseCoordinate("54°00'44.28\"N"), 54.0123);
  assert.equal(parseCoordinate("6°32'E"), 6.5333333);
});

test('things that are not coordinates', () => {
  for (const bad of ['', null, 'abc', '54.x', "54°75'", '1 2 3 4', 'WTG A01']) assert.equal(parseCoordinate(bad), null, String(bad));
});

test('tables: delimiter detection and quotes', () => {
  assert.deepEqual(parseTable('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseTable('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseTable('"WTG, A01",54.1,6.2\r\n'), [['WTG, A01', '54.1', '6.2']]);
});

test('turbine list with a header, mixed notations and a vessel', () => {
  const csv = "Name;Latitude;Longitude;Kind\nWTG A01;54,0123;6,5432;\nWTG A02;54°00.800'N;6°32.600'E;WTG\nSOV Windea;;;SOV\n";
  const r = parseLocationRows(csv);
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].lat, 54.0123);
  assert.ok(Math.abs(r.rows[1].lon - 6.5433333) < 1e-6);
  assert.equal(r.rows[2].kind, 'SOV');
});

test('turbine list without a header', () => {
  const r = parseLocationRows('WTG 1,54.1,6.1\nWTG 2,54.2,6.2');
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.problems, []);
});

test('problems block the import: swapped columns, duplicates, empty names, 0,0', () => {
  const r = parseLocationRows('name,lat,lon\nA01,6.5,54.1\nA02,95,6\nA03,54,6\nA03,54,6\n,54,6\nA05,0,0\nA06,x,y');
  const msgs = r.problems.map((p) => p.error).join(' | ');
  assert.equal(r.rows.length, 2);           // A01 (valid numbers, even if swapped) and A03
  assert.match(msgs, /A02: latitude 95 is out of range/);
  assert.match(msgs, /A03 appears twice/);
  assert.match(msgs, /Name is empty/);
  assert.match(msgs, /A05: position 0, 0/);
  assert.match(msgs, /A06: cannot read/);
});

test('a turbine far from the others gets a warning', () => {
  const r = parseLocationRows('a,54.00,6.00\nb,54.01,6.01\nc,54.02,6.02\nd,48.00,2.00');
  assert.equal(r.problems.length, 0);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].warning, /^d is \d+ km/);
});
