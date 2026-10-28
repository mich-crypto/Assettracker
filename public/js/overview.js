// Site manager overview, organised by location: what equipment is on the vessel
// and on each turbine, with its latest check values and alerts.
import { ago, api, esc, fmtTime, registerServiceWorker, renderHeader, requireLogin, toast } from './app.js';
import { evaluateAlerts, formatValue } from './fields.js';

const user = requireLogin('overview');
const $ = (id) => document.getElementById(id);
const STALE_DAYS = 7;

let types = [];
let locations = [];
let assets = [];
let map;
let markerLayer;
let fitted = false;

if (user) init();

async function init() {
  renderHeader('overview');
  registerServiceWorker();
  initMap();
  ['q', 'f-type', 'f-alert'].forEach((id) => $(id).addEventListener('input', render));
  $('btn-csv').onclick = exportCsv;
  await load();
  setInterval(load, 60_000);
}

async function load() {
  try {
    const [boot, list] = await Promise.all([api('/api/bootstrap'), api('/api/assets')]);
    types = boot.types;
    locations = boot.locations;
    assets = list.assets.map(enrich);
    const sel = $('f-type');
    if (sel.options.length === 1) sel.innerHTML += types.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    render();
  } catch (e) {
    toast(`Could not load: ${e.message}`, 'error');
  }
}

function typeOf(a) {
  return types.find((t) => t.id === a.type_id) || { name: a.type_id, fields: [] };
}

function enrich(a) {
  const type = typeOf(a);
  const alerts = a.last ? evaluateAlerts(type.fields, a.last.data) : [];
  const stale = !a.last || Date.now() - new Date(a.last.recorded_at) > STALE_DAYS * 86400e3;
  return { ...a, type, alerts, stale };
}

/** What a site manager calls a unit: its type plus its fixed choices, e.g. "Generator 350 kVA". */
function kindOf(a) {
  const extras = a.type.fields.filter((f) => f.scope === 'asset' && f.type === 'select' && a.attributes[f.key])
    .map((f) => a.attributes[f.key]);
  return [a.type.name, ...extras].join(' ');
}

function filtered() {
  const q = $('q').value.trim().toLowerCase().replace(/\s+/g, '');
  const type = $('f-type').value;
  const alertsOnly = $('f-alert').checked;
  return assets.filter((a) => {
    if (type && a.type_id !== type) return false;
    if (alertsOnly && !a.alerts.length) return false;
    if (q && !(a.last?.location_name || '').toLowerCase().replace(/\s+/g, '').includes(q)) return false;
    return true;
  });
}

/** Groups units by their current location: { location, units }[]. */
function byLocation(list) {
  const groups = new Map();
  for (const a of list) {
    if (!a.last?.location_id) continue;
    const loc = locations.find((l) => l.id === a.last.location_id) ||
      { id: a.last.location_id, name: a.last.location_name, kind: a.last.location_kind };
    if (!groups.has(loc.id)) groups.set(loc.id, { location: loc, units: [] });
    groups.get(loc.id).units.push(a);
  }
  return [...groups.values()];
}

function render() {
  const list = filtered();
  const onSov = assets.filter((a) => a.last?.location_kind === 'SOV');
  const onWtg = assets.filter((a) => a.last?.location_kind === 'WTG');
  const kpi = (n, label) => `<div class="kpi"><b>${n}</b><span>${label}</span></div>`;
  $('kpis').innerHTML =
    kpi(onSov.length, 'on the vessel') +
    kpi(`${onWtg.length}`, `on ${new Set(onWtg.map((a) => a.last.location_id)).size} turbines`) +
    kpi(assets.filter((a) => a.alerts.length).length, 'need attention') +
    kpi(assets.filter((a) => a.last && a.stale).length, `not checked in ${STALE_DAYS} days`);

  const groups = byLocation(list);
  const byName = (x, y) => x.location.name.localeCompare(y.location.name, undefined, { numeric: true });
  const sovGroups = groups.filter((g) => g.location.kind === 'SOV').sort(byName);
  // Show every vessel, even an empty one: "nothing on board" is useful to know.
  for (const sov of locations.filter((l) => l.kind === 'SOV' && l.active)) {
    if (!sovGroups.some((g) => g.location.id === sov.id) && !$('q').value && !$('f-alert').checked) sovGroups.push({ location: sov, units: [] });
  }
  const wtgGroups = groups.filter((g) => g.location.kind === 'WTG').sort(byName);
  $('sov-cards').innerHTML = sovGroups.map(locationCard).join('') || '<p class="empty-note">No equipment on the vessel matches.</p>';
  $('wtg-cards').innerHTML = wtgGroups.map(locationCard).join('') || '<p class="empty-note">No equipment on turbines matches.</p>';

  const unplaced = list.filter((a) => !a.last);
  $('unplaced').classList.toggle('hidden', !unplaced.length);
  $('unplaced-count').textContent = `(${unplaced.length})`;
  $('unplaced-list').innerHTML = summaryChips(unplaced);

  document.querySelectorAll('.unit[data-id]').forEach((b) => (b.onclick = () => openAsset(b.dataset.id)));
  renderMap(wtgGroups);
}

function summaryChips(units) {
  const counts = new Map();
  for (const a of units) counts.set(kindOf(a), (counts.get(kindOf(a)) || 0) + 1);
  return `<div class="kind-summary">${[...counts].sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true }))
    .map(([k, n]) => `<span class="kind-chip">${n} × ${esc(k)}</span>`).join('')}</div>`;
}

function unitValues(a) {
  return a.type.fields.filter((f) => f.scope === 'check' && f.type !== 'multiselect' && a.last.data[f.key] != null)
    .map((f) => `${esc(f.label)} <b>${esc(formatValue(f, a.last.data[f.key]))}</b>`).join(' · ');
}

function locationCard(g) {
  const units = [...g.units].sort((x, y) => kindOf(x).localeCompare(kindOf(y), undefined, { numeric: true }));
  const attention = units.some((a) => a.alerts.length);
  return `<section class="loc-card${attention ? ' attention' : ''}">
    <h3><span>${esc(g.location.name)}</span>${attention ? '<span class="badge badge-danger">needs attention</span>' : ''}</h3>
    ${units.length ? summaryChips(units) : '<p class="empty-note">Nothing on board.</p>'}
    ${units.map((a) => `<button type="button" class="unit" data-id="${a.id}">
      <div class="unit-kind">${esc(kindOf(a))}</div>
      <div class="unit-vals">${unitValues(a)}</div>
      ${a.alerts.length ? `<div>${a.alerts.map((x) => `<span class="badge badge-danger">${esc(x.text)}</span>`).join(' ')}</div>` : ''}
      <div class="unit-vals">Checked ${esc(ago(a.last.recorded_at))}${a.stale ? ' <span class="badge badge-warn">over a week ago</span>' : ''}</div>
    </button>`).join('')}
  </section>`;
}

function sourceBadge(r) {
  if (r.location_source === 'gps') return '<span class="badge badge-ok" title="Confirmed by GPS">GPS</span>';
  const why = { no_fix: 'no GPS fix', poor_accuracy: 'weak GPS', implausible: 'GPS implausible (jamming?)', ok: 'chosen by user', unavailable: 'no GPS' }[r.gps_status] || '';
  return `<span class="badge badge-warn" title="Entered manually: ${esc(why)}">Manual</span>`;
}

// ---------------------------------------------------------------- map

function initMap() {
  if (!window.L) {
    $('map').innerHTML = '<p class="muted" style="padding:16px">Map unavailable.</p>';
    return;
  }
  map = L.map('map', { zoomControl: true }).setView([54, 4], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: 'Seamarks &copy; OpenSeaMap',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

function renderMap(wtgGroups) {
  if (!map) return;
  markerLayer.clearLayers();
  const bounds = [];
  for (const l of locations.filter((x) => x.kind === 'WTG' && x.lat != null)) {
    L.marker([l.lat, l.lon], { icon: L.divIcon({ className: '', html: '<div class="map-wtg"></div>', iconSize: [14, 14] }), title: l.name, keyboard: false })
      .bindTooltip(l.name).addTo(markerLayer);
    bounds.push([l.lat, l.lon]);
  }
  for (const g of wtgGroups) {
    if (g.location.lat == null) continue;
    const alert = g.units.some((a) => a.alerts.length);
    const icon = L.divIcon({ className: '', html: `<div class="map-count${alert ? ' alert' : ''}">${g.units.length}</div>`, iconSize: [28, 28] });
    const counts = new Map();
    for (const a of g.units) counts.set(kindOf(a), (counts.get(kindOf(a)) || 0) + 1);
    const html = `<b>${esc(g.location.name)}</b><br>${[...counts].map(([k, n]) => `${n} × ${esc(k)}`).join('<br>')}` +
      (alert ? '<br><span style="color:#c0392b">⚠ needs attention</span>' : '');
    L.marker([g.location.lat, g.location.lon], { icon, zIndexOffset: 1000 }).bindPopup(html).addTo(markerLayer);
  }
  if (!fitted && bounds.length) {
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    fitted = true;
  }
}

// ---------------------------------------------------------------- detail + export

async function openAsset(id) {
  const drawer = $('drawer');
  drawer.classList.remove('hidden');
  drawer.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { asset, readings } = await api(`/api/assets/${id}`);
    const type = typeOf(asset);
    const checks = type.fields.filter((f) => f.scope === 'check');
    drawer.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <h2 id="d-title" style="margin:0">${esc(kindOf({ ...asset, type }))}</h2>
        <button class="btn" type="button" id="d-close">Close</button>
      </div>
      <p class="muted">${readings[0] ? `At ${esc(readings[0].location_name || '?')} · checked ${esc(ago(readings[0].recorded_at))}` : 'Not scanned yet'}</p>
      <dl class="kv">${type.fields.filter((f) => f.scope === 'asset').map((f) =>
        `<dt>${esc(f.label)}</dt><dd>${esc(formatValue(f, asset.attributes[f.key]))}</dd>`).join('')}</dl>
      <p class="muted" style="font-size:.85rem">Serial ${esc(asset.serial)}${asset.name ? ` · ${esc(asset.name)}` : ''}</p>
      <h3 style="margin-top:16px">History (${readings.length})</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Location</th>${checks.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th>By</th></tr></thead>
        <tbody>${readings.map((r) => `<tr>
          <td>${esc(fmtTime(r.recorded_at))}</td>
          <td>${esc(r.location_name || '?')} ${sourceBadge(r)}${r.distance_m != null ? `<div class="muted">${Math.round(r.distance_m)} m from WTG</div>` : ''}</td>
          ${checks.map((f) => `<td>${esc(formatValue(f, r.data[f.key]))}</td>`).join('')}
          <td>${esc(r.user_name || '')}${r.notes ? `<div class="muted">${esc(r.notes)}</div>` : ''}</td>
        </tr>`).join('') || `<tr><td colspan="${checks.length + 3}" class="muted">No readings yet.</td></tr>`}</tbody>
      </table></div>`;
    $('d-close').onclick = () => drawer.classList.add('hidden');
    $('d-close').focus();
  } catch (e) {
    drawer.innerHTML = `<p class="field-error">${esc(e.message)}</p><button class="btn" onclick="this.parentElement.classList.add('hidden')">Close</button>`;
  }
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('drawer').classList.add('hidden'); });

async function exportCsv() {
  try {
    const { readings } = await api('/api/readings?limit=5000');
    const keys = [...new Set(types.flatMap((t) => t.fields.filter((f) => f.scope === 'check').map((f) => f.key)))];
    const head = ['recorded_at', 'serial', 'type', 'location', 'location_kind', 'location_source', 'gps_status', 'lat', 'lon', 'accuracy_m', 'distance_m', ...keys, 'notes', 'user'];
    const cell = (v) => {
      const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(',')].concat(readings.map((r) => [
      r.recorded_at, r.serial, r.type_id, r.location_name, r.location_kind, r.location_source, r.gps_status,
      r.lat, r.lon, r.accuracy_m, r.distance_m, ...keys.map((k) => r.data[k]), r.notes, r.user_name,
    ].map(cell).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `readings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    toast(e.message, 'error');
  }
}
