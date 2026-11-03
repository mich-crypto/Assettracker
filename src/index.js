import { router } from './api.js';
import { verifySession } from './auth.js';
import { HttpError, json } from './http.js';
import { RESERVED_SLUGS, SLUG_RE } from '../public/js/projects.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

// AUTH_MODE=open: no logins, every request acts as an admin. Readings carry no
// personal name. (AUTH_MODE=login keeps the account system for later use.)
const OPEN_USER = { id: null, username: 'open', name: null, role: 'admin', open: true };

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

const notFoundPage = (env, request) =>
  env.ASSETS.fetch(new Request(new URL('/404.html', request.url), request)).then((r) => new Response(r.body, { ...r, status: 404 }));

/** A label scanned with the phone's normal camera: /t/<code> opens the project that owns it. */
async function labelRedirect(request, env, code) {
  const row = await env.DB.prepare(
    `SELECT p.slug FROM tags t JOIN assets a ON a.id = t.asset_id JOIN projects p ON p.id = a.project_id WHERE t.code = ?`,
  ).bind(code).first();
  const url = new URL(request.url);
  const target = row
    ? `/${row.slug}/field#t=${encodeURIComponent(code)}`
    : `/?label=${encodeURIComponent(code)}`;
  return Response.redirect(new URL(target, url).toString(), 302);
}

const PROJECT_PAGES = { '/': '/project', '/field': '/field', '/add': '/add', '/warehouse': '/warehouse', '/overview': '/overview' };

async function handleProjectPath(request, env, slug, rest) {
  const project = await env.DB.prepare('SELECT slug, name, status FROM projects WHERE slug = ?').bind(slug).first();
  if (!project) return notFoundPage(env, request);
  if (rest === '/manifest.webmanifest') {
    return json({
      name: project.name,
      short_name: project.slug,
      description: `Equipment tracking for ${project.name}`,
      start_url: `/${project.slug}/field`,
      scope: `/${project.slug}/`,
      display: 'standalone',
      background_color: '#f3f5f7',
      theme_color: '#0b5cad',
      icons: [
        { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icons/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      ],
    }, 200, { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' });
  }
  const page = PROJECT_PAGES[rest.replace(/\/+$/, '') || '/'];
  if (!page) return notFoundPage(env, request);
  return env.ASSETS.fetch(new Request(new URL(page, request.url), request));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    let response;
    if (path.startsWith('/api/')) {
      response = await handleApi(request, env, ctx);
    } else if (path.startsWith('/t/') && path.length > 3) {
      response = await labelRedirect(request, env, decodeURIComponent(path.slice(3)));
    } else {
      const m = path.match(/^\/([^/]+)(\/.*)?$/);
      if (m && SLUG_RE.test(m[1]) && !RESERVED_SLUGS.has(m[1].toLowerCase())) {
        response = await handleProjectPath(request, env, m[1], m[2] || '/');
      } else {
        response = await env.ASSETS.fetch(request);
      }
    }
    const out = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
