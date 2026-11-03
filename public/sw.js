// Service worker: keeps the app available offline so technicians can scan at a
// turbine without signal. Data (equipment, outbox) lives in IndexedDB; API calls
// are never cached here. Pages are cached the first time they are opened (and
// the project home page warms the rest), because their addresses contain the
// project link (/BLP/field).
const VERSION = 'v4';
const STATIC = [
  '/', '/icons/icon.svg', '/icons/icon-maskable.svg', '/css/app.css',
  '/js/app.js', '/js/projects.js', '/js/store.js', '/js/fields.js', '/js/geo.js', '/js/forms.js', '/js/scan.js', '/js/pairing.js',
  '/js/field.js', '/js/add.js', '/js/warehouse.js', '/js/overview.js', '/js/project.js',
  '/vendor/jsQR.js', '/vendor/qrcode.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // One missing file must not break the install.
      .then((c) => Promise.all(STATIC.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
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
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/t/')) return;
  // Network first (fresh code when online), cache as the offline fallback.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(event.request);
      if (res.ok && res.type === 'basic') cache.put(url.pathname, res.clone());
      return res;
    } catch {
      const hit = await cache.match(url.pathname, { ignoreSearch: true });
      if (hit) return hit;
      if (event.request.mode === 'navigate') {
        // An unvisited project page offline: the same project's Scan page is the best fallback.
        const slug = url.pathname.split('/')[1];
        return (await cache.match(`/${slug}/field`)) || (await cache.match('/')) || Response.error();
      }
      return Response.error();
    }
  })());
});

// Background Sync (Android Chrome): when connectivity returns, wake an open
// page so it uploads the outbox.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'outbox') return;
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => clients.forEach((c) => c.postMessage('sync'))));
});
