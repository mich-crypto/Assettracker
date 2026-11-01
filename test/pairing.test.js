import assert from 'node:assert/strict';
import { test } from 'node:test';
import { knownPartner, lastState, pairingFor } from '../public/js/pairing.js';

const generator = { id: 'generator', name: 'Generator', fields: [
  { key: 'fuel_cube', label: 'Fuel cube connected', type: 'boolean', scope: 'check', sovValue: false, pairWith: 'fuel-cube' },
] };
const cube = { id: 'fuel-cube', name: 'Fuel cube', fields: [{ key: 'fuel_level', label: 'Fuel level', type: 'number', scope: 'check' }] };
const light = { id: 'light', name: 'Light tower', fields: [] };
const types = [generator, cube, light];

const at = (h) => new Date(Date.UTC(2026, 10, 1, h)).toISOString();
const G = { id: 'g1', state: { location_id: 'A03', linked_asset_id: 'c1', at: at(8) } };
const C = { id: 'c1', state: { location_id: 'A03', linked_asset_id: 'g1', at: at(8) } };
const G2 = { id: 'g2', state: { location_id: 'B01', linked_asset_id: null, at: at(8) } };

test('pairing direction: generator asks for the fuel cube, fuel cube asks for the generator', () => {
  assert.equal(pairingFor(types, generator).direction, 'forward');
  assert.equal(pairingFor(types, generator).partnerType.id, 'fuel-cube');
  assert.equal(pairingFor(types, cube).direction, 'reverse');
  assert.equal(pairingFor(types, cube).partnerType.id, 'generator');
  assert.equal(pairingFor(types, light), null);
});

test('known together at the same WTG -> no need to scan the partner', () => {
  assert.equal(knownPartner(C, 'A03', [G, C, G2])?.id, 'g1');
  assert.equal(knownPartner(G, 'A03', [G, C, G2])?.id, 'c1');
});

test('not known together elsewhere or when not linked', () => {
  assert.equal(knownPartner(C, 'B01', [G, C, G2]), null, 'cube is now at another WTG');
  assert.equal(knownPartner(G2, 'B01', [G, C, G2]), null, 'generator without a cube');
});

test('readings still queued on the phone count (offline)', () => {
  const C2 = { id: 'c2', state: null };
  const pending = [
    { asset_id: 'g2', location_id: 'B01', linked_asset_id: 'c2', recorded_at: at(9) },
    { asset_id: 'c2', location_id: 'B01', linked_asset_id: 'g2', recorded_at: at(9) },
  ];
  assert.equal(lastState('g2', [G2], pending).linked_asset_id, 'c2');
  assert.equal(knownPartner(C2, 'B01', [G2, C2], pending)?.id, 'g2');
  // a newer queued reading that moved the generator away breaks the pair
  const moved = [...pending, { asset_id: 'g2', location_id: 'C04', linked_asset_id: null, recorded_at: at(10) }];
  assert.equal(knownPartner(C2, 'B01', [G2, C2], moved), null);
});

test('a generator re-linked to another fuel cube is no longer with the old one', () => {
  const G3 = { id: 'g3', state: { location_id: 'A03', linked_asset_id: 'c9', at: at(10) } }; // now on cube c9
  const Cold = { id: 'c8', state: { location_id: 'A03', linked_asset_id: 'g3', at: at(8) } };
  const Cnew = { id: 'c9', state: { location_id: 'A03', linked_asset_id: 'g3', at: at(10) } };
  assert.equal(knownPartner(Cold, 'A03', [G3, Cold, Cnew]), null);
  assert.equal(knownPartner(Cnew, 'A03', [G3, Cold, Cnew])?.id, 'g3');
});
