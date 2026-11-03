// Warehouse hub: add equipment, mark refuelled / serviced, look after the equipment
// list (edit, retire, attach a label), handle things technicians reported, and
// import the existing fleet.
import {
  SLUG, api, esc, fmtDate, fmtTime, loadReference, path, registerServiceWorker, renderHeader, requireProject,
  startAutoSync, syncNow, toast, updateSyncPill,
} from './app.js';
import { alertsFor, kindOf, typeById } from './equipment.js';
import { collectFields, renderFields, showErrors } from './forms.js';
import { normalizeValues } from './fields.js';
import { buildTemplate, parseAssetRows } from './importer.js';
import { downloadBlob } from './print.js';
import { parseTagText, scanQr } from './scan.js';
import { serviceRows } from './reports.js';
import { outbox } from './store.js';

const ok = requireProject();
const $ = (id) => document.getElementById(id);

let ref = null;        // offline snapshot: types, locations, assets (with tags and last state)
let selected = null;   // asset chosen for refuel / service
let mode = null;       // 'refuel' | 'service'
let imported = null;   // parsed import list

if (ok) init();

async function init() {
  renderHeader('warehouse');
  registerServiceWorker();
  startAutoSync();
  $('t-add').href = path('add');
  try {
    ref = await loadReference();
  } catch (e) {
    toast(e.message, 'error');
    ref = { types: [], locations: [], assets: [], settings: {}, openIssues: 0 };
  }
  window.addEventListener('hashchange', route);
  $('act-scan').onclick = async () => { const t = await scanQr(); if (t) pick(parseTagText(t)); };
  $('act-serial').onchange = () => { if ($('act-serial').value.trim()) pick($('act-serial').value.trim()); };
  $('act-confirm').onsubmit = onConfirmAction;
  $('act-cancel').onclick = () => resetAction();
  $('act-confirm').querySelectorAll('[data-months]').forEach((b) => (b.onclick = () => { $('act-date').value = addMonths(Number(b.dataset.months)); }));
  $('list-q').oninput = renderList;
  $('imp-template').onclick = () => downloadBlob(new Blob([buildTemplate(ref.types)], { type: 'text/csv' }), 'equipment-import-template.csv');
  $('imp-file').onchange = async () => { const f = $('imp-file').files[0]; if (f) { $('imp-text').value = await f.text(); checkImport(); } };
  $('imp-check').onclick = checkImport;
  $('imp-go').onclick = runImport;
  route();
}

const typeOf = (a) => typeById(ref.types, a.type_id);
const locationName = (id) => ref.locations.find((l) => l.id === id)?.name || null;
const addMonths = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- routing

function route() {
  const view = location.hash.slice(1).split('&')[0] || 'home';
  for (const id of ['home', 'action', 'list', 'issues', 'import']) $(`view-${id}`).classList.add('hidden');
  const shown = view === 'refuel' || view === 'service' ? 'action' : ['list', 'issues', 'import'].includes(view) ? view : 'home';
  $(`view-${shown}`).classList.remove('hidden');
  document.querySelectorAll('.back-link').forEach((a) => (a.href = path('warehouse')));
  if (shown === 'home') renderHome();
  if (shown === 'action') startAction(view);
  if (shown === 'list') renderList();
  if (shown === 'issues') loadIssues();
  window.scrollTo(0, 0);
}

function renderHome() {
  $('issue-count').textContent = ref.openIssues ? `${ref.openIssues} waiting for you` : 'Nothing reported';
  const rows = serviceRows(withState(ref.assets), ref.types).slice(0, 6);
  $('due-list').innerHTML = rows.map((r) => `<div class="due-row"><div><b>${esc(r.kind)}</b> <span class="muted">${esc(r.serial)} · ${esc(r.location)}</span></div>
      <div>${r.reasons.map((x) => `<div><span class="warn-sym" aria-hidden="true">⚠</span> ${esc(x)}</div>`).join('')}</div></div>`).join('')
    || '<p class="muted">Nothing needs service right now.</p>';
  $('due-more').href = `${path('overview')}#service`;
}

/** The offline snapshot has no check values or locations by name; give the report what it needs. */
function withState(assets) {
  return assets.map((a) => ({ ...a, last: a.state ? { location_name: locationName(a.state.location_id) } : null, check: null }));
}

// ---------------------------------------------------------------- refuelled / serviced

function startAction(view) {
  mode = view;
  $('act-title').textContent = view === 'refuel' ? 'Refuelled' : 'Serviced';
  $('act-serials').innerHTML = ref.assets.map((a) => `<option value="${esc(a.serial)}">${esc(kindOf(a, typeOf(a)))}</option>`).join('');
  resetAction();
}

function resetAction() {
  selected = null;
  $('act-pick').classList.remove('hidden');
  $('act-confirm').classList.add('hidden');
  $('act-serial').value = '';
  $('act-error').textContent = '';
}

function pick(codeOrSerial) {
  const q = String(codeOrSerial || '').trim().toLowerCase();
  const asset = ref.assets.find((a) => a.tags.some((t) => t.code.toLowerCase() === q) || a.serial.toLowerCase() === q);
  if (!asset) {
    $('act-error').textContent = `"${codeOrSerial}" is not registered in this project. Check the label or the serial number.`;
    return;
  }
  selected = asset;
  const type = typeOf(asset);
  $('act-pick').classList.add('hidden');
  $('act-confirm').classList.remove('hidden');
  $('act-kind').textContent = kindOf(asset, type);
  const where = asset.state?.location_id ? locationName(asset.state.location_id) : null;
  $('act-sub').textContent = `${where ? `At ${where} · ` : ''}${asset.tags[0] ? `tag ${asset.tags[0].code}` : 'no label yet'}`;
  $('act-service').classList.toggle('hidden', mode !== 'service');
  $('act-date').required = mode === 'service';
  $('act-date').value = '';
  $('act-save').textContent = mode === 'refuel' ? 'Yes, it is refuelled (full)' : 'Mark as serviced';
}

async function onConfirmAction(e) {
  e.preventDefault();
  if (!selected) return;
  const item = {
    id: crypto.randomUUID(), kind: 'event', event: mode, asset_id: selected.id, tag_code: selected.tags[0]?.code ?? null,
    recorded_at: new Date().toISOString(), project: SLUG,
    label: `${kindOf(selected, typeOf(selected))} · ${mode === 'refuel' ? 'refuelled' : 'serviced'}`,
  };
  if (mode === 'service') {
    if (!$('act-date').value) { $('act-date').focus(); return; }
    item.next_inspection = $('act-date').value;
  }
  await outbox.put(item);
  updateSyncPill();
  toast(mode === 'refuel' ? `${kindOf(selected, typeOf(selected))} marked as refuelled` : `${kindOf(selected, typeOf(selected))} serviced, next inspection ${fmtDate(item.next_inspection)}`, 'ok');
  if (mode === 'service') selected.attributes.inspection_due = item.next_inspection;
  resetAction();
  if (navigator.onLine !== false) syncNow();
}

// ---------------------------------------------------------------- equipment list

function renderList() {
  const q = $('list-q').value.trim().toLowerCase().replace(/\s+/g, '');
  const rows = ref.assets.filter((a) => {
    if (!q) return true;
    const hay = [kindOf(a, typeOf(a)), a.serial, locationName(a.state?.location_id), ...a.tags.map((t) => t.code)].join(' ').toLowerCase().replace(/\s+/g, '');
    return hay.includes(q);
  });
  $('list-rows').innerHTML = rows.map((a) => {
    const type = typeOf(a);
    const warn = alertsFor({ ...a, check: null }, type).some((w) => w.days != null);
    return `<tr class="clickable" data-id="${esc(a.id)}">
      <td><b>${esc(kindOf(a, type))}</b>${warn ? ' <span class="warn-sym" title="Inspection due">⚠</span>' : ''}</td>
      <td class="mono">${esc(a.serial)}</td>
      <td>${esc(locationName(a.state?.location_id) || '—')}</td>
      <td>${a.tags.length ? `<span class="badge badge-ok">${esc(a.tags[0].kind.toUpperCase())}</span>` : '<span class="badge badge-warn">no label</span>'}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">No equipment found.</td></tr>';
  $('list-rows').querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => openEditor(tr.dataset.id)));
}

function openEditor(id) {
  const asset = ref.assets.find((a) => a.id === id);
  if (!asset) return;
  const type = typeOf(asset);
  const d = $('drawer');
  d.classList.remove('hidden');
  d.innerHTML = `
    <div class="row" style="justify-content:space-between"><h2 id="ed-title" style="margin:0">${esc(kindOf(asset, type))}</h2><button class="btn" type="button" id="ed-close">Close</button></div>
    <p class="muted">${asset.tags.length ? `Label <span class="mono">${esc(asset.tags[0].code)}</span>` : 'No label yet'}</p>
    <form id="ed-form" class="stack" autocomplete="off" novalidate>
      <div class="field"><label for="ed-serial">Serial number</label><input id="ed-serial" type="text" autocapitalize="characters" value="${esc(asset.serial)}" required><div class="field-error" data-error-for="serial"></div></div>
      <div id="ed-fields"></div>
      <div class="field-error" id="ed-error"></div>
      <div class="row"><button class="btn btn-primary" type="submit">Save</button></div>
    </form>
    <div class="stack" style="margin-top:14px">
      ${asset.tags.length ? '' : `<a class="btn btn-big" href="${path('add')}#asset=${esc(asset.id)}">Attach a label</a>`}
      <button class="btn btn-danger" type="button" id="ed-retire">Retire this equipment</button>
    </div>`;
  renderFields($('ed-fields'), type.fields, 'asset', asset.attributes);
  $('ed-close').onclick = () => d.classList.add('hidden');
  $('ed-form').onsubmit = async (e) => {
    e.preventDefault();
    const raw = collectFields($('ed-fields'), type.fields, 'asset');
    const { values, errors } = normalizeValues(type.fields, 'asset', raw);
    showErrors($('ed-form'), errors);
    if (Object.keys(errors).length) return;
    try {
      await api(`/api/assets/${asset.id}`, { method: 'PATCH', body: { serial: $('ed-serial').value.trim().toUpperCase(), attributes: values } });
      toast('Saved', 'ok');
      ref = await loadReference();
      d.classList.add('hidden');
      renderList();
    } catch (err) { $('ed-error').textContent = err.status === 0 ? 'Editing needs a connection.' : err.message; }
  };
  $('ed-retire').onclick = async () => {
    if (!confirm(`Retire ${kindOf(asset, type)} (${asset.serial})? It disappears from the app. Its history is kept.`)) return;
    try {
      await api(`/api/assets/${asset.id}`, { method: 'PATCH', body: { status: 'retired' } });
      toast('Equipment retired', 'ok');
      ref = await loadReference();
      d.classList.add('hidden');
      renderList();
    } catch (err) { toast(err.status === 0 ? 'Retiring needs a connection' : err.message, 'error'); }
  };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('drawer').classList.add('hidden'); });

// ---------------------------------------------------------------- things to investigate

const ISSUE_TITLE = {
  cube_missing: 'Fuel cube reported missing',
  cube_conflict: 'Fuel cube claimed by two generators',
  label_mismatch: 'Label does not match the equipment',
  unknown_tag: 'Label not registered',
};

function issueText(i) {
  const kind = (id, serial) => (id ? `${kindOf({ attributes: {} }, typeById(ref.types, id))} ${serial}` : '');
  const where = i.location_name ? ` at ${i.location_name}` : '';
  switch (i.type) {
    case 'cube_missing': return `${kind(i.type_id, i.serial)} was expected${where}${i.related_serial ? ` with generator ${i.related_serial}` : ''}, but the technician said it is not there. It has been moved to the vessel. Find out where it really is.`;
    case 'cube_conflict': return `${kind(i.type_id, i.serial)} was scanned${where} connected to generator ${i.related_serial || '?'}, while the app says it is connected to another generator there.${i.note ? ` ${i.note}` : ''}`;
    case 'label_mismatch': return `The label${i.tag_code ? ` ${i.tag_code}` : ''} on ${kind(i.type_id, i.serial) || 'a unit'}${where} does not match the equipment (wrong serial number or wrong label). Check the nameplate.${i.note ? ` Note: ${i.note}` : ''}`;
    case 'unknown_tag': return `Label ${i.tag_code || ''}${where} was scanned but is not linked to any equipment. Add the equipment or remove the label.`;
    default: return i.note || i.type;
  }
}

async function loadIssues() {
  $('issue-list').innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { issues } = await api('/api/issues');
    $('issue-list').innerHTML = issues.map((i) => `<article class="issue"><h3>${esc(ISSUE_TITLE[i.type] || i.type)}</h3>
        <p style="margin:0">${esc(issueText(i))}</p><div class="muted">${esc(fmtTime(i.created_at))}</div>
        <div class="row"><button class="btn" type="button" data-resolve="${esc(i.id)}">Mark as resolved</button></div></article>`).join('')
      || '<p class="muted">Nothing to investigate. Well done.</p>';
    $('issue-list').querySelectorAll('[data-resolve]').forEach((b) => (b.onclick = async () => {
      try {
        await api(`/api/issues/${b.dataset.resolve}`, { method: 'PATCH', body: { status: 'resolved' } });
        ref.openIssues = Math.max(0, (ref.openIssues || 1) - 1);
        loadIssues();
      } catch (e) { toast(e.message, 'error'); }
    }));
  } catch (e) {
    $('issue-list').innerHTML = `<p class="field-error">${e.status === 0 ? 'This list needs a connection.' : esc(e.message)}</p>`;
  }
}

// ---------------------------------------------------------------- import

function checkImport() {
  imported = parseAssetRows($('imp-text').value, ref.types);
  const known = new Set(ref.assets.map((a) => `${a.type_id}\u001e${a.serial.toLowerCase()}`));
  const dup = imported.rows.filter((r) => known.has(`${r.type_id}\u001e${r.serial.toLowerCase()}`));
  imported.rows = imported.rows.filter((r) => !dup.includes(r));
  for (const r of dup) imported.problems.push({ line: r.line, error: `${r.serial} is already registered (skipped)`, soft: true });
  const hard = imported.problems.filter((p) => !p.soft);
  $('imp-result').innerHTML =
    (imported.problems.length ? `<div class="notice ${hard.length ? 'notice-danger' : 'notice-warn'}"><b>${imported.problems.length} row${imported.problems.length === 1 ? '' : 's'} will be skipped:</b><ul>${imported.problems.slice(0, 15).map((p) => `<li>${p.line ? `Line ${p.line}: ` : ''}${esc(p.error)}</li>`).join('')}${imported.problems.length > 15 ? `<li>…and ${imported.problems.length - 15} more</li>` : ''}</ul></div>` : '') +
    (imported.rows.length ? `<div class="notice notice-ok">${imported.rows.length} equipment ready to import.</div>` : '');
  $('imp-go').classList.toggle('hidden', !imported.rows.length);
  $('imp-go').textContent = `Import ${imported.rows.length} equipment`;
}

async function runImport() {
  if (!imported?.rows.length) return;
  $('imp-go').disabled = true;
  try {
    const { created, problems } = await api('/api/assets/import', { method: 'POST', body: { rows: imported.rows.map(({ type_id, serial, attributes }) => ({ type_id, serial, attributes })) } });
    toast(`${created} equipment imported`, 'ok');
    ref = await loadReference();
    $('imp-result').innerHTML = `<div class="notice notice-ok">${created} equipment added.${problems.length ? ` ${problems.length} skipped.` : ''} Attach labels from the equipment list: tap a row, then <b>Attach a label</b>.</div>`;
    $('imp-text').value = '';
    $('imp-go').classList.add('hidden');
    imported = null;
  } catch (e) {
    $('imp-result').innerHTML = `<div class="notice notice-danger">${esc(e.status === 0 ? 'Importing needs a connection.' : e.message)}</div>`;
  } finally {
    $('imp-go').disabled = false;
  }
}
