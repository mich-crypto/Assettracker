import { can, hashPassword, ROLES, signSession, verifyPassword } from './auth.js';
import { HttpError, json, num, parseJsonColumn, readJson, Router, str } from './http.js';
import { validSlug } from '../public/js/projects.js';
import { registerBilling } from './billing.js';
import { VAT_MODES } from '../public/js/billing.js';
import { applyLocationRules, normalizeValues, validateFieldDefs } from '../public/js/fields.js';

export const router = new Router();

const MAX_SYNC_BATCH = 500;
const GPS_STATUSES = ['ok', 'poor_accuracy', 'no_fix', 'implausible', 'unavailable'];
const ISSUE_TYPES = ['cube_missing', 'cube_conflict', 'label_mismatch', 'unknown_tag'];

function guard(user, permission) {
  if (!user) throw new HttpError(401, 'Not signed in');
  if (permission && !can(user, permission)) throw new HttpError(403, 'Not allowed for your role');
}

const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

async function loadType(env, typeId, projectId = null) {
  const row = await env.DB.prepare('SELECT * FROM asset_types WHERE id = ?').bind(typeId).first();
  if (!row || (projectId && row.project_id && row.project_id !== projectId)) throw new HttpError(400, `Unknown asset type: ${typeId}`);
  return { ...row, fields: parseJsonColumn(row.fields, []) };
}

const typeOut = (t) => ({ ...t, fields: parseJsonColumn(t.fields, []) });

/** The equipment types of a project: its own copy when it has one, else the standard types. */
async function typesOfProject(env, projectId, { all = false } = {}) {
  const active = all ? '' : ' AND active = 1';
  const own = await env.DB.prepare(`SELECT * FROM asset_types WHERE project_id = ?${active} ORDER BY name`).bind(projectId).all();
  const hasOwn = own.results.length || (await env.DB.prepare('SELECT 1 AS x FROM asset_types WHERE project_id = ? LIMIT 1').bind(projectId).first());
  if (hasOwn) return { rows: own.results, own: true };
  const shared = await env.DB.prepare(`SELECT * FROM asset_types WHERE project_id IS NULL${active} ORDER BY name`).all();
  return { rows: shared.results, own: false };
}

/** Gives a project its own copy of the standard types and re-points its equipment to the copies. */
async function copyTypesToProject(env, project) {
  const { results: shared } = await env.DB.prepare('SELECT * FROM asset_types WHERE project_id IS NULL AND active = 1').all();
  const idOf = (id) => `${project.slug.toLowerCase()}-${id}`;
  const ids = new Map(shared.map((t) => [t.id, idOf(t.id)]));
  const stmts = [];
  for (const t of shared) {
    const fields = parseJsonColumn(t.fields, []).map((f) => (typeof f.pairWith === 'string' && ids.has(f.pairWith) ? { ...f, pairWith: ids.get(f.pairWith) } : f));
    stmts.push(env.DB.prepare('INSERT INTO asset_types (id, name, fields, active, project_id) VALUES (?, ?, ?, 1, ?)').bind(ids.get(t.id), t.name, JSON.stringify(fields), project.id));
  }
  for (const [old, neu] of ids) stmts.push(env.DB.prepare('UPDATE assets SET type_id = ? WHERE project_id = ? AND type_id = ?').bind(neu, project.id, old));
  if (stmts.length) await env.DB.batch(stmts);
  return shared.length;
}

function assetOut(a) {
  const { attributes, tag_codes, ...rest } = a;
  return {
    ...rest,
    attributes: parseJsonColumn(attributes, {}),
    tags: tag_codes ? tag_codes.split('\u001f').map((t) => { const [code, kind] = t.split('\u001e'); return { code, kind }; }) : [],
  };
}

/** The units a reading was connected to, as a list (older readings only have one). */
function linkedIdsOf(r) {
  const ids = parseJsonColumn(r.linked_asset_ids, null);
  return ids || (r.linked_asset_id ? [r.linked_asset_id] : []);
}

function readingOut(r) {
  const ids = parseJsonColumn(r.linked_asset_ids, null);
  return { ...r, data: parseJsonColumn(r.data, {}), linked_asset_ids: ids || (r.linked_asset_id ? [r.linked_asset_id] : []) };
}

const ASSET_SELECT = `
  SELECT a.*, (SELECT group_concat(t.code || char(30) || t.kind, char(31)) FROM tags t WHERE t.asset_id = a.id) AS tag_codes
  FROM assets a`;

// ---------------------------------------------------------------- projects

/** What phones and the overview may know about a project (no contact details). */
const projectPublic = (p) => ({
  id: p.id, slug: p.slug, name: p.name, status: p.status,
  geoMode: p.geo_mode, gpsRadiusM: p.gps_radius_m, farmRadiusKm: p.farm_radius_km, nfcEnabled: !!p.nfc_enabled,
});

async function loadProject(env, slugValue) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE slug = ?').bind(slugValue).first();
  if (!project) throw new HttpError(404, 'Unknown project');
  return project;
}

/** Registers a route under /api/p/:slug, with the project loaded; closed projects are read-only. */
function P(method, pattern, handler, { readOnlyOk = false } = {}) {
  router.add(method, `/api/p/:slug${pattern}`, async (ctx) => {
    const project = await loadProject(ctx.env, ctx.params.slug);
    if (method !== 'GET' && project.status === 'closed' && !readOnlyOk) throw new HttpError(403, 'This project is closed');
    return handler({ ...ctx, project });
  });
}

async function assetInProject(env, project, assetId) {
  const row = await env.DB.prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?').bind(assetId, project.id).first();
  if (!row) throw new HttpError(404, 'Equipment not found');
  return row;
}

router.add('GET', '/api/p/:slug/info', async ({ env, params }) => {
  const p = await loadProject(env, params.slug);
  return json({ project: { slug: p.slug, name: p.name, status: p.status } });
});

// Admin: all projects with a few counts.
router.add('GET', '/api/projects', async ({ env, user }) => {
  guard(user, 'admin');
  const { results } = await env.DB.prepare(
    `SELECT p.*,
       (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id AND a.status = 'active') AS assets,
       (SELECT COUNT(*) FROM locations l WHERE l.project_id = p.id AND l.kind = 'WTG' AND l.active = 1) AS wtgs,
       (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id AND a.status = 'active' AND a.defect = 1) AS defects,
       (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status = 'open') AS open_issues
     FROM projects p ORDER BY p.created_at DESC`,
  ).all();
  return json({ projects: results });
});

function projectFields(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, { name: 'name', required: true, max: 80 });
  if (body.client !== undefined) out.client = str(body.client, { max: 80 });
  if (body.contact_email !== undefined) {
    const e = str(body.contact_email, { max: 120 });
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, 'Enter a valid e-mail address');
    out.contact_email = e;
  }
  if (body.status !== undefined) {
    if (!['active', 'closed'].includes(body.status)) throw new HttpError(400, 'status must be active or closed');
    out.status = body.status;
  }
  if (body.geo_mode !== undefined) {
    if (!['test', 'live'].includes(body.geo_mode)) throw new HttpError(400, 'geo_mode must be test or live');
    out.geo_mode = body.geo_mode;
  }
  if (body.gps_radius_m !== undefined) out.gps_radius_m = num(body.gps_radius_m, { name: 'GPS radius', min: 10, max: 10000 }) ?? 300;
  if (body.farm_radius_km !== undefined) out.farm_radius_km = num(body.farm_radius_km, { name: 'wind farm area', min: 1, max: 100 }) ?? 20;
  if (body.nfc_enabled !== undefined) out.nfc_enabled = body.nfc_enabled ? 1 : 0;
  // Billing (see src/billing.js)
  if (body.billing_enabled !== undefined) out.billing_enabled = body.billing_enabled ? 1 : 0;
  for (const k of ['billing_start', 'billing_end']) {
    if (body[k] === undefined) continue;
    const d = str(body[k], { max: 10 });
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, 'Billing dates must look like 2026-12-31');
    out[k] = d;
  }
  for (const k of ['billing_startup_cents', 'billing_monthly_cents']) {
    if (body[k] === undefined) continue;
    const n = num(body[k], { name: 'fee', min: 0, max: 1e10 }) ?? 0;
    if (!Number.isInteger(n)) throw new HttpError(400, 'Fees must be whole cents');
    out[k] = n;
  }
  if (body.billing_vat_mode !== undefined) {
    if (!VAT_MODES.includes(body.billing_vat_mode)) throw new HttpError(400, 'Invalid VAT treatment');
    out.billing_vat_mode = body.billing_vat_mode;
  }
  if (body.billing_company !== undefined) out.billing_company = str(body.billing_company, { max: 120 });
  if (body.billing_address !== undefined) out.billing_address = str(body.billing_address, { max: 400 });
  if (body.billing_vat_id !== undefined) out.billing_vat_id = str(body.billing_vat_id, { max: 40 });
  if (body.billing_reference !== undefined) out.billing_reference = str(body.billing_reference, { max: 80 });
  if (body.billing_email !== undefined) {
    const e = str(body.billing_email, { max: 120 });
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, 'Enter a valid billing e-mail address');
    out.billing_email = e;
  }
  return out;
}

router.add('POST', '/api/projects', async ({ request, env, user }) => {
  guard(user, 'admin');
  const body = await readJson(request);
  const link = String(body.slug || '').trim();
  if (!validSlug(link)) throw new HttpError(400, 'The link must be 2 to 24 letters, digits or hyphens (for example BLP) and not a reserved word');
  const exists = await env.DB.prepare('SELECT id FROM projects WHERE slug = ?').bind(link).first();
  if (exists) throw new HttpError(409, `The link /${link} is already used by another project`);
  const v = projectFields(body, false);
  const id = newId();
  await env.DB.prepare('INSERT INTO projects (id, slug, name, client, contact_email) VALUES (?, ?, ?, ?, ?)')
    .bind(id, link, v.name, v.client ?? null, v.contact_email ?? null).run();
  await copyTypesToProject(env, { id, slug: link });
  return json({ project: await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first() }, 201);
});

router.add('PATCH', '/api/projects/:id', async ({ request, env, user, params }) => {
  guard(user, 'admin');
  const v = projectFields(await readJson(request), true);
  const keys = Object.keys(v);
  if (!keys.length) throw new HttpError(400, 'Nothing to update');
  const res = await env.DB.prepare(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => v[k]), params.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Project not found');
  return json({ project: await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(params.id).first() });
});

// Usage statistics of one project (scans, movements, events) for the admin, to see how the app is used.
router.add('GET', '/api/projects/:id/stats', async ({ env, user, params, url }) => {
  guard(user, 'admin');
  const p = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(params.id).first();
  if (!p) throw new HttpError(404, 'Project not found');
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 7), 365);
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const base = 'FROM readings r JOIN assets a ON a.id = r.asset_id WHERE a.project_id = ?';
  const [perDay, byKind, events, where, top, issues, quality] = await env.DB.batch([
    env.DB.prepare(`SELECT substr(r.recorded_at, 1, 10) AS d, r.kind, COUNT(*) AS n ${base} AND r.recorded_at >= ? GROUP BY d, r.kind ORDER BY d`).bind(p.id, since),
    env.DB.prepare(`SELECT r.kind, COUNT(*) AS n ${base} GROUP BY r.kind`).bind(p.id),
    env.DB.prepare(`SELECT json_extract(r.data, '$.event') AS event, COUNT(*) AS n ${base} AND r.kind = 'event' GROUP BY event`).bind(p.id),
    env.DB.prepare(`SELECT l.name, COUNT(*) AS n ${base.replace('WHERE', 'LEFT JOIN locations l ON l.id = r.location_id WHERE')} AND r.kind = 'check' AND r.recorded_at >= ? GROUP BY l.name ORDER BY n DESC LIMIT 8`).bind(p.id, since),
    env.DB.prepare(`SELECT a.serial, a.type_id, COUNT(*) AS n ${base} AND r.kind = 'check' AND r.recorded_at >= ? GROUP BY a.id ORDER BY n DESC LIMIT 8`).bind(p.id, since),
    env.DB.prepare('SELECT type, status, COUNT(*) AS n FROM issues WHERE project_id = ? GROUP BY type, status').bind(p.id),
    env.DB.prepare(`SELECT COUNT(*) AS scans,
        SUM(CASE WHEN r.location_source = 'manual' THEN 1 ELSE 0 END) AS manual,
        SUM(CASE WHEN (julianday(r.received_at) - julianday(r.recorded_at)) * 1440 > 30 THEN 1 ELSE 0 END) AS late
      ${base} AND r.kind = 'check' AND r.recorded_at >= ?`).bind(p.id, since),
  ]);
  return json({ days, since, perDay: perDay.results, byKind: byKind.results, events: events.results, topLocations: where.results, topEquipment: top.results, issues: issues.results, quality: quality.results[0] });
});

// Deletes a project with all its equipment, readings and locations. The caller must
// type the project's link as confirmation.
router.add('DELETE', '/api/projects/:id', async ({ request, env, user, params }) => {
  guard(user, 'admin');
  const body = await readJson(request);
  const p = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(params.id).first();
  if (!p) throw new HttpError(404, 'Project not found');
  if (String(body.confirm || '').toLowerCase() !== p.slug.toLowerCase()) throw new HttpError(400, `Type the project link (${p.slug}) to confirm`);
  const billed = await env.DB.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE project_id = ? AND status <> 'draft'`).bind(p.id).first();
  if (billed.n) throw new HttpError(409, 'This project has invoices that must be kept. Close the project instead.');
  const mine = '(SELECT id FROM assets WHERE project_id = ?)';
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM invoices WHERE project_id = ? AND status = 'draft'`).bind(p.id),
    env.DB.prepare('DELETE FROM issues WHERE project_id = ?').bind(p.id),
    env.DB.prepare(`DELETE FROM readings WHERE asset_id IN ${mine}`).bind(p.id),
    env.DB.prepare(`DELETE FROM tags WHERE asset_id IN ${mine}`).bind(p.id),
    env.DB.prepare('DELETE FROM assets WHERE project_id = ?').bind(p.id),
    env.DB.prepare('DELETE FROM locations WHERE project_id = ?').bind(p.id),
    env.DB.prepare('DELETE FROM asset_types WHERE project_id = ?').bind(p.id),
    env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(p.id),
  ]);
  return json({ ok: true });
});

registerBilling(router, guard);

// ---------------------------------------------------------------- auth

router.add('GET', '/api/auth/status', async ({ env }) => {
  if (env.AUTH_MODE === 'open') return json({ open: true, needsSetup: false });
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return json({ open: false, needsSetup: row.n === 0 });
});

// Creates the first admin. Only works while there are no users, and only with
// the SETUP_KEY secret, so a freshly deployed site cannot be claimed by a stranger.
router.add('POST', '/api/auth/setup', async ({ request, env }) => {
  const body = await readJson(request);
  if (!env.SETUP_KEY || body.setupKey !== env.SETUP_KEY) throw new HttpError(403, 'Invalid setup key');
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  if (row.n > 0) throw new HttpError(409, 'Setup already completed');
  const user = await createUser(env, { ...body, role: 'admin' });
  return json({ token: await signSession(user, env.SESSION_SECRET), user }, 201);
});

router.add('POST', '/api/auth/login', async ({ request, env }) => {
  const body = await readJson(request);
  const username = str(body.username, { name: 'username', required: true });
  const row = await env.DB.prepare('SELECT * FROM users WHERE username = ? AND active = 1').bind(username).first();
  if (!row || !(await verifyPassword(String(body.password || ''), row.password_hash))) {
    throw new HttpError(401, 'Wrong username or password');
  }
  const user = { id: row.id, username: row.username, name: row.name, role: row.role };
  return json({ token: await signSession(user, env.SESSION_SECRET), user });
});

router.add('GET', '/api/auth/me', async ({ user }) => {
  guard(user);
  return json({ user });
});

// ---------------------------------------------------------------- users (admin)

async function createUser(env, body) {
  const username = str(body.username, { name: 'username', required: true, max: 60 });
  const name = str(body.name, { name: 'name', required: true, max: 100 });
  const role = String(body.role || '');
  if (!ROLES.includes(role)) throw new HttpError(400, `role must be one of ${ROLES.join(', ')}`);
  const password = String(body.password || '');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  const id = newId();
  await env.DB.prepare('INSERT INTO users (id, username, name, role, password_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(id, username, name, role, await hashPassword(password))
    .run();
  return { id, username, name, role };
}

router.add('GET', '/api/users', async ({ env, user }) => {
  guard(user, 'admin');
  const { results } = await env.DB.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY name').all();
  return json({ users: results });
});

router.add('POST', '/api/users', async ({ request, env, user }) => {
  guard(user, 'admin');
  return json({ user: await createUser(env, await readJson(request)) }, 201);
});

router.add('PATCH', '/api/users/:id', async ({ request, env, user, params }) => {
  guard(user, 'admin');
  const body = await readJson(request);
  const sets = [];
  const vals = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(str(body.name, { name: 'name', required: true })); }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'Invalid role');
    sets.push('role = ?'); vals.push(body.role);
  }
  if (body.active !== undefined) { sets.push('active = ?'); vals.push(body.active ? 1 : 0); }
  if (body.password) {
    if (String(body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    sets.push('password_hash = ?'); vals.push(await hashPassword(String(body.password)));
  }
  if (params.id === user.id && (body.active === false || (body.role && body.role !== 'admin'))) {
    throw new HttpError(400, 'You cannot deactivate or demote your own account');
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  const res = await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, params.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'User not found');
  return json({ ok: true });
});

// ---------------------------------------------------------------- bootstrap (offline cache)

// Everything the field app needs to work without a connection: this project's
// settings, locations and equipment, plus the shared equipment types.
P('GET', '/bootstrap', async ({ env, user, project }) => {
  guard(user);
  const types = { results: (await typesOfProject(env, project.id)).rows };
  const [locations, assets, states, issues] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM locations WHERE project_id = ? AND active = 1 ORDER BY kind DESC, name').bind(project.id),
    env.DB.prepare(`${ASSET_SELECT} WHERE a.status = 'active' AND a.project_id = ? ORDER BY a.serial`).bind(project.id),
    // Where each unit was last seen and what it was connected to, so the phone
    // knows offline whether a generator and fuel cube are already together.
    env.DB.prepare(`SELECT asset_id, location_id, linked_asset_id, linked_asset_ids, recorded_at FROM (
      SELECT r.asset_id, r.location_id, r.linked_asset_id, r.linked_asset_ids, r.recorded_at,
        ROW_NUMBER() OVER (PARTITION BY r.asset_id ORDER BY r.recorded_at DESC, r.received_at DESC) AS rn
      FROM readings r JOIN assets a ON a.id = r.asset_id
      WHERE a.project_id = ? AND r.kind IN ('check', 'move')) WHERE rn = 1`).bind(project.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM issues WHERE project_id = ? AND status = 'open'").bind(project.id),
  ]);
  const stateOf = new Map(states.results.map((r) => [r.asset_id, r]));
  return json({
    user,
    serverTime: nowIso(),
    project: projectPublic(project),
    settings: {
      geoMode: project.geo_mode,
      gpsRadiusM: project.gps_radius_m,
      farmRadiusKm: project.farm_radius_km,
      nfcEnabled: !!project.nfc_enabled,
    },
    openIssues: issues.results[0].n,
    types: types.results.map(typeOut),
    // The project's GPS radius applies to every turbine.
    locations: locations.results.map((l) => (l.kind === 'WTG' ? { ...l, radius_m: project.gps_radius_m } : l)),
    assets: assets.results.map((a) => {
      const st = stateOf.get(a.id);
      return { ...assetOut(a), state: st ? { location_id: st.location_id, linked_asset_ids: linkedIdsOf(st), at: st.recorded_at } : null };
    }),
  });
});

// ---------------------------------------------------------------- asset types (shared by all projects)

// ?project=<id> gives that project's types (own: false means it still uses the standard ones).
router.add('GET', '/api/types', async ({ env, user, url }) => {
  guard(user);
  const pid = url.searchParams.get('project');
  if (pid) {
    const { rows, own } = await typesOfProject(env, pid, { all: true });
    return json({ types: rows.map(typeOut), own });
  }
  const { results } = await env.DB.prepare('SELECT * FROM asset_types WHERE project_id IS NULL ORDER BY name').all();
  return json({ types: results.map(typeOut) });
});

router.add('POST', '/api/projects/:id/own-types', async ({ env, user, params }) => {
  guard(user, 'admin');
  const p = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(params.id).first();
  if (!p) throw new HttpError(404, 'Project not found');
  if ((await typesOfProject(env, p.id, { all: true })).own) throw new HttpError(409, 'This project already has its own equipment types');
  const n = await copyTypesToProject(env, p);
  return json({ copied: n });
});

function checkFields(fields) {
  const errors = validateFieldDefs(fields);
  if (errors.length) throw new HttpError(400, 'Invalid field definitions', errors);
  return JSON.stringify(fields);
}

router.add('POST', '/api/types', async ({ request, env, user }) => {
  guard(user, 'admin');
  const body = await readJson(request);
  const name = str(body.name, { name: 'name', required: true, max: 80 });
  let id = slug(body.id || name);
  if (!id) throw new HttpError(400, 'Invalid type id');
  let pid = null;
  if (body.project_id) {
    const p = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(body.project_id).first();
    if (!p) throw new HttpError(404, 'Project not found');
    if (!(await typesOfProject(env, p.id, { all: true })).own) throw new HttpError(409, 'Give the project its own equipment types first');
    pid = p.id;
    id = `${p.slug.toLowerCase()}-${id}`;
  }
  await env.DB.prepare('INSERT INTO asset_types (id, name, fields, project_id) VALUES (?, ?, ?, ?)')
    .bind(id, name, checkFields(body.fields || []), pid)
    .run();
  return json({ type: typeOut(await env.DB.prepare('SELECT * FROM asset_types WHERE id = ?').bind(id).first()) }, 201);
});

router.add('PATCH', '/api/types/:id', async ({ request, env, user, params }) => {
  guard(user, 'admin');
  const body = await readJson(request);
  const sets = [];
  const vals = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(str(body.name, { name: 'name', required: true })); }
  if (body.fields !== undefined) { sets.push('fields = ?'); vals.push(checkFields(body.fields)); }
  if (body.active !== undefined) { sets.push('active = ?'); vals.push(body.active ? 1 : 0); }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  const res = await env.DB.prepare(`UPDATE asset_types SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, params.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Type not found');
  return json({ type: typeOut(await env.DB.prepare('SELECT * FROM asset_types WHERE id = ?').bind(params.id).first()) });
});

// ---------------------------------------------------------------- locations (per project)

function locationValues(body, partial = false) {
  const out = {};
  if (!partial || body.kind !== undefined) {
    if (!['WTG', 'SOV'].includes(body.kind)) throw new HttpError(400, 'kind must be WTG or SOV');
    out.kind = body.kind;
  }
  if (!partial || body.name !== undefined) out.name = str(body.name, { name: 'name', required: true, max: 80 });
  if (body.lat !== undefined) out.lat = num(body.lat, { name: 'lat', min: -90, max: 90 });
  if (body.lon !== undefined) out.lon = num(body.lon, { name: 'lon', min: -180, max: 180 });
  if (body.notes !== undefined) out.notes = str(body.notes, { max: 500 });
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  if (!partial && out.kind === 'WTG' && (out.lat == null || out.lon == null)) {
    throw new HttpError(400, `WTG ${out.name} needs lat and lon`);
  }
  return out;
}

P('GET', '/locations', async ({ env, user, project }) => {
  guard(user);
  const { results } = await env.DB.prepare('SELECT * FROM locations WHERE project_id = ? ORDER BY kind DESC, name').bind(project.id).all();
  return json({ locations: results });
});

P('POST', '/locations', async ({ request, env, user, project }) => {
  guard(user, 'locations');
  const v = locationValues(await readJson(request));
  const id = newId();
  await env.DB.prepare('INSERT INTO locations (id, project_id, kind, name, lat, lon, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, project.id, v.kind, v.name, v.lat ?? null, v.lon ?? null, v.notes ?? null)
    .run();
  return json({ location: await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first() }, 201);
});

P('PATCH', '/locations/:id', async ({ request, env, user, params, project }) => {
  guard(user, 'locations');
  const v = locationValues(await readJson(request), true);
  const keys = Object.keys(v);
  if (!keys.length) throw new HttpError(400, 'Nothing to update');
  const res = await env.DB.prepare(`UPDATE locations SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND project_id = ?`)
    .bind(...keys.map((k) => v[k]), params.id, project.id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'Location not found');
  return json({ location: await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(params.id).first() });
});

// Bulk create/update by name, e.g. a wind farm's turbine coordinate list.
P('POST', '/locations/import', async ({ request, env, user, project }) => {
  guard(user, 'locations');
  const body = await readJson(request);
  if (!Array.isArray(body.rows) || !body.rows.length) throw new HttpError(400, 'rows must be a non-empty list');
  if (body.rows.length > 2000) throw new HttpError(400, 'At most 2000 rows per import');
  const errors = [];
  const stmts = [];
  body.rows.forEach((row, i) => {
    try {
      const v = locationValues({ ...row, kind: String(row.kind || 'WTG').toUpperCase() });
      stmts.push(
        env.DB.prepare(
          `INSERT INTO locations (id, project_id, kind, name, lat, lon, notes) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id, name) DO UPDATE SET kind = excluded.kind, lat = excluded.lat, lon = excluded.lon,
             notes = COALESCE(excluded.notes, locations.notes), active = 1`,
        ).bind(newId(), project.id, v.kind, v.name, v.lat ?? null, v.lon ?? null, v.notes ?? null),
      );
    } catch (e) {
      errors.push(`row ${i + 1}: ${e.message}`);
    }
  });
  if (errors.length) throw new HttpError(400, 'Import rejected; nothing was saved', errors);
  await env.DB.batch(stmts);
  return json({ imported: stmts.length });
});

// ---------------------------------------------------------------- equipment

// Per asset: where it is now (latest scan or manual move) and its latest check values
// (latest scan, overridden by a newer "refueled" event), for the overview and reports.
P('GET', '/assets', async ({ env, user, url, project }) => {
  guard(user, 'overview');
  const where = ['a.project_id = ?'];
  const vals = [project.id];
  const type = url.searchParams.get('type');
  if (type) { where.push('a.type_id = ?'); vals.push(type); }
  if (url.searchParams.get('status') !== 'all') where.push("a.status = 'active'");
  const ranked = (cond, cols = 'r.asset_id, r.recorded_at') => `
      SELECT ${cols}, ROW_NUMBER() OVER (PARTITION BY r.asset_id ORDER BY r.recorded_at DESC, r.received_at DESC) AS rn
      FROM readings r WHERE ${cond}`;
  const sql = `
    WITH latest AS (${ranked("r.kind IN ('check', 'move')", 'r.*')}),
    latest_check AS (${ranked("r.kind = 'check'", 'r.asset_id, r.recorded_at, r.data')}),
    latest_refuel AS (${ranked("r.kind = 'event' AND json_extract(r.data, '$.event') = 'refuel'")}),
    latest_service AS (${ranked("r.kind = 'event' AND json_extract(r.data, '$.event') = 'service'")})
    SELECT a.*,
      (SELECT group_concat(t.code || char(30) || t.kind, char(31)) FROM tags t WHERE t.asset_id = a.id) AS tag_codes,
      l.id AS r_id, l.recorded_at AS r_recorded_at, l.location_id AS r_location_id, l.location_source AS r_location_source,
      l.gps_status AS r_gps_status, l.lat AS r_lat, l.lon AS r_lon, l.accuracy_m AS r_accuracy_m, l.data AS r_data,
      l.notes AS r_notes, l.kind AS r_kind, l.linked_asset_id AS r_linked_asset_id, l.linked_asset_ids AS r_linked_asset_ids,
      c.recorded_at AS c_recorded_at, c.data AS c_data,
      rf.recorded_at AS f_refueled_at, sv.recorded_at AS f_serviced_at,
      loc.name AS r_location_name, loc.kind AS r_location_kind, loc.lat AS r_location_lat, loc.lon AS r_location_lon
    FROM assets a
    LEFT JOIN latest l ON l.asset_id = a.id AND l.rn = 1
    LEFT JOIN latest_check c ON c.asset_id = a.id AND c.rn = 1
    LEFT JOIN latest_refuel rf ON rf.asset_id = a.id AND rf.rn = 1
    LEFT JOIN latest_service sv ON sv.asset_id = a.id AND sv.rn = 1
    LEFT JOIN locations loc ON loc.id = l.location_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.serial`;
  const { results } = await env.DB.prepare(sql).bind(...vals).all();
  return json({
    assets: results.map((row) => {
      const asset = {};
      const last = {};
      const check = {};
      const events = {};
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith('r_')) last[k.slice(2)] = v;
        else if (k.startsWith('c_')) check[k.slice(2)] = v;
        else if (k.startsWith('f_')) events[k.slice(2)] = v;
        else asset[k] = v;
      }
      let latestCheck = check.recorded_at ? readingOut(check) : null;
      // A refuel recorded after the last scan means the tank is full again.
      if (events.refueled_at && (!latestCheck || events.refueled_at > latestCheck.recorded_at)) {
        latestCheck = { recorded_at: events.refueled_at, data: { ...(latestCheck?.data || {}), fuel_level: 100 } };
      }
      return {
        ...assetOut(asset),
        last: last.id ? readingOut(last) : null,
        check: latestCheck,
        refueled_at: events.refueled_at ?? null,
        serviced_at: events.serviced_at ?? null,
      };
    }),
  });
});

P('GET', '/assets/:id', async ({ env, user, params, url, project }) => {
  guard(user);
  await assetInProject(env, project, params.id);
  const asset = await env.DB.prepare(`${ASSET_SELECT} WHERE a.id = ?`).bind(params.id).first();
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);
  const { results } = await env.DB.prepare(
    `SELECT r.*, l.name AS location_name, l.kind AS location_kind
     FROM readings r LEFT JOIN locations l ON l.id = r.location_id
     WHERE r.asset_id = ? ORDER BY r.recorded_at DESC LIMIT ?`,
  ).bind(params.id, limit).all();
  return json({ asset: assetOut(asset), readings: results.map(readingOut) });
});

function tagValues(t) {
  const code = str(t.code, { name: 'tag code', required: true, max: 120 });
  if (!['qr', 'nfc'].includes(t.kind)) throw new HttpError(400, 'tag kind must be qr or nfc');
  return { code, kind: t.kind };
}

async function assertTagFree(env, code, assetId) {
  const row = await env.DB.prepare(
    'SELECT t.asset_id, a.serial FROM tags t JOIN assets a ON a.id = t.asset_id WHERE t.code = ?',
  ).bind(code).first();
  if (row && row.asset_id !== assetId) throw new HttpError(409, `This label is already linked to equipment ${row.serial}`);
  return !!row;
}

async function assertSerialFree(env, typeId, serial, exceptId = null) {
  const dup = await env.DB.prepare(
    `SELECT a.id, p.name AS project FROM assets a JOIN projects p ON p.id = a.project_id
     WHERE a.type_id = ? AND a.serial = ? COLLATE NOCASE`,
  ).bind(typeId, serial).first();
  if (dup && dup.id !== exceptId) throw new HttpError(409, `Serial number ${serial} is already registered (project ${dup.project})`);
}

P('POST', '/assets', async ({ request, env, user, project }) => {
  guard(user, 'link');
  const body = await readJson(request);
  const type = await loadType(env, body.type_id, project.id);
  const serial = str(body.serial, { name: 'serial number', required: true, max: 80 });
  const { values, errors } = normalizeValues(type.fields, 'asset', body.attributes);
  if (Object.keys(errors).length) throw new HttpError(400, 'Please correct the highlighted fields', errors);
  await assertSerialFree(env, type.id, serial);
  const tags = (body.tags || []).map(tagValues);
  for (const t of tags) await assertTagFree(env, t.code, null);
  const id = newId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO assets (id, project_id, type_id, serial, name, attributes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, project.id, type.id, serial, str(body.name, { max: 100 }), JSON.stringify(values), user.id),
    ...tags.map((t) =>
      env.DB.prepare('INSERT INTO tags (code, asset_id, kind, created_by) VALUES (?, ?, ?, ?)').bind(t.code, id, t.kind, user.id)),
  ]);
  return json({ asset: assetOut(await env.DB.prepare(`${ASSET_SELECT} WHERE a.id = ?`).bind(id).first()) }, 201);
});

// Bulk add (the fleet list from Excel/CSV). Equipment is created without labels; a
// label is attached later by scanning it. Rows that fail are reported, the rest is saved.
P('POST', '/assets/import', async ({ request, env, user, project }) => {
  guard(user, 'link');
  const body = await readJson(request);
  if (!Array.isArray(body.rows) || !body.rows.length) throw new HttpError(400, 'rows must be a non-empty list');
  if (body.rows.length > 1000) throw new HttpError(400, 'At most 1000 rows per import');
  const types = new Map((await typesOfProject(env, project.id, { all: true })).rows.map((t) => [t.id, typeOut(t)]));
  const existing = new Set((await env.DB.prepare('SELECT type_id || char(30) || lower(serial) AS k FROM assets').all()).results.map((r) => r.k));
  const stmts = [];
  const problems = [];
  const seen = new Set();
  body.rows.forEach((row, i) => {
    const line = i + 1;
    const type = types.get(row.type_id);
    if (!type) return problems.push({ row: line, error: `Unknown equipment type "${row.type_id}"` });
    const serial = String(row.serial ?? '').trim();
    if (!serial) return problems.push({ row: line, error: 'Serial number is empty' });
    const key = `${type.id}\u001e${serial.toLowerCase()}`;
    if (existing.has(key) || seen.has(key)) return problems.push({ row: line, error: `Serial ${serial} is already registered` });
    const { values, errors } = normalizeValues(type.fields, 'asset', row.attributes || {});
    if (Object.keys(errors).length) return problems.push({ row: line, error: Object.values(errors).join('; ') });
    seen.add(key);
    stmts.push(env.DB.prepare('INSERT INTO assets (id, project_id, type_id, serial, attributes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId(), project.id, type.id, serial, JSON.stringify(values), user.id));
  });
  if (stmts.length) await env.DB.batch(stmts);
  return json({ created: stmts.length, problems });
});

P('PATCH', '/assets/:id', async ({ request, env, user, params, project }) => {
  guard(user, 'link');
  const body = await readJson(request);
  const current = await assetInProject(env, project, params.id);
  const sets = ['updated_at = ?'];
  const vals = [nowIso()];
  if (body.serial !== undefined) {
    const serial = str(body.serial, { name: 'serial number', required: true, max: 80 });
    await assertSerialFree(env, current.type_id, serial, current.id);
    sets.push('serial = ?'); vals.push(serial);
  }
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(str(body.name, { max: 100 })); }
  if (body.status !== undefined) {
    if (!['active', 'retired'].includes(body.status)) throw new HttpError(400, 'status must be active or retired');
    sets.push('status = ?'); vals.push(body.status);
  }
  if (body.attributes !== undefined) {
    const type = await loadType(env, current.type_id, project.id);
    const { values, errors } = normalizeValues(type.fields, 'asset', body.attributes);
    if (Object.keys(errors).length) throw new HttpError(400, 'Please correct the highlighted fields', errors);
    sets.push('attributes = ?'); vals.push(JSON.stringify(values));
  }
  await env.DB.prepare(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, params.id).run();
  return json({ asset: assetOut(await env.DB.prepare(`${ASSET_SELECT} WHERE a.id = ?`).bind(params.id).first()) });
});

// Site manager puts a unit at a location by hand (no scan). Stored as a 'move'
// reading so the history shows where it was placed and when.
P('POST', '/assets/:id/move', async ({ request, env, user, params, project }) => {
  guard(user, 'overview');
  const body = await readJson(request);
  const asset = await assetInProject(env, project, params.id);
  if (asset.status !== 'active') throw new HttpError(404, 'Equipment not found');
  const loc = await env.DB.prepare('SELECT id, name FROM locations WHERE id = ? AND project_id = ? AND active = 1').bind(body.location_id || '', project.id).first();
  if (!loc) throw new HttpError(400, 'Select a location');
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO readings (id, asset_id, recorded_at, user_id, location_id, location_source, gps_status, data, notes, kind)
     VALUES (?, ?, ?, ?, ?, 'manual', 'unavailable', '{}', ?, 'move')`,
  ).bind(id, asset.id, nowIso(), user.id, loc.id, str(body.notes, { max: 500 })).run();
  return json({ ok: true, id, location: loc }, 201);
});

P('POST', '/assets/:id/tags', async ({ request, env, user, params, project }) => {
  guard(user, 'link');
  const t = tagValues(await readJson(request));
  await assetInProject(env, project, params.id);
  if (!(await assertTagFree(env, t.code, params.id))) {
    await env.DB.prepare('INSERT INTO tags (code, asset_id, kind, created_by) VALUES (?, ?, ?, ?)')
      .bind(t.code, params.id, t.kind, user.id)
      .run();
  }
  return json({ ok: true }, 201);
});

P('DELETE', '/tags/:code', async ({ env, user, params, project }) => {
  guard(user, 'link');
  const res = await env.DB.prepare('DELETE FROM tags WHERE code = ? AND asset_id IN (SELECT id FROM assets WHERE project_id = ?)')
    .bind(params.code, project.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Tag not found');
  return json({ ok: true });
});

P('GET', '/tags/:code', async ({ env, user, params, project }) => {
  guard(user);
  const asset = await env.DB.prepare(`${ASSET_SELECT} JOIN tags tg ON tg.asset_id = a.id WHERE tg.code = ? AND a.project_id = ?`)
    .bind(params.code, project.id)
    .first();
  if (!asset) throw new HttpError(404, 'This label is not linked to any equipment in this project');
  return json({ asset: assetOut(asset) });
});

// ---------------------------------------------------------------- issues (for the warehouse supervisor)

P('GET', '/issues', async ({ env, user, url, project }) => {
  guard(user);
  const status = url.searchParams.get('status') === 'resolved' ? 'resolved' : 'open';
  const { results } = await env.DB.prepare(
    `SELECT i.*, a.serial, a.type_id, a.attributes, ra.serial AS related_serial, ra.type_id AS related_type_id, l.name AS location_name
     FROM issues i LEFT JOIN assets a ON a.id = i.asset_id LEFT JOIN assets ra ON ra.id = i.related_asset_id
     LEFT JOIN locations l ON l.id = i.location_id
     WHERE i.project_id = ? AND i.status = ? ORDER BY i.created_at DESC LIMIT 200`,
  ).bind(project.id, status).all();
  return json({ issues: results.map((r) => ({ ...r, attributes: parseJsonColumn(r.attributes, {}) })) });
});

P('PATCH', '/issues/:id', async ({ request, env, user, params, project }) => {
  guard(user, 'link');
  const body = await readJson(request);
  const status = body.status === 'open' ? 'open' : 'resolved';
  const res = await env.DB.prepare('UPDATE issues SET status = ?, resolved_at = ? WHERE id = ? AND project_id = ?')
    .bind(status, status === 'resolved' ? nowIso() : null, params.id, project.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Issue not found');
  return json({ ok: true });
});

// ---------------------------------------------------------------- readings

// Offline outbox upload. Idempotent: every item carries a client-generated id, so a
// batch that is resent after a dropped connection is stored once. Each item is
// accepted or rejected on its own; one bad entry never blocks the rest.
// Item kinds: check (a scan with values), move (a location without values),
// event (refuel / service), issue (something for the warehouse supervisor).
P('POST', '/readings/sync', async ({ request, env, user, project }) => {
  guard(user, 'field');
  const body = await readJson(request, 5_000_000);
  const items = Array.isArray(body.readings) ? body.readings : null;
  if (!items) throw new HttpError(400, 'readings must be a list');
  if (items.length > MAX_SYNC_BATCH) throw new HttpError(400, `At most ${MAX_SYNC_BATCH} readings per request`);

  const typeRows = { results: (await typesOfProject(env, project.id, { all: true })).rows };
  const [locRows, assetRows, tagRows] = await env.DB.batch([
    env.DB.prepare('SELECT id, kind FROM locations WHERE project_id = ?').bind(project.id),
    env.DB.prepare('SELECT id, type_id FROM assets WHERE project_id = ?').bind(project.id),
    env.DB.prepare('SELECT t.code, t.asset_id FROM tags t JOIN assets a ON a.id = t.asset_id WHERE a.project_id = ?').bind(project.id),
  ]);
  const types = new Map(typeRows.results.map((t) => [t.id, typeOut(t)]));
  const locationKinds = new Map(locRows.results.map((l) => [l.id, l.kind]));
  const assets = new Map(assetRows.results.map((a) => [a.id, a]));
  const tagIndex = new Map(tagRows.results.map((t) => [t.code.toLowerCase(), t.asset_id]));
  const findAsset = (id, code) => assets.get(id) || (code ? assets.get(tagIndex.get(String(code).toLowerCase())) : null) || null;

  const results = [];
  const stmts = [];
  const pending = [];   // parallel to stmts: { id } for items, null for helper statements
  for (const raw of items) {
    const id = typeof raw?.id === 'string' && /^[0-9a-f-]{36}$/i.test(raw.id) ? raw.id : null;
    const reject = (error) => results.push({ id: raw?.id ?? null, status: 'rejected', error });
    if (!id) { reject('Missing or invalid id'); continue; }
    try {
      const recordedAt = new Date(raw.recorded_at);
      if (Number.isNaN(recordedAt.getTime())) { reject('Invalid recorded_at'); continue; }
      if (recordedAt.getTime() > Date.now() + 24 * 3600 * 1000) { reject('recorded_at is in the future (check phone clock)'); continue; }
      const at = recordedAt.toISOString();
      const kind = ['check', 'move', 'event', 'issue'].includes(raw.kind) ? raw.kind : 'check';

      // ---- something to look into
      if (kind === 'issue') {
        if (!ISSUE_TYPES.includes(raw.issue_type)) { reject('Unknown issue type'); continue; }
        const asset = findAsset(raw.asset_id, raw.tag_code);
        const related = findAsset(raw.related_asset_id, raw.related_tag_code);
        stmts.push(env.DB.prepare(
          `INSERT OR IGNORE INTO issues (id, project_id, type, asset_id, related_asset_id, tag_code, location_id, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, project.id, raw.issue_type, asset?.id ?? null, related?.id ?? null, str(raw.tag_code, { max: 120 }),
          locationKinds.has(raw.location_id) ? raw.location_id : null, str(raw.note, { max: 1000 }), at));
        pending.push({ id });
        continue;
      }

      // Fall back to the tag: an offline scan of a label linked after the phone's last
      // refresh has no asset_id yet, and is resolved here at sync time.
      const asset = findAsset(raw.asset_id, raw.tag_code);
      if (!asset) { reject('Unknown equipment, or the label belongs to another project'); continue; }
      const type = types.get(asset.type_id);
      const defs = type ? type.fields : [];

      // ---- refuelled / serviced (the location does not change)
      if (kind === 'event') {
        let data;
        if (raw.event === 'refuel') data = { event: 'refuel', fuel_level: 100 };
        else if (raw.event === 'service') {
          const next = String(raw.next_inspection || '');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || Number.isNaN(Date.parse(next))) { reject('Enter the next inspection date'); continue; }
          data = { event: 'service', next_inspection: next };
          if (defs.some((f) => f.key === 'inspection_due' && f.scope === 'asset')) {
            stmts.push(env.DB.prepare("UPDATE assets SET attributes = json_set(attributes, '$.inspection_due', ?), updated_at = ? WHERE id = ?")
              .bind(next, at, asset.id));
            pending.push(null);
          }
        } else if (raw.event === 'defect' || raw.event === 'repaired') {
          // Equipment that cannot be used (defect) or is usable again (repaired). The newest event wins,
          // so late or repeated uploads from phones that were offline cannot undo a newer one.
          const note = raw.event === 'defect' ? str(raw.notes, { max: 300 }) : null;
          data = { event: raw.event, ...(note ? { note } : {}) };
          stmts.push(env.DB.prepare(
            'UPDATE assets SET defect = ?, defect_note = ?, defect_at = ?, updated_at = ? WHERE id = ? AND (defect_at IS NULL OR defect_at <= ?)',
          ).bind(raw.event === 'defect' ? 1 : 0, note, at, at, asset.id, at));
          pending.push(null);
        } else { reject('Unknown event'); continue; }
        stmts.push(env.DB.prepare(
          `INSERT OR IGNORE INTO readings (id, asset_id, recorded_at, user_id, location_source, gps_status, data, notes, tag_code, kind)
           VALUES (?, ?, ?, ?, 'manual', 'unavailable', ?, ?, ?, 'event')`,
        ).bind(id, asset.id, at, user.id, JSON.stringify(data), str(raw.notes, { max: 1000 }), str(raw.tag_code, { max: 120 })));
        pending.push({ id });
        continue;
      }

      // ---- a scan or a placement: needs a location
      // No WTG/SOV is fine in test mode when the phone's GPS position is the location.
      const hasFix = Number.isFinite(raw.lat) && Number.isFinite(raw.lon);
      if (raw.location_id) {
        if (!locationKinds.has(raw.location_id)) { reject('Unknown location'); continue; }
      } else if (project.geo_mode === 'live' || !hasFix) {
        reject('Select the location (WTG or vessel)'); continue;
      }
      let values = {};
      if (kind === 'check') {
        // e.g. fuel cube is never connected on the SOV, whatever the phone sent.
        const data = applyLocationRules(defs, raw.data || {}, locationKinds.get(raw.location_id));
        const result = normalizeValues(defs, 'check', data);
        if (Object.keys(result.errors).length) { reject(Object.values(result.errors).join('; ')); continue; }
        values = result.values;
      }
      // The unit it was connected to (e.g. the fuel cube on this generator), by id or scanned label.
      // A setup has several units (generator, battery pack, fuel cube): a list of ids, or the older single one.
      const wanted = [...(Array.isArray(raw.linked_asset_ids) ? raw.linked_asset_ids.slice(0, 10) : []), raw.linked_asset_id].filter(Boolean);
      const linkedIds = [...new Set(wanted.map((x) => findAsset(x)?.id).filter((x) => x && x !== asset.id))];
      if (!linkedIds.length) { const one = findAsset(null, raw.linked_tag_code); if (one && one.id !== asset.id) linkedIds.push(one.id); }
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO readings
          (id, asset_id, recorded_at, user_id, location_id, location_source, gps_status, lat, lon, accuracy_m, distance_m, data, notes, tag_code, kind, linked_asset_id, linked_asset_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, asset.id, at, user.id, raw.location_id || null,
        raw.location_source === 'gps' ? 'gps' : 'manual',
        GPS_STATUSES.includes(raw.gps_status) ? raw.gps_status : 'unavailable',
        num(raw.lat, { min: -90, max: 90, name: 'lat' }), num(raw.lon, { min: -180, max: 180, name: 'lon' }),
        num(raw.accuracy_m, { min: 0, name: 'accuracy' }), num(raw.distance_m, { min: 0, name: 'distance' }),
        JSON.stringify(values), str(raw.notes, { max: 2000, name: 'notes' }), str(raw.tag_code, { max: 120 }),
        kind, linkedIds[0] ?? null, linkedIds.length ? JSON.stringify(linkedIds) : null,
      ));
      pending.push({ id });
    } catch (e) {
      reject(e instanceof HttpError ? e.message : 'Invalid entry');
    }
  }
  if (stmts.length) {
    const out = await env.DB.batch(stmts);
    out.forEach((r, i) => { if (pending[i]) results.push({ id: pending[i].id, status: r.meta.changes ? 'stored' : 'duplicate' }); });
  }
  return json({ results });
});

P('GET', '/readings', async ({ env, user, url, project }) => {
  guard(user, 'overview');
  const where = ['a.project_id = ?'];
  const vals = [project.id];
  const p = url.searchParams;
  if (p.get('asset_id')) { where.push('r.asset_id = ?'); vals.push(p.get('asset_id')); }
  if (p.get('location_id')) { where.push('r.location_id = ?'); vals.push(p.get('location_id')); }
  if (p.get('from')) { where.push('r.recorded_at >= ?'); vals.push(p.get('from')); }
  if (p.get('to')) { where.push('r.recorded_at <= ?'); vals.push(p.get('to')); }
  const limit = Math.min(Number(p.get('limit')) || 500, 5000);
  const { results } = await env.DB.prepare(
    `SELECT r.*, a.serial, a.type_id, a.name AS asset_name, l.name AS location_name, l.kind AS location_kind
     FROM readings r JOIN assets a ON a.id = r.asset_id
     LEFT JOIN locations l ON l.id = r.location_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.recorded_at DESC LIMIT ?`,
  ).bind(...vals, limit).all();
  return json({ readings: results.map(readingOut) });
});
