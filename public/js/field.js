// Field app for technicians and warehouse supervisors: scan a tag, confirm the
// location (GPS against known WTG positions, or manual when GPS is jammed),
// enter the check values, and queue the reading for sync.
import {
  ago, api, can, deviceId, esc, loadReference, registerServiceWorker, renderHeader, requireLogin,
  startAutoSync, syncNow, toast, updateSyncPill,
} from './app.js';
import { evaluateAlerts, formatValue, normalizeValues } from './fields.js';
import { collectFields, renderFields, showErrors } from './forms.js';
import { distanceM, resolveLocation } from './geo.js';
import { nfcSupported, parseTagText, readNfc, scanQr } from './scan.js';
import { outbox } from './store.js';

const user = requireLogin('field');
const $ = (id) => document.getElementById(id);

let ref = null;          // offline reference data (types, locations, assets)
let current = null;      // { asset, type, code }
let bestFix = null;      // most recent GPS fix
let resolution = null;   // result of resolveLocation
let chosenLocation = null;
let manualChoice = false;
let fixTimer = null;

if (user) init();

async function init() {
  renderHeader('field');
  registerServiceWorker();
  startAutoSync();
  try {
    ref = await loadReference();
  } catch (e) {
    toast(e.message, 'error');
    ref = { types: [], locations: [], assets: [] };
  }
  showDataAge();
  renderOutbox();
  watchGps();

  if (nfcSupported()) $('btn-nfc').classList.remove('hidden');
  $('btn-qr').onclick = async () => {
    const text = await scanQr();
    if (text) openCode(parseTagText(text));
  };
  $('btn-nfc').onclick = onNfc;
  $('manual-code').onsubmit = (e) => {
    e.preventDefault();
    const code = parseTagText(e.target.code.value);
    if (code) openCode(code);
  };
  $('btn-sync').onclick = () => syncNow({ manual: true });
  $('btn-cancel').onclick = closeReading;
  $('btn-loc-manual').onclick = () => showManualPicker(true);
  $('btn-loc-change').onclick = () => showManualPicker(true);
  $('loc-filter').oninput = fillLocationSelect;
  $('loc-select').onchange = () => {
    chosenLocation = ref.locations.find((l) => l.id === $('loc-select').value) || null;
    manualChoice = true;
    $('loc-error').textContent = '';
    $('loc-name').textContent = chosenLocation ? labelFor(chosenLocation) : '';
    $('loc-status').textContent = 'Selected manually';
    $('btn-loc-manual').classList.add('hidden');
  };
  $('reading-form').onsubmit = onSave;
  window.addEventListener('at:outbox', renderOutbox);
  window.addEventListener('hashchange', openFromHash);
  openFromHash();
}

function showDataAge() {
  $('data-age').textContent = ref.fromCache
    ? `Offline - using asset list saved ${ago(ref.serverTime)}.`
    : `Asset list up to date (${ref.assets.length} assets, ${ref.locations.length} locations).`;
}

// ---------------------------------------------------------------- GPS

// GPS is watched from page load so a fix is usually ready by the time the tag is scanned.
function watchGps() {
  if (!('geolocation' in navigator)) {
    $('gps-warm').textContent = 'This device has no GPS - locations must be entered manually.';
    return;
  }
  navigator.geolocation.watchPosition(
    (p) => {
      bestFix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp };
      $('gps-warm').textContent = `GPS ready (±${Math.round(p.coords.accuracy)} m).`;
      if (current && !manualChoice && geoCheckOn()) applyResolution();
    },
    (err) => {
      $('gps-warm').textContent = err.code === err.PERMISSION_DENIED
        ? 'Location permission denied - allow it in the browser settings, or enter locations manually.'
        : 'Waiting for GPS…';
    },
    { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
  );
}

// Off while testing away from the wind farm (GEO_CHECK=off on the server).
const geoCheckOn = () => ref?.settings?.geoCheck !== false;
const LAST_LOCATION_KEY = 'at.lastLocation';

/** Testing mode: no GPS lock or warnings; the user picks any location. */
function applyTestMode() {
  resolution = null;
  const lastId = localStorage.getItem(LAST_LOCATION_KEY);
  chosenLocation = ref.locations.find((l) => l.id === lastId) || null;
  manualChoice = !!chosenLocation;
  $('loc-box').className = 'loc-box';
  $('loc-status').textContent = 'Location check off (testing)';
  $('loc-name').textContent = chosenLocation ? labelFor(chosenLocation) : '';
  $('loc-detail').textContent = 'GPS is not checked against the turbine positions. Select any location.';
  $('btn-loc-change').classList.add('hidden');
  $('btn-loc-manual').classList.add('hidden');
  showManualPicker(false);
}

function applyResolution() {
  resolution = resolveLocation(bestFix, ref.locations);
  const box = $('loc-box');
  const status = {
    ok: 'GPS position',
    poor_accuracy: 'Weak GPS signal',
    no_fix: 'No GPS position',
    implausible: 'GPS position not plausible',
  }[resolution.gpsStatus];
  $('loc-status').textContent = status;
  $('loc-detail').textContent = resolution.reason;
  if (!manualChoice) chosenLocation = resolution.requiresManual ? null : resolution.suggestion;
  box.className = `loc-box ${resolution.requiresManual ? 'warn' : 'ok'}`;
  $('loc-name').textContent = chosenLocation ? labelFor(chosenLocation) : '';
  $('btn-loc-change').classList.toggle('hidden', !chosenLocation);
  $('btn-loc-manual').classList.toggle('hidden', !!chosenLocation);
  if (resolution.requiresManual) showManualPicker(false);
}

function labelFor(l) {
  return l.kind === 'SOV' ? `${l.name} (vessel)` : l.name;
}

function showManualPicker(focus) {
  $('loc-manual').classList.remove('hidden');
  fillLocationSelect();
  if (focus) $('loc-filter').focus();
}

function fillLocationSelect() {
  const q = $('loc-filter').value.trim().toLowerCase().replace(/\s+/g, '');
  const dist = new Map((resolution?.nearest || []).map((n) => [n.location.id, n.distanceM]));
  const match = (l) => !q || l.name.toLowerCase().replace(/\s+/g, '').includes(q);
  const sovs = ref.locations.filter((l) => l.kind === 'SOV' && match(l));
  // Nearest turbines first when GPS gives a usable hint, else alphabetical.
  const wtgs = ref.locations.filter((l) => l.kind === 'WTG' && match(l))
    .sort((a, b) => (dist.get(a.id) ?? Infinity) - (dist.get(b.id) ?? Infinity) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }));
  const opt = (l) => {
    const d = dist.get(l.id);
    const hint = d != null && resolution?.gpsStatus !== 'implausible' ? ` · ${d < 2000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`}` : '';
    return `<option value="${l.id}"${chosenLocation?.id === l.id ? ' selected' : ''}>${esc(l.name)}${hint}</option>`;
  };
  $('loc-select').innerHTML =
    (sovs.length ? `<optgroup label="Vessel (SOV)">${sovs.map(opt).join('')}</optgroup>` : '') +
    (wtgs.length ? `<optgroup label="Turbines (WTG)">${wtgs.map(opt).join('')}</optgroup>` : '');
}

// ---------------------------------------------------------------- identify

async function onNfc() {
  const btn = $('btn-nfc');
  const ctrl = new AbortController();
  btn.textContent = 'Hold phone against the tag… (tap to cancel)';
  btn.onclick = () => ctrl.abort();
  try {
    const { code, serialCode } = await readNfc(ctrl.signal);
    // Try the stored code first, then the chip serial (tags linked by serial only).
    const known = findAsset(code) ? code : findAsset(serialCode) ? serialCode : code;
    openCode(known);
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message || 'NFC not available', 'error');
  } finally {
    ctrl.abort();
    btn.textContent = 'Read NFC tag';
    btn.onclick = onNfc;
  }
}

function openFromHash() {
  const code = new URLSearchParams(location.hash.slice(1)).get('t');
  if (code) openCode(code);
}

function findAsset(code) {
  if (!code) return null;
  const c = code.toLowerCase();
  return ref.assets.find((a) => a.tags.some((t) => t.code.toLowerCase() === c)) ||
    ref.assets.find((a) => a.serial.toLowerCase() === c) || null;
}

async function openCode(code) {
  let asset = findAsset(code);
  if (!asset && navigator.onLine !== false) {
    // Linked after this phone's last refresh? Ask the server and refresh the cache.
    try {
      asset = (await api(`/api/tags/${encodeURIComponent(code)}`)).asset;
      ref = await loadReference();
      showDataAge();
    } catch (e) {
      if (e.status === 404) {
        if (can('link') && confirm(`Tag ${code} is not linked to an asset yet. Link it now?`)) {
          location.href = `/link#t=${encodeURIComponent(code)}`;
          return;
        }
        if (!can('link')) toast(`Tag ${code} is not linked to any asset. Ask the warehouse supervisor to link it.`, 'error');
        return;
      }
    }
  }
  if (!asset) {
    // Offline and unknown: still allow recording; the server resolves the tag at sync.
    const type = ref.types.length === 1 ? ref.types[0] : await pickType();
    if (!type) return;
    current = { asset: null, type, code };
  } else {
    const type = ref.types.find((t) => t.id === asset.type_id) || { id: asset.type_id, name: asset.type_id, fields: [] };
    current = { asset, type, code };
  }
  showReading();
}

function pickType() {
  const names = ref.types.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
  const n = Number(prompt(`Tag not in the offline list. What kind of equipment is it?\n${names}`, '1'));
  return Promise.resolve(ref.types[n - 1] || null);
}

// ---------------------------------------------------------------- record

function showReading() {
  const { asset, type, code } = current;
  manualChoice = false;
  chosenLocation = null;
  $('a-title').textContent = asset ? `${asset.serial}${asset.name ? ` - ${asset.name}` : ''}` : code;
  $('a-sub').textContent = `${type.name} · tag ${code}`;
  $('a-attrs').innerHTML = asset
    ? type.fields.filter((f) => f.scope === 'asset').map((f) =>
        `<dt>${esc(f.label)}</dt><dd>${esc(formatValue(f, asset.attributes[f.key]))}</dd>`).join('')
    : '';
  $('a-unknown').classList.toggle('hidden', !!asset);
  $('a-unknown').textContent = 'This tag is not in the offline asset list. The reading will be matched to its asset when it syncs.';
  renderFields($('check-fields'), type.fields, 'check');
  $('notes').value = '';
  $('loc-filter').value = '';
  $('loc-manual').classList.add('hidden');
  $('loc-error').textContent = '';
  $('scan-view').classList.add('hidden');
  $('reading-view').classList.remove('hidden');
  window.scrollTo(0, 0);

  clearTimeout(fixTimer);
  if (!geoCheckOn()) {
    applyTestMode();
  } else if (bestFix || !('geolocation' in navigator)) {
    applyResolution();
  } else {
    // The GPS watcher applies the fix as soon as it arrives; after a grace
    // period without one, treat it as no fix (jamming) and ask for manual entry.
    resolution = null;
    $('loc-box').className = 'loc-box';
    $('loc-status').textContent = 'Getting GPS position…';
    $('loc-name').textContent = '';
    $('loc-detail').textContent = '';
    $('btn-loc-change').classList.add('hidden');
    $('btn-loc-manual').classList.remove('hidden');
    fixTimer = setTimeout(() => { if (current && !resolution) applyResolution(); }, 15_000);
  }
}

function closeReading() {
  current = null;
  clearTimeout(fixTimer);
  $('reading-view').classList.add('hidden');
  $('scan-view').classList.remove('hidden');
  if (location.hash) history.replaceState(null, '', location.pathname);
}

async function onSave(e) {
  e.preventDefault();
  const form = $('reading-form');
  const { values, errors } = normalizeValues(current.type.fields, 'check', collectFields(form, current.type.fields, 'check'));
  showErrors(form, errors);
  if (!chosenLocation) {
    $('loc-error').textContent = 'Select where the asset is.';
    showManualPicker(true);
    return;
  }
  if (Object.keys(errors).length) return;

  const fix = bestFix;
  // In testing mode the GPS status is still recorded, it just never decided the location.
  if (!geoCheckOn()) resolution = resolveLocation(fix, ref.locations);
  const usedGps = geoCheckOn() && !manualChoice && resolution && !resolution.requiresManual;
  localStorage.setItem(LAST_LOCATION_KEY, chosenLocation.id);
  const reading = {
    id: crypto.randomUUID(),
    asset_id: current.asset?.id ?? null,
    tag_code: current.code,
    recorded_at: new Date().toISOString(),
    location_id: chosenLocation.id,
    location_source: usedGps ? 'gps' : 'manual',
    gps_status: resolution?.gpsStatus ?? 'unavailable',
    lat: fix?.lat ?? null,
    lon: fix?.lon ?? null,
    accuracy_m: fix?.accuracy ?? null,
    distance_m: fix && chosenLocation.kind === 'WTG' && chosenLocation.lat != null
      ? Math.round(distanceM(fix.lat, fix.lon, chosenLocation.lat, chosenLocation.lon)) : null,
    data: values,
    notes: $('notes').value.trim() || null,
    device_id: deviceId(),
    recorded_by: user.name,
    // Local-only display label; stripped before upload.
    label: `${current.asset?.serial ?? current.code} @ ${chosenLocation.name}`,
  };
  await outbox.put(reading);
  const alerts = evaluateAlerts(current.type.fields, values);
  toast(alerts.length ? `Saved - alert: ${alerts.map((a) => a.text).join('; ')}` : 'Reading saved', alerts.length ? 'error' : 'ok');
  closeReading();
  renderOutbox();
  updateSyncPill();
  if (navigator.onLine !== false) syncNow();
}

async function renderOutbox() {
  const items = (await outbox.all()).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const box = $('outbox');
  if (!items.length) {
    box.textContent = 'Nothing queued - all readings are on the server.';
    return;
  }
  box.innerHTML = items.map((i) => `
    <div class="outbox-item">
      <div>
        <div>${esc(i.label || i.tag_code)}</div>
        <div class="muted">${new Date(i.recorded_at).toLocaleString()}</div>
        ${i.rejected ? `<div class="field-error">Rejected: ${esc(i.error)}</div>` : ''}
      </div>
      <div>${i.rejected
        ? `<button class="link-btn" data-discard="${i.id}">Discard</button>`
        : '<span class="badge badge-warn">Queued</span>'}</div>
    </div>`).join('');
  box.querySelectorAll('[data-discard]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Discard this reading? It will not be sent to the server.')) return;
      await outbox.remove([b.dataset.discard]);
      renderOutbox();
      updateSyncPill();
    };
  });
}
