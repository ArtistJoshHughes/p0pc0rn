// idb.js - a tiny IndexedDB helper shared by the queue, the research cache and the assistant's sessions (same style as store.js:
// every write resolves on tx.oncomplete). If IndexedDB cannot open (private mode, blocked), it falls back to memory and
// `persistent` is false, so the caller can tell the person that jobs will not survive a reload.
export async function openDB(name, version, stores) {
  // stores: {storeName: {keyPath, indexes?: [name]}}
  let db = null;
  try {
    db = await new Promise((res, rej) => {
      const r = indexedDB.open(name, version);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const [s, o] of Object.entries(stores)) {
          const os = d.objectStoreNames.contains(s) ? r.transaction.objectStore(s) : d.createObjectStore(s, { keyPath: o.keyPath });
          for (const ix of o.indexes || []) if (!os.indexNames.contains(ix)) os.createIndex(ix, ix);
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => setTimeout(() => rej(new Error('IndexedDB blocked by another tab')), 6000);
    });
    db.onversionchange = () => { db.close(); };
  } catch (e) { db = null; }
  if (!db) return memoryDB(stores);
  const run = (names, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(names, mode), box = {};
    t.oncomplete = () => res(box.v);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new DOMException('Transaction aborted', 'AbortError'));
    fn(t, box);
  });
  const req = (r, box) => { r.onsuccess = () => { box.v = r.result; }; };
  return {
    persistent: true, name,
    get: (s, key) => run([s], 'readonly', (t, b) => req(t.objectStore(s).get(key), b)),
    all: (s) => run([s], 'readonly', (t, b) => req(t.objectStore(s).getAll(), b)),
    put: (s, v) => run([s], 'readwrite', (t) => { t.objectStore(s).put(v); }),
    putMany: (s, vs) => run([s], 'readwrite', (t) => { const os = t.objectStore(s); for (const v of vs) os.put(v); }),
    del: (s, key) => run([s], 'readwrite', (t) => { t.objectStore(s).delete(key); }),
    clear: (s) => run([s], 'readwrite', (t) => { t.objectStore(s).clear(); }),
    close: () => db.close(),
  };
}
function memoryDB(stores) {
  const m = {}; for (const s of Object.keys(stores)) m[s] = new Map();
  const kp = (s) => stores[s].keyPath;
  const clone = (v) => (v && typeof v === 'object' && !(v instanceof Blob) ? structuredClone(v) : v);
  return {
    persistent: false, name: 'memory',
    get: async (s, key) => clone(m[s].get(key)),
    all: async (s) => [...m[s].values()].map(clone),
    put: async (s, v) => { m[s].set(v[kp(s)], clone(v)); },
    putMany: async (s, vs) => { for (const v of vs) m[s].set(v[kp(s)], clone(v)); },
    del: async (s, key) => { m[s].delete(key); },
    clear: async (s) => { m[s].clear(); },
    close: () => {},
  };
}
export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
