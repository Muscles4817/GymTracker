// Thin promise wrapper over IndexedDB. All data lives on this device.

const DB_NAME = 'gymtracker';
const DB_VERSION = 1;

export const STORES = {
  workouts: 'workouts',
  exercises: 'exercises',
  routines: 'routines',
  meta: 'meta',
};

let _db = null;

export function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.workouts)) {
        const s = db.createObjectStore(STORES.workouts, { keyPath: 'id' });
        s.createIndex('day', 'day');
        s.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains(STORES.exercises)) {
        db.createObjectStore(STORES.exercises, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.routines)) {
        db.createObjectStore(STORES.routines, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
      void ev;
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => {
        _db.close();
        _db = null;
      };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return openDb().then((db) => db.transaction(store, mode).objectStore(store));
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const dbGet = (store, key) => tx(store, 'readonly').then((s) => wrap(s.get(key)));
export const dbAll = (store) => tx(store, 'readonly').then((s) => wrap(s.getAll()));
export const dbPut = (store, value) => tx(store, 'readwrite').then((s) => wrap(s.put(value)));
export const dbDelete = (store, key) => tx(store, 'readwrite').then((s) => wrap(s.delete(key)));
const dbClear = (store) => tx(store, 'readwrite').then((s) => wrap(s.clear()));

export function dbPutMany(store, values) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        const os = t.objectStore(store);
        values.forEach((v) => os.put(v));
        t.oncomplete = () => resolve(values.length);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export async function wipeAll() {
  await Promise.all(Object.values(STORES).map((s) => dbClear(s)));
}
