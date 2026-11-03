// Admin: projects (create, settings, onboarding, turbines, close, delete), generic
// QR labels, and the equipment types shared by all projects.
import { api, esc, toast } from './app.js';
import { parseLocationRows } from './coords.js';
import { downloadBlob, printOnly, qrPng, qrSvg } from './print.js';
import { newTagCode, tagUrl } from './scan.js';
import { initTypesEditor } from './types-editor.js';
import { validSlug } from './projects.js';

const $ = (id) => document.getElementById(id);
const BASE_KEY = 'at.siteBase';

let projects = [];
let current = null;        // selected project
let locations = [];        // its locations
let parsed = null;         // result of "Check the list"
let map = null;
let mapLayer = null;

init();

async function init() {
  $('btn-new-project').onclick = () => { $('new-project').classList.toggle('hidden'); $('np-name').focus(); };
  $('np-cancel').onclick = () => $('new-project').classList.add('hidden');
  $('new-project').onsubmit = onCreate;
  $('np-slug').oninput = () => { $('np-preview').textContent = `The project will be at ${siteBase()}/${$('np-slug').value.trim() || '…'}`; };
  $('np-name').oninput = () => {
    // Suggest initials as the link until the user types their own.
    if ($('np-slug').dataset.touched) return;
    const initials = $('np-name').value.trim().split(/\s+/).map((w) => w[0] || '').join('').toUpperCase().slice(0, 6);
    $('np-slug').value = initials;
    $('np-slug').dispatchEvent(new Event('input'));
  };
  $('np-slug').addEventListener('keydown', () => { $('np-slug').dataset.touched = '1'; });
  $('pp-close').onclick = () => { current = null; $('project-panel').classList.add('hidden'); renderProjects(); };
  $('site-base').value = siteBase();
  $('site-base').onchange = () => {
    try { localStorage.setItem(BASE_KEY, $('site-base').value.trim().replace(/\/+$/, '')); } catch { /* ignore */ }
    if (current) renderLink();
  };
  $('pp-copy').onclick = () => copy(projectUrl(), 'Link copied');
  $('pp-copy-mail').onclick = () => copy(mailText().body, 'E-mail text copied');
  $('pp-print').onclick = printOnboarding;
  $('pp-png').onclick = async () => downloadBlob(await qrPng(projectUrl()), `${current.slug}-qr.png`);
  $('pp-settings').onsubmit = onSaveSettings;
  $('pp-status').onclick = onToggleStatus;
  $('pp-delete').onsubmit = onDelete;
  $('sov-form').onsubmit = onAddSov;
  $('wtg-check').onclick = onCheckList;
  $('wtg-import').onclick = onImport;
  $('wtg-file').onchange = onFile;
  $('wtg-template').onclick = () => downloadBlob(new Blob(['name,latitude,longitude\nWTG A01,54.01230,6.54320\nWTG A02,54.01230,6.55820\n'], { type: 'text/csv' }), 'turbine-list-template.csv');
  $('lb-make').onclick = makeLabels;
  await loadProjects();
  initTypesEditor().catch((e) => toast(e.message, 'error'));
}

function siteBase() {
  let saved = null;
  try { saved = localStorage.getItem(BASE_KEY); } catch { /* ignore */ }
  return (saved || location.origin).replace(/\/+$/, '');
}

const projectUrl = () => `${siteBase()}/${current.slug}`;

async function copy(text, message) {
  try { await navigator.clipboard.writeText(text); toast(message, 'ok'); } catch { toast('Copy is not allowed here; select the text instead', 'error'); }
}

// ---------------------------------------------------------------- projects

async function loadProjects() {
  ({ projects } = await api('/api/projects'));
  renderProjects();
}

function renderProjects() {
  $('project-list').innerHTML = projects.map((p) => `
    <button type="button" class="project-card${current?.id === p.id ? ' selected' : ''}" data-id="${esc(p.id)}">
      <b>${esc(p.name)}</b>
      <span class="mono">/${esc(p.slug)}</span>
      <span class="muted">${p.client ? `${esc(p.client)} · ` : ''}${p.wtgs} turbines · ${p.assets} equipment${p.open_issues ? ` · <span class="warn-sym">⚠</span> ${p.open_issues} to investigate` : ''}</span>
      <span class="badge ${p.status === 'active' ? 'badge-ok' : ''}">${p.status === 'active' ? (p.geo_mode === 'live' ? 'live' : 'testing') : 'closed'}</span>
    </button>`).join('') || '<p class="muted">No projects yet. Create the first one.</p>';
  $('project-list').querySelectorAll('.project-card').forEach((b) => (b.onclick = () => selectProject(b.dataset.id)));
}

async function onCreate(e) {
  e.preventDefault();
  $('np-error').textContent = '';
  const slug = $('np-slug').value.trim();
  if (!validSlug(slug)) { $('np-error').textContent = 'The link must be 2 to 24 letters, digits or hyphens (for example BLP) and not a reserved word.'; return; }
  try {
    const { project } = await api('/api/projects', { method: 'POST', body: {
      name: $('np-name').value, slug, client: $('np-client').value, contact_email: $('np-email').value,
    } });
    e.target.reset();
    delete $('np-slug').dataset.touched;
    $('new-project').classList.add('hidden');
    toast(`Project ${project.name} created`, 'ok');
    await loadProjects();
    selectProject(project.id);
  } catch (err) { $('np-error').textContent = err.message; }
}

async function selectProject(id) {
  current = projects.find((p) => p.id === id);
  if (!current) return;
  renderProjects();
  $('project-panel').classList.remove('hidden');
  $('pp-title').textContent = `${current.name}  ·  /${current.slug}`;
  $('ps-name').value = current.name;
  $('ps-client').value = current.client || '';
  $('ps-email').value = current.contact_email || '';
  $('ps-mode').value = current.geo_mode;
  $('ps-radius').value = current.gps_radius_m;
  $('ps-farm').value = current.farm_radius_km;
  $('ps-nfc').checked = !!current.nfc_enabled;
  $('ps-error').textContent = '';
  $('pp-status').textContent = current.status === 'active' ? 'Close project (read-only)' : 'Reopen project';
  $('pp-export').href = '#';
  $('pp-export').onclick = (e) => { e.preventDefault(); exportCsv(); };
  $('pp-delete-confirm').value = '';
  $('pp-delete-confirm').placeholder = `Type ${current.slug} to delete`;
  parsed = null;
  $('wtg-result').innerHTML = '';
  $('wtg-import').classList.add('hidden');
  $('wtg-text').value = '';
  renderLink();
  await loadLocations();
  $('project-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function onSaveSettings(e) {
  e.preventDefault();
  $('ps-error').textContent = '';
  try {
    const { project } = await api(`/api/projects/${current.id}`, { method: 'PATCH', body: {
      name: $('ps-name').value, client: $('ps-client').value, contact_email: $('ps-email').value,
      geo_mode: $('ps-mode').value, gps_radius_m: $('ps-radius').value, farm_radius_km: $('ps-farm').value, nfc_enabled: $('ps-nfc').checked,
    } });
    toast('Settings saved', 'ok');
    await loadProjects();
    current = projects.find((p) => p.id === project.id);
    $('pp-title').textContent = `${current.name}  ·  /${current.slug}`;
    renderLink();
  } catch (err) { $('ps-error').textContent = err.message; }
}

async function onToggleStatus() {
  const next = current.status === 'active' ? 'closed' : 'active';
  if (next === 'closed' && !confirm(`Close ${current.name}? Nobody can add or change anything until you reopen it.`)) return;
  try {
    await api(`/api/projects/${current.id}`, { method: 'PATCH', body: { status: next } });
    toast(next === 'closed' ? 'Project closed' : 'Project reopened', 'ok');
    await loadProjects();
    selectProject(current.id);
  } catch (err) { toast(err.message, 'error'); }
}

async function onDelete(e) {
  e.preventDefault();
  try {
    await api(`/api/projects/${current.id}`, { method: 'DELETE', body: { confirm: $('pp-delete-confirm').value } });
    toast(`Project ${current.name} deleted`, 'ok');
    current = null;
    $('project-panel').classList.add('hidden');
    await loadProjects();
  } catch (err) { toast(err.message, 'error'); }
}

async function exportCsv() {
  try {
    const { readings } = await api(`/api/p/${current.slug}/readings?limit=5000`);
    const keys = [...new Set(readings.flatMap((r) => Object.keys(r.data || {})))];
    const cell = (v) => {
      const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['recorded_at', 'kind', 'serial', 'type', 'location', 'location_source', 'gps_status', 'lat', 'lon', ...keys, 'notes'];
    const lines = [head.join(',')].concat(readings.map((r) => [
      r.recorded_at, r.kind, r.serial, r.type_id, r.location_name, r.location_source, r.gps_status, r.lat, r.lon, ...keys.map((k) => r.data[k]), r.notes,
    ].map(cell).join(',')));
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), `${current.slug}-readings.csv`);
  } catch (err) { toast(err.message, 'error'); }
}

// ---------------------------------------------------------------- link, QR, onboarding

function renderLink() {
  const url = projectUrl();
  $('pp-link').textContent = url;
  $('pp-open').href = url;
  $('pp-qr').innerHTML = qrSvg(url);
  const m = mailText();
  $('pp-mail').href = current.contact_email ? `mailto:${encodeURIComponent(current.contact_email)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}` : '#';
  $('pp-mail').classList.toggle('btn-disabled', !current.contact_email);
  $('pp-mail-hint').textContent = current.contact_email
    ? 'Opens your e-mail program with the text filled in. Attach the QR (PNG) or the printed onboarding sheet yourself.'
    : 'Add a contact e-mail in the settings to prepare the e-mail.';
}

function mailText() {
  const name = current.name;
  const url = projectUrl();
  return {
    subject: `AssetTracker for ${name}: how to get access`,
    body: `Hello,

Here is the link to the equipment tracking app for ${name}:
${url}

How to get started
1. Open the link on your phone (or laptop). You can also scan the QR code in the attachment.
2. The first time, the app shows how to put it on your home screen. Do this once; after that it opens like any other app and also works without signal on the turbines.
3. Choose what you do: Scan equipment (technicians), Warehouse, or Overview (site manager).

Technicians: scan the QR label on the generator, confirm where you are, answer the few questions and save. Readings you take offline are sent automatically when you are back on the vessel network.

Kind regards`,
  };
}

function printOnboarding() {
  const url = projectUrl();
  $('onboard-sheet').innerHTML = `
    <div class="onboard-page">
      <div class="onboard-brand">Asset<b>Tracker</b></div>
      <h1>${esc(current.name)}</h1>
      <p class="onboard-lead">Scan the QR code with your phone camera, or open the link.</p>
      <div class="onboard-qr">${qrSvg(url)}</div>
      <p class="onboard-url">${esc(url)}</p>
      <div class="onboard-cols">
        <div><h2>1. Put it on your home screen</h2>
          <p><b>iPhone (Safari):</b> Share → Add to Home Screen.</p>
          <p><b>Android (Chrome):</b> ⋮ menu → Install app.</p>
          <p><b>Laptop (Chrome / Edge):</b> install icon in the address bar.</p></div>
        <div><h2>2. Choose what you do</h2>
          <p><b>Scan equipment</b> for technicians.</p>
          <p><b>Warehouse</b> to add equipment, mark refuelled or serviced.</p>
          <p><b>Overview</b> for the site manager.</p></div>
        <div><h2>3. Offshore</h2>
          <p>The app works without signal. Anything you record is sent automatically when you are back on the vessel network.</p></div>
      </div>
      ${current.contact_email ? `<p class="onboard-contact">Questions: ${esc(current.contact_email)}</p>` : ''}
    </div>`;
  printOnly($('onboard-sheet'));
}

// ---------------------------------------------------------------- locations

async function loadLocations() {
  ({ locations } = await api(`/api/p/${current.slug}/locations`));
  const sovs = locations.filter((l) => l.kind === 'SOV');
  const wtgs = locations.filter((l) => l.kind === 'WTG');
  $('sov-list').innerHTML = sovs.map((l) => `<span class="chip">${esc(l.name)}${l.active ? '' : ' <span class="muted">(inactive)</span>'}
    <button type="button" class="link-btn" data-toggle="${l.id}" data-active="${l.active}">${l.active ? 'Deactivate' : 'Activate'}</button></span>`).join('') || '<span class="muted">No vessel yet.</span>';
  $('wtg-summary').textContent = wtgs.length ? `${wtgs.filter((l) => l.active).length} active turbines.` : 'No turbines yet. Import the list below.';
  $('wtg-rows').innerHTML = wtgs.map((l) => `<tr><td><b>${esc(l.name)}</b></td><td class="mono">${l.lat?.toFixed(5) ?? '—'}</td><td class="mono">${l.lon?.toFixed(5) ?? '—'}</td>
    <td>${l.active ? '' : '<span class="badge">inactive</span> '}<button type="button" class="link-btn" data-toggle="${l.id}" data-active="${l.active}">${l.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('');
  document.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = async () => {
    try { await api(`/api/p/${current.slug}/locations/${b.dataset.toggle}`, { method: 'PATCH', body: { active: b.dataset.active !== '1' } }); await loadLocations(); } catch (e) { toast(e.message, 'error'); }
  }));
  drawMap();
}

async function onAddSov(e) {
  e.preventDefault();
  try {
    await api(`/api/p/${current.slug}/locations`, { method: 'POST', body: { kind: 'SOV', name: $('sov-name').value } });
    e.target.reset();
    await loadLocations();
    await loadProjects();
  } catch (err) { toast(err.message, 'error'); }
}

async function onFile() {
  const file = $('wtg-file').files[0];
  if (!file) return;
  $('wtg-text').value = await file.text();
  onCheckList();
}

function onCheckList() {
  parsed = parseLocationRows($('wtg-text').value);
  const { rows, problems, warnings } = parsed;
  const wtgs = rows.filter((r) => r.kind === 'WTG').length;
  const sovs = rows.length - wtgs;
  $('wtg-result').innerHTML =
    (problems.length ? `<div class="notice notice-danger"><b>${problems.length} problem${problems.length === 1 ? '' : 's'}. Nothing is imported until these are fixed:</b><ul>${problems.slice(0, 12).map((p) => `<li>${p.line ? `Line ${p.line}: ` : ''}${esc(p.error)}</li>`).join('')}${problems.length > 12 ? `<li>…and ${problems.length - 12} more</li>` : ''}</ul></div>` : '') +
    (warnings.length ? `<div class="notice notice-warn"><ul>${warnings.map((w) => `<li>${esc(w.warning)}</li>`).join('')}</ul></div>` : '') +
    (rows.length && !problems.length ? `<div class="notice notice-ok">${wtgs} turbine${wtgs === 1 ? '' : 's'}${sovs ? ` and ${sovs} vessel${sovs === 1 ? '' : 's'}` : ''} ready. Check the positions on the map.</div>` : '');
  $('wtg-import').classList.toggle('hidden', !rows.length || !!problems.length);
  $('wtg-import').textContent = `Import ${rows.length} location${rows.length === 1 ? '' : 's'}`;
  drawMap();
}

async function onImport() {
  if (!parsed || parsed.problems.length || !parsed.rows.length) return;
  try {
    const { imported } = await api(`/api/p/${current.slug}/locations/import`, { method: 'POST', body: { rows: parsed.rows.map(({ name, kind, lat, lon }) => ({ name, kind, lat, lon })) } });
    toast(`${imported} locations imported`, 'ok');
    parsed = null;
    $('wtg-text').value = '';
    $('wtg-result').innerHTML = '';
    $('wtg-import').classList.add('hidden');
    await loadLocations();
    await loadProjects();
  } catch (err) {
    $('wtg-result').innerHTML = `<div class="notice notice-danger">${esc(err.message)}${Array.isArray(err.details) ? `<ul>${err.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</div>`;
  }
}

/** Turbines already in the project (grey) and the list being checked (blue). */
function drawMap() {
  if (!window.L) return;
  if (!map) {
    map = L.map('loc-map').setView([54, 4], 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    mapLayer = L.layerGroup().addTo(map);
  }
  mapLayer.clearLayers();
  const pts = [];
  for (const l of locations.filter((x) => x.kind === 'WTG' && x.lat != null && x.active)) {
    L.circleMarker([l.lat, l.lon], { radius: 5, color: '#5b6876', weight: 1, fillOpacity: 0.7 }).bindTooltip(l.name).addTo(mapLayer);
    pts.push([l.lat, l.lon]);
  }
  for (const r of parsed?.rows.filter((x) => x.kind === 'WTG') || []) {
    L.circleMarker([r.lat, r.lon], { radius: 6, color: '#155fa0', fillColor: '#155fa0', fillOpacity: 0.9 }).bindTooltip(r.name).addTo(mapLayer);
    pts.push([r.lat, r.lon]);
  }
  setTimeout(() => { map.invalidateSize(); if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 }); }, 50);
}

// ---------------------------------------------------------------- generic labels

function makeLabels() {
  const n = Math.max(1, Math.min(500, Number($('lb-count').value) || 100));
  const size = Number($('lb-size').value) || 35;
  const base = siteBase();
  const sheet = $('lb-sheet');
  sheet.style.setProperty('--label-mm', `${size}mm`);
  sheet.innerHTML = Array.from({ length: n }, () => {
    const code = newTagCode();
    return `<div class="label-sticker">${qrSvg(tagUrl(code, base), { margin: 1 })}<div class="l-code">${esc(code)}</div></div>`;
  }).join('');
  sheet.classList.remove('hidden');
  printOnly(sheet);
}
