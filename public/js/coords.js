// Reading a turbine list (CSV or pasted from Excel): names plus coordinates in
// whatever notation the client used. Pure functions, shared with tests.
import { distanceM } from './geo.js';

/**
 * One coordinate to decimal degrees. Accepts 54.0123 · 54,0123 · -54.0123 · 54.0123 N ·
 * 54°00.738'N · 54 00.738 N · 54°00'44.3"N · N54 0 44.3. Returns null when it cannot be read.
 */
export function parseCoordinate(input) {
  if (input == null) return null;
  const text = String(input).trim();
  if (!text) return null;
  const hemi = text.match(/[NSEWO]/i);
  const h = hemi ? hemi[0].toUpperCase() : '';
  const nums = text.replace(/[NSEWO]/gi, ' ').match(/\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length > 3) return null;
  // The rest of the text may only be separators and degree/minute/second marks.
  const rest = text.replace(/[NSEWO]/gi, '').replace(/\d+(?:[.,]\d+)?/g, '').replace(/[\s°'’′"”″,.:dDmMsS-]/g, '');
  if (rest) return null;
  const [d, m = 0, s = 0] = nums.map((n) => Number(n.replace(',', '.')));
  if (m >= 60 || s >= 60) return null;
  let value = d + m / 60 + s / 3600;
  const negative = /^\s*-/.test(text) || h === 'S' || h === 'W';
  if (negative) value = -value;
  return Math.round(value * 1e7) / 1e7;
}

/** Splits CSV/TSV text into rows of cells; delimiter is detected, quotes are respected. */
export function parseTable(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
  return rows;
}

const HEADER_NAMES = {
  name: ['name', 'wtg', 'turbine', 'location', 'id', 'wtg id', 'wtg name'],
  lat: ['lat', 'latitude', 'y'],
  lon: ['lon', 'lng', 'long', 'longitude', 'x'],
  kind: ['kind', 'type'],
};

function mapHeader(cells) {
  const map = {};
  cells.forEach((c, i) => {
    const key = c.toLowerCase();
    for (const [field, names] of Object.entries(HEADER_NAMES)) if (names.includes(key) && map[field] == null) map[field] = i;
  });
  return map.name != null && map.lat != null && map.lon != null ? map : null;
}

/**
 * Turbine / vessel list -> { rows, problems, warnings }.
 * Columns: name, latitude, longitude[, kind]. With or without a header line.
 * rows: [{ line, name, kind, lat, lon }]; problems block the import, warnings do not.
 */
export function parseLocationRows(text) {
  const table = parseTable(text);
  const rows = [];
  const problems = [];
  const warnings = [];
  if (!table.length) return { rows, problems: [{ line: 0, error: 'Nothing to import' }], warnings };
  let map = mapHeader(table[0]);
  const start = map ? 1 : 0;
  if (!map) map = { name: 0, lat: 1, lon: 2, kind: 3 };
  const seen = new Set();
  for (let i = start; i < table.length; i++) {
    const cells = table[i];
    const line = i + 1;
    const name = (cells[map.name] || '').trim();
    const kindRaw = (cells[map.kind] || '').trim().toUpperCase();
    const kind = kindRaw === 'SOV' || kindRaw.startsWith('VESSEL') ? 'SOV' : 'WTG';
    if (!name) { problems.push({ line, error: 'Name is empty' }); continue; }
    if (seen.has(name.toLowerCase())) { problems.push({ line, error: `${name} appears twice` }); continue; }
    seen.add(name.toLowerCase());
    if (kind === 'SOV') { rows.push({ line, name, kind, lat: null, lon: null }); continue; }
    const lat = parseCoordinate(cells[map.lat]);
    const lon = parseCoordinate(cells[map.lon]);
    if (lat == null || lon == null) { problems.push({ line, error: `${name}: cannot read the coordinates "${cells[map.lat] ?? ''}" / "${cells[map.lon] ?? ''}"` }); continue; }
    if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) { problems.push({ line, error: `${name}: latitude ${lat} is out of range (latitude and longitude swapped?)` }); continue; }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { problems.push({ line, error: `${name}: coordinates are out of range` }); continue; }
    if (lat === 0 && lon === 0) { problems.push({ line, error: `${name}: position 0, 0 is not a real location` }); continue; }
    rows.push({ line, name, kind, lat, lon });
  }
  // A turbine far from all the others is probably a typo.
  const wtgs = rows.filter((r) => r.kind === 'WTG');
  if (wtgs.length >= 3) {
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const cLat = med(wtgs.map((r) => r.lat));
    const cLon = med(wtgs.map((r) => r.lon));
    for (const r of wtgs) {
      const km = distanceM(cLat, cLon, r.lat, r.lon) / 1000;
      if (km > 60) warnings.push({ line: r.line, warning: `${r.name} is ${Math.round(km)} km from the other turbines. Check its position.` });
    }
  }
  return { rows, problems, warnings };
}
