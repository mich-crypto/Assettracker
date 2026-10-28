// Local persistence for offline use (IndexedDB):
//   cache  - last bootstrap snapshot (types, locations, assets/tags)
//   outbox - readings captured on the phone that have not reached the server yet

const DB_NAME = 'assettracker';
const VERSION = 1;

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache');
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => (result = r));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const cache = {
  get: (key) => tx('cache', 'readonly', (s) => reqP(s.get(key))),
  set: (key, value) => tx('cache', 'readwrite', (s) => { s.put(value, key); }),
};

export const outbox = {
  all: () => tx('outbox', 'readonly', (s) => reqP(s.getAll())),
  put: (item) => tx('outbox', 'readwrite', (s) => { s.put(item); }),
  remove: (ids) => tx('outbox', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); }),
  count: () => tx('outbox', 'readonly', (s) => reqP(s.count())),
};
