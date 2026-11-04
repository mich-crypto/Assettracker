// Site manager overview: what is on the SOV and on each turbine, with filter and sort,
// status (orange = warning, red = defect or not usable), service report and refuel planning.
import { ago, api, esc, fmtDate, fmtTime, path, registerServiceWorker, renderHeader, requireProject, toast } from './app.js';
import { kindOf as kindOfType, typeById } from './equipment.js';
import { applyFilters, enrich as enrichUnit, fuelCell, initToolbar, rowClass, statusCell } from './equipment-list.js';
import { formatValue } from './fields.js';
import { printOnly } from './print.js';
import { fuelRows, rowsToText, serviceRows } from './reports.js';

const ok = requireProject();
const $ = (id) => document.getElementById(id);

let types = [];
let project = null;
let barSov;
let barWtg;
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
  barSov = initToolbar($('bar-sov'), { onChange: render });
  barWtg = initToolbar($('bar-wtg'), { sorts: ['wtg', 'kind', 'status', 'fuel-asc', 'battery-asc', 'fuel-desc', 'checked'], onChange: render });
  $('fuel-max').onchange = render;
  $('svc-copy').onclick = () => copyReport('service');
  $('fuel-copy').onclick = () => copyReport('fuel');
  $('btn-paper').onclick = printPaper;
  await load();
  if (location.hash === '#service') { $('svc-card').open = true; $('svc-card').scrollIntoView(); }
  setInterval(load, 60_000);
}

async function load() {
  try {
    const [boot, list] = await Promise.all([api('/api/bootstrap'), api('/api/assets')]);
    types = boot.types;
    locations = boot.locations;
    project = boot.project;
    assets = list.assets.map(enrich);
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    render();
  } catch (e) {
    toast(`Could not load: ${e.message}`, 'error');
  }
}

const typeOf = (a) => typeById(types, a.type_id);
const enrich = (a) => enrichUnit(a, typeOf(a));
const kindOf = (a) => a.kind;

function render() {
  const onSov = assets.filter((a) => a.last?.location_kind === 'SOV');
  const onWtg = assets.filter((a) => a.last?.location_kind === 'WTG');
  const kpi = (n, label, cls = '') => `<div class="kpi ${cls}"><b>${n}</b><span>${label}</span></div>`;
  $('kpis').innerHTML =
    kpi(onSov.length, 'on the SOV') +
    kpi(onWtg.length, `on ${new Set(onWtg.map((a) => a.last.location_id)).size} turbines`) +
    kpi(`<span class="warn-sym">⚠</span> ${assets.filter((a) => a.status === 'warning').length}`, 'with a warning') +
    kpi(`⛔ ${assets.filter((a) => a.status === 'blocked').length}`, 'defect, not usable', 'kpi-red');

  barSov.setKinds(onSov.map((a) => a.kind));
  barWtg.setKinds(onWtg.map((a) => a.kind));

  const sovCount = locations.filter((l) => l.kind === 'SOV' && l.active).length;
  const sovList = applyFilters(onSov, barSov.state());
  $('sov-rows').innerHTML = sovList.map((a) => `<tr class="${rowClass(a)}" data-id="${a.id}">
      <td><b>${esc(a.kind)}</b>${sovCount > 1 ? `<div class="muted">${esc(a.last.location_name)}</div>` : ''}${movedTag(a)}</td>
      <td>${fuelCell(a)}</td><td>${statusCell(a)}</td><td>${checkedCell(a)}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="muted">${onSov.length ? 'Nothing matches.' : 'No equipment on the SOV.'}</td></tr>`;

  const wtgList = applyFilters(onWtg, barWtg.state());
  $('wtg-rows').innerHTML = wtgList.map((a) => `<tr class="${rowClass(a)}" data-id="${a.id}">
      <td class="wtg-name">${esc(a.last.location_name)}</td>
      <td><b>${esc(a.kind)}</b>${movedTag(a)}</td>
      <td>${fuelCell(a)}</td><td>${statusCell(a)}</td><td>${checkedCell(a)}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="muted">${onWtg.length ? 'Nothing matches.' : 'No equipment on turbines.'}</td></tr>`;

  const groups = new Map();
  for (const a of onWtg) {
    if (!groups.has(a.last.location_id)) groups.set(a.last.location_id, { name: a.last.location_name, lat: a.last.location_lat, lon: a.last.location_lon, units: [] });
    groups.get(a.last.location_id).units.push(a);
  }
  renderReports();
  document.querySelectorAll('[data-id]').forEach((el) => (el.onclick = () => openAsset(el.dataset.id)));
  renderMap([...groups.values()]);
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


function checkedCell(a) {
  return a.check ? esc(ago(a.check.recorded_at)) : '<span class="muted">not scanned</span>';
}

function movedTag(a) {
  // Connected unit (e.g. generator <-> fuel cube), if both are still at the same place.
  const partner = a.last?.linked_asset_id && assets.find((x) => x.id === a.last.linked_asset_id);
  const together = partner && partner.last?.linked_asset_id === a.id && partner.last?.location_id === a.last.location_id;
  const link = together ? `<div class="muted moved-tag">⛓ with ${esc(kindOf(partner))}</div>` : '';
  return link;
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
    if (g.lat == null) continue;
    const alert = g.units.some((a) => a.status !== 'ok');
    const icon = L.divIcon({ className: '', html: `<div class="map-count${alert ? ' alert' : ''}">${g.units.length}</div>`, iconSize: [28, 28] });
    const counts = new Map();
    for (const a of g.units) counts.set(kindOf(a), (counts.get(kindOf(a)) || 0) + 1);
    const html = `<b>${esc(g.name)}</b><br>${[...counts].map(([k, n]) => `${n} × ${esc(k)}`).join('<br>')}` +
      (alert ? '<br><span style="color:#c0392b">⚠ needs attention</span>' : '');
    L.marker([g.lat, g.lon], { icon, zIndexOffset: 1000 }).bindPopup(html).addTo(markerLayer);
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
        <h2 id="d-title" style="margin:0">${esc(kindOfType(asset, type))}</h2>
        <button class="btn" type="button" id="d-close">Close</button>
      </div>
      ${asset.defect ? `<p class="blocked-why" style="background:var(--danger);color:#fff">⛔ Defect: do not use${asset.defect_note ? ` · ${esc(asset.defect_note)}` : ''}</p>` : ''}
      <p class="muted">${readings[0] ? `At ${esc(readings[0].location_name || 'phone GPS position (elsewhere)')}` : 'No location yet'}${lastCheck ? ` · checked ${esc(ago(lastCheck.recorded_at))}` : ' · not scanned yet'}</p>
      <dl class="kv">${type.fields.filter((f) => f.scope === 'asset').map((f) =>
        `<dt>${esc(f.label)}</dt><dd>${esc(f.type === 'date' ? fmtDate(asset.attributes[f.key]) : formatValue(f, asset.attributes[f.key]))}</dd>`).join('')}</dl>
      <p class="muted" style="font-size:.85rem">Serial ${esc(asset.serial)}${asset.name ? ` · ${esc(asset.name)}` : ''}</p>
      <h3 style="margin-top:16px">History (${readings.length})</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Location</th>${checks.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th>Notes</th></tr></thead>
        <tbody>${readings.map((r) => (r.kind === 'event' ? `<tr>
          <td>${esc(fmtTime(r.recorded_at))}</td>
          <td colspan="${checks.length + 2}"><span class="badge ${r.data.event === 'defect' ? 'badge-danger' : 'badge-ok'}">${{ refuel: 'Refuelled', service: 'Serviced', defect: 'Marked defect', repaired: 'Repaired' }[r.data.event] || r.data.event}</span>${r.data.next_inspection ? ` next inspection ${esc(fmtDate(r.data.next_inspection))}` : ''}${r.data.note ? ` ${esc(r.data.note)}` : ''}</td></tr>` : `<tr>
          <td>${esc(fmtTime(r.recorded_at))}</td>
          <td>${r.location_name ? esc(r.location_name) : r.lat != null ? `Elsewhere (${r.lat.toFixed(4)}, ${r.lon.toFixed(4)})` : '?'} ${r.kind === 'move' ? '<span class="badge">placed by hand</span>' : sourceBadge(r)}${r.distance_m != null ? `<div class="muted">${Math.round(r.distance_m)} m from WTG</div>` : ''}</td>
          ${checks.map((f) => `<td>${esc(formatValue(f, r.data[f.key]))}</td>`).join('')}
          <td>${r.notes ? `<div class="muted">${esc(r.notes)}</div>` : ''}</td>
        </tr>`)).join('') || `<tr><td colspan="${checks.length + 3}" class="muted">No readings yet.</td></tr>`}</tbody>
      </table></div>`;
    $('d-close').onclick = () => drawer.classList.add('hidden');
    $('d-close').focus();
  } catch (e) {
    drawer.innerHTML = `<p class="field-error">${esc(e.message)}</p><button class="btn" onclick="this.parentElement.classList.add('hidden')">Close</button>`;
  }
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('drawer').classList.add('hidden'); });

/** A sheet to keep on paper (print, or save as PDF): everything and where it is, for when nothing else works. */
function printPaper() {
  const rows = [...assets].sort((x, y) => (x.last?.location_kind === 'SOV' ? 0 : 1) - (y.last?.location_kind === 'SOV' ? 0 : 1)
    || String(x.last?.location_name || '~').localeCompare(String(y.last?.location_name || '~'), undefined, { numeric: true })
    || x.kind.localeCompare(y.kind, undefined, { numeric: true }));
  const due = (a) => {
    const f = a.type.fields.find((x) => x.type === 'date' && x.scope === 'asset' && x.dueWarnDays != null);
    return f && a.attributes?.[f.key] ? fmtDate(a.attributes[f.key]) : '';
  };
  $('paper').innerHTML = `<h1>Equipment list ${esc(project?.name || '')}</h1>
    <p>Printed ${esc(new Date().toLocaleString())}. Keep this copy on board. Write changes in the last column and give them to the warehouse.</p>
    <table><thead><tr><th>Location</th><th>Equipment</th><th>Serial</th><th>Fuel</th><th>Status</th><th>Inspection due</th><th>Changes</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td>${esc(a.last?.location_name || '')}</td><td>${esc(a.kind)}</td><td>${esc(a.serial)}</td>
      <td>${a.levels.filter((l) => l.v != null).map((l) => `${a.levels.length > 1 ? (/batter/i.test(l.f.key) ? 'Battery ' : 'Fuel ') : ''}${esc(formatValue(l.f, l.v))}`).join(', ')}</td>
      <td>${a.block ? `<b>DO NOT USE: ${esc(a.block.short)}</b>` : a.alerts.length ? esc(a.alerts.map((x) => x.text).join('; ')) : 'OK'}</td>
      <td>${esc(due(a))}</td><td></td></tr>`).join('')}</tbody></table>`;
  printOnly($('paper'));
}
