// Shared browser helpers: session, API calls, navigation, offline sync.
import { cache, outbox } from './store.js';

const TOKEN_KEY = 'at.token';
const USER_KEY = 'at.user';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  },
  set(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  /** No-login mode: a placeholder token plus the name typed on this device. */
  setOpen(name) {
    this.set('open', { id: null, name, role: 'admin', open: true });
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

const PERMS = {
  manager: ['overview', 'field'],
  supervisor: ['overview', 'link', 'field', 'locations'],
  technician: ['field'],
};
export function can(permission, user = session.user) {
  if (!user) return false;
  return user.role === 'admin' || (PERMS[user.role] || []).includes(permission);
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'No connection');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login') window.dispatchEvent(new Event('at:unauthorized'));
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details);
  }
  return data;
}

/** Redirects to the login page unless signed in with the given permission. */
export function requireLogin(permission) {
  const user = session.user;
  if (!user || !session.token) {
    location.replace(`/?next=${encodeURIComponent(location.pathname + location.hash)}`);
    return null;
  }
  if (permission && !can(permission, user)) {
    location.replace('/');
    return null;
  }
  return user;
}

export function homeFor(user) {
  if (can('overview', user) && user.role !== 'supervisor') return '/overview';
  if (can('link', user)) return '/link';
  return '/field';
}

const NAV = [
  ['overview', '/overview', 'Overview'],
  ['link', '/link', 'Link tags'],
  ['field', '/field', 'Scan'],
  ['locations', '/admin', 'Setup'],
];

/** Renders the top bar with role-appropriate navigation and the sync indicator. */
export function renderHeader(active) {
  const user = session.user;
  const header = document.createElement('header');
  header.className = 'topbar';
  header.innerHTML = `
    <a class="brand" href="/">Asset<b>Tracker</b></a>
    <nav>${NAV.filter(([p]) => can(p)).map(([p, href, label]) =>
      `<a href="${href}"${p === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div class="topbar-right">
      <button type="button" class="sync-pill" id="sync-pill" title="Sync now"></button>
      <span class="who">${esc(user?.name || '')}</span>
      ${user?.open
        ? '<a class="link-btn" href="/">Change name</a>'
        : '<button type="button" class="link-btn" id="logout">Sign out</button>'}
    </div>`;
  document.body.prepend(header);
  header.querySelector('#logout')?.addEventListener('click', async () => {
    const pending = await outbox.count().catch(() => 0);
    if (pending && !confirm(`${pending} reading(s) have not been synced yet and will stay on this phone. Sign out anyway?`)) return;
    session.clear();
    location.href = '/';
  });
  header.querySelector('#sync-pill').onclick = () => syncNow({ manual: true });
  updateSyncPill();
  return header;
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
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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

/** Refreshes the offline snapshot from the server; falls back to the cached copy. */
export async function loadReference({ refresh = true } = {}) {
  if (refresh && navigator.onLine !== false) {
    try {
      const data = await api('/api/bootstrap');
      await cache.set('bootstrap', data);
      return { ...data, fromCache: false };
    } catch (e) {
      if (e.status === 401) throw e;
    }
  }
  const cached = await cache.get('bootstrap');
  if (!cached) throw new ApiError(0, 'No connection and no offline data yet. Open the app once while online.');
  return { ...cached, fromCache: true };
}

export function deviceId() {
  let id = localStorage.getItem('at.device');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('at.device', id);
  }
  return id;
}

let syncing = null;

/**
 * Uploads the outbox. Stored and duplicate readings are removed locally;
 * rejected ones stay, marked with the server's reason, so nothing is lost silently.
 */
export function syncNow({ manual = false } = {}) {
  syncing ??= (async () => {
    const items = (await outbox.all()).filter((i) => !i.rejected || manual);
    if (!items.length) {
      if (manual) toast('Nothing to sync');
      return;
    }
    if (!session.token) return;
    setPill('syncing');
    let stored = 0;
    let rejected = 0;
    try {
      for (let i = 0; i < items.length; i += 200) {
        const chunk = items.slice(i, i + 200);
        const { results } = await api('/api/readings/sync', {
          method: 'POST',
          body: { readings: chunk.map(({ rejected: _r, error: _e, label: _l, ...r }) => r) },
        });
        const done = results.filter((r) => r.status !== 'rejected').map((r) => r.id);
        await outbox.remove(done);
        stored += done.length;
        for (const r of results.filter((x) => x.status === 'rejected')) {
          const item = chunk.find((c) => c.id === r.id);
          if (item) { await outbox.put({ ...item, rejected: true, error: r.error }); rejected++; }
        }
      }
      if (stored) toast(`Synced ${stored} reading${stored === 1 ? '' : 's'}`, 'ok');
      if (rejected) toast(`${rejected} reading(s) were rejected - see the Scan page`, 'error');
    } catch (e) {
      if (manual) toast(e.status === 0 ? 'Offline - readings stay queued on this phone' : e.message, 'error');
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

window.addEventListener('at:unauthorized', () => {
  // Keep the outbox; it is synced after the next sign-in.
  toast('Your session has expired. Sign in again to sync.', 'error');
  session.clear();
  setTimeout(() => location.replace(`/?next=${encodeURIComponent(location.pathname)}`), 1500);
});

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Ask for a wake-up when connectivity returns, where Background Sync exists (Android Chrome).
      navigator.serviceWorker.ready.then((r) => r.sync?.register('outbox').catch(() => {}));
      return reg;
    }).catch(() => {});
  }
}
