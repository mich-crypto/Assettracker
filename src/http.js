export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function readJson(request, maxBytes = 2_000_000) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'Request body too large');
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}

/** Minimal path router: add('GET', '/api/assets/:id', handler). */
export class Router {
  routes = [];

  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(
      '^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$',
    );
    this.routes.push({ method, re, keys, handler });
    return this;
  }

  match(method, path) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = path.match(r.re);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return { pathMatched };
  }
}

export function str(v, { max = 200, required = false, name = 'value' } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, `${name} is too long (max ${max})`);
  return s;
}

export function num(v, { name = 'value', min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be a number between ${min} and ${max}`);
  return n;
}

export function parseJsonColumn(v, fallback) {
  try {
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
