// Guided scan flow for technicians. Open the app, scan the QR label, and answer one
// question per screen:
//   location (confirm or edit) -> alarms -> fuel cube (still there? connected?)
//   -> fuel level -> summary -> save.
// Everything is saved on the phone first and synced when there is a connection.
import { showInstallGuide } from './install.js';
import {
  SLUG, ago, api, esc, loadReference, path, registerServiceWorker, renderHeader, requireProject,
  startAutoSync, syncNow, toast, updateSyncPill,
} from './app.js';
import { blockedBy, kindOf, typeById } from './equipment.js';
import { applyLocationRules, evaluateAlerts, fixedAt, formatValue, normalizeValues } from './fields.js';
import { distanceM, resolveLocation } from './geo.js';
import { knownPartner, pairingFor } from './pairing.js';
import { nfcSupported, parseTagText, readNfc, scanQr } from './scan.js';
import { cache, outbox } from './store.js';

const ok = requireProject();
const $ = (id) => document.getElementById(id);

let ref = null;          // offline snapshot of this project (types, locations, equipment)
let fix = null;          // latest GPS fix
let resolution = null;   // what the GPS fix says about the location
let pending = [];        // outbox items, so connections recorded offline count as known
let s = null;            // the scan in progress
let trail = [];          // steps visited, for Back
let fixTimer = null;

// "Wherever the phone is" (testing only; in live mode the location is always a WTG or vessel).
const HERE = { id: '__gps', kind: 'GPS', name: 'Phone GPS position' };
const testMode = () => ref?.settings?.geoMode !== 'live';

if (ok) init();

async function init() {
  renderHeader('field');
  registerServiceWorker();
  startAutoSync();
  showSplash();
  try {
    ref = await loadReference();
  } catch (e) {
    toast(e.message, 'error');
    ref = { types: [], locations: [], assets: [], settings: {}, openIssues: 0 };
  }
  renderOutbox();
  watchGps();

  if (ref.settings?.nfcEnabled && nfcSupported()) $('btn-nfc').classList.remove('hidden');
  $('btn-qr').onclick = async () => { const text = await scanQr(); if (text) openCode(text); };
  $('btn-nfc').onclick = onNfc;
  $('manual-code').onsubmit = (e) => { e.preventDefault(); const c = e.target.code.value.trim(); if (c) openCode(c); };
  $('btn-sync').onclick = () => syncNow({ manual: true });
  $('btn-cancel').onclick = leaveFlow;
  $('btn-back').onclick = back;
  $('btn-problem').onclick = () => openProblem('label_mismatch');
  $('problem-cancel').onclick = () => $('problem').close();
  $('problem-send').onclick = sendProblem;
  $('problem-defect').onclick = sendDefect;
  $('blocked-back').onclick = leaveFlow;
  window.addEventListener('at:outbox', renderOutbox);
  window.addEventListener('hashchange', openFromHash);
  openFromHash();
  showInstallGuide({ auto: true }).then(maybeTour);
}

const typeOf = (a) => typeById(ref.types, a.type_id);

// ---------------------------------------------------------------- splash + first-time tour

function showSplash() {
  let seen = false;
  try { seen = sessionStorage.getItem('at.splash') === '1'; sessionStorage.setItem('at.splash', '1'); } catch { /* ignore */ }
  if (seen) return;
  const el = $('splash');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 1700);
}

const TOUR = [
  ['Scan the QR label', 'Point the camera at the QR label on the generator or fuel cube. If the camera does not work, type the code printed under the label.'],
  ['Confirm where you are', 'The phone finds the turbine with GPS. Tap Confirm, or Edit to pick the turbine or vessel yourself.'],
  ['Answer a few questions', 'Alarms, fuel cube and fuel level, one question per screen. Then Save. Without signal everything is kept on the phone and sent automatically later.'],
];

function maybeTour() {
  const key = `at.tour.${SLUG}`;
  let seen = null;
  try { seen = localStorage.getItem(key); } catch { /* ignore */ }
  if (seen || location.hash.includes('t=')) return;
  let i = 0;
  const dlg = $('tour');
  const show = () => {
    $('tour-count').textContent = `${i + 1} of ${TOUR.length}`;
    $('tour-title').textContent = TOUR[i][0];
    $('tour-text').textContent = TOUR[i][1];
    $('tour-next').textContent = i === TOUR.length - 1 ? 'Got it' : 'Next';
  };
  const done = () => { try { localStorage.setItem(key, '1'); } catch { /* ignore */ } dlg.close(); };
  $('tour-next').onclick = () => { if (i === TOUR.length - 1) done(); else { i++; show(); } };
  $('tour-skip').onclick = done;
  show();
  setTimeout(() => { if (!dlg.open) dlg.showModal(); }, 1800);
}

// ---------------------------------------------------------------- GPS

function watchGps() {
  const led = (state, tip) => { $('gps').dataset.state = state; $('gps').title = tip; };
  if (!('geolocation' in navigator)) { led('off', 'This device has no GPS: choose locations by hand'); return; }
  navigator.geolocation.watchPosition(
    (p) => {
      fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp };
      led(p.coords.accuracy > 100 ? 'weak' : 'ok', `GPS ±${Math.round(p.coords.accuracy)} m`);
      if (s && s.step === 'location' && !s.locManual && !s.editing) { autoPick(); render(); }
    },
    (err) => {
      led(err.code === err.PERMISSION_DENIED ? 'off' : 'search', err.code === err.PERMISSION_DENIED ? 'Location permission denied. Allow it in the browser settings' : 'Waiting for GPS');
    },
    { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
  );
}

function resolve() {
  resolution = resolveLocation(fix, ref.locations, { mode: ref.settings?.geoMode || 'test', farmKm: ref.settings?.farmRadiusKm || 20 });
}

/** Chooses the location the GPS suggests; leaves it empty when it must be chosen by hand. */
function autoPick() {
  resolve();
  if (s.locManual) return;
  if (resolution.elsewhere && fix && testMode()) s.loc = HERE;
  else if (resolution.suggestion && (!resolution.requiresManual || resolution.gpsStatus === 'poor_accuracy')) s.loc = resolution.suggestion;
  else s.loc = null;
}

// ---------------------------------------------------------------- identify

async function onNfc() {
  const btn = $('btn-nfc');
  const ctrl = new AbortController();
  btn.textContent = 'Hold phone against the tag… (tap to cancel)';
  btn.onclick = () => ctrl.abort();
  try {
    const { code, serialCode } = await readNfc(ctrl.signal);
    openCode(findAsset(code) ? code : findAsset(serialCode) ? serialCode : code);
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
  if (code) { history.replaceState(null, '', location.pathname); openCode(code); }
}

function findAsset(code) {
  if (!code) return null;
  const c = String(code).toLowerCase();
  return ref.assets.find((a) => a.tags.some((t) => t.code.toLowerCase() === c)) ||
    ref.assets.find((a) => a.serial.toLowerCase() === c) || null;
}

async function openCode(raw) {
  const code = parseTagText(raw);
  if (!code) return;
  let asset = findAsset(code);
  if (!asset && navigator.onLine !== false) {
    // Registered after this phone's last refresh? Ask the server and refresh the copy.
    try {
      await api(`/api/tags/${encodeURIComponent(code)}`);
      ref = await loadReference();
      asset = findAsset(code);
    } catch (e) {
      if (e.status && e.status !== 404) toast(e.message, 'error');
    }
  }
  if (!asset) { openProblem('unknown_tag', code); return; }
  startScan(asset, code);
}

// ---------------------------------------------------------------- the guided questions

function startScan(asset, code) {
  const type = typeOf(asset);
  const block = blockedBy(asset, type);
  if (block) { showBlocked(asset, type, block); return; }
  s = {
    asset, type, code, loc: null, locManual: false, editing: false, locSource: 'gps',
    answers: {}, pairing: pairingFor(ref.types, type), known: null,
    partner: { status: 'none', asset: null, code: null }, partnerAnswer: null, sov: null, issues: [], step: null,
  };
  trail = [];
  $('view-home').classList.add('hidden');
  $('view-flow').classList.remove('hidden');
  resolve();
  autoPick();
  clearTimeout(fixTimer);
  // Give GPS a few seconds before asking for the location by hand.
  if (!fix && 'geolocation' in navigator) fixTimer = setTimeout(() => { if (s?.step === 'location' && !s.loc) { autoPick(); render(); } }, 12_000);
  go('location');
}

/** Defect or inspection overdue: the equipment may not be used, so no questions are asked. */
function showBlocked(asset, type, block) {
  $('blocked-what').textContent = `${kindOf(asset, type)} · ${asset.serial}`;
  $('blocked-why').textContent = block.text;
  $('view-home').classList.add('hidden');
  $('view-flow').classList.add('hidden');
  $('view-blocked').classList.remove('hidden');
  window.scrollTo(0, 0);
  navigator.vibrate?.([200, 100, 200]);
}

function leaveFlow() {
  $('view-blocked').classList.add('hidden');
  clearTimeout(fixTimer);
  s = null;
  trail = [];
  $('view-flow').classList.add('hidden');
  $('view-home').classList.remove('hidden');
  window.scrollTo(0, 0);
}

const sovs = () => ref.locations.filter((l) => l.kind === 'SOV');
const checkFields = () => s.type.fields.filter((f) => f.scope === 'check');
const pairField = () => (s.pairing?.direction === 'forward' ? s.pairing.field : null);

/** The steps this scan needs, from what is known so far. Recomputed after every answer. */
function plan() {
  const ids = ['location'];
  const fields = checkFields();
  const pf = pairField();
  const fixedKeys = new Set(fixedAt(s.type.fields, s.loc?.kind).map((f) => f.key));
  for (const f of fields.filter((x) => x.type === 'multiselect')) ids.push(`f:${f.key}`);
  if (pf && s.loc && !fixedKeys.has(pf.key)) {
    if (s.known) {
      ids.push('cube-known');
      if (s.partner.status === 'removed' && sovs().length > 1) ids.push('cube-sov');
    } else {
      ids.push('cube-ask');
      if (s.partnerAnswer === true) ids.push('cube-scan');
    }
  } else if (s.pairing?.direction === 'reverse' && s.loc?.kind === 'WTG') {
    if (s.known) ids.push('gen-known');
    else { ids.push('gen-ask'); if (s.partnerAnswer === true) ids.push('gen-scan'); }
  }
  for (const f of fields.filter((x) => x.type === 'boolean' && x !== pf && !fixedKeys.has(x.key))) ids.push(`f:${f.key}`);
  for (const f of fields.filter((x) => !['multiselect', 'boolean'].includes(x.type))) ids.push(`f:${f.key}`);
  ids.push('summary');
  return ids;
}

function refreshKnown() {
  const wanted = s.pairing?.partnerType?.id;
  const p = s.loc && s.loc !== HERE ? knownPartner(s.asset, s.loc.id, ref.assets, pending) : null;
  s.known = p && p.type_id === wanted ? p : null;
}

function go(step, { isBack = false } = {}) {
  if (!isBack && s.step) trail.push(s.step);
  s.step = step;
  render();
  window.scrollTo(0, 0);
}

function advance() {
  const p = plan();
  const i = p.indexOf(s.step);
  go(p[Math.min(p.length - 1, i + 1)]);
}

function back() {
  if (s.step === 'location' && !s.editing) return leaveFlow();
  const prev = trail.pop();
  if (!prev) return leaveFlow();
  if (prev === 'location') s.editing = false;
  go(prev, { isBack: true });
}

function nav({ next = null, disabled = false, hideBack = false } = {}) {
  $('btn-next').classList.toggle('hidden', !next);
  $('btn-next').textContent = next || '';
  $('btn-next').disabled = disabled;
  $('btn-back').classList.toggle('hidden', hideBack);
  $('nav').classList.toggle('single', !next || hideBack);
}

function render() {
  const p = plan();
  const i = Math.max(0, p.indexOf(s.step));
  $('progress').innerHTML = p.map((_, n) => `<span class="${n <= i ? 'done' : ''}"></span>`).join('');
  $('step-label').textContent = `${kindOf(s.asset, s.type)} · tag ${s.code}`;
  $('btn-back').textContent = s.step === 'location' ? 'Cancel scan' : 'Back';
  $('btn-next').onclick = null;
  const [kind, key] = s.step.split(':');
  (STEPS[kind] || STEPS.summary)(key);
}

// ---------------------------------------------------------------- steps

const STEPS = {
  location() {
    refreshKnown();
    if (!s.editing && s.loc) {
      const warn = resolution?.requiresManual && s.loc !== HERE;
      $('step').innerHTML = `<h1>Where are you?</h1>
        <div class="loc-hero ${warn ? 'warn' : 'ok'}">
          <div class="muted">${esc(locationStatus())}</div>
          <div class="loc-name">${esc(locLabel(s.loc))}</div>
          <div class="muted">${esc(resolution?.reason || '')}</div>
        </div>
        <button type="button" class="btn btn-primary btn-big" id="loc-confirm">Confirm</button>
        <button type="button" class="btn btn-big" id="loc-edit" style="margin-top:10px">Edit</button>`;
      $('loc-confirm').onclick = () => { s.locSource = s.loc === HERE || (!s.locManual && !resolution?.requiresManual) ? 'gps' : 'manual'; refreshKnown(); advance(); };
      $('loc-edit').onclick = () => { s.editing = true; render(); };
      nav({ hideBack: false });
      return;
    }
    const waiting = !s.loc && !fix && 'geolocation' in navigator && !s.editing && !s.locManual && resolution?.gpsStatus === 'no_fix' && fixTimer;
    $('step').innerHTML = `<h1>${s.editing ? 'Choose the location' : 'Where are you?'}</h1>
      ${waiting ? '<p class="muted">Getting GPS position…</p>' : `<p class="muted">${esc(s.editing ? 'Select the turbine or vessel.' : resolution?.reason || 'Select the turbine or vessel.')}</p>`}
      <div class="field"><input id="loc-filter" type="search" placeholder="Filter, e.g. A03" aria-label="Filter locations"></div>
      <div class="pick-list" id="loc-list"></div>`;
    $('loc-filter').oninput = fillPicker;
    fillPicker();
    nav({ hideBack: false });
  },

  f(key) {
    const f = checkFields().find((x) => x.key === key);
    const values = s.answers;
    const forCube = s.pairing?.direction === 'forward' && ['known', 'scanned'].includes(s.partner.status);
    const isBattery = /batter/i.test(f.key);
    const about = forCube && !isBattery ? s.pairing.partnerType.name.toLowerCase() : s.type.name.toLowerCase();
    if (f.type === 'multiselect') {
      const chosen = new Set(values[key] || []);
      $('step').innerHTML = `<h1>${esc(f.label)}</h1><p class="muted">Tick every alarm that is active. Leave all unticked if there are none.</p>
        <div class="toggle-list">${f.options.map((o) => `<button type="button" class="btn" data-o="${esc(o)}" aria-pressed="${chosen.has(o)}">${esc(o)}</button>`).join('')}</div>`;
      $('step').querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        on ? chosen.add(b.dataset.o) : chosen.delete(b.dataset.o);
        values[key] = [...chosen];
        $('btn-next').textContent = chosen.size ? 'Next' : 'No alarms';
      }));
      nav({ next: chosen.size ? 'Next' : 'No alarms' });
      $('btn-next').onclick = () => { values[key] = [...chosen]; advance(); };
      return;
    }
    if (f.type === 'boolean') {
      $('step').innerHTML = `<h1>${esc(f.label)}?</h1><div class="choice-list"><button type="button" class="btn" data-v="true">Yes</button><button type="button" class="btn" data-v="false">No</button></div>`;
      $('step').querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { values[key] = b.dataset.v === 'true'; advance(); }));
      nav({});
      return;
    }
    const steps = f.type === 'number' && f.step && f.min != null && f.max != null ? Math.floor((f.max - f.min) / f.step) + 1 : 0;
    if (steps >= 2 && steps <= 11) {
      const choices = Array.from({ length: steps }, (_, n) => f.min + n * f.step);
      const lowAt = f.alert?.atMost ?? (f.alert?.below != null ? f.alert.below - 1e-9 : null);
      $('step').innerHTML = `<h1>${esc(f.label)}</h1><p class="muted">${isBattery ? `Read the battery level on the ${esc(about)}.` : `Read the level on the ${esc(about)}.`}</p>
        <div class="gauge-list">${[...choices].reverse().map((c) => `<button type="button" class="gauge${lowAt != null && c <= lowAt ? ' low' : ''}" data-v="${c}"><b>${c}${f.unit === '%' ? ' %' : esc(f.unit ? ` ${f.unit}` : '')}</b><span class="muted">${c === f.max ? 'full' : c === f.min ? 'empty' : ''}</span>
          <span class="bar"><span style="width:${((c - f.min) / (f.max - f.min)) * 100}%"></span></span></button>`).join('')}</div>`;
      $('step').querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { values[key] = Number(b.dataset.v); advance(); }));
      nav({});
      return;
    }
    if (f.type === 'select') {
      $('step').innerHTML = `<h1>${esc(f.label)}</h1><div class="choice-list">${f.options.map((o) => `<button type="button" class="btn" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
      $('step').querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { values[key] = b.dataset.v; advance(); }));
      nav({});
      return;
    }
    const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
    $('step').innerHTML = `<h1>${esc(f.label)}${f.unit ? ` <span class="muted">(${esc(f.unit)})</span>` : ''}</h1>
      <div class="field"><input id="in-field" class="big" type="${type}" inputmode="${f.type === 'number' ? 'decimal' : 'text'}" value="${esc(values[key] ?? '')}" aria-label="${esc(f.label)}"></div>
      <div class="field-error" id="in-error"></div>`;
    const go1 = () => {
      const v = $('in-field').value;
      const { errors } = normalizeValues([f], 'check', { [key]: v });
      if (errors[key]) { $('in-error').textContent = errors[key]; return; }
      values[key] = v;
      advance();
    };
    nav({ next: 'Next' });
    $('btn-next').onclick = go1;
    $('in-field').onkeydown = (e) => { if (e.key === 'Enter') go1(); };
    $('in-field').focus();
  },

  // ---- fuel cube, asked on the generator
  'cube-known'() {
    const p = s.known;
    $('step').innerHTML = `<h1>Is the fuel cube still here?</h1>
      <div class="partner-card"><b>${esc(partnerLabel(p))}</b><div class="muted">${p.tags[0] ? `tag ${esc(p.tags[0].code)}` : ''} · connected to this generator at ${esc(locLabel(s.loc))}</div></div>
      <div class="choice-list"><button type="button" class="btn" id="cube-yes">Yes, it is connected</button><button type="button" class="btn" id="cube-no">No, it is not here</button></div>`;
    $('cube-yes').onclick = () => { s.partner = { status: 'known', asset: p, code: p.tags[0]?.code ?? null }; s.answers[pairField().key] = true; advance(); };
    $('cube-no').onclick = () => {
      s.partner = { status: 'removed', asset: p, code: p.tags[0]?.code ?? null };
      s.answers[pairField().key] = false;
      if (sovs().length === 1) s.sov = sovs()[0];
      advance();
    };
    nav({});
  },

  'cube-sov'() {
    $('step').innerHTML = `<h1>Which vessel is it on?</h1><p class="muted">The fuel cube is moved back to the vessel.</p>
      <div class="choice-list">${sovs().map((l) => `<button type="button" class="btn" data-id="${esc(l.id)}">${esc(l.name)}</button>`).join('')}</div>`;
    $('step').querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => { s.sov = sovs().find((l) => l.id === b.dataset.id); advance(); }));
    nav({});
  },

  'cube-ask'() {
    const pt = s.pairing.partnerType.name.toLowerCase();
    $('step').innerHTML = `<h1>${esc(pairField().label)}?</h1><p class="muted">Is a ${esc(pt)} connected to this ${esc(s.type.name.toLowerCase())}?</p>
      <div class="choice-list"><button type="button" class="btn" id="ask-yes">Yes</button><button type="button" class="btn" id="ask-no">No</button></div>`;
    $('ask-yes').onclick = () => { s.partnerAnswer = true; s.answers[pairField().key] = true; advance(); };
    $('ask-no').onclick = () => { s.partnerAnswer = false; s.partner = { status: 'none', asset: null, code: null }; s.answers[pairField().key] = false; advance(); };
    nav({});
  },

  'cube-scan'() { partnerScan('forward'); },

  // ---- generator, asked on the fuel cube
  'gen-known'() {
    const p = s.known;
    $('step').innerHTML = `<h1>Still connected to this generator?</h1>
      <div class="partner-card"><b>${esc(partnerLabel(p))}</b><div class="muted">${p.tags[0] ? `tag ${esc(p.tags[0].code)}` : ''}</div></div>
      <div class="choice-list"><button type="button" class="btn" id="gen-yes">Yes, it is connected</button><button type="button" class="btn" id="gen-no">No, not connected</button></div>`;
    $('gen-yes').onclick = () => { s.partner = { status: 'known', asset: p, code: p.tags[0]?.code ?? null }; advance(); };
    $('gen-no').onclick = () => { s.partner = { status: 'none', asset: null, code: null }; advance(); };
    nav({});
  },

  'gen-ask'() {
    const pt = s.pairing.partnerType.name.toLowerCase();
    $('step').innerHTML = `<h1>Connected to a ${esc(pt)}?</h1>
      <div class="choice-list"><button type="button" class="btn" id="ask-yes">Yes, scan the ${esc(pt)}</button><button type="button" class="btn" id="ask-no">No</button></div>`;
    $('ask-yes').onclick = () => { s.partnerAnswer = true; advance(); };
    $('ask-no').onclick = () => { s.partnerAnswer = false; s.partner = { status: 'none', asset: null, code: null }; advance(); };
    nav({});
  },

  'gen-scan'() { partnerScan('reverse'); },

  summary() {
    const { values } = collectValues();
    const alerts = evaluateAlerts(s.type.fields, values);
    const rows = [['Equipment', kindOf(s.asset, s.type)], ['Location', locLabel(s.loc)]];
    for (const f of checkFields()) {
      if (values[f.key] === undefined && f.type === 'multiselect') { rows.push([f.label, 'None']); continue; }
      if (values[f.key] === undefined) continue;
      rows.push([f.label, formatValue(f, values[f.key])]);
    }
    if (s.partner.status === 'known' || s.partner.status === 'scanned') rows.push([s.pairing.partnerType.name, partnerLabel(s.partner.asset)]);
    if (s.partner.status === 'removed') rows.push([s.pairing.partnerType.name, 'Not here: moved to the vessel']);
    $('step').innerHTML = `<h1>Ready to save</h1>
      ${alerts.length ? `<div class="notice notice-danger">${alerts.map((a) => `⚠ ${esc(a.text)}`).join('<br>')}</div>` : ''}
      <dl style="margin:0">${rows.map(([k, v]) => `<div class="sum-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="field-error" id="save-error"></div>`;
    nav({ next: 'Save' });
    $('btn-next').onclick = save;
  },
};

const locLabel = (l) => (l === HERE ? (fix ? `Here (${fix.lat.toFixed(4)}, ${fix.lon.toFixed(4)})` : 'Here (GPS position)') : l.kind === 'SOV' ? `${l.name} (vessel)` : l.name);
const partnerLabel = (a) => (a ? kindOf(a, typeOf(a)) : s.pairing.partnerType.name);

function locationStatus() {
  if (s.loc === HERE) return 'Away from the wind farm (testing)';
  return { ok: 'GPS position', poor_accuracy: 'Weak GPS signal', no_fix: 'No GPS position', implausible: 'GPS position not plausible' }[resolution?.gpsStatus] || 'Location';
}

function fillPicker() {
  const q = $('loc-filter').value.trim().toLowerCase().replace(/\s+/g, '');
  const dist = new Map((resolution?.nearest || []).map((n) => [n.location.id, n.distanceM]));
  const match = (l) => !q || l.name.toLowerCase().replace(/\s+/g, '').includes(q);
  const useDist = resolution && resolution.gpsStatus !== 'implausible' && resolution.gpsStatus !== 'no_fix';
  const wtgs = ref.locations.filter((l) => l.kind === 'WTG' && match(l))
    .sort((a, b) => (useDist ? (dist.get(a.id) ?? Infinity) - (dist.get(b.id) ?? Infinity) : 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const item = (l) => {
    const d = dist.get(l.id);
    const hint = useDist && d != null ? (d < 2000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`) : '';
    return `<button type="button" class="btn" data-id="${esc(l.id)}"><span>${esc(l.name)}</span><span class="muted">${hint}</span></button>`;
  };
  const group = (title, list) => (list.length ? `<div class="pick-group">${title}</div>${list.map(item).join('')}` : '');
  const here = fix && testMode() && (!q || 'here gps'.includes(q))
    ? `<div class="pick-group">Elsewhere (testing)</div><button type="button" class="btn" data-id="${HERE.id}"><span>Here (phone GPS position)</span></button>` : '';
  $('loc-list').innerHTML = here + group('Vessel', sovs().filter(match)) + group('Turbines', wtgs) || '<p class="muted">No location found.</p>';
  $('loc-list').querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => {
    s.loc = b.dataset.id === HERE.id ? HERE : ref.locations.find((l) => l.id === b.dataset.id);
    s.locManual = true;
    s.locSource = s.loc === HERE ? 'gps' : 'manual';
    s.editing = false;
    refreshKnown();
    // A new location can change which questions apply.
    if (s.partner.status === 'removed') s.partner = { status: 'none', asset: null, code: null };
    advance();
  }));
}

/** Scan the other unit (the fuel cube, or the generator). */
function partnerScan(direction) {
  const pt = s.pairing.partnerType;
  const owner = s.partner.status === 'scanned' ? s.partner : null;
  $('step').innerHTML = `<h1>Scan the ${esc(pt.name.toLowerCase())}</h1>
    <p class="muted">${direction === 'forward' ? `Scan the QR label on the ${esc(pt.name.toLowerCase())} connected to this ${esc(s.type.name.toLowerCase())}.` : `Scan the QR label on the ${esc(pt.name.toLowerCase())} this ${esc(s.type.name.toLowerCase())} is connected to.`}</p>
    ${owner ? `<div class="notice notice-ok">✓ ${esc(partnerLabel(owner.asset))}${owner.code ? ` · tag <b class="mono">${esc(owner.code)}</b>` : ''}</div>` : ''}
    <div class="field-error" id="scan-error"></div>
    <div class="stack">
      <button type="button" class="btn ${owner ? '' : 'btn-primary'} btn-big" id="p-scan">${owner ? 'Scan again' : 'Scan QR code'}</button>
      ${ref.settings?.nfcEnabled && nfcSupported() ? '<button type="button" class="btn btn-big" id="p-nfc">Or tap an NFC tag</button>' : ''}
      <button type="button" class="link-btn" id="p-type">Type the code instead</button>
      <button type="button" class="link-btn" id="p-skip">I cannot scan it</button>
    </div>`;
  const accept = (raw) => {
    const code = parseTagText(raw);
    if (!code) return;
    const a = findAsset(code);
    if (a && a.id === s.asset.id) { $('scan-error').textContent = `That is this ${s.type.name.toLowerCase()} itself. Scan the ${pt.name.toLowerCase()}.`; return; }
    if (a && a.type_id !== pt.id) { $('scan-error').textContent = `That label is on a ${typeOf(a).name.toLowerCase()}. Scan the ${pt.name.toLowerCase()}.`; return; }
    if (!a) { $('scan-error').textContent = 'That label is not registered in this project.'; return; }
    s.partner = { status: 'scanned', asset: a, code };
    s.issues = s.issues.filter((i) => i.issue_type !== 'cube_conflict');
    // Another unit already linked to it at this very location: two claim the same one.
    const st = a.state;
    if (st?.linked_asset_id && st.linked_asset_id !== s.asset.id && s.loc && s.loc !== HERE && st.location_id === s.loc.id) {
      const other = ref.assets.find((x) => x.id === st.linked_asset_id);
      if (other?.state?.linked_asset_id === a.id) {
        const cube = direction === 'forward' ? a : s.asset;
        const gen = direction === 'forward' ? s.asset : a;
        s.issues.push({ issue_type: 'cube_conflict', asset_id: cube.id, related_asset_id: gen.id, note: `The app also has it connected to ${other.serial}.` });
      }
    }
    if (navigator.vibrate) navigator.vibrate(80);
    render();
  };
  $('p-scan').onclick = async () => { const t = await scanQr(); if (t) accept(t); };
  $('p-type').onclick = () => { const c = prompt('Code printed under the QR label:'); if (c) accept(c); };
  $('p-skip').onclick = () => { s.partner = { status: 'skipped', asset: null, code: null }; advance(); };
  if ($('p-nfc')) {
    $('p-nfc').onclick = async () => {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 30_000);
      try { const { code, serialCode } = await readNfc(ctrl.signal); accept(findAsset(code) ? code : findAsset(serialCode) ? serialCode : code); }
      catch (e) { if (e.name !== 'AbortError') $('scan-error').textContent = e.message || 'NFC read failed'; }
    };
  }
  nav({ next: owner ? 'Next' : null });
  if (owner) $('btn-next').onclick = advance;
}

// ---------------------------------------------------------------- save

/** Check values for this unit, with location rules (fuel cube never on the vessel) applied. */
function collectValues() {
  const raw = applyLocationRules(s.type.fields, s.answers, s.loc?.kind);
  return normalizeValues(s.type.fields, 'check', raw);
}

function locFields() {
  const atHere = s.loc === HERE;
  return {
    location_id: atHere ? null : s.loc.id,
    location_source: s.locSource,
    gps_status: resolution?.gpsStatus ?? 'unavailable',
    lat: fix?.lat ?? null,
    lon: fix?.lon ?? null,
    accuracy_m: fix?.accuracy ?? null,
    distance_m: fix && s.loc.kind === 'WTG' && s.loc.lat != null ? Math.round(distanceM(fix.lat, fix.lon, s.loc.lat, s.loc.lon)) : null,
  };
}

const item = (extra) => ({ id: crypto.randomUUID(), recorded_at: new Date().toISOString(), project: SLUG, ...extra });

async function save() {
  const { values, errors } = collectValues();
  if (Object.keys(errors).length) {
    $('save-error').textContent = Object.values(errors).join('. ');
    return;
  }
  if (s.loc === HERE && !fix) { $('save-error').textContent = 'No GPS position. Go back and choose a turbine or vessel.'; return; }
  const place = locFields();
  const where = locLabel(s.loc);
  const items = [];
  const main = item({
    kind: 'check', asset_id: s.asset.id, tag_code: s.code, ...place, data: values,
    label: `${kindOf(s.asset, s.type)} · tag ${s.code} @ ${where}`,
  });
  items.push(main);

  const partner = s.partner;
  const pt = s.pairing?.partnerType;
  if (s.pairing?.direction === 'forward' && (partner.status === 'known' || partner.status === 'scanned')) {
    // The fuel cube is here, connected to this generator, at the level just entered.
    main.linked_asset_id = partner.asset?.id ?? null;
    main.linked_tag_code = partner.code;
    const cubeKeys = new Set(pt.fields.filter((f) => f.scope === 'check').map((f) => f.key));
    items.push(item({
      kind: 'check', asset_id: partner.asset?.id ?? null, tag_code: partner.code, ...place,
      data: Object.fromEntries(Object.entries(values).filter(([k]) => cubeKeys.has(k))),
      linked_asset_id: s.asset.id, linked_tag_code: s.code,
      label: `${partnerLabel(partner.asset)} · tag ${partner.code} @ ${where} (with generator)`,
    }));
  } else if (s.pairing?.direction === 'forward' && partner.status === 'removed') {
    // Reported not here: the fuel cube goes back to the vessel without a reading, and the
    // warehouse supervisor is told, because the app expected it here.
    if (s.sov) {
      items.push(item({
        kind: 'move', asset_id: partner.asset.id, tag_code: partner.code, location_id: s.sov.id, location_source: 'manual', gps_status: 'unavailable',
        label: `${partnerLabel(partner.asset)} · tag ${partner.code} moved to ${s.sov.name}`,
      }));
    }
    s.issues.push({ issue_type: 'cube_missing', asset_id: partner.asset.id, related_asset_id: s.asset.id });
  } else if (s.pairing?.direction === 'reverse' && (partner.status === 'known' || partner.status === 'scanned')) {
    main.linked_asset_id = partner.asset?.id ?? null;
    main.linked_tag_code = partner.code;
    if (partner.status === 'scanned') {
      // The generator is now known to be here, connected to this fuel cube.
      items.push(item({
        kind: 'move', asset_id: partner.asset?.id ?? null, tag_code: partner.code, ...place, linked_asset_id: s.asset.id, linked_tag_code: s.code,
        label: `${partnerLabel(partner.asset)} · tag ${partner.code} @ ${where} (with fuel cube)`,
      }));
    }
  }
  for (const i of s.issues) {
    items.push(item({ kind: 'issue', location_id: s.loc === HERE ? null : s.loc.id, tag_code: s.code, ...i, label: `To investigate: ${i.issue_type.replace('_', ' ')}` }));
  }

  for (const it of items) {
    await outbox.put(it);
    if (it.asset_id && (it.kind === 'check' || it.kind === 'move')) rememberState(it);
  }
  cache.set(`bootstrap:${SLUG}`, ref).catch(() => {});
  const alerts = evaluateAlerts(s.type.fields, values);
  toast(alerts.length ? `Saved. Warning: ${alerts.map((a) => a.text).join('; ')}` : 'Saved', alerts.length ? 'error' : 'ok');
  leaveFlow();
  renderOutbox();
  updateSyncPill();
  if (navigator.onLine !== false) syncNow();
}

/** Keeps this phone's copy of where a unit is and what it is connected to up to date. */
function rememberState(r) {
  const a = ref.assets.find((x) => x.id === r.asset_id);
  if (a && (!a.state || r.recorded_at >= a.state.at)) {
    a.state = { location_id: r.location_id, linked_asset_id: r.linked_asset_id ?? null, at: r.recorded_at };
  }
}

// ---------------------------------------------------------------- reporting a problem

let problemKind = 'label_mismatch';
let problemCode = null;

function openProblem(kind, code = null) {
  problemKind = kind;
  problemCode = code || s?.code || null;
  const unknown = kind === 'unknown_tag';
  $('problem-title').textContent = unknown ? 'This label is not registered' : 'Something is wrong';
  $('problem-text').textContent = unknown
    ? `Label ${problemCode} is not linked to any equipment in this project. Add the equipment, or tell the warehouse supervisor.`
    : 'The label does not match the equipment, the serial number is different, or something else is not right. The warehouse supervisor will look into it.';
  $('problem-note').value = '';
  $('problem-add').classList.toggle('hidden', !unknown);
  $('problem-defect').classList.toggle('hidden', unknown || !s?.asset);
  $('problem-add').href = `${path('add')}#t=${encodeURIComponent(problemCode || '')}`;
  $('problem').showModal();
}

async function sendDefect() {
  const note = $('problem-note').value.trim() || null;
  const a = s.asset;
  await outbox.put(item({ kind: 'event', event: 'defect', asset_id: a.id, tag_code: s.code, notes: note, label: `Defect: ${a.serial}` }));
  // The phone knows at once, even before it is synced.
  a.defect = 1; a.defect_note = note; a.defect_at = new Date().toISOString();
  cache.set(`bootstrap:${SLUG}`, ref).catch(() => {});
  $('problem').close();
  toast('Marked as defect. The warehouse supervisor is told.', 'ok');
  leaveFlow();
  renderOutbox();
  updateSyncPill();
  if (navigator.onLine !== false) syncNow();
}

async function sendProblem() {
  const note = $('problem-note').value.trim() || null;
  await outbox.put(item({
    kind: 'issue', issue_type: problemKind, asset_id: s?.asset?.id ?? null, tag_code: problemCode,
    location_id: s?.loc && s.loc !== HERE ? s.loc.id : null, note, label: `To investigate: ${problemKind.replace('_', ' ')} ${problemCode || ''}`,
  }));
  $('problem').close();
  toast('The warehouse supervisor will be told', 'ok');
  if (s) leaveFlow();
  renderOutbox();
  updateSyncPill();
  if (navigator.onLine !== false) syncNow();
}

// ---------------------------------------------------------------- outbox list

async function renderOutbox() {
  const items = (await outbox.all()).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  pending = items;
  const box = $('outbox');
  $('outbox-card').classList.toggle('hidden', !items.length);
  if (!items.length) { box.textContent = ''; return; }
  box.innerHTML = items.map((i) => `
    <div class="outbox-item">
      <div>
        <div>${esc(i.label || i.tag_code || i.kind)}</div>
        <div class="muted">${new Date(i.recorded_at).toLocaleString()}</div>
        ${i.rejected ? `<div class="field-error">Rejected: ${esc(i.error)}</div>` : ''}
      </div>
      <div>${i.rejected
        ? `<button class="link-btn" data-discard="${i.id}">Discard</button>`
        : '<span class="badge badge-warn">Queued</span>'}</div>
    </div>`).join('');
  box.querySelectorAll('[data-discard]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Discard this item? It will not be sent to the server.')) return;
      await outbox.remove([b.dataset.discard]);
      renderOutbox();
      updateSyncPill();
    };
  });
}
