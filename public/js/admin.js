// Setup: locations (supervisor + admin), users and equipment types (admin).
import { api, esc, registerServiceWorker, renderHeader, requireLogin, toast } from './app.js';
import { validateFieldDefs } from './fields.js';

const user = requireLogin('locations');
const $ = (id) => document.getElementById(id);
const isAdmin = user?.role === 'admin';

let types = [];

if (user) init();

async function init() {
  renderHeader('locations');
  registerServiceWorker();
  $('loc-form').onsubmit = onAddLocation;
  $('btn-import').onclick = onImport;
  await loadLocations();
  if (isAdmin) {
    $('users-card').classList.remove('hidden');
    $('types-card').classList.remove('hidden');
    $('user-form').onsubmit = onAddUser;
    $('t-select').onchange = showType;
    $('t-new').onclick = newType;
    $('t-save').onclick = saveType;
    await Promise.all([loadUsers(), loadTypes()]);
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

const EXAMPLE_FIELDS = [
  { key: 'rating', label: 'Rating', type: 'select', scope: 'asset', required: true, options: ['Small', 'Large'] },
  { key: 'condition', label: 'Condition OK', type: 'boolean', scope: 'check', required: true, alert: { equals: false } },
];

async function loadTypes(selectId) {
  ({ types } = await api('/api/types'));
  $('t-select').innerHTML = types.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  if (selectId) $('t-select').value = selectId;
  showType();
}

function showType() {
  const t = types.find((x) => x.id === $('t-select').value);
  if (!t) return newType();
  $('t-name').value = t.name;
  $('t-fields').value = JSON.stringify(t.fields, null, 2);
  $('t-error').textContent = '';
}

function newType() {
  $('t-select').value = '';
  $('t-name').value = '';
  $('t-fields').value = JSON.stringify(EXAMPLE_FIELDS, null, 2);
  $('t-name').focus();
}

async function saveType() {
  $('t-error').textContent = '';
  let fields;
  try {
    fields = JSON.parse($('t-fields').value);
  } catch (e) {
    $('t-error').textContent = `Not valid JSON: ${e.message}`;
    return;
  }
  const problems = validateFieldDefs(fields);
  if (problems.length) {
    $('t-error').textContent = problems.join('\n');
    return;
  }
  const id = $('t-select').value;
  try {
    const { type } = id
      ? await api(`/api/types/${id}`, { method: 'PATCH', body: { name: $('t-name').value, fields } })
      : await api('/api/types', { method: 'POST', body: { name: $('t-name').value, fields } });
    toast(`${type.name} saved`, 'ok');
    loadTypes(type.id);
  } catch (err) {
    $('t-error').textContent = [err.message, ...(Array.isArray(err.details) ? err.details : [])].join('\n');
  }
}
