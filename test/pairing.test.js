import assert from 'node:assert/strict';
import { test } from 'node:test';
import { knownPartners, knownPartnerOfType, lastState, pairingsFor } from '../public/js/pairing.js';

const generator = { id: 'generator', name: 'Generator', fields: [
  { key: 'fuel_cube', label: 'Fuel cube connected', type: 'boolean', scope: 'check', sovValue: false, pairWith: 'fuel-cube' },
] };
const cube = { id: 'fuel-cube', name: 'Fuel cube', fields: [{ key: 'fuel_level', label: 'Fuel level', type: 'number', scope: 'check' }] };
const light = { id: 'light', name: 'Light tower', fields: [] };
const types = [generator, cube, light];

const at = (h) => new Date(Date.UTC(2026, 10, 1, h)).toISOString();
const G = { id: 'g1', state: { location_id: 'A03', linked_asset_ids: ['c1'], at: at(8) } };
const C = { id: 'c1', state: { location_id: 'A03', linked_asset_ids: ['g1'], at: at(8) } };
const G2 = { id: 'g2', state: { location_id: 'B01', linked_asset_ids: [], at: at(8) } };

test('pairing direction: generator asks for the fuel cube, fuel cube asks for the generator', () => {
  assert.equal(pairingsFor(types, generator).forward[0].partnerType.id, 'fuel-cube');
  assert.equal(pairingsFor(types, cube).reverse.partnerType.id, 'generator');
  assert.deepEqual(pairingsFor(types, light), { forward: [], reverse: null });
});

test('a hybrid generator pairs with a fuel cube and a battery pack', () => {
  const hybrid = { id: 'hybrid', name: 'Hybrid', fields: [
    { key: 'fuel_cube', type: 'boolean', scope: 'check', pairWith: 'fuel-cube' }, { key: 'battery_pack', type: 'boolean', scope: 'check', pairWith: 'battery-pack' }] };
  const pack = { id: 'battery-pack', name: 'Battery pack', fields: [] };
  const all = [hybrid, cube, pack];
  assert.deepEqual(pairingsFor(all, hybrid).forward.map((p) => p.partnerType.id), ['fuel-cube', 'battery-pack']);
  assert.equal(pairingsFor(all, pack).reverse.partnerType.id, 'hybrid');
});

test('a whole setup is known together at the turbine, and only there', () => {
  const H = { id: 'h', type_id: 'hybrid', state: { location_id: 'A03', linked_asset_ids: ['c', 'b'], at: at(8) } };
  const Cc = { id: 'c', type_id: 'fuel-cube', state: { location_id: 'A03', linked_asset_ids: ['h', 'b'], at: at(8) } };
  const B = { id: 'b', type_id: 'battery-pack', state: { location_id: 'A03', linked_asset_ids: ['h', 'c'], at: at(8) } };
  assert.deepEqual(knownPartners(H, 'A03', [H, Cc, B]).map((x) => x.id).sort(), ['b', 'c']);
  assert.equal(knownPartnerOfType(B, 'A03', 'hybrid', [H, Cc, B])?.id, 'h');
  // back on the vessel they are separate: the battery pack was scanned alone on the SOV
  const B2 = { ...B, state: { location_id: 'SOV', linked_asset_ids: [], at: at(12) } };
  assert.deepEqual(knownPartners(H, 'A03', [H, Cc, B2]).map((x) => x.id), ['c']);
  assert.deepEqual(knownPartners(B2, 'SOV', [H, Cc, B2]), []);
});

test('known together at the same WTG -> no need to scan the partner', () => {
  assert.equal(knownPartners(C, 'A03', [G, C, G2])[0]?.id, 'g1');
  assert.equal(knownPartners(G, 'A03', [G, C, G2])[0]?.id, 'c1');
});

test('not known together elsewhere or when not linked', () => {
  assert.deepEqual(knownPartners(C, 'B01', [G, C, G2]), [], 'cube is now at another WTG');
  assert.deepEqual(knownPartners(G2, 'B01', [G, C, G2]), [], 'generator without a cube');
});

test('readings still queued on the phone count (offline)', () => {
  const C2 = { id: 'c2', state: null };
  const pending = [
    { asset_id: 'g2', location_id: 'B01', linked_asset_ids: ['c2'], recorded_at: at(9) },
    { asset_id: 'c2', location_id: 'B01', linked_asset_ids: ['g2'], recorded_at: at(9) },
  ];
  assert.deepEqual(lastState('g2', [G2], pending).linked_asset_ids, ['c2']);
  assert.equal(knownPartners(C2, 'B01', [G2, C2], pending)[0]?.id, 'g2');
  // a newer queued reading that moved the generator away breaks the pair
  const moved = [...pending, { asset_id: 'g2', location_id: 'C04', linked_asset_ids: [], recorded_at: at(10) }];
  assert.deepEqual(knownPartners(C2, 'B01', [G2, C2], moved), []);
});

test('a generator re-linked to another fuel cube is no longer with the old one', () => {
  const G3 = { id: 'g3', state: { location_id: 'A03', linked_asset_ids: ['c9'], at: at(10) } }; // now on cube c9
  const Cold = { id: 'c8', state: { location_id: 'A03', linked_asset_id: 'g3', at: at(8) } };
  const Cnew = { id: 'c9', state: { location_id: 'A03', linked_asset_id: 'g3', at: at(10) } };
  assert.deepEqual(knownPartners(Cold, 'A03', [G3, Cold, Cnew]), []);
  assert.equal(knownPartners(Cnew, 'A03', [G3, Cold, Cnew])[0]?.id, 'g3');
});
