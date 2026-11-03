// Shared browser helpers: project from the address, API calls, navigation,
// offline data and sync. Every page lives under a project link (/BLP/field).
import { slugFromPath } from './projects.js';
import { cache, outbox } from './store.js';

export const SLUG = slugFromPath(location.pathname);
export const BASE = SLUG ? `/${SLUG}` : '';
/** Address of a page in this project: path('field') -> /BLP/field; path() -> /BLP */
export const path = (page = '') => `${BASE}${page ? `/${page}` : ''}`;

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const GLOBAL_API = ['/api/projects', '/api/types', '/api/auth', '/api/users', '/api/billing', '/api/invoice', '/api/p/'];

/** Calls the API. Project data lives under /api/p/<slug>; admin routes are global. */
export async function api(apiPath, { method = 'GET', body } = {}) {
  let target = apiPath;
  if (!GLOBAL_API.some((g) => apiPath.startsWith(g))) {
    if (!SLUG) throw new ApiError(0, 'Open the app through your project link');
    target = `/api/p/${SLUG}${apiPath.slice('/api'.length)}`;
  }
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'No connection');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details);
  return data;
}

/** Pages of a project need the project link in the address; anything else goes to the start page. */
export function requireProject() {
  if (!SLUG) {
    location.replace('/');
    return null;
  }
  return { open: true };
}

const NAV = [
  ['overview', 'Overview'],
  ['warehouse', 'Warehouse'],
  ['field', 'Scan'],
];

/** Top bar with navigation, the project name and the sync indicator. */
export async function renderHeader(active) {
  const header = document.createElement('header');
  header.className = 'topbar';
  header.innerHTML = `
    <a class="brand" href="${path()}" id="brand">Asset<b>Tracker</b> <span class="project-name">${esc(SLUG)}</span></a>
    <nav>${NAV.map(([id, label]) =>
      `<a href="${path(id)}"${id === active ? ' aria-current="page"' : ''} data-nav="${id}">${label}</a>`).join('')}</nav>
    <div class="topbar-right"><button type="button" class="sync-pill" id="sync-pill" title="Sync now"></button></div>`;
  document.body.prepend(header);
  header.querySelector('#sync-pill').onclick = () => syncNow({ manual: true });
  updateSyncPill();
  injectManifest();
  // Show the project's real name and the number of things waiting for the supervisor.
  cache.get(`bootstrap:${SLUG}`).then((b) => {
    if (!b) return;
    header.querySelector('.project-name').textContent = b.project?.name || SLUG;
    setIssueBadge(b.openIssues);
  }).catch(() => {});
  return header;
}

export function setIssueBadge(n) {
  const a = document.querySelector('[data-nav="warehouse"]');
  if (!a) return;
  a.querySelector('.nav-badge')?.remove();
  if (n > 0) a.insertAdjacentHTML('beforeend', `<span class="nav-badge" aria-label="${n} to investigate">${n}</span>`);
}

/** A per-project manifest, so "add to home screen" opens this project's Scan page. */
function injectManifest() {
  if (!SLUG || document.querySelector('link[rel=manifest]')) return;
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = `${BASE}/manifest.webmanifest`;
  document.head.append(link);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(message, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Whole days from today until a YYYY-MM-DD date (negative when it has passed). */
export function daysUntil(d, now = new Date()) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, day) - today) / 86400e3);
}

export function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// ---------------------------------------------------------------- offline data + sync

/** Refreshes this project's offline snapshot from the server; falls back to the cached copy. */
export async function loadReference({ refresh = true } = {}) {
  const key = `bootstrap:${SLUG}`;
  if (refresh && navigator.onLine !== false) {
    try {
      const data = await api('/api/bootstrap');
      await cache.set(key, data);
      setIssueBadge(data.openIssues);
      return { ...data, fromCache: false };
    } catch (e) {
      if (e.status === 404 || e.status === 403) throw e;
    }
  }
  const cached = await cache.get(key);
  if (!cached) throw new ApiError(0, 'No connection and no offline data yet. Open the app once while online.');
  return { ...cached, fromCache: true };
}

let syncing = null;
const LOCAL_ONLY = ['label', 'rejected', 'error', 'project'];

/**
 * Uploads the outbox. Stored and duplicate items are removed locally;
 * rejected ones stay, marked with the server's reason, so nothing is lost silently.
 */
export function syncNow({ manual = false } = {}) {
  syncing ??= (async () => {
    const items = (await outbox.all()).filter((i) => !i.rejected || manual);
    if (!items.length) {
      if (manual) toast('Nothing to sync');
      return;
    }
    setPill('syncing');
    let stored = 0;
    let rejected = 0;
    try {
      const byProject = new Map();
      for (const i of items) {
        const slug = i.project || SLUG;
        if (!byProject.has(slug)) byProject.set(slug, []);
        byProject.get(slug).push(i);
      }
      for (const [slug, list] of byProject) {
        for (let n = 0; n < list.length; n += 200) {
          const chunk = list.slice(n, n + 200);
          const { results } = await api(`/api/p/${slug}/readings/sync`, {
            method: 'POST',
            body: { readings: chunk.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !LOCAL_ONLY.includes(k)))) },
          });
          const done = results.filter((r) => r.status !== 'rejected').map((r) => r.id);
          await outbox.remove(done);
          stored += done.length;
          for (const r of results.filter((x) => x.status === 'rejected')) {
            const item = chunk.find((c) => c.id === r.id);
            if (item) { await outbox.put({ ...item, rejected: true, error: r.error }); rejected++; }
          }
        }
      }
      if (stored) toast(`Synced ${stored} item${stored === 1 ? '' : 's'}`, 'ok');
      if (rejected) toast(`${rejected} item(s) were rejected - see the Scan page`, 'error');
    } catch (e) {
      if (manual) toast(e.status === 0 ? 'Offline - everything stays queued on this phone' : e.message, 'error');
    }
  })().finally(() => {
    syncing = null;
    updateSyncPill();
    window.dispatchEvent(new Event('at:outbox'));
  });
  return syncing;
}

function setPill(state, count = 0) {
  const pill = document.getElementById('sync-pill');
  if (!pill) return;
  const online = navigator.onLine !== false;
  pill.dataset.state = state;
  pill.textContent = state === 'syncing' ? 'Syncing…'
    : count ? `${count} to sync${online ? '' : ' · offline'}`
    : online ? 'Synced' : 'Offline';
}

export async function updateSyncPill() {
  const items = await outbox.all().catch(() => []);
  setPill(items.length ? (navigator.onLine === false ? 'offline' : 'pending') : (navigator.onLine === false ? 'offline' : 'ok'), items.length);
}

/** Starts background sync triggers: on reconnect, on focus and periodically. */
export function startAutoSync() {
  const kick = () => { if (navigator.onLine !== false) syncNow(); };
  window.addEventListener('online', () => { updateSyncPill(); kick(); });
  window.addEventListener('offline', updateSyncPill);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data === 'sync') kick(); });
  setInterval(kick, 60_000);
  kick();
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(() => {
      // Ask for a wake-up when connectivity returns, where Background Sync exists (Android Chrome).
      navigator.serviceWorker.ready.then((r) => r.sync?.register('outbox').catch(() => {}));
    }).catch(() => {});
  }
}

/** Fetches the project's pages once so the service worker can serve them offline. */
export function warmPages() {
  if (!SLUG || navigator.onLine === false) return;
  for (const page of ['', 'field', 'add', 'warehouse', 'overview']) fetch(path(page)).catch(() => {});
}
