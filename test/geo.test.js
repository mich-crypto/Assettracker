import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceM, resolveLocation } from '../public/js/geo.js';

const now = Date.now();
const locations = [
  { id: 'a01', kind: 'WTG', name: 'WTG A01', lat: 54.0, lon: 6.0, radius_m: 300, active: 1 },
  { id: 'a02', kind: 'WTG', name: 'WTG A02', lat: 54.0, lon: 6.02, radius_m: 300, active: 1 }, // ~1.3 km east
  { id: 'sov', kind: 'SOV', name: 'SOV Windea', lat: null, lon: null, radius_m: 300, active: 1 },
];
const fix = (lat, lon, accuracy = 10) => ({ lat, lon, accuracy, timestamp: now });

test('distanceM is roughly right', () => {
  const d = distanceM(54, 6, 54, 6.02);
  assert.ok(d > 1250 && d < 1350, `got ${d}`);
});

test('fix within a WTG radius resolves to that WTG', () => {
  const r = resolveLocation(fix(54.001, 6.0), locations, { now });
  assert.equal(r.gpsStatus, 'ok');
  assert.equal(r.requiresManual, false);
  assert.equal(r.suggestion.id, 'a01');
  assert.ok(r.distanceM < 150);
});

test('fix away from every WTG resolves to the only SOV', () => {
  const r = resolveLocation(fix(54.05, 6.1), locations, { now });
  assert.equal(r.gpsStatus, 'ok');
  assert.equal(r.suggestion.id, 'sov');
  assert.equal(r.requiresManual, false);
});

test('with several SOVs and no WTG nearby the user must pick', () => {
  const two = [...locations, { id: 'sov2', kind: 'SOV', name: 'SOV Two', active: 1 }];
  const r = resolveLocation(fix(54.05, 6.1), two, { now });
  assert.equal(r.requiresManual, true);
  assert.equal(r.suggestion, null);
});

test('no fix (jamming) requires manual entry', () => {
  const r = resolveLocation(null, locations, { now });
  assert.equal(r.gpsStatus, 'no_fix');
  assert.equal(r.requiresManual, true);
});

test('0,0 and stale fixes count as no fix', () => {
  assert.equal(resolveLocation(fix(0, 0), locations, { now }).gpsStatus, 'no_fix');
  const old = { ...fix(54.001, 6.0), timestamp: now - 10 * 60 * 1000 };
  assert.equal(resolveLocation(old, locations, { now }).gpsStatus, 'no_fix');
});

test('fix hundreds of km away (spoofing) is implausible', () => {
  const r = resolveLocation(fix(48.85, 2.35), locations, { now });
  assert.equal(r.gpsStatus, 'implausible');
  assert.equal(r.requiresManual, true);
  assert.equal(r.nearest[0].location.id, 'a01');
});

test('poor accuracy suggests but still requires confirmation', () => {
  const r = resolveLocation(fix(54.001, 6.0, 800), locations, { now });
  assert.equal(r.gpsStatus, 'poor_accuracy');
  assert.equal(r.requiresManual, true);
  assert.equal(r.suggestion.id, 'a01');
});

test('inactive locations are ignored', () => {
  const r = resolveLocation(fix(54.001, 6.0), locations.map((l) => (l.id === 'a01' ? { ...l, active: 0 } : l)), { now });
  assert.equal(r.suggestion.id, 'sov');
});

test('fix on shore near the farm is elsewhere (phone position), not the SOV', () => {
  const coast = resolveLocation(fix(53.6, 6.6), locations, { now }); // ~58 km from A01
  assert.equal(coast.gpsStatus, 'ok');
  assert.equal(coast.elsewhere, true);
  assert.equal(coast.suggestion, null);
  assert.equal(coast.requiresManual, false);
});

test('implausibly far fix is also flagged elsewhere so it can be kept if intended', () => {
  const r = resolveLocation(fix(53.55, 9.99), locations, { now }); // Hamburg, ~260 km
  assert.equal(r.gpsStatus, 'implausible');
  assert.equal(r.elsewhere, true);
});
