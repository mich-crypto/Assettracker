import { router } from './api.js';
import { verifySession } from './auth.js';
import { HttpError, json } from './http.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

// AUTH_MODE=open: no logins, every request acts as an admin. Readings then
// carry the name typed on the phone (recorded_by) instead of a user account.
const OPEN_USER = { id: null, username: 'open', name: 'Open access', role: 'admin', open: true };

const isOpenMode = (env) => env.AUTH_MODE === 'open';

async function currentUser(request, env) {
  if (isOpenMode(env)) return OPEN_USER;
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = await verifySession(token, env.SESSION_SECRET);
  if (!session) return null;
  // Re-check the account so a deactivated user or changed role takes effect immediately.
  return env.DB.prepare('SELECT id, username, name, role FROM users WHERE id = ? AND active = 1')
    .bind(session.sub)
    .first();
}

async function handleApi(request, env, ctx) {
  if (!isOpenMode(env) && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
    return json({ error: 'Server misconfigured: SESSION_SECRET must be set (at least 32 characters)' }, 500);
  }
  const url = new URL(request.url);
  const found = router.match(request.method, url.pathname);
  if (!found.handler) {
    return json({ error: found.pathMatched ? 'Method not allowed' : 'Not found' }, found.pathMatched ? 405 : 404);
  }
  try {
    const user = await currentUser(request, env);
    return await found.handler({ request, env, ctx, url, params: found.params, user });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, details: err.details }, err.status);
    if (String(err?.message).includes('UNIQUE constraint failed')) {
      return json({ error: 'A record with this value already exists' }, 409);
    }
    console.error(err);
    return json({ error: 'Internal error' }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = url.pathname.startsWith('/api/')
      ? await handleApi(request, env, ctx)
      : await env.ASSETS.fetch(request);
    const out = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
