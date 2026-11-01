// Linking equipment that works together, e.g. a generator and the fuel cube
// feeding it. A yes/no check field with `pairWith: '<type id>'` (generator:
// "Fuel cube connected") asks to scan that other unit when answered Yes, and
// scanning the other unit asks for the generator - unless both are already
// known to be together at this location.
//
// Pure functions over the offline data, shared by the field app and tests.

/**
 * How a type pairs with others.
 * forward: this type has the yes/no field (generator -> fuel cube).
 * reverse: another type's field points at this one (fuel cube -> generator).
 */
export function pairingFor(types, type) {
  if (!type) return null;
  const field = type.fields.find((f) => f.scope === 'check' && f.type === 'boolean' && f.pairWith);
  if (field) {
    const partnerType = types.find((t) => t.id === field.pairWith);
    return partnerType ? { direction: 'forward', field, partnerType } : null;
  }
  for (const t of types) {
    const f = t.fields.find((x) => x.scope === 'check' && x.type === 'boolean' && x.pairWith === type.id);
    if (f) return { direction: 'reverse', field: f, partnerType: t };
  }
  return null;
}

/**
 * Latest known { location_id, linked_asset_id, at } for a unit: the server
 * snapshot, overridden by newer readings still waiting in the phone's outbox.
 */
export function lastState(assetId, assets, pending = []) {
  const a = assets.find((x) => x.id === assetId);
  let st = a?.state || null;
  for (const r of pending) {
    if (r.asset_id !== assetId || r.rejected) continue;
    if (!st || r.recorded_at > st.at) st = { location_id: r.location_id, linked_asset_id: r.linked_asset_id ?? null, at: r.recorded_at };
  }
  return st;
}

/**
 * The partner unit this one is already known to be connected to at this
 * location, or null. Both must point at each other (a generator that was since
 * linked to another fuel cube no longer counts) and the partner must be here.
 */
export function knownPartner(asset, locationId, assets, pending = []) {
  if (!asset || !locationId) return null;
  const own = lastState(asset.id, assets, pending);
  const id = own?.linked_asset_id;
  if (!id) return null;
  const partner = assets.find((x) => x.id === id);
  const st = lastState(id, assets, pending);
  return partner && st?.linked_asset_id === asset.id && st.location_id === locationId ? partner : null;
}
