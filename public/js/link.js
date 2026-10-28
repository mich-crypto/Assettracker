// Warehouse supervisor: register equipment and link QR labels / NFC tags to it.
import { api, esc, registerServiceWorker, renderHeader, requireLogin, toast } from './app.js';
import { formatValue, normalizeValues } from './fields.js';
import { collectFields, renderFields, showErrors } from './forms.js';
import { newTagCode, nfcSupported, parseTagText, readNfc, scanQr, tagUrl, writeNfc } from './scan.js';

const user = requireLogin('link');
const $ = (id) => document.getElementById(id);

let types = [];
let assets = [];
let editing = null;   // asset being edited, or null for a new one
let tags = [];        // [{ code, kind, isNew }]

if (user) init();

async function init() {
  renderHeader('link');
  registerServiceWorker();
  try {
    const data = await api('/api/bootstrap');
    types = data.types;
    assets = data.assets;
  } catch (e) {
    toast(`Could not load data: ${e.message}`, 'error');
  }
  $('type').innerHTML = types.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  $('type').onchange = () => renderFields($('attr-fields'), currentType().fields, 'asset', editing?.attributes);
  if (nfcSupported()) $('btn-nfc-read').classList.remove('hidden');
  $('btn-gen').onclick = () => addTag({ code: newTagCode(), kind: 'qr' });
  $('btn-scan').onclick = async () => {
    const text = await scanQr();
    if (text) addTag({ code: parseTagText(text), kind: 'qr' });
  };
  $('btn-nfc-read').onclick = onReadNfc;
  $('btn-new').onclick = () => startNew();
  $('btn-retire').onclick = onRetire;
  $('asset-form').onsubmit = onSave;
  $('search').oninput = renderList;
  $('btn-blank').onclick = printBlankLabels;
  $('btn-print-labels').onclick = () => printOnly($('label-card'));
  startNew();
  renderList();

  // Arriving from the field app with an unlinked tag.
  const code = new URLSearchParams(location.hash.slice(1)).get('t');
  if (code) {
    addTag({ code, kind: code.startsWith('NFC-') ? 'nfc' : 'qr' });
    history.replaceState(null, '', location.pathname);
    $('serial').focus();
  }
}

const currentType = () => types.find((t) => t.id === $('type').value) || { fields: [] };

function startNew() {
  editing = null;
  tags = [];
  $('asset-form').reset();
  $('form-title').textContent = 'Link new asset';
  $('btn-new').classList.add('hidden');
  $('btn-retire').classList.add('hidden');
  $('type').disabled = false;
  $('form-error').textContent = '';
  renderFields($('attr-fields'), currentType().fields, 'asset');
  renderTags();
  $('label-card').classList.add('hidden');
}

function startEdit(asset) {
  editing = asset;
  tags = asset.tags.map((t) => ({ ...t }));
  $('form-title').textContent = `Edit ${asset.serial}`;
  $('btn-new').classList.remove('hidden');
  $('btn-retire').classList.remove('hidden');
  $('type').value = asset.type_id;
  $('type').disabled = true; // fields depend on the type; re-register to change it
  $('serial').value = asset.serial;
  $('name').value = asset.name || '';
  $('form-error').textContent = '';
  renderFields($('attr-fields'), currentType().fields, 'asset', asset.attributes);
  renderTags();
  renderLabels(asset);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function addTag(tag) {
  if (!tag.code) return;
  if (tags.some((t) => t.code.toLowerCase() === tag.code.toLowerCase())) return toast('That tag is already in the list');
  const owner = assets.find((a) => a.id !== editing?.id && a.tags.some((t) => t.code.toLowerCase() === tag.code.toLowerCase()));
  if (owner) return toast(`Tag ${tag.code} is already linked to ${owner.serial}`, 'error');
  tags.push({ ...tag, isNew: true });
  renderTags();
}

function renderTags() {
  $('tags').innerHTML = tags.length ? tags.map((t, i) => `
    <div class="row" style="justify-content:space-between;border:1px solid var(--border);border-radius:8px;padding:8px 10px">
      <div><span class="badge">${t.kind.toUpperCase()}</span> <span class="mono">${esc(t.code)}</span>
        ${t.isNew ? '<span class="badge badge-warn">not saved</span>' : ''}</div>
      <div class="row">
        ${nfcSupported() ? `<button type="button" class="link-btn" data-write="${i}">Write to NFC</button>` : ''}
        <button type="button" class="link-btn" data-remove="${i}">Remove</button>
      </div>
    </div>`).join('') : '<p class="muted">No tag yet. Generate a QR label, scan an existing one, or read an NFC tag.</p>';
  $('tags').querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => removeTag(Number(b.dataset.remove))));
  $('tags').querySelectorAll('[data-write]').forEach((b) => (b.onclick = () => onWriteNfc(tags[Number(b.dataset.write)])));
}

async function removeTag(i) {
  const t = tags[i];
  if (!t.isNew) {
    if (!confirm(`Unlink tag ${t.code} from ${editing.serial}?`)) return;
    try {
      await api(`/api/tags/${encodeURIComponent(t.code)}`, { method: 'DELETE' });
      await reloadAssets();
    } catch (e) {
      return toast(e.message, 'error');
    }
  }
  tags.splice(i, 1);
  renderTags();
}

async function onReadNfc() {
  const btn = $('btn-nfc-read');
  const ctrl = new AbortController();
  btn.textContent = 'Hold tag to phone… (tap to cancel)';
  btn.onclick = () => ctrl.abort();
  try {
    const { code, serialCode } = await readNfc(ctrl.signal);
    // A blank tag only has its chip serial; a pre-written one carries our code.
    addTag({ code: code || serialCode, kind: 'nfc' });
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message || 'NFC read failed', 'error');
  } finally {
    ctrl.abort();
    btn.textContent = 'Read NFC tag';
    btn.onclick = onReadNfc;
  }
}

// Writing our URL means iPhones (which cannot use Web NFC) still open the app when tapping the tag.
async function onWriteNfc(tag) {
  const ctrl = new AbortController();
  toast('Hold the NFC tag against the phone…');
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    await writeNfc(tag.code, ctrl.signal);
    toast(`Tag written: ${tag.code}`, 'ok');
  } catch (e) {
    toast(e.name === 'AbortError' ? 'NFC write timed out' : e.message, 'error');
  } finally {
    clearTimeout(timer);
  }
}

async function onSave(e) {
  e.preventDefault();
  const form = $('asset-form');
  const type = currentType();
  const raw = collectFields($('attr-fields'), type.fields, 'asset');
  const { values, errors } = normalizeValues(type.fields, 'asset', raw);
  const serial = $('serial').value.trim();
  if (!serial) errors.serial = 'Serial number is required';
  showErrors(form, errors);
  $('form-error').textContent = '';
  if (Object.keys(errors).length) return;
  if (!editing && !tags.length && !confirm('Save without any tag? You can link one later.')) return;

  $('btn-save').disabled = true;
  try {
    let asset;
    if (editing) {
      ({ asset } = await api(`/api/assets/${editing.id}`, {
        method: 'PATCH',
        body: { serial, name: $('name').value, attributes: values },
      }));
      for (const t of tags.filter((x) => x.isNew)) {
        await api(`/api/assets/${editing.id}/tags`, { method: 'POST', body: { code: t.code, kind: t.kind } });
      }
    } else {
      ({ asset } = await api('/api/assets', {
        method: 'POST',
        body: { type_id: type.id, serial, name: $('name').value, attributes: values, tags: tags.map(({ code, kind }) => ({ code, kind })) },
      }));
    }
    await reloadAssets();
    const saved = assets.find((a) => a.id === asset.id) || asset;
    toast(`${saved.serial} saved`, 'ok');
    startEdit(saved);
  } catch (err) {
    $('form-error').textContent = err.message;
    if (err.details && typeof err.details === 'object' && !Array.isArray(err.details)) showErrors(form, err.details);
  } finally {
    $('btn-save').disabled = false;
  }
}

async function onRetire() {
  if (!editing || !confirm(`Retire ${editing.serial}? It disappears from the field app and overview.`)) return;
  try {
    await api(`/api/assets/${editing.id}`, { method: 'PATCH', body: { status: 'retired' } });
    await reloadAssets();
    toast(`${editing.serial} retired`, 'ok');
    startNew();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function reloadAssets() {
  assets = (await api('/api/bootstrap')).assets;
  renderList();
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const rows = assets.filter((a) => !q || [a.serial, a.name, ...a.tags.map((t) => t.code)].some((v) => v && v.toLowerCase().includes(q)));
  $('asset-rows').innerHTML = rows.map((a) => {
    const type = types.find((t) => t.id === a.type_id);
    const attrs = type ? type.fields.filter((f) => f.scope === 'asset' && a.attributes[f.key] != null)
      .map((f) => formatValue(f, a.attributes[f.key])).join(' · ') : '';
    return `<tr class="clickable" data-id="${a.id}">
      <td><b>${esc(a.serial)}</b>${a.name ? `<div class="muted">${esc(a.name)}</div>` : ''}</td>
      <td>${esc(type?.name || a.type_id)}<div class="muted">${esc(attrs)}</div></td>
      <td>${a.tags.length ? a.tags.map((t) => `<span class="badge">${t.kind.toUpperCase()}</span>`).join(' ') : '<span class="badge badge-warn">none</span>'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" class="muted">No assets yet.</td></tr>';
  $('asset-rows').querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = () => startEdit(assets.find((a) => a.id === tr.dataset.id));
  });
}

function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function renderLabels(asset) {
  const qrTags = asset.tags.filter((t) => t.kind === 'qr');
  $('label-card').classList.toggle('hidden', !qrTags.length);
  const type = types.find((t) => t.id === asset.type_id);
  const summary = (type?.fields || []).filter((f) => f.scope === 'asset' && f.type === 'select' && asset.attributes[f.key])
    .map((f) => asset.attributes[f.key]).join(' · ');
  $('labels').innerHTML = qrTags.map((t) => `
    <div class="label">
      ${qrSvg(tagUrl(t.code))}
      <div>
        <div class="l-serial">${esc(asset.serial)}</div>
        <div>${esc(type?.name || '')} ${esc(summary)}</div>
        <div class="l-code">${esc(t.code)}</div>
      </div>
    </div>`).join('');
}

/** Prints just one card: the print stylesheet shows only `.print-area`. */
function printOnly(el) {
  const others = [...document.querySelectorAll('.print-area')].filter((x) => x !== el);
  others.forEach((x) => x.classList.remove('print-area'));
  el.classList.add('print-area');
  window.addEventListener('afterprint', () => {
    if (el.id !== 'label-card') el.classList.remove('print-area');
    others.forEach((x) => x.classList.add('print-area'));
  }, { once: true });
  window.print();
}

// Pre-printed labels: new random codes, not linked to anything until scanned in Add equipment.
function printBlankLabels() {
  const n = Math.max(1, Math.min(100, Number($('blank-count').value) || 12));
  const sheet = $('blank-labels');
  sheet.innerHTML = Array.from({ length: n }, () => {
    const code = newTagCode();
    return `<div class="label label-blank">${qrSvg(tagUrl(code))}<div class="l-code">${esc(code)}</div></div>`;
  }).join('');
  sheet.classList.remove('hidden');
  printOnly($('blank-card'));
}
