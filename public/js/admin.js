// Admin: projects (create, settings, onboarding, turbines, close, delete), generic
// QR labels, and the equipment types shared by all projects.
import { api, esc, toast } from './app.js';
import { kindOf } from './equipment.js';
import { parseLocationRows } from './coords.js';
import { downloadBlob, printOnly, qrPng, qrSvg } from './print.js';
import { newTagCode, tagUrl } from './scan.js';
import { initTypesEditor, showTypesFor } from './types-editor.js';
import { validSlug } from './projects.js';
import { initBilling } from './admin-billing.js';

const $ = (id) => document.getElementById(id);
const BASE_KEY = 'at.siteBase';

let projects = [];
let current = null;        // selected project
let locations = [];        // its locations
let parsed = null;         // result of "Check the list"
let map = null;
let mapLayer = null;
let billing = null;
let invoices = [];
const TABS = ['overview', 'stats', 'billing', 'details', 'types', 'settings', 'labels'];

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
  $('pp-details').onsubmit = onSaveSettings;
  $('st-days').onchange = loadStats;
  window.addEventListener('hashchange', route);
  window.addEventListener('billing:loaded', (e) => { invoices = e.detail.invoices; renderHomeTiles(); });
  $('pp-status').onclick = onToggleStatus;
  $('pp-delete').onsubmit = onDelete;
  $('sov-form').onsubmit = onAddSov;
  $('wtg-check').onclick = onCheckList;
  $('wtg-import').onclick = onImport;
  $('wtg-file').onchange = onFile;
  $('wtg-template').onclick = () => downloadBlob(new Blob(['name,latitude,longitude\nWTG A01,54.01230,6.54320\nWTG A02,54.01230,6.55820\n'], { type: 'text/csv' }), 'turbine-list-template.csv');
  $('lb-make').onclick = makeLabels;
  billing = initBilling({ getProjects: () => projects, reloadProjects: loadProjects });
  await loadProjects();
  initTypesEditor();
  route();
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
  renderHomeTiles();
}

function renderHomeTiles() {
  const active = projects.filter((p) => p.status === 'active');
  const sum = (k) => projects.reduce((n, p) => n + (p[k] || 0), 0);
  const today = new Date().toISOString().slice(0, 10), month = today.slice(0, 7);
  const open = invoices.filter((i) => i.status === 'issued' || i.status === 'sent');
  const money = (c) => (c / 100).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' });
  const tile = (label, value, sub = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="tile"><span>${label}</span><b>${value}</b><span>${sub}</span></${href ? 'a' : 'div'}>`;
  $('home-tiles').innerHTML =
    tile('Active projects', String(active.length), `${projects.length - active.length} closed`) +
    tile('Equipment in use', String(sum('assets')), `${sum('wtgs')} turbines in total`) +
    tile('Defect equipment', String(sum('defects')), sum('defects') ? 'cannot be used' : 'all usable') +
    tile('Reported by technicians', String(sum('open_issues')), 'to investigate') +
    tile('Invoiced this month', money(invoices.filter((i) => i.status !== 'draft' && i.status !== 'void' && (i.issue_date || '').startsWith(month)).reduce((n, i) => n + i.total_cents, 0)), 'incl. VAT', '#/finance') +
    tile('Still to be paid', money(open.reduce((n, i) => n + i.total_cents, 0)), `${open.filter((i) => i.due_date && i.due_date < today).length} overdue`, '#/finance');
}

function renderProjects() {
  $('project-list').innerHTML = projects.map((p) => `
    <a class="project-card${current?.id === p.id ? ' selected' : ''}" href="#/p/${esc(p.slug)}/overview">
      <b>${esc(p.name)}</b>
      <span class="mono">/${esc(p.slug)}</span>
      <span class="muted">${p.client ? `${esc(p.client)} · ` : ''}${p.wtgs} turbines · ${p.assets} equipment${p.defects ? ` · <span class="stat-blocked">⛔ ${p.defects}</span>` : ''}${p.open_issues ? ` · <span class="warn-sym">⚠</span> ${p.open_issues} to investigate` : ''}</span>
      <span class="badge ${p.status === 'active' ? 'badge-ok' : ''}">${p.status === 'active' ? (p.geo_mode === 'live' ? 'live' : 'testing') : 'closed'}</span>
    </a>`).join('') || '<p class="muted">No projects yet. Create the first one.</p>';
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
    location.hash = `#/p/${project.slug}/overview`;
  } catch (err) { $('np-error').textContent = err.message; }
}

// ---------------------------------------------------------------- pages and tabs

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const page = parts[0] === 'finance' ? 'finance' : parts[0] === 'p' && parts[1] ? 'project' : 'home';
  for (const id of ['home', 'finance', 'project']) $(`page-${id}`).classList.toggle('hidden', id !== page);
  document.querySelectorAll('#top-tabs a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.top === (page === 'project' ? 'home' : page)));
  if (page === 'project') openProject(parts[1], TABS.includes(parts[2]) ? parts[2] : 'overview');
  else current = null;
  window.scrollTo(0, 0);
}

async function openProject(slug, tab) {
  if (!projects.length) await loadProjects();
  const p = projects.find((x) => x.slug.toLowerCase() === slug.toLowerCase());
  if (!p) { location.hash = '#/'; return; }
  if (current?.id !== p.id) await loadProject(p);
  document.querySelectorAll('#p-tabs a').forEach((a) => {
    a.href = `#/p/${p.slug}/${a.dataset.tab}`;
    a.toggleAttribute('aria-current', a.dataset.tab === tab);
  });
  for (const t of TABS) $(`pane-${t}`).classList.toggle('hidden', t !== tab);
  if (tab === 'stats') loadStats();
}

async function loadProject(p) {
  current = p;
  $('pp-title').textContent = `${current.name}  ·  /${current.slug}`;
  $('pp-badge').textContent = current.status === 'active' ? (current.geo_mode === 'live' ? 'live' : 'testing') : 'closed';
  $('pp-badge').className = `badge ${current.status === 'active' ? 'badge-ok' : ''}`;
  $('ps-name').value = current.name;
  $('ps-client').value = current.client || '';
  $('ps-email').value = current.contact_email || '';
  $('ps-mode').value = current.geo_mode;
  $('ps-radius').value = current.gps_radius_m;
  $('ps-farm').value = current.farm_radius_km;
  $('ps-nfc').checked = !!current.nfc_enabled;
  $('ps-error').textContent = ''; $('pd-error').textContent = '';
  $('pp-status').textContent = current.status === 'active' ? 'Close project (read-only)' : 'Reopen project';
  $('pp-export').href = '#';
  $('pp-export').onclick = (e) => { e.preventDefault(); exportCsv(); };
  $('pp-delete-confirm').value = '';
  $('pp-delete-confirm').placeholder = `Type ${current.slug} to delete`;
  parsed = null;
  $('wtg-result').innerHTML = '';
  $('wtg-import').classList.add('hidden');
  $('wtg-text').value = '';
  ['overview', 'warehouse', 'field'].forEach((pg) => { $(`po-${pg}`).href = `/${current.slug}/${pg}`; });
  renderLink();
  billing.showProject(current);
  showTypesFor(current).catch((e) => toast(e.message, 'error'));
  loadOverview();
  await loadLocations();
}

/** The numbers on the project's first tab. */
async function loadOverview() {
  const slug = current.slug;
  try {
    const [{ assets }, { types }] = await Promise.all([api(`/api/p/${slug}/assets`), api(`/api/types?project=${current.id}`)]);
    if (current?.slug !== slug) return;
    const tile = (label, value, sub = '') => `<div class="tile"><span>${label}</span><b>${value}</b><span>${sub}</span></div>`;
    const kinds = new Map();
    for (const a of assets) { const k = kindOf(a, types.find((t) => t.id === a.type_id) || { name: a.type_id, fields: [] }); kinds.set(k, (kinds.get(k) || 0) + 1); }
    $('po-tiles').innerHTML =
      tile('Equipment', String(assets.length), `${assets.filter((a) => a.last?.location_kind === 'SOV').length} on the SOV · ${assets.filter((a) => a.last?.location_kind === 'WTG').length} on turbines`) +
      tile('Turbines', String(current.wtgs), 'in the list') +
      tile('Defect', String(assets.filter((a) => a.defect).length), 'cannot be used') +
      tile('To investigate', String(current.open_issues || 0), 'reported by technicians');
    $('po-kinds').innerHTML = [...kinds].sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true })).map(([k, n]) => `<span class="kind-chip">${n} × ${esc(k)}</span>`).join('') || '<span class="muted">No equipment yet</span>';
  } catch (err) { $('po-tiles').innerHTML = `<p class="field-error">${esc(err.message)}</p>`; }
}

/** Statistics: how often the app is used, to see what to improve. */
async function loadStats() {
  if (!current) return;
  const slug = current.slug;
  try {
    const days = Number($('st-days').value);
    const st = await api(`/api/projects/${current.id}/stats?days=${days}`);
    if (current?.slug !== slug) return;
    const n = (k) => st.perDay.filter((r) => r.kind === k).reduce((s, r) => s + r.n, 0);
    const ev = (e) => st.events.find((x) => x.event === e)?.n || 0;
    const q = st.quality || { scans: 0, manual: 0, late: 0 };
    const pct = (x) => (q.scans ? `${Math.round((x / q.scans) * 100)} %` : '—');
    const tile = (label, value, sub = '') => `<div class="tile"><span>${label}</span><b>${value}</b><span>${sub}</span></div>`;
    $('st-tiles').innerHTML = tile('Scans', String(n('check')), `last ${days} days`) + tile('Movements', String(n('move')), 'placed by hand') +
      tile('Refuels, services', `${ev('refuel')} · ${ev('service')}`, 'all time') + tile('Defects reported', String(ev('defect')), 'all time') +
      tile('Location chosen by hand', pct(q.manual), 'of scans: GPS not used') + tile('Sent later', pct(q.late), 'of scans: made offline');
    const byDay = new Map();
    for (const r of st.perDay) if (r.kind === 'check') byDay.set(r.d, r.n);
    const list = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10); list.push([d, byDay.get(d) || 0]); }
    const max = Math.max(1, ...list.map((x) => x[1]));
    $('st-chart').innerHTML = list.map(([d, v]) => `<div class="bar" title="${d}: ${v}"><span style="height:${Math.round((v / max) * 100)}%"></span></div>`).join('');
    const rows = (arr, label) => (arr.length ? `<table><tbody>${arr.map((r) => `<tr><td>${esc(label(r))}</td><td class="num">${r.n}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No scans in this period.</p>');
    $('st-loc').innerHTML = rows(st.topLocations, (r) => r.name || 'Elsewhere');
    $('st-eq').innerHTML = rows(st.topEquipment, (r) => r.serial);
  } catch (err) { $('st-tiles').innerHTML = `<p class="field-error">${esc(err.message)}</p>`; }
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
    await loadProject(current);
  } catch (err) { $('ps-error').textContent = err.message; $('pd-error').textContent = err.message; }
}

async function onToggleStatus() {
  const next = current.status === 'active' ? 'closed' : 'active';
  if (next === 'closed' && !confirm(`Close ${current.name}? Nobody can add or change anything until you reopen it.`)) return;
  try {
    await api(`/api/projects/${current.id}`, { method: 'PATCH', body: { status: next } });
    toast(next === 'closed' ? 'Project closed' : 'Project reopened', 'ok');
    await loadProjects();
    await loadProject(projects.find((p) => p.id === current.id));
  } catch (err) { toast(err.message, 'error'); }
}

async function onDelete(e) {
  e.preventDefault();
  try {
    await api(`/api/projects/${current.id}`, { method: 'DELETE', body: { confirm: $('pp-delete-confirm').value } });
    toast(`Project ${current.name} deleted`, 'ok');
    current = null;
    await loadProjects();
    location.hash = '#/';
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
