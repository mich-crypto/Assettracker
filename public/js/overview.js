// Site manager overview: where every asset is, its latest check values and alerts.
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
  ['q', 'f-type', 'f-where', 'f-alert'].forEach((id) => $(id).addEventListener('input', render));
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

function filtered() {
  const q = $('q').value.trim().toLowerCase();
  const type = $('f-type').value;
  const where = $('f-where').value;
  const alertsOnly = $('f-alert').checked;
  return assets.filter((a) => {
    if (type && a.type_id !== type) return false;
    if (where === 'none' && a.last) return false;
    if ((where === 'WTG' || where === 'SOV') && a.last?.location_kind !== where) return false;
    if (alertsOnly && !a.alerts.length) return false;
    if (q && ![a.serial, a.name, a.last?.location_name, ...a.tags.map((t) => t.code)].some((v) => v && v.toLowerCase().includes(q))) return false;
    return true;
  });
}

function render() {
  const list = filtered();
  const kpi = (n, label) => `<div class="kpi"><b>${n}</b><span>${label}</span></div>`;
  $('kpis').innerHTML =
    kpi(assets.length, 'assets') +
    kpi(assets.filter((a) => a.alerts.length).length, 'with alerts') +
    kpi(`${assets.filter((a) => a.last?.location_kind === 'WTG').length} / ${assets.filter((a) => a.last?.location_kind === 'SOV').length}`, 'on WTG / on SOV') +
    kpi(assets.filter((a) => a.stale).length, `not scanned in ${STALE_DAYS} days`);
  renderTable(list);
  renderMap(list);
}

function checkSummary(a) {
  if (!a.last) return '<span class="muted">—</span>';
  return a.type.fields.filter((f) => f.scope === 'check' && a.last.data[f.key] != null && f.type !== 'multiselect')
    .map((f) => `<div><span class="muted">${esc(f.label)}:</span> ${esc(formatValue(f, a.last.data[f.key]))}</div>`).join('');
}

function sourceBadge(r) {
  if (r.location_source === 'gps') return '<span class="badge badge-ok" title="Confirmed by GPS">GPS</span>';
  const why = { no_fix: 'no GPS fix', poor_accuracy: 'weak GPS', implausible: 'GPS implausible (jamming?)', ok: 'chosen by user', unavailable: 'no GPS' }[r.gps_status] || '';
  return `<span class="badge badge-warn" title="Entered manually: ${esc(why)}">Manual</span>`;
}

function renderTable(list) {
  $('rows').innerHTML = list.map((a) => {
    const attrs = a.type.fields.filter((f) => f.scope === 'asset' && a.attributes[f.key] != null)
      .map((f) => formatValue(f, a.attributes[f.key])).join(' · ');
    const l = a.last;
    return `<tr class="clickable" data-id="${a.id}">
      <td><b>${esc(a.serial)}</b>${a.name ? ` <span class="muted">${esc(a.name)}</span>` : ''}
        <div class="muted">${esc(a.type.name)}${attrs ? ` · ${esc(attrs)}` : ''}</div></td>
      <td>${l ? `<b>${esc(l.location_name || '?')}</b> <span class="badge">${esc(l.location_kind || '')}</span><div>${sourceBadge(l)}</div>` : '<span class="muted">Never scanned</span>'}</td>
      <td>${checkSummary(a)}</td>
      <td>${a.alerts.length ? a.alerts.map((x) => `<div><span class="badge badge-danger">${esc(x.text)}</span></div>`).join('') : '<span class="muted">—</span>'}</td>
      <td>${l ? `${esc(ago(l.recorded_at))}<div class="muted">${esc(l.user_name || '')}</div>` : ''}${a.stale && l ? '<div><span class="badge badge-warn">stale</span></div>' : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">No assets match.</td></tr>';
  $('rows').querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => openAsset(tr.dataset.id)));
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

/** Where to draw an asset: the WTG's surveyed position, or the reading's GPS fix on the SOV. */
function positionOf(a) {
  const l = a.last;
  if (!l) return null;
  if (l.location_kind === 'WTG' && l.location_lat != null) return { key: `loc:${l.location_id}`, lat: l.location_lat, lon: l.location_lon, title: l.location_name };
  if (l.location_kind === 'SOV') {
    const sov = locations.find((x) => x.id === l.location_id);
    if (l.lat != null && l.gps_status === 'ok') return { key: `loc:${l.location_id}`, lat: l.lat, lon: l.lon, title: `${l.location_name} (last fix)` };
    if (sov?.lat != null) return { key: `loc:${l.location_id}`, lat: sov.lat, lon: sov.lon, title: l.location_name };
  }
  return null;
}

function renderMap(list) {
  if (!map) return;
  markerLayer.clearLayers();
  const bounds = [];
  for (const l of locations.filter((x) => x.kind === 'WTG' && x.lat != null)) {
    L.marker([l.lat, l.lon], { icon: L.divIcon({ className: '', html: '<div class="map-wtg"></div>', iconSize: [14, 14] }), title: l.name, keyboard: false })
      .bindTooltip(l.name).addTo(markerLayer);
    bounds.push([l.lat, l.lon]);
  }
  const groups = new Map();
  for (const a of list) {
    const p = positionOf(a);
    if (!p) continue;
    if (!groups.has(p.key)) groups.set(p.key, { ...p, assets: [] });
    groups.get(p.key).assets.push(a);
  }
  for (const g of groups.values()) {
    const alert = g.assets.some((a) => a.alerts.length);
    const icon = L.divIcon({ className: '', html: `<div class="map-count${alert ? ' alert' : ''}">${g.assets.length}</div>`, iconSize: [28, 28] });
    const html = `<b>${esc(g.title)}</b><br>${g.assets.map((a) =>
      `${esc(a.serial)}${a.alerts.length ? ' <span style="color:#c0392b">⚠</span>' : ''}`).join('<br>')}`;
    L.marker([g.lat, g.lon], { icon, zIndexOffset: 1000 }).bindPopup(html).addTo(markerLayer);
    bounds.push([g.lat, g.lon]);
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
        <h2 id="d-title" style="margin:0">${esc(asset.serial)}</h2>
        <button class="btn" type="button" id="d-close">Close</button>
      </div>
      <p class="muted">${esc(type.name)}${asset.name ? ` · ${esc(asset.name)}` : ''} · tags: ${asset.tags.map((t) => `<span class="mono">${esc(t.code)}</span>`).join(', ') || 'none'}</p>
      <dl class="kv">${type.fields.filter((f) => f.scope === 'asset').map((f) =>
        `<dt>${esc(f.label)}</dt><dd>${esc(formatValue(f, asset.attributes[f.key]))}</dd>`).join('')}</dl>
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
