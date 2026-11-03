import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLines, duePeriods, fmtMoney, invoiceNumber, monthLabel, nextMonth, parseMoney, totals, validLines, addDays } from '../public/js/billing.js';

test('duePeriods bills the current month in advance and catches up', () => {
  assert.deepEqual(duePeriods({ start: '2026-11-15', today: '2026-11-03' }), []);
  assert.deepEqual(duePeriods({ start: '2026-11-03', today: '2026-11-03' }), ['2026-11']);
  assert.deepEqual(duePeriods({ start: '2026-09-10', today: '2026-11-03' }), ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(duePeriods({ start: '2026-09-10', today: '2026-11-03', existing: ['2026-09', '2026-11'] }), ['2026-10']);
  assert.deepEqual(duePeriods({ start: '2026-09-10', end: '2026-10-20', today: '2026-12-01' }), ['2026-09', '2026-10']);
  assert.equal(duePeriods({ start: '2020-01-01', today: '2026-11-03' }).length, 12);
});
test('months and dates', () => {
  assert.equal(nextMonth('2026-12'), '2027-01');
  assert.equal(monthLabel('2026-11'), 'November 2026');
  assert.equal(addDays('2026-12-20', 30), '2027-01-19');
});
test('startup fee only on the first month', () => {
  const p = { name: 'Baltic', billing_start: '2026-09-10', billing_startup_cents: 100000, billing_monthly_cents: 25000 };
  assert.equal(buildLines({ project: p, period: '2026-09' }).length, 2);
  assert.equal(buildLines({ project: p, period: '2026-10' }).length, 1);
  assert.equal(buildLines({ project: { ...p, billing_monthly_cents: 0 }, period: '2026-10' }).length, 0);
});
test('totals and VAT modes', () => {
  const lines = [{ description: 'a', qty: 1, unit_cents: 100000 }, { description: 'b', qty: 2, unit_cents: 12550 }];
  assert.deepEqual(totals(lines, 21, 'standard'), { subtotal_cents: 125100, vat_percent: 21, vat_cents: 26271, total_cents: 151371, vat_note: null });
  const r = totals(lines, 21, 'reverse');
  assert.equal(r.vat_cents, 0); assert.equal(r.total_cents, 125100); assert.match(r.vat_note, /reverse/);
});
test('invoice numbers and money', () => {
  assert.equal(invoiceNumber('', 2026, 7), '2026-0007');
  assert.equal(invoiceNumber('AT-', 2026, 12), 'AT-2026-0012');
  assert.match(fmtMoney(125000, 'EUR'), /1,250\.00/);
  for (const [t, c] of [['1250', 125000], ['1.250,50', 125050], ['1,250.50', 125050], ['12,5', 1250], ['€ 99', 9900], ['1,250', 125000], ['abc', null], ['', null]]) assert.equal(parseMoney(t), c, t);
});
test('validLines', () => {
  assert.ok(validLines([]));
  assert.ok(validLines([{ description: '', qty: 1, unit_cents: 1 }]));
  assert.ok(validLines([{ description: 'x', qty: 0, unit_cents: 1 }]));
  assert.equal(validLines([{ description: 'x', qty: 1, unit_cents: 100 }]), null);
});
