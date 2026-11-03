// Site manager overview: a searchable list of the equipment on the vessel, then
// the turbines with their equipment, fuel level and a warning symbol. The manager
// can also put a unit at a location by hand (serial number -> location).
import { ago, api, esc, fmtDate, fmtTime, path, registerServiceWorker, renderHeader, requireProject, toast } from './app.js';
import { alertsFor, kindOf as kindOfType, levelField as levelOfType, typeById } from './equipment.js';
import { formatValue } from './fields.js';
import { downloadBlob, printOnly } from './print.js';
import { fuelRows, rowsToCsv, rowsToText, serviceRows } from './reports.js';

const ok = requireProject();
const $ = (id) => document.getElementById(id);

let types = [];
let openIssues = 0;
let locations = [];
let assets = [];
let map;
let markerLayer;
let fitted = false;

if (ok) init();

async function init() {
  renderHeader('overview');
  registerServiceWorker();
  initMap();
  $('fuel-max').onchange = render;
  $('svc-copy').onclick = () => copyReport('service');
  $('svc-csv').onclick = () => csvReport('service');
  $('svc-print').onclick = () => printOnly($('svc-card'));
  $('fuel-copy').onclick = () => copyReport('fuel');
  $('fuel-print').onclick = () => printOnly($('fuel-card'));
  ['q-sov', 'q-wtg', 'f-alert'].forEach((id) => $(id).addEventListener('input', render));
  $('assign-form').onsubmit = onAssign;
  $('as-serial').oninput = assignHint;
  $('btn-csv').onclick = exportCsv;
  await load();
  if (location.hash === '#service') { $('svc-card').open = true; $('svc-card').scrollIntoView(); }
  setInterval(load, 60_000);
}

async function load() {
  try {
    const [boot, list] = await Promise.all([api('/api/bootstrap'), api('/api/assets')]);
    types = boot.types;
    locations = boot.locations;
    openIssues = boot.openIssues;
    assets = list.assets.map(enrich);
    fillAssignLists();
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    render();
  } catch (e) {
    toast(`Could not load: ${e.message}`, 'error');
  }
}

const typeOf = (a) => typeById(types, a.type_id);

// `last` = where the unit is now (scan or manual move); `check` = its latest scan values.
function enrich(a) {
  const type = typeOf(a);
  return { ...a, type, alerts: alertsFor(a, type) };
}

/** What a site manager calls a unit: its type plus its fixed choices, e.g. "Generator 350 kVA". */
const kindOf = (a) => kindOfType(a, a.type);

const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');

/** Search text for a unit: what it is, where it is, its serial and tags (serials aren't shown but can be searched). */
function haystack(a) {
  return norm([kindOf(a), a.last?.location_name, a.serial, a.name, ...a.tags.map((t) => t.code), ...a.alerts.map((x) => x.text)].join(' '));
}

function visible(a, q) {
  if ($('f-alert').checked && !a.alerts.length) return false;
  return !q || haystack(a).includes(q);
}

const byKind = (x, y) => kindOf(x).localeCompare(kindOf(y), undefined, { numeric: true });

function render() {
  const onSov = assets.filter((a) => a.last?.location_kind === 'SOV');
  const onWtg = assets.filter((a) => a.last?.location_kind === 'WTG');
  const kpi = (n, label) => `<div class="kpi"><b>${n}</b><span>${label}</span></div>`;
  $('kpis').innerHTML =
    kpi(onSov.length, 'on the vessel') +
    kpi(onWtg.length, `on ${new Set(onWtg.map((a) => a.last.location_id)).size} turbines`) +
    kpi(`<span class="warn-sym">⚠</span> ${assets.filter((a) => a.alerts.length).length}`, 'with a warning') +
    `<a class="kpi kpi-link" href="${path('warehouse')}"><b>${openIssues}</b><span>to investigate</span></a>`;

  // Vessel: one searchable list (vessel name shown when there is more than one SOV).
  const sovCount = locations.filter((l) => l.kind === 'SOV' && l.active).length;
  const qs = norm($('q-sov').value);
  const sovList = onSov.filter((a) => visible(a, qs)).sort((x, y) =>
    (x.last.location_name || '').localeCompare(y.last.location_name || '') || byKind(x, y));
  $('sov-rows').innerHTML = sovList.map((a) => `<tr class="clickable" data-id="${a.id}">
      <td><b>${esc(kindOf(a))}</b><span class="warn-inline">${warnCell(a)}</span>${sovCount > 1 ? `<div class="muted">${esc(a.last.location_name)}</div>` : ''}${movedTag(a)}</td>
      <td>${fuelCell(a)}</td><td class="c-warn">${warnCell(a)}</td><td>${checkedCell(a)}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="muted">${onSov.length ? 'No equipment on the vessel matches.' : 'No equipment on the vessel.'}</td></tr>`;

  // Turbines: grouped per WTG, in turbine order.
  const qw = norm($('q-wtg').value);
  const groups = new Map();
  for (const a of onWtg) {
    const wtgMatch = qw && norm(a.last.location_name).includes(qw);
    if (!visible(a, wtgMatch ? '' : qw)) continue;
    const key = a.last.location_id;
    if (!groups.has(key)) groups.set(key, { name: a.last.location_name, lat: a.last.location_lat, lon: a.last.location_lon, units: [] });
    groups.get(key).units.push(a);
  }
  const wtgGroups = [...groups.values()].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
  const table = $('wtg-table');
  table.querySelectorAll('tbody').forEach((tb) => tb.remove());
  table.insertAdjacentHTML('beforeend', wtgGroups.length
    ? wtgGroups.map((g) => `<tbody class="wtg-group">${g.units.sort(byKind).map((a, i) => `<tr class="clickable" data-id="${a.id}">
        ${i === 0 ? `<td class="wtg-name" rowspan="${g.units.length}">${esc(g.name)}</td>` : ''}
        <td><b>${esc(kindOf(a))}</b><span class="warn-inline">${warnCell(a)}</span>${movedTag(a)}</td>
        <td>${fuelCell(a)}</td><td class="c-warn">${warnCell(a)}</td><td>${checkedCell(a)}</td>
      </tr>`).join('')}</tbody>`).join('')
    : `<tbody><tr><td colspan="5" class="muted">${onWtg.length ? 'No turbine or equipment matches.' : 'No equipment on turbines.'}</td></tr></tbody>`);

  const elsewhere = assets.filter((a) => a.last && !a.last.location_id && visible(a, ''))
    .sort((x, y) => y.last.recorded_at.localeCompare(x.last.recorded_at));
  $('elsewhere-section').classList.toggle('hidden', !elsewhere.length);
  $('elsewhere-cards').innerHTML = elsewhere.length ? elsewhereCard(elsewhere) : '';

  const unplaced = assets.filter((a) => !a.last);
  $('unplaced').classList.toggle('hidden', !unplaced.length);
  $('unplaced-count').textContent = `(${unplaced.length})`;
  $('unplaced-list').innerHTML = summaryChips(unplaced) +
    '<p class="muted">Use <b>Assign a location</b> above to place them.</p>';

  renderReports();
  document.querySelectorAll('[data-id]').forEach((el) => (el.onclick = () => openAsset(el.dataset.id)));
  renderMap(wtgGroups, elsewhere);
}

// ---------------------------------------------------------------- reports

const SVC_HEAD = ['Location', 'Equipment', 'Serial', 'Needs', 'Last serviced'];
const FUEL_HEAD = ['Turbine', 'Equipment', 'Serial', 'Fuel level', 'Last check'];
let svc = [];
let fuel = [];

function renderReports() {
  svc = serviceRows(assets, types);
  $('svc-count').textContent = svc.length ? `(${svc.length})` : '';
  $('svc-rows').innerHTML = svc.map((r) => `<tr class="clickable" data-id="${esc(r.id)}">
      <td>${esc(r.location)}</td><td><b>${esc(r.kind)}</b><div class="muted">${esc(r.serial)}</div></td>
      <td>${r.reasons.map((x) => `<div><span class="warn-sym" aria-hidden="true">⚠</span> ${esc(x)}</div>`).join('')}</td>
      <td>${r.servicedAt ? esc(fmtDate(r.servicedAt)) : '<span class="muted">—</span>'}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">Nothing needs service right now.</td></tr>';

  fuel = fuelRows(assets, types, Number($('fuel-max').value));
  $('fuel-count').textContent = fuel.length ? `(${fuel.length})` : '';
  $('fuel-rows').innerHTML = fuel.map((r) => `<tr class="clickable" data-id="${esc(r.id)}">
      <td><b>${esc(r.location)}</b></td><td>${esc(r.kind)}<div class="muted">${esc(r.serial)}</div></td>
      <td>${r.level}${esc(r.unit)}</td><td>${esc(ago(r.at))}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">No equipment on turbines at or below this level.</td></tr>';
}

const reportLines = (which) => (which === 'service'
  ? svc.map((r) => [r.location, r.kind, r.serial, r.reasons.join('; '), r.servicedAt ? fmtDate(r.servicedAt) : ''])
  : fuel.map((r) => [r.location, r.kind, r.serial, `${r.level}${r.unit}`, ago(r.at)]));

async function copyReport(which) {
  const title = which === 'service' ? 'Equipment that needs service' : `Fuel visit list (${$('fuel-max').value}% or lower)`;
  try {
    await navigator.clipboard.writeText(rowsToText(title, which === 'service' ? SVC_HEAD : FUEL_HEAD, reportLines(which)));
    toast('Report copied as text', 'ok');
  } catch { toast('Copy is not allowed here', 'error'); }
}

function csvReport(which) {
  downloadBlob(new Blob([rowsToCsv(which === 'service' ? SVC_HEAD : FUEL_HEAD, reportLines(which))], { type: 'text/csv' }), `service-report-${new Date().toISOString().slice(0, 10)}.csv`);
}

/** The level shown in the Fuel column: the fuel field, else the first percentage field. */
const levelField = (a) => levelOfType(a.type);

function fuelCell(a) {
  const f = levelField(a);
  const v = f && a.check ? a.check.data[f.key] : null;
  if (v == null) return '<span class="muted">—</span>';
  const pct = f.max ? Math.max(0, Math.min(100, (v / f.max) * 100)) : v;
  const low = a.alerts.some((x) => x.key === f.key);
  return `<span class="fuel"><span class="fuel-bar${low ? ' low' : ''}" aria-hidden="true"><span style="width:${pct}%"></span></span>${esc(formatValue(f, v))}</span>`;
}

function warnCell(a) {
  if (!a.alerts.length) return '';
  const text = a.alerts.map((x) => x.text).join('; ');
  return `<span class="warn-sym" title="${esc(text)}" role="img" aria-label="Warning: ${esc(text)}">⚠</span>`;
}

function checkedCell(a) {
  return a.check ? esc(ago(a.check.recorded_at)) : '<span class="muted">not scanned</span>';
}

function movedTag(a) {
  // Connected unit (e.g. generator <-> fuel cube), if both are still at the same place.
  const partner = a.last?.linked_asset_id && assets.find((x) => x.id === a.last.linked_asset_id);
  const together = partner && partner.last?.linked_asset_id === a.id && partner.last?.location_id === a.last.location_id;
  const link = together ? `<div class="muted moved-tag">⛓ with ${esc(kindOf(partner))}</div>` : '';
  const moved = a.last?.kind === 'move' && !a.last.linked_asset_id
    ? '<div class="muted moved-tag">placed by hand</div>' : '';
  return link + moved;
}

function elsewhereCard(units) {
  return `<section class="loc-card">
    ${summaryChips(units)}
    ${units.map((a) => {
      const pos = a.last.lat != null
        ? `<a href="https://www.openstreetmap.org/?mlat=${a.last.lat}&mlon=${a.last.lon}#map=14/${a.last.lat}/${a.last.lon}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${a.last.lat.toFixed(4)}, ${a.last.lon.toFixed(4)}</a>`
        : 'position unknown';
      return `<button type="button" class="unit" data-id="${a.id}">
        <div class="unit-kind">${esc(kindOf(a))} ${warnCell(a)}</div>
        <div class="unit-vals">At ${pos} · ${fuelCell(a)}</div>
        <div class="unit-vals">Checked ${a.check ? esc(ago(a.check.recorded_at)) : '—'}</div>
      </button>`;
    }).join('')}
  </section>`;
}

function summaryChips(units) {
  const counts = new Map();
  for (const a of units) counts.set(kindOf(a), (counts.get(kindOf(a)) || 0) + 1);
  return `<div class="kind-summary">${[...counts].sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true }))
    .map(([k, n]) => `<span class="kind-chip">${n} × ${esc(k)}</span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- assign a location by hand

function locationOptions(selectedId = '') {
  const active = locations.filter((l) => l.active);
  const opt = (l) => `<option value="${esc(l.id)}"${l.id === selectedId ? ' selected' : ''}>${esc(l.name)}</option>`;
  const sovs = active.filter((l) => l.kind === 'SOV');
  const wtgs = active.filter((l) => l.kind === 'WTG').sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
  return '<option value="">Select…</option>' +
    (sovs.length ? `<optgroup label="Vessel (SOV)">${sovs.map(opt).join('')}</optgroup>` : '') +
    (wtgs.length ? `<optgroup label="Turbines (WTG)">${wtgs.map(opt).join('')}</optgroup>` : '');
}

function fillAssignLists() {
  $('serial-list').innerHTML = assets.map((a) =>
    `<option value="${esc(a.serial)}">${esc(kindOf(a))}${a.last?.location_name ? ` · ${esc(a.last.location_name)}` : ''}</option>`).join('');
  const keep = $('as-location').value;
  $('as-location').innerHTML = locationOptions(keep);
}

function findBySerial(text) {
  const q = norm(text);
  return q ? assets.find((a) => norm(a.serial) === q || a.tags.some((t) => norm(t.code) === q)) : null;
}

function assignHint() {
  const a = findBySerial($('as-serial').value);
  $('as-hint').textContent = !$('as-serial').value.trim() ? ''
    : a ? `${kindOf(a)} · now ${a.last ? `at ${a.last.location_name || 'a GPS position'}` : 'not placed yet'}`
    : 'No equipment with this serial number.';
}

async function onAssign(e) {
  e.preventDefault();
  const a = findBySerial($('as-serial').value);
  const locId = $('as-location').value;
  if (!a) { $('as-hint').textContent = 'No equipment with this serial number.'; $('as-serial').focus(); return; }
  if (!locId) { $('as-location').focus(); return; }
  await moveAsset(a, locId);
  $('as-serial').value = '';
  $('as-hint').textContent = '';
}

async function moveAsset(a, locId) {
  const loc = locations.find((l) => l.id === locId);
  try {
    await api(`/api/assets/${a.id}/move`, { method: 'POST', body: { location_id: locId } });
    toast(`${kindOf(a)} (${a.serial}) placed at ${loc?.name}`, 'ok');
    await load();
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
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

function renderMap(wtgGroups, elsewhere = []) {
  if (!map) return;
  markerLayer.clearLayers();
  const bounds = [];
  for (const l of locations.filter((x) => x.kind === 'WTG' && x.lat != null)) {
    L.marker([l.lat, l.lon], { icon: L.divIcon({ className: '', html: '<div class="map-wtg"></div>', iconSize: [14, 14] }), title: l.name, keyboard: false })
      .bindTooltip(l.name).addTo(markerLayer);
    bounds.push([l.lat, l.lon]);
  }
  for (const g of wtgGroups) {
    if (g.lat == null) continue;
    const alert = g.units.some((a) => a.alerts.length);
    const icon = L.divIcon({ className: '', html: `<div class="map-count${alert ? ' alert' : ''}">${g.units.length}</div>`, iconSize: [28, 28] });
    const counts = new Map();
    for (const a of g.units) counts.set(kindOf(a), (counts.get(kindOf(a)) || 0) + 1);
    const html = `<b>${esc(g.name)}</b><br>${[...counts].map(([k, n]) => `${n} × ${esc(k)}`).join('<br>')}` +
      (alert ? '<br><span style="color:#c0392b">⚠ warning</span>' : '');
    L.marker([g.lat, g.lon], { icon, zIndexOffset: 1000 }).bindPopup(html).addTo(markerLayer);
  }
  // Units elsewhere get their own pin at the phone's position (not included in the
  // initial zoom, which stays on the wind farm).
  for (const a of elsewhere.filter((x) => x.last.lat != null)) {
    const icon = L.divIcon({ className: '', html: `<div class="map-count map-elsewhere${a.alerts.length ? ' alert' : ''}">1</div>`, iconSize: [28, 28] });
    L.marker([a.last.lat, a.last.lon], { icon }).bindPopup(`<b>${esc(kindOf(a))}</b><br>Elsewhere · ${esc(ago(a.last.recorded_at))}`).addTo(markerLayer);
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
    const lastCheck = readings.find((r) => r.kind === 'check');
    drawer.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <h2 id="d-title" style="margin:0">${esc(kindOf({ ...asset, type }))}</h2>
        <button class="btn" type="button" id="d-close">Close</button>
      </div>
      <p class="muted">${readings[0] ? `At ${esc(readings[0].location_name || 'phone GPS position (elsewhere)')}` : 'No location yet'}${lastCheck ? ` · checked ${esc(ago(lastCheck.recorded_at))}` : ' · not scanned yet'}</p>
      <form class="row" id="d-move" style="align-items:end;margin-bottom:8px">
        <div class="field grow" style="margin:0"><label for="d-move-loc">Move to</label><select id="d-move-loc">${locationOptions()}</select></div>
        <button class="btn" type="submit">Assign</button>
      </form>
      <dl class="kv">${type.fields.filter((f) => f.scope === 'asset').map((f) =>
        `<dt>${esc(f.label)}</dt><dd>${esc(f.type === 'date' ? fmtDate(asset.attributes[f.key]) : formatValue(f, asset.attributes[f.key]))}</dd>`).join('')}</dl>
      <p class="muted" style="font-size:.85rem">Serial ${esc(asset.serial)}${asset.name ? ` · ${esc(asset.name)}` : ''}</p>
      <h3 style="margin-top:16px">History (${readings.length})</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Location</th>${checks.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th>Notes</th></tr></thead>
        <tbody>${readings.map((r) => (r.kind === 'event' ? `<tr>
          <td>${esc(fmtTime(r.recorded_at))}</td>
          <td colspan="${checks.length + 2}"><span class="badge badge-ok">${r.data.event === 'refuel' ? 'Refuelled' : 'Serviced'}</span>${r.data.next_inspection ? ` next inspection ${esc(fmtDate(r.data.next_inspection))}` : ''}</td></tr>` : `<tr>
          <td>${esc(fmtTime(r.recorded_at))}</td>
          <td>${r.location_name ? esc(r.location_name) : r.lat != null ? `Elsewhere (${r.lat.toFixed(4)}, ${r.lon.toFixed(4)})` : '?'} ${r.kind === 'move' ? '<span class="badge">placed by hand</span>' : sourceBadge(r)}${r.distance_m != null ? `<div class="muted">${Math.round(r.distance_m)} m from WTG</div>` : ''}</td>
          ${checks.map((f) => `<td>${esc(formatValue(f, r.data[f.key]))}</td>`).join('')}
          <td>${r.notes ? `<div class="muted">${esc(r.notes)}</div>` : ''}</td>
        </tr>`)).join('') || `<tr><td colspan="${checks.length + 3}" class="muted">No readings yet.</td></tr>`}</tbody>
      </table></div>`;
    $('d-close').onclick = () => drawer.classList.add('hidden');
    $('d-move').onsubmit = async (e) => {
      e.preventDefault();
      const locId = $('d-move-loc').value;
      if (!locId) return $('d-move-loc').focus();
      const a = assets.find((x) => x.id === asset.id) || { ...asset, type };
      if (await moveAsset(a, locId)) openAsset(asset.id);
    };
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
    const head = ['recorded_at', 'kind', 'serial', 'type', 'location', 'location_kind', 'location_source', 'gps_status', 'lat', 'lon', 'accuracy_m', 'distance_m', ...keys, 'notes'];
    const cell = (v) => {
      const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(',')].concat(readings.map((r) => [
      r.recorded_at, r.kind, r.serial, r.type_id, r.location_name, r.location_kind, r.location_source, r.gps_status,
      r.lat, r.lon, r.accuracy_m, r.distance_m, ...keys.map((k) => r.data[k]), r.notes,
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
