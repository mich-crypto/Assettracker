// Service worker: keeps the app shell available offline so technicians can
// scan at a turbine without signal. Data (assets, outbox) lives in IndexedDB;
// API calls are never cached here.
const VERSION = 'v1';
const SHELL = [
  '/', '/field', '/link', '/overview', '/admin',
  '/manifest.webmanifest', '/icons/icon.svg', '/css/app.css',
  '/js/app.js', '/js/store.js', '/js/fields.js', '/js/geo.js', '/js/forms.js', '/js/scan.js',
  '/js/field.js', '/js/link.js', '/js/overview.js', '/js/admin.js',
  '/vendor/jsQR.js', '/vendor/qrcode.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first (fresh code when online), cache as the offline fallback.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(event.request);
      if (res.ok) cache.put(url.pathname === '/' ? '/' : url.pathname, res.clone());
      return res;
    } catch {
      const hit = await cache.match(url.pathname === '/' ? '/' : url.pathname, { ignoreSearch: true });
      if (hit) return hit;
      if (event.request.mode === 'navigate') return (await cache.match('/field')) || Response.error();
      return Response.error();
    }
  })());
});

// Background Sync (Android Chrome): when connectivity returns, wake an open
// page so it uploads the outbox with the user's session.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'outbox') return;
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => clients.forEach((c) => c.postMessage('sync'))));
});
