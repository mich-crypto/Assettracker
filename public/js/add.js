// Add equipment, step by step on the phone:
//   (type) -> required details, e.g. kVA rating -> serial number
//   -> stick the QR label on the generator window -> scan it -> saved.
import { api, esc, registerServiceWorker, renderHeader, requireLogin, toast } from './app.js';
import { normalizeValues } from './fields.js';
import { nfcSupported, parseTagText, readNfc, scanQr } from './scan.js';

const user = requireLogin('link');
const $ = (id) => document.getElementById(id);

let types = [];
let assets = [];
let steps = [];
let at = 0;
let state = fresh();
let saving = false;

function fresh(typeId = null) {
  return { typeId, attributes: {}, serial: '', tag: null, saved: null };
}

if (user) init();

async function init() {
  renderHeader('add');
  registerServiceWorker();
  try {
    ({ types, assets } = await api('/api/bootstrap'));
  } catch (e) {
    $('step').innerHTML = `<h1>No connection</h1><p>Adding equipment needs a connection to the server. ${esc(e.message)}</p>`;
    $('btn-next').disabled = true;
    return;
  }
  types = types.filter((t) => t.active !== 0);
  if (types.length === 1) state.typeId = types[0].id;
  // Arriving from a scan of an unlinked label: that label is already read.
  const code = new URLSearchParams(location.hash.slice(1)).get('t');
  if (code) {
    state.tag = { code: parseTagText(code), kind: code.startsWith('NFC-') ? 'nfc' : 'qr' };
    history.replaceState(null, '', location.pathname);
  }
  $('btn-back').onclick = back;
  $('btn-next').onclick = next;
  buildSteps();
  render();
}

const type = () => types.find((t) => t.id === state.typeId);

// Required details set once when linking (e.g. the kVA rating) each get a step.
function buildSteps() {
  const t = type();
  const detailSteps = t ? t.fields.filter((f) => f.scope === 'asset' && f.required).map((f) => ({ id: 'field', field: f })) : [];
  steps = [
    ...(types.length > 1 ? [{ id: 'type' }] : []),
    ...detailSteps,
    { id: 'serial' },
    { id: 'sticker' },
    { id: 'scan' },
    { id: 'done' },
  ];
}

function render() {
  const step = steps[at];
  const total = steps.length - 1; // the "done" screen is not a step
  $('progress').innerHTML = Array.from({ length: total }, (_, i) => `<span class="${i <= at ? 'done' : ''}"></span>`).join('');
  $('step-label').textContent = step.id === 'done' ? '' : `Step ${at + 1} of ${total}`;
  $('btn-back').classList.toggle('hidden', at === 0 || step.id === 'done');
  $('btn-back').parentElement.style.gridTemplateColumns = at === 0 || step.id === 'done' ? '1fr' : '';
  RENDER[step.id](step);
  updateNext();
}

function updateNext() {
  const step = steps[at];
  const btn = $('btn-next');
  btn.textContent = { scan: 'Save equipment', done: 'Add another' }[step.id] || 'Next';
  btn.disabled = saving || !valid(step);
}

function valid(step) {
  switch (step.id) {
    case 'type': return !!state.typeId;
    case 'field': return !normalizeValues([step.field], 'asset', state.attributes).errors[step.field.key];
    case 'serial': return !!state.serial && !serialTaken();
    case 'scan': return !!state.tag && !tagTaken(state.tag.code);
    default: return true;
  }
}

function back() {
  if (at > 0) { at--; render(); }
}

async function next() {
  const step = steps[at];
  if (!valid(step)) return;
  if (step.id === 'scan') return save();
  if (step.id === 'done') {
    // Same equipment type again; everything else starts fresh.
    state = fresh(state.typeId);
    at = steps.findIndex((s) => s.id !== 'type');
    return render();
  }
  at++;
  render();
}

function serialTaken() {
  const s = state.serial.toLowerCase();
  return assets.some((a) => a.type_id === state.typeId && a.serial.toLowerCase() === s);
}

function tagTaken(code) {
  const c = code.toLowerCase();
  return assets.find((a) => a.tags.some((t) => t.code.toLowerCase() === c)) || null;
}

function kindLabel() {
  const t = type();
  const extras = t.fields.filter((f) => f.scope === 'asset' && f.type === 'select' && state.attributes[f.key]).map((f) => state.attributes[f.key]);
  return [t.name, ...extras].join(' ');
}

// ---------------------------------------------------------------- steps

function choiceList(options, current, onPick) {
  $('step').querySelector('.choice-list').innerHTML = options.map((o) =>
    `<button type="button" class="btn" data-v="${esc(o.value)}" aria-pressed="${o.value === current}">${esc(o.label)}</button>`).join('');
  $('step').querySelectorAll('.choice-list .btn').forEach((b) => {
    b.onclick = () => {
      onPick(b.dataset.v);
      // Tapping a choice moves straight on: one tap per step on the phone.
      updateNext();
      next();
    };
  });
}

const RENDER = {
  type() {
    $('step').innerHTML = '<h1>What are you adding?</h1><div class="choice-list"></div>';
    choiceList(types.map((t) => ({ value: t.id, label: t.name })), state.typeId, (v) => {
      if (v !== state.typeId) { state = fresh(v); }
      buildSteps();
    });
  },

  field({ field: f }) {
    if (f.type === 'select') {
      $('step').innerHTML = `<h1>${esc(f.label)}</h1><p class="muted">Select the ${esc(f.label.toLowerCase())} of the ${esc(type().name.toLowerCase())}.</p><div class="choice-list"></div>`;
      choiceList(f.options.map((o) => ({ value: o, label: o })), state.attributes[f.key], (v) => { state.attributes[f.key] = v; });
      return;
    }
    const inputType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
    $('step').innerHTML = `<h1>${esc(f.label)}</h1>
      <div class="field"><input id="w-field" class="big" type="${inputType}" value="${esc(state.attributes[f.key] ?? '')}" aria-label="${esc(f.label)}"></div>`;
    const el = $('w-field');
    el.oninput = () => { state.attributes[f.key] = el.value; updateNext(); };
    el.onkeydown = (e) => { if (e.key === 'Enter') next(); };
    el.focus();
  },

  serial() {
    $('step').innerHTML = `<h1>Serial number</h1>
      <p class="muted">Type the serial number from the ${esc(kindLabel())} nameplate.</p>
      <div class="field">
        <input id="w-serial" class="big" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(state.serial)}" aria-label="Serial number">
        <div class="field-error" id="w-serial-error"></div>
      </div>`;
    const el = $('w-serial');
    const check = () => {
      state.serial = el.value.trim().toUpperCase();
      $('w-serial-error').textContent = state.serial && serialTaken() ? `A ${type().name.toLowerCase()} with serial ${state.serial} is already registered.` : '';
      updateNext();
    };
    el.oninput = check;
    el.onkeydown = (e) => { if (e.key === 'Enter') next(); };
    check();
    el.focus();
  },

  sticker() {
    $('step').innerHTML = `<h1>Apply the QR label</h1>
      <div class="sticker-hint" aria-hidden="true">
        <svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="20" width="180" height="100" rx="8" fill="none" stroke="currentColor" stroke-width="4"/>
          <rect x="30" y="38" width="80" height="50" rx="4" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="6 4"/>
          <g fill="currentColor"><rect x="52" y="45" width="36" height="36" fill="#fff" stroke="currentColor" stroke-width="2"/>
          <rect x="56" y="49" width="10" height="10"/><rect x="74" y="49" width="10" height="10"/><rect x="56" y="67" width="10" height="10"/><rect x="72" y="65" width="5" height="5"/><rect x="79" y="72" width="5" height="5"/></g>
          <rect x="128" y="40" width="46" height="8" rx="2" fill="currentColor" opacity=".35"/><rect x="128" y="56" width="46" height="8" rx="2" fill="currentColor" opacity=".35"/>
          <rect x="22" y="120" width="20" height="10" fill="currentColor"/><rect x="158" y="120" width="20" height="10" fill="currentColor"/>
        </svg>
      </div>
      <p>Stick a new QR label on the <b>generator window</b>.</p>
      <ul class="muted">
        <li>Clean and dry the spot first.</li>
        <li>Press the label flat so it can be scanned easily.</li>
      </ul>
      <p class="muted">Tap <b>Next</b> when the label is on, to scan it.</p>`;
  },

  scan() {
    const owner = state.tag && tagTaken(state.tag.code);
    $('step').innerHTML = `<h1>Scan the QR label</h1>
      <p class="muted">Scan the label you just applied, to link it to this ${esc(kindLabel())}.</p>
      ${state.tag && !owner ? `<div class="notice notice-ok">✓ Label read: <b class="mono">${esc(state.tag.code)}</b></div>` : ''}
      ${owner ? `<div class="notice notice-danger">This label is already linked to another ${esc(type().name.toLowerCase())} (serial ${esc(owner.serial)}). Use a new label.</div>` : ''}
      <div class="field-error" id="w-save-error"></div>
      <div class="stack">
        <button type="button" class="btn ${state.tag ? '' : 'btn-primary'} btn-big" id="w-scan">${state.tag ? 'Scan again' : 'Scan QR code'}</button>
        ${nfcSupported() ? '<button type="button" class="btn btn-big" id="w-nfc">Or tap an NFC tag</button>' : ''}
        <button type="button" class="link-btn" id="w-type">Camera not working? Type the code</button>
      </div>
      <dl class="summary-list">
        <dt>Equipment</dt><dd>${esc(kindLabel())}</dd>
        <dt>Serial</dt><dd>${esc(state.serial)}</dd>
      </dl>`;
    $('w-scan').onclick = async () => {
      const text = await scanQr();
      if (text) setTag(parseTagText(text), 'qr');
    };
    $('w-type').onclick = () => {
      const code = prompt('Code printed under the QR label (e.g. AT-7K3QX9M2PD):');
      if (code) setTag(parseTagText(code), 'qr');
    };
    if ($('w-nfc')) {
      $('w-nfc').onclick = async () => {
        const ctrl = new AbortController();
        $('w-nfc').textContent = 'Hold the tag against the phone…';
        setTimeout(() => ctrl.abort(), 30_000);
        try {
          const { code, serialCode } = await readNfc(ctrl.signal);
          setTag(code || serialCode, 'nfc');
        } catch (e) {
          if (e.name !== 'AbortError') toast(e.message || 'NFC read failed', 'error');
          RENDER.scan();
        }
      };
    }
  },

  done() {
    const s = state.saved;
    $('step').innerHTML = `<div class="done-mark" aria-hidden="true">✓</div>
      <h1>Equipment added</h1>
      <dl class="summary-list">
        <dt>Equipment</dt><dd>${esc(kindLabel())}</dd>
        <dt>Serial</dt><dd>${esc(s.serial)}</dd>
        <dt>Tag</dt><dd class="mono">${esc(state.tag.code)}</dd>
      </dl>
      <p class="muted">It shows up in the Scan app straight away. Optional details can be added later under Link tags.</p>
      <a class="btn btn-big" href="/field">Go to Scan</a>`;
  },
};

function setTag(code, kind) {
  if (!code) return;
  state.tag = { code, kind };
  if (navigator.vibrate) navigator.vibrate(80);
  RENDER.scan();
  updateNext();
}

async function save() {
  saving = true;
  updateNext();
  const t = type();
  const { values } = normalizeValues(t.fields, 'asset', state.attributes);
  try {
    const { asset } = await api('/api/assets', {
      method: 'POST',
      body: { type_id: t.id, serial: state.serial, attributes: values, tags: [state.tag] },
    });
    state.saved = asset;
    assets.push(asset);
    at = steps.findIndex((s) => s.id === 'done');
    render();
  } catch (e) {
    const msg = e.status === 0 ? 'No connection - move to where there is signal and tap Save again.' : e.message;
    $('w-save-error').textContent = msg;
  } finally {
    saving = false;
    updateNext();
  }
}
