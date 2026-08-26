/**
 * IndexedDB-backed persistence for the app store.
 *
 * Why: the zustand persist cache (courses / announcements / resources / unit tabs /
 * summaries) grew past the WebView localStorage quota (~5 MB on WKWebView), so
 * `localStorage.setItem` threw `QuotaExceededError` right after a successful sync
 * and surfaced as `[unhandledrejection] The quota has been exceeded. setItem`.
 *
 * IndexedDB has a far larger quota (hundreds of MB), and writes are async, so a
 * failed write can be caught and downgraded silently instead of crashing the app.
 *
 * Migration: on first read after this change, any existing localStorage payload
 * ("muster-settings") is moved into IndexedDB and removed from localStorage.
 */

const DB_NAME = "muster-cache";
const DB_VERSION = 1;
const STORE = "kv";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("indexedDB open failed"));
    };
    req.onblocked = () => {
      /* another tab holds the old version; keep waiting */
    };
  });
  return dbPromise;
}

function idbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Migrate the legacy localStorage payload into IndexedDB (once). */
async function migrateFromLocalStorage(key: string): Promise<string | null> {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const db = await openDb();
    await idbPut(db, key, raw);
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* leftover legacy copy is harmless */
    }
    console.info(`[idbStorage] migrated "${key}" from localStorage to IndexedDB`);
    return raw;
  } catch (e) {
    console.warn("[idbStorage] localStorage migration failed", e);
    return null;
  }
}

export const idbStorage = {
  async getItem(name: string): Promise<string | null> {
    try {
      const db = await openDb();
      const value = await idbGet(db, name);
      if (value !== null) return value;
      // First run with the new backend: pull the old localStorage cache over.
      return await migrateFromLocalStorage(name);
    } catch (e) {
      console.warn("[idbStorage] getItem failed", e);
      return null;
    }
  },

  async setItem(name: string, value: string): Promise<void> {
    try {
      const db = await openDb();
      await idbPut(db, name, value);
    } catch (e) {
      // Never crash the app on a cache write; worst case the cache is stale/absent
      // and the next launch re-syncs.
      console.warn("[idbStorage] setItem failed, cache write skipped", e);
    }
  },

  async removeItem(name: string): Promise<void> {
    try {
      const db = await openDb();
      await idbDelete(db, name);
    } catch (e) {
      console.warn("[idbStorage] removeItem failed", e);
    }
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};
