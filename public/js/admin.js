// Setup: locations (supervisor + admin), users and equipment types (admin).
import { api, esc, registerServiceWorker, renderHeader, requireLogin, toast } from './app.js';
import { validateFieldDefs } from './fields.js';
import { renderFields } from './forms.js';

const user = requireLogin('locations');
const $ = (id) => document.getElementById(id);
const isAdmin = user?.role === 'admin';
const openMode = !!user?.open; // no logins: user accounts are not used

let types = [];

if (user) init();

async function init() {
  renderHeader('locations');
  registerServiceWorker();
  $('loc-form').onsubmit = onAddLocation;
  $('btn-import').onclick = onImport;
  await loadLocations();
  if (isAdmin) {
    $('types-card').classList.remove('hidden');
    $('t-select').onchange = showType;
    $('t-new').onclick = newType;
    $('t-save').onclick = saveType;
    await loadTypes();
    if (!openMode) {
      $('users-card').classList.remove('hidden');
      $('user-form').onsubmit = onAddUser;
      await loadUsers();
    }
  }
}

// ---------------------------------------------------------------- locations

async function loadLocations() {
  const { locations } = await api('/api/locations');
  $('loc-rows').innerHTML = locations.map((l) => `<tr>
    <td><b>${esc(l.name)}</b></td>
    <td><span class="badge">${l.kind}</span></td>
    <td class="mono">${l.lat != null ? `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}` : '—'}</td>
    <td>${l.kind === 'WTG' ? `${l.radius_m} m` : ''}</td>
    <td>${l.active ? '' : '<span class="badge">inactive</span>'}
      <button class="link-btn" data-loc="${l.id}" data-active="${l.active}">${l.active ? 'Deactivate' : 'Activate'}</button></td>
  </tr>`).join('') || '<tr><td colspan="5" class="muted">No locations yet.</td></tr>';
  $('loc-rows').querySelectorAll('[data-loc]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/api/locations/${b.dataset.loc}`, { method: 'PATCH', body: { active: b.dataset.active !== '1' } });
        loadLocations();
      } catch (e) { toast(e.message, 'error'); }
    };
  });
}

async function onAddLocation(e) {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/locations', { method: 'POST', body });
    e.target.reset();
    toast(`${body.name} added`, 'ok');
    loadLocations();
  } catch (err) { toast(err.message, 'error'); }
}

async function onImport() {
  $('csv-error').textContent = '';
  const rows = $('csv').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^name\s*[,;]/i.test(l)) // skip a header line
    .map((l) => {
      const [name, lat, lon, kind, radius_m] = l.split(/[;,\t]/).map((s) => s.trim());
      return { name, lat, lon, kind: kind || 'WTG', ...(radius_m ? { radius_m } : {}) };
    });
  if (!rows.length) return;
  try {
    const { imported } = await api('/api/locations/import', { method: 'POST', body: { rows } });
    toast(`${imported} locations imported`, 'ok');
    $('csv').value = '';
    loadLocations();
  } catch (err) {
    $('csv-error').textContent = [err.message, ...(Array.isArray(err.details) ? err.details : [])].join('\n');
  }
}

// ---------------------------------------------------------------- users

async function loadUsers() {
  const { users } = await api('/api/users');
  $('user-rows').innerHTML = users.map((u) => `<tr>
    <td>${esc(u.name)}</td><td class="mono">${esc(u.username)}</td>
    <td><select data-role="${u.id}" aria-label="Role of ${esc(u.name)}">${['technician', 'supervisor', 'manager', 'admin'].map((r) =>
      `<option${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
    <td>${u.active ? '<span class="badge badge-ok">active</span>' : '<span class="badge">disabled</span>'}</td>
    <td><button class="link-btn" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'Disable' : 'Enable'}</button>
        <button class="link-btn" data-reset="${u.id}">Reset password</button></td>
  </tr>`).join('');
  const patch = async (id, body) => {
    try { await api(`/api/users/${id}`, { method: 'PATCH', body }); toast('Saved', 'ok'); } catch (e) { toast(e.message, 'error'); }
    loadUsers();
  };
  $('user-rows').querySelectorAll('[data-role]').forEach((s) => (s.onchange = () => patch(s.dataset.role, { role: s.value })));
  $('user-rows').querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = () => patch(b.dataset.toggle, { active: b.dataset.active !== '1' })));
  $('user-rows').querySelectorAll('[data-reset]').forEach((b) => {
    b.onclick = () => {
      const password = prompt('New password (min. 8 characters):');
      if (password) patch(b.dataset.reset, { password });
    };
  });
}

async function onAddUser(e) {
  e.preventDefault();
  try {
    await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    toast('User added', 'ok');
    loadUsers();
  } catch (err) { toast(err.message, 'error'); }
}

// ---------------------------------------------------------------- types
//
// Form-based editor for an equipment type's field list. It edits the same
// field definitions as before (see fields.js), so nobody needs to write JSON.

const TYPE_LABELS = {
  number: 'Number', text: 'Text', boolean: 'Yes / No', select: 'Choose one', multiselect: 'Choose several', date: 'Date',
};

const PRESETS = {
  fuel: { label: 'Fuel level', type: 'number', scope: 'check', required: true, min: 0, max: 100, step: 25, unit: '%', alert: { atMost: 25 } },
  cube: { label: 'Fuel cube connected', type: 'boolean', scope: 'check', required: true, sovValue: false },
  ok: { label: 'Condition OK', type: 'boolean', scope: 'check', required: true, alert: { equals: false } },
  alarms: { label: 'Active alarms', type: 'multiselect', scope: 'check', options: ['Fault', 'Damage', 'Other'], alert: { any: true } },
  manufacturer: { label: 'Manufacturer', type: 'text', scope: 'asset' },
  inspection: { label: 'Next inspection', type: 'date', scope: 'asset' },
};

let draft = [];   // field definitions being edited; existing fields keep their key

async function loadTypes(selectId) {
  ({ types } = await api('/api/types'));
  $('t-select').innerHTML = types.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  if (selectId) $('t-select').value = selectId;
  $('t-add').onclick = () => addField({ label: '', type: 'text', scope: 'check' });
  $('t-preset').onchange = () => {
    const p = PRESETS[$('t-preset').value];
    if (p) addField(structuredClone(p));
    $('t-preset').value = '';
  };
  $('t-name').oninput = renderPreview;
  showType();
}

function showType() {
  const t = types.find((x) => x.id === $('t-select').value);
  if (!t) return newType();
  $('t-name').value = t.name;
  draft = structuredClone(t.fields);
  $('t-error').textContent = '';
  renderDraft();
}

function newType() {
  $('t-select').value = '';
  $('t-name').value = '';
  draft = [structuredClone(PRESETS.ok)];
  $('t-error').textContent = '';
  renderDraft();
  $('t-name').focus();
}

function addField(f) {
  draft.push(f);
  renderDraft();
  const cards = $('t-fields').querySelectorAll('.fdef');
  cards[cards.length - 1]?.querySelector('[data-k=label]')?.focus();
}

function numAttr(v) {
  return v == null ? '' : esc(v);
}

function alertControls(f) {
  const a = f.alert || {};
  if (f.type === 'number') {
    const mode = a.atMost != null ? 'atMost' : a.below != null ? 'below' : a.above != null ? 'above' : '';
    const val = a.atMost ?? a.below ?? a.above ?? '';
    return `<div class="row">
      <div class="field small"><label>Flag on overview when</label><select data-k="alertMode">
        <option value="">Never</option>
        <option value="atMost"${mode === 'atMost' ? ' selected' : ''}>at or below</option>
        <option value="below"${mode === 'below' ? ' selected' : ''}>below</option>
        <option value="above"${mode === 'above' ? ' selected' : ''}>above</option>
      </select></div>
      <div class="field small${mode ? '' : ' hidden'}"><label>Value</label><input data-k="alertValue" type="number" step="any" value="${esc(val)}"></div>
    </div>`;
  }
  if (f.type === 'boolean') {
    const v = 'equals' in a ? String(a.equals) : '';
    return `<div class="field"><label>Flag on overview when</label><select data-k="alertEquals">
      <option value="">Never</option>
      <option value="true"${v === 'true' ? ' selected' : ''}>answer is Yes</option>
      <option value="false"${v === 'false' ? ' selected' : ''}>answer is No</option>
    </select></div>`;
  }
  if (f.type === 'select') {
    return `<div class="field"><label>Flag on overview when</label><select data-k="alertEquals">
      <option value="">Never</option>
      ${(f.options || []).map((o) => `<option value="${esc(o)}"${a.equals === o ? ' selected' : ''}>answer is ${esc(o)}</option>`).join('')}
    </select></div>`;
  }
  if (f.type === 'multiselect') {
    return `<label class="check-inline"><input type="checkbox" data-k="alertAny"${a.any ? ' checked' : ''}> Flag on overview when anything is ticked</label>`;
  }
  return '';
}

function fieldCard(f, i) {
  const choice = f.type === 'select' || f.type === 'multiselect';
  return `<div class="fdef" data-i="${i}">
    <div class="fdef-head">
      <b>${i + 1}. ${esc(f.label || 'New field')}</b>
      <div class="fdef-tools">
        <button type="button" class="btn" data-act="up" title="Move up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="btn" data-act="down" title="Move down" aria-label="Move down"${i === draft.length - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" class="btn btn-danger" data-act="remove" title="Remove" aria-label="Remove field">✕</button>
      </div>
    </div>
    <div class="row">
      <div class="field grow"><label>Question / label</label><input data-k="label" type="text" value="${esc(f.label)}" placeholder="e.g. Oil level OK"></div>
      <div class="field small"><label>Answer type</label><select data-k="type">${Object.entries(TYPE_LABELS).map(([v, l]) =>
        `<option value="${v}"${f.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="row">
      <div class="field grow"><label>Asked</label><select data-k="scope">
        <option value="check"${f.scope === 'check' ? ' selected' : ''}>On every scan</option>
        <option value="asset"${f.scope === 'asset' ? ' selected' : ''}>Once, when linking the tag</option>
      </select></div>
      <label class="check-inline field"><input type="checkbox" data-k="required"${f.required ? ' checked' : ''}> Required</label>
    </div>
    ${choice ? `<div class="field"><label>Options (one per line)</label><textarea data-k="options" rows="3">${esc((f.options || []).join('\n'))}</textarea></div>` : ''}
    ${f.type === 'number' ? `<div class="row">
      <div class="field small"><label>Unit</label><input data-k="unit" type="text" value="${esc(f.unit || '')}" placeholder="%, h, bar"></div>
      <div class="field small"><label>Min</label><input data-k="min" type="number" step="any" value="${numAttr(f.min)}"></div>
      <div class="field small"><label>Max</label><input data-k="max" type="number" step="any" value="${numAttr(f.max)}"></div>
      <div class="field small"><label>Steps of</label><input data-k="step" type="number" step="any" min="0" value="${numAttr(f.step)}" placeholder="any"></div>
    </div>` : ''}
    ${f.type === 'boolean' && f.scope === 'check' ? `<div class="field"><label>On the vessel (SOV)</label><select data-k="sovValue">
      <option value=""${'sovValue' in f ? '' : ' selected'}>Ask as usual</option>
      <option value="false"${f.sovValue === false ? ' selected' : ''}>Don't ask - always No</option>
      <option value="true"${f.sovValue === true ? ' selected' : ''}>Don't ask - always Yes</option>
    </select></div>` : ''}
    ${alertControls(f)}
    ${f.key ? `<p class="muted" style="margin:0;font-size:.8rem">Data key: <code>${esc(f.key)}</code></p>` : ''}
  </div>`;
}

function renderDraft() {
  $('t-fields').innerHTML = draft.map(fieldCard).join('') || '<p class="muted">No fields yet. Add one below.</p>';
  $('t-fields').querySelectorAll('.fdef').forEach((card) => {
    const i = Number(card.dataset.i);
    card.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'remove') {
        if (draft[i].key && !confirm(`Remove "${draft[i].label}"? Past readings keep their values.`)) return;
        draft.splice(i, 1);
      } else {
        const j = act === 'up' ? i - 1 : i + 1;
        [draft[i], draft[j]] = [draft[j], draft[i]];
      }
      renderDraft();
    }));
    card.querySelectorAll('[data-k]').forEach((el) => {
      // Changes that alter which inputs are shown re-render the card list.
      const structural = ['type', 'scope', 'alertMode', 'options'].includes(el.dataset.k);
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
        updateField(draft[i], el.dataset.k, el.type === 'checkbox' ? el.checked : el.value);
        if (el.dataset.k === 'label') card.querySelector('.fdef-head b').textContent = `${i + 1}. ${el.value || 'New field'}`;
        if (structural && el.tagName === 'SELECT') renderDraft(); else renderPreview();
      });
      if (el.dataset.k === 'options') el.addEventListener('change', renderDraft);
    });
  });
  renderPreview();
}

function parseOptions(text) {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const list = lines.length === 1 && lines[0].includes(',') ? lines[0].split(',').map((s) => s.trim()).filter(Boolean) : lines;
  return [...new Set(list)];
}

function updateField(f, k, v) {
  const num = (x) => (x === '' || x == null ? undefined : Number(x));
  switch (k) {
    case 'label': f.label = v; break;
    case 'scope': f.scope = v; if (v !== 'check') delete f.sovValue; break;
    case 'required': if (v) f.required = true; else delete f.required; break;
    case 'type':
      f.type = v;
      if (v === 'select' || v === 'multiselect') f.options ??= ['Option 1', 'Option 2'];
      else delete f.options;
      if (v !== 'number') for (const x of ['unit', 'min', 'max', 'step']) delete f[x];
      delete f.alert;
      delete f.sovValue;
      break;
    case 'sovValue': if (v === '') delete f.sovValue; else f.sovValue = v === 'true'; break;
    case 'options': f.options = parseOptions(v); break;
    case 'unit': if (v.trim()) f.unit = v.trim(); else delete f.unit; break;
    case 'min': case 'max': case 'step': {
      const n = num(v);
      if (n === undefined || Number.isNaN(n)) delete f[k]; else f[k] = n;
      break;
    }
    case 'alertMode': {
      const prev = f.alert ? (f.alert.atMost ?? f.alert.below ?? f.alert.above) : undefined;
      if (!v) delete f.alert; else f.alert = { [v]: prev ?? 0 };
      break;
    }
    case 'alertValue': {
      const mode = f.alert && Object.keys(f.alert)[0];
      if (mode) f.alert = { [mode]: num(v) ?? 0 };
      break;
    }
    case 'alertEquals':
      if (v === '') delete f.alert;
      else f.alert = { equals: f.type === 'boolean' ? v === 'true' : v };
      break;
    case 'alertAny': if (v) f.alert = { any: true }; else delete f.alert; break;
  }
}

/** Gives new fields a stable data key derived from their label. */
function withKeys(fields) {
  const used = new Set(fields.map((f) => f.key).filter(Boolean));
  return fields.map((f) => {
    if (f.key) return f;
    let base = (f.label || 'field').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 34) || 'field';
    if (!/^[a-z]/.test(base)) base = `f_${base}`;
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    used.add(key);
    return { key, ...f };
  });
}

function renderPreview() {
  $('t-error').textContent = '';
  const fields = withKeys(draft.filter((f) => f.label));
  renderFields($('t-preview-asset'), fields, 'asset');
  renderFields($('t-preview-check'), fields, 'check');
}

async function saveType() {
  $('t-error').textContent = '';
  const name = $('t-name').value.trim();
  const problems = [];
  if (!name) problems.push('Give the equipment type a name.');
  draft.forEach((f, i) => {
    if (!f.label?.trim()) problems.push(`Field ${i + 1}: enter a question / label.`);
    if ((f.type === 'select' || f.type === 'multiselect') && !(f.options || []).length) problems.push(`Field ${i + 1}: add at least one option.`);
    if (f.min != null && f.max != null && f.min > f.max) problems.push(`Field ${i + 1}: min is larger than max.`);
  });
  const fields = withKeys(draft.map((f) => ({ ...f, label: f.label?.trim() })));
  if (!problems.length) problems.push(...validateFieldDefs(fields));
  if (problems.length) {
    $('t-error').textContent = problems.join('\n');
    return;
  }
  const id = $('t-select').value;
  try {
    const { type } = id
      ? await api(`/api/types/${id}`, { method: 'PATCH', body: { name, fields } })
      : await api('/api/types', { method: 'POST', body: { name, fields } });
    toast(`${type.name} saved`, 'ok');
    loadTypes(type.id);
  } catch (err) {
    $('t-error').textContent = [err.message, ...(Array.isArray(err.details) ? err.details : [])].join('\n');
  }
}
