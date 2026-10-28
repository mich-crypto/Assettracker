import { can, hashPassword, ROLES, signSession, verifyPassword } from './auth.js';
import { HttpError, json, num, parseJsonColumn, readJson, Router, str } from './http.js';
import { normalizeValues, validateFieldDefs } from '../public/js/fields.js';

export const router = new Router();

const MAX_SYNC_BATCH = 500;
const GPS_STATUSES = ['ok', 'poor_accuracy', 'no_fix', 'implausible', 'unavailable'];

function guard(user, permission) {
  if (!user) throw new HttpError(401, 'Not signed in');
  if (permission && !can(user, permission)) throw new HttpError(403, 'Not allowed for your role');
}

const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

async function loadType(env, typeId) {
  const row = await env.DB.prepare('SELECT * FROM asset_types WHERE id = ?').bind(typeId).first();
  if (!row) throw new HttpError(400, `Unknown asset type: ${typeId}`);
  return { ...row, fields: parseJsonColumn(row.fields, []) };
}

const typeOut = (t) => ({ ...t, fields: parseJsonColumn(t.fields, []) });

function assetOut(a) {
  const { attributes, tag_codes, ...rest } = a;
  return {
    ...rest,
    attributes: parseJsonColumn(attributes, {}),
    tags: tag_codes ? tag_codes.split('\u001f').map((t) => { const [code, kind] = t.split('\u001e'); return { code, kind }; }) : [],
  };
}

function readingOut(r) {
  return { ...r, data: parseJsonColumn(r.data, {}) };
}

const ASSET_SELECT = `
  SELECT a.*, (SELECT group_concat(t.code || char(30) || t.kind, char(31)) FROM tags t WHERE t.asset_id = a.id) AS tag_codes
  FROM assets a`;

// ---------------------------------------------------------------- auth

router.add('GET', '/api/auth/status', async ({ env }) => {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return json({ needsSetup: row.n === 0 });
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

// Everything the field app needs to work without a connection: types, locations
// and the tag -> asset index. Fetched whenever the app is online.
router.add('GET', '/api/bootstrap', async ({ env, user }) => {
  guard(user);
  const [types, locations, assets] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM asset_types WHERE active = 1 ORDER BY name'),
    env.DB.prepare('SELECT * FROM locations WHERE active = 1 ORDER BY kind DESC, name'),
    env.DB.prepare(`${ASSET_SELECT} WHERE a.status = 'active' ORDER BY a.serial`),
  ]);
  return json({
    user,
    serverTime: nowIso(),
    types: types.results.map(typeOut),
    locations: locations.results,
    assets: assets.results.map(assetOut),
  });
});

// ---------------------------------------------------------------- asset types (admin)

router.add('GET', '/api/types', async ({ env, user }) => {
  guard(user);
  const { results } = await env.DB.prepare('SELECT * FROM asset_types ORDER BY name').all();
  return json({ types: results.map(typeOut) });
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
  const id = slug(body.id || name);
  if (!id) throw new HttpError(400, 'Invalid type id');
  await env.DB.prepare('INSERT INTO asset_types (id, name, fields) VALUES (?, ?, ?)')
    .bind(id, name, checkFields(body.fields || []))
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

// ---------------------------------------------------------------- locations

function locationValues(body, partial = false) {
  const out = {};
  if (!partial || body.kind !== undefined) {
    if (!['WTG', 'SOV'].includes(body.kind)) throw new HttpError(400, 'kind must be WTG or SOV');
    out.kind = body.kind;
  }
  if (!partial || body.name !== undefined) out.name = str(body.name, { name: 'name', required: true, max: 80 });
  if (body.lat !== undefined) out.lat = num(body.lat, { name: 'lat', min: -90, max: 90 });
  if (body.lon !== undefined) out.lon = num(body.lon, { name: 'lon', min: -180, max: 180 });
  if (body.radius_m !== undefined) out.radius_m = num(body.radius_m, { name: 'radius_m', min: 10, max: 10000 }) ?? 300;
  if (body.notes !== undefined) out.notes = str(body.notes, { max: 500 });
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  if (!partial && out.kind === 'WTG' && (out.lat == null || out.lon == null)) {
    throw new HttpError(400, `WTG ${out.name} needs lat and lon`);
  }
  return out;
}

router.add('GET', '/api/locations', async ({ env, user }) => {
  guard(user);
  const { results } = await env.DB.prepare('SELECT * FROM locations ORDER BY kind DESC, name').all();
  return json({ locations: results });
});

router.add('POST', '/api/locations', async ({ request, env, user }) => {
  guard(user, 'locations');
  const v = locationValues(await readJson(request));
  const id = newId();
  await env.DB.prepare('INSERT INTO locations (id, kind, name, lat, lon, radius_m, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, v.kind, v.name, v.lat ?? null, v.lon ?? null, v.radius_m ?? 300, v.notes ?? null)
    .run();
  return json({ location: await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first() }, 201);
});

router.add('PATCH', '/api/locations/:id', async ({ request, env, user, params }) => {
  guard(user, 'locations');
  const v = locationValues(await readJson(request), true);
  const keys = Object.keys(v);
  if (!keys.length) throw new HttpError(400, 'Nothing to update');
  const res = await env.DB.prepare(`UPDATE locations SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => v[k]), params.id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'Location not found');
  return json({ location: await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(params.id).first() });
});

// Bulk create/update by name, e.g. a wind farm's turbine coordinate list.
router.add('POST', '/api/locations/import', async ({ request, env, user }) => {
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
          `INSERT INTO locations (id, kind, name, lat, lon, radius_m, notes) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, lat = excluded.lat, lon = excluded.lon,
             radius_m = excluded.radius_m, notes = COALESCE(excluded.notes, locations.notes), active = 1`,
        ).bind(newId(), v.kind, v.name, v.lat ?? null, v.lon ?? null, v.radius_m ?? 300, v.notes ?? null),
      );
    } catch (e) {
      errors.push(`row ${i + 1}: ${e.message}`);
    }
  });
  if (errors.length) throw new HttpError(400, 'Import rejected; nothing was saved', errors);
  await env.DB.batch(stmts);
  return json({ imported: stmts.length });
});

// ---------------------------------------------------------------- assets

// Latest reading per asset, for the site manager's overview.
router.add('GET', '/api/assets', async ({ env, user, url }) => {
  guard(user, 'overview');
  const where = [];
  const vals = [];
  const type = url.searchParams.get('type');
  if (type) { where.push('a.type_id = ?'); vals.push(type); }
  if (url.searchParams.get('status') !== 'all') where.push("a.status = 'active'");
  const sql = `
    WITH latest AS (
      SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.asset_id ORDER BY r.recorded_at DESC, r.received_at DESC) AS rn
      FROM readings r
    )
    SELECT a.*,
      (SELECT group_concat(t.code || char(30) || t.kind, char(31)) FROM tags t WHERE t.asset_id = a.id) AS tag_codes,
      l.id AS r_id, l.recorded_at AS r_recorded_at, l.location_id AS r_location_id, l.location_source AS r_location_source,
      l.gps_status AS r_gps_status, l.lat AS r_lat, l.lon AS r_lon, l.accuracy_m AS r_accuracy_m, l.data AS r_data,
      l.notes AS r_notes, u.name AS r_user_name,
      loc.name AS r_location_name, loc.kind AS r_location_kind, loc.lat AS r_location_lat, loc.lon AS r_location_lon
    FROM assets a
    LEFT JOIN latest l ON l.asset_id = a.id AND l.rn = 1
    LEFT JOIN locations loc ON loc.id = l.location_id
    LEFT JOIN users u ON u.id = l.user_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.serial`;
  const { results } = await env.DB.prepare(sql).bind(...vals).all();
  return json({
    assets: results.map((row) => {
      const asset = {};
      const last = {};
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith('r_')) last[k.slice(2)] = v;
        else asset[k] = v;
      }
      return { ...assetOut(asset), last: last.id ? readingOut(last) : null };
    }),
  });
});

router.add('GET', '/api/assets/:id', async ({ env, user, params, url }) => {
  guard(user);
  if (!can(user, 'overview') && !can(user, 'link')) throw new HttpError(403, 'Not allowed for your role');
  const asset = await env.DB.prepare(`${ASSET_SELECT} WHERE a.id = ?`).bind(params.id).first();
  if (!asset) throw new HttpError(404, 'Asset not found');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);
  const { results } = await env.DB.prepare(
    `SELECT r.*, u.name AS user_name, l.name AS location_name, l.kind AS location_kind
     FROM readings r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN locations l ON l.id = r.location_id
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
  if (row && row.asset_id !== assetId) throw new HttpError(409, `Tag ${code} is already linked to ${row.serial}`);
  return !!row;
}

router.add('POST', '/api/assets', async ({ request, env, user }) => {
  guard(user, 'link');
  const body = await readJson(request);
  const type = await loadType(env, body.type_id);
  const serial = str(body.serial, { name: 'serial number', required: true, max: 80 });
  const { values, errors } = normalizeValues(type.fields, 'asset', body.attributes);
  if (Object.keys(errors).length) throw new HttpError(400, 'Please correct the highlighted fields', errors);
  const tags = (body.tags || []).map(tagValues);
  for (const t of tags) await assertTagFree(env, t.code, null);
  const id = newId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO assets (id, type_id, serial, name, attributes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, type.id, serial, str(body.name, { max: 100 }), JSON.stringify(values), user.id),
    ...tags.map((t) =>
      env.DB.prepare('INSERT INTO tags (code, asset_id, kind, created_by) VALUES (?, ?, ?, ?)').bind(t.code, id, t.kind, user.id)),
  ]);
  return json({ asset: assetOut(await env.DB.prepare(`${ASSET_SELECT} WHERE a.id = ?`).bind(id).first()) }, 201);
});

router.add('PATCH', '/api/assets/:id', async ({ request, env, user, params }) => {
  guard(user, 'link');
  const body = await readJson(request);
  const current = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(params.id).first();
  if (!current) throw new HttpError(404, 'Asset not found');
  const sets = ['updated_at = ?'];
  const vals = [nowIso()];
  if (body.serial !== undefined) { sets.push('serial = ?'); vals.push(str(body.serial, { name: 'serial number', required: true, max: 80 })); }
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(str(body.name, { max: 100 })); }
  if (body.status !== undefined) {
    if (!['active', 'retired'].includes(body.status)) throw new HttpError(400, 'status must be active or retired');
    sets.push('status = ?'); vals.push(body.status);
  }
  if (body.attributes !== undefined) {
    const type = await loadType(env, current.type_id);
    const { values, errors } = normalizeValues(type.fields, 'asset', body.attributes);
    if (Object.keys(errors).length) throw new HttpError(400, 'Please correct the highlighted fields', errors);
    sets.push('attributes = ?'); vals.push(JSON.stringify(values));
  }
  await env.DB.prepare(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, params.id).run();
  return json({ asset: assetOut(await env.DB.prepare(`${ASSET_SELECT} WHERE a.id = ?`).bind(params.id).first()) });
});

router.add('POST', '/api/assets/:id/tags', async ({ request, env, user, params }) => {
  guard(user, 'link');
  const t = tagValues(await readJson(request));
  const exists = await env.DB.prepare('SELECT id FROM assets WHERE id = ?').bind(params.id).first();
  if (!exists) throw new HttpError(404, 'Asset not found');
  if (!(await assertTagFree(env, t.code, params.id))) {
    await env.DB.prepare('INSERT INTO tags (code, asset_id, kind, created_by) VALUES (?, ?, ?, ?)')
      .bind(t.code, params.id, t.kind, user.id)
      .run();
  }
  return json({ ok: true }, 201);
});

router.add('DELETE', '/api/tags/:code', async ({ env, user, params }) => {
  guard(user, 'link');
  const res = await env.DB.prepare('DELETE FROM tags WHERE code = ?').bind(params.code).run();
  if (!res.meta.changes) throw new HttpError(404, 'Tag not found');
  return json({ ok: true });
});

router.add('GET', '/api/tags/:code', async ({ env, user, params }) => {
  guard(user);
  const asset = await env.DB.prepare(`${ASSET_SELECT} JOIN tags tg ON tg.asset_id = a.id WHERE tg.code = ?`)
    .bind(params.code)
    .first();
  if (!asset) throw new HttpError(404, 'Tag is not linked to any asset');
  return json({ asset: assetOut(asset) });
});

// ---------------------------------------------------------------- readings

// Offline outbox upload. Idempotent: every reading carries a client-generated
// id, so a batch that is resent after a dropped connection is stored once.
// Each reading is accepted or rejected on its own; one bad entry never blocks the rest.
router.add('POST', '/api/readings/sync', async ({ request, env, user }) => {
  guard(user, 'field');
  const body = await readJson(request, 5_000_000);
  const items = Array.isArray(body.readings) ? body.readings : null;
  if (!items) throw new HttpError(400, 'readings must be a list');
  if (items.length > MAX_SYNC_BATCH) throw new HttpError(400, `At most ${MAX_SYNC_BATCH} readings per request`);

  const [typeRows, locRows, assetRows, tagRows] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM asset_types'),
    env.DB.prepare('SELECT id FROM locations'),
    env.DB.prepare('SELECT id, type_id FROM assets'),
    env.DB.prepare('SELECT code, asset_id FROM tags'),
  ]);
  const types = new Map(typeRows.results.map((t) => [t.id, typeOut(t)]));
  const locationIds = new Set(locRows.results.map((l) => l.id));
  const assets = new Map(assetRows.results.map((a) => [a.id, a]));
  const tagIndex = new Map(tagRows.results.map((t) => [t.code.toLowerCase(), t.asset_id]));

  const results = [];
  const stmts = [];
  const pending = [];
  for (const raw of items) {
    const id = typeof raw?.id === 'string' && /^[0-9a-f-]{36}$/i.test(raw.id) ? raw.id : null;
    const reject = (error) => results.push({ id: raw?.id ?? null, status: 'rejected', error });
    if (!id) { reject('Missing or invalid reading id'); continue; }
    try {
      // Fall back to the tag: an offline scan of a tag linked after the phone's last
      // refresh has no asset_id yet, and is resolved here at sync time.
      const asset = assets.get(raw.asset_id) ||
        (raw.tag_code ? assets.get(tagIndex.get(String(raw.tag_code).toLowerCase())) : null);
      if (!asset) { reject('Unknown asset / tag not linked'); continue; }
      if (!raw.location_id || !locationIds.has(raw.location_id)) { reject('Unknown or missing location'); continue; }
      const recordedAt = new Date(raw.recorded_at);
      if (Number.isNaN(recordedAt.getTime())) { reject('Invalid recorded_at'); continue; }
      if (recordedAt.getTime() > Date.now() + 24 * 3600 * 1000) { reject('recorded_at is in the future (check phone clock)'); continue; }
      const type = types.get(asset.type_id);
      const { values, errors } = normalizeValues(type ? type.fields : [], 'check', raw.data);
      if (Object.keys(errors).length) { reject(Object.values(errors).join('; ')); continue; }
      const source = raw.location_source === 'gps' ? 'gps' : 'manual';
      const gpsStatus = GPS_STATUSES.includes(raw.gps_status) ? raw.gps_status : 'unavailable';
      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO readings
            (id, asset_id, recorded_at, user_id, location_id, location_source, gps_status, lat, lon, accuracy_m, distance_m, data, notes, tag_code, device_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id, asset.id, recordedAt.toISOString(), user.id, raw.location_id, source, gpsStatus,
          num(raw.lat, { min: -90, max: 90, name: 'lat' }), num(raw.lon, { min: -180, max: 180, name: 'lon' }),
          num(raw.accuracy_m, { min: 0, name: 'accuracy' }), num(raw.distance_m, { min: 0, name: 'distance' }),
          JSON.stringify(values), str(raw.notes, { max: 2000, name: 'notes' }), str(raw.tag_code, { max: 120 }),
          str(raw.device_id, { max: 80 }),
        ),
      );
      pending.push(id);
    } catch (e) {
      reject(e instanceof HttpError ? e.message : 'Invalid reading');
    }
  }
  if (stmts.length) {
    const out = await env.DB.batch(stmts);
    out.forEach((r, i) => results.push({ id: pending[i], status: r.meta.changes ? 'stored' : 'duplicate' }));
  }
  return json({ results });
});

router.add('GET', '/api/readings', async ({ env, user, url }) => {
  guard(user, 'overview');
  const where = [];
  const vals = [];
  const p = url.searchParams;
  if (p.get('asset_id')) { where.push('r.asset_id = ?'); vals.push(p.get('asset_id')); }
  if (p.get('location_id')) { where.push('r.location_id = ?'); vals.push(p.get('location_id')); }
  if (p.get('from')) { where.push('r.recorded_at >= ?'); vals.push(p.get('from')); }
  if (p.get('to')) { where.push('r.recorded_at <= ?'); vals.push(p.get('to')); }
  const limit = Math.min(Number(p.get('limit')) || 500, 5000);
  const { results } = await env.DB.prepare(
    `SELECT r.*, a.serial, a.type_id, a.name AS asset_name, u.name AS user_name, l.name AS location_name, l.kind AS location_kind
     FROM readings r JOIN assets a ON a.id = r.asset_id
     LEFT JOIN users u ON u.id = r.user_id LEFT JOIN locations l ON l.id = r.location_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.recorded_at DESC LIMIT ?`,
  ).bind(...vals, limit).all();
  return json({ readings: results.map(readingOut) });
});
