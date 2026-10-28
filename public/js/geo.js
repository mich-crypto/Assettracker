// Location resolution: turns a phone GPS fix into a WTG / SOV suggestion and
// decides whether the fix can be trusted or manual entry is required.
// Shared by the browser (works offline against the cached location list) and tests.

export const DEFAULTS = {
  maxAccuracyM: 150,      // fixes worse than this are treated as unreliable
  farmKm: 30,             // further than this from every WTG => not at the wind farm (shore, train, port)
  implausibleKm: 150,     // further than this from every WTG => likely jamming/spoofing
  maxFixAgeMs: 2 * 60 * 1000,
};

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function validCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0); // 0,0 is a classic bogus/jammed fix
}

/**
 * @param fix        { lat, lon, accuracy, timestamp } or null when no fix was obtained
 * @param locations  [{ id, kind: 'WTG'|'SOV', name, lat, lon, radius_m, active }]
 * @returns {
 *   gpsStatus: 'ok'|'poor_accuracy'|'no_fix'|'implausible',
 *   requiresManual: boolean,   // true => the user must pick the location themselves
 *   suggestion: location|null, // best guess (WTG in range, else the SOV)
 *   elsewhere: boolean,        // fix is away from the wind farm: use the phone's own position
 *   distanceM: number|null,    // fix -> suggested WTG
 *   nearest: [{ location, distanceM }] // WTGs by distance, for the picker
 *   reason: string
 * }
 */
export function resolveLocation(fix, locations, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const active = locations.filter((l) => l.active !== 0 && l.active !== false);
  const wtgs = active.filter((l) => l.kind === 'WTG' && validCoord(l.lat, l.lon));
  const sovs = active.filter((l) => l.kind === 'SOV');
  const soleSov = sovs.length === 1 ? sovs[0] : null;

  const result = (gpsStatus, extra) => ({
    gpsStatus,
    requiresManual: gpsStatus !== 'ok',
    suggestion: null,
    distanceM: null,
    nearest: [],
    elsewhere: false,
    ...extra,
  });

  if (!fix || !validCoord(fix.lat, fix.lon)) {
    return result('no_fix', { reason: 'No GPS position available (possible jamming). Select the location manually.' });
  }
  const now = o.now ?? Date.now();
  if (fix.timestamp && now - fix.timestamp > o.maxFixAgeMs) {
    return result('no_fix', { reason: 'GPS position is outdated. Select the location manually.' });
  }

  const nearest = wtgs
    .map((l) => ({ location: l, distanceM: distanceM(fix.lat, fix.lon, l.lat, l.lon) }))
    .sort((a, b) => a.distanceM - b.distanceM);

  if (nearest.length && nearest[0].distanceM > o.implausibleKm * 1000) {
    return result('implausible', {
      nearest,
      elsewhere: true,
      reason: `GPS position is ${Math.round(nearest[0].distanceM / 1000)} km from the nearest WTG (possible jamming/spoofing). Select the location manually.`,
    });
  }

  const inRange = nearest.find((n) => n.distanceM <= (n.location.radius_m || 300));
  const poor = fix.accuracy != null && fix.accuracy > o.maxAccuracyM;

  if (poor) {
    return result('poor_accuracy', {
      nearest,
      suggestion: inRange ? inRange.location : soleSov,
      distanceM: inRange ? inRange.distanceM : null,
      reason: `GPS accuracy is ±${Math.round(fix.accuracy)} m. Confirm or select the location manually.`,
    });
  }

  if (inRange) {
    return result('ok', {
      nearest,
      suggestion: inRange.location,
      distanceM: inRange.distanceM,
      reason: `At ${inRange.location.name} (${Math.round(inRange.distanceM)} m from turbine position).`,
    });
  }

  // Well away from the farm (on shore, in a train): the phone's position is the location.
  if (nearest.length && nearest[0].distanceM > o.farmKm * 1000) {
    return result('ok', {
      nearest,
      elsewhere: true,
      reason: `Not at the wind farm (${Math.round(nearest[0].distanceM / 1000)} km from the nearest WTG). Saved at the phone's GPS position.`,
    });
  }

  // Not at any turbine but within the farm: the asset is on the vessel.
  if (soleSov) {
    return result('ok', { nearest, suggestion: soleSov, reason: `Not near a WTG - assumed on board ${soleSov.name}.` });
  }
  return {
    ...result('ok', { nearest }),
    requiresManual: true,
    reason: sovs.length ? 'Not near a WTG. Select which vessel you are on.' : 'Not near any known WTG. Select the location manually.',
  };
}
