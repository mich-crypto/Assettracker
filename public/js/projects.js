// What a project link (/BLP) may be called. Static folders and app pages are
// reserved so a project can never shadow them.
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,23}$/;

export const RESERVED_SLUGS = new Set([
  'api', 't', 'js', 'css', 'vendor', 'icons', 'admin', 'field', 'add', 'warehouse', 'overview', 'project',
  'index', 'login', 'setup', 'static', 'assets', 'public', 'sw', 'manifest', '404', 'favicon',
]);

export function validSlug(slug) {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug.toLowerCase());
}

/** The project a page belongs to, from its address: /BLP/field -> "BLP"; null on /admin, / and friends. */
export function slugFromPath(pathname) {
  const m = String(pathname).match(/^\/([^/]+)/);
  return m && SLUG_RE.test(m[1]) && !RESERVED_SLUGS.has(m[1].toLowerCase()) ? m[1] : null;
}
