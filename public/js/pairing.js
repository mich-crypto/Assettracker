// Linking equipment that works together. A hybrid setup is three units: the generator, a battery pack
// and a fuel cube. On a turbine they are always together; on the vessel they are separate items.
//
// A yes/no check field with `pairWith: '<type id>'` on the generator ("Fuel cube connected",
// "Battery pack connected") asks to scan that other unit when answered Yes. Scanning the other unit
// asks for the generator, unless it is already known to be together with it at this location.
//
// Pure functions over the offline data, shared by the field app, the lists and the tests.

/**
 * How a type pairs with others.
 * forward: this type has yes/no fields that point at other types (generator -> fuel cube, battery pack).
 * reverse: another type's field points at this one (fuel cube -> generator).
 * Returns { forward: [{ field, partnerType }], reverse: { field, partnerType } | null }.
 */
export function pairingsFor(types, type) {
  const none = { forward: [], reverse: null };
  if (!type) return none;
  const forward = type.fields
    .filter((f) => f.scope === 'check' && f.type === 'boolean' && f.pairWith)
    .map((field) => ({ field, partnerType: types.find((t) => t.id === field.pairWith) }))
    .filter((p) => p.partnerType);
  if (forward.length) return { forward, reverse: null };
  for (const t of types) {
    const f = t.fields.find((x) => x.scope === 'check' && x.type === 'boolean' && x.pairWith === type.id);
    if (f) return { forward: [], reverse: { field: f, partnerType: t } };
  }
  return none;
}

const idsOf = (st) => st?.linked_asset_ids ?? (st?.linked_asset_id ? [st.linked_asset_id] : []);

/**
 * Latest known { location_id, linked_asset_ids, at } for a unit: the server snapshot,
 * overridden by newer readings still waiting in the phone's outbox.
 */
export function lastState(assetId, assets, pending = []) {
  const a = assets.find((x) => x.id === assetId);
  let st = a?.state ? { ...a.state, linked_asset_ids: idsOf(a.state) } : null;
  for (const r of pending) {
    if (r.asset_id !== assetId || r.rejected) continue;
    if (!st || r.recorded_at > st.at) st = { location_id: r.location_id, linked_asset_ids: idsOf(r), at: r.recorded_at };
  }
  return st;
}

/**
 * The units this one is already known to be connected to at this location. Both must point at
 * each other (a generator that was since linked to another fuel cube no longer counts) and the
 * partner must be here.
 */
export function knownPartners(asset, locationId, assets, pending = []) {
  if (!asset || !locationId) return [];
  const own = lastState(asset.id, assets, pending);
  const out = [];
  for (const id of own?.linked_asset_ids ?? []) {
    const partner = assets.find((x) => x.id === id);
    const st = lastState(id, assets, pending);
    if (partner && st?.location_id === locationId && st.linked_asset_ids.includes(asset.id)) out.push(partner);
  }
  return out;
}

/** The first known partner of a given type, or null. */
export const knownPartnerOfType = (asset, locationId, typeId, assets, pending = []) =>
  knownPartners(asset, locationId, assets, pending).find((p) => p.type_id === typeId) || null;
