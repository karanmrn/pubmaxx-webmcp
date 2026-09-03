// Promise-wrapped IndexedDB key-value store — the SECOND layer of offline
// resilience (issue #32, PRD § The Spill). The service worker's Cache API
// keeps response BYTES; this keeps a PARSED payload the app can fall back to
// when a fetch fails entirely (SW not yet installed, first-load-then-cellar,
// private browsing quirks). Used for the slim venue index (lib/venuesSlim.ts).
//
// Contract: NEVER throws. Every failure path — no IndexedDB in this runtime
// (Node, old WebViews, some private modes), a blocked open, a torn write —
// degrades to `get → null` / `set → false`, so callers treat it as a strictly
// optional bonus layer.

const DB_NAME = "pubmax-offline";
const DB_VERSION = 1;
const STORE = "kv";

type StoredRow = { key: string; value: unknown; savedAt: number };

export type OfflineCache = {
  /** Parsed value for `key`, or null if missing/unavailable/broken. */
  get<T>(key: string): Promise<T | null>;
  /** Persist `value` under `key`; resolves false (never rejects) on failure. */
  set(key: string, value: unknown): Promise<boolean>;
};

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
    request.onblocked = () => reject(new Error("indexedDB open blocked"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
  });
}

/**
 * Build a cache bound to a specific IDBFactory. The factory parameter exists
 * for tests (inject an in-memory shim); production code uses the default
 * `offlineCache` export bound to the runtime's real indexedDB — or to nothing,
 * in which case every method is a graceful no-op.
 */
export function createOfflineCache(factory?: IDBFactory | null): OfflineCache {
  const idb =
    factory !== undefined
      ? factory
      : typeof indexedDB !== "undefined"
        ? indexedDB
        : null;

  // Memoize the open across calls; drop the memo on failure so a transient
  // error (e.g. a blocked upgrade) doesn't poison the cache forever.
  let dbPromise: Promise<IDBDatabase> | null = null;
  function db(): Promise<IDBDatabase> {
    if (!idb) return Promise.reject(new Error("indexedDB unavailable"));
    if (!dbPromise) {
      dbPromise = openDatabase(idb).catch((error) => {
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        const database = await db();
        const store = database.transaction(STORE, "readonly").objectStore(STORE);
        const row = (await requestToPromise(store.get(key))) as StoredRow | undefined;
        return row === undefined ? null : (row.value as T);
      } catch {
        return null;
      }
    },

    async set(key: string, value: unknown): Promise<boolean> {
      try {
        const database = await db();
        const store = database.transaction(STORE, "readwrite").objectStore(STORE);
        const row: StoredRow = { key, value, savedAt: Date.now() };
        await requestToPromise(store.put(row));
        return true;
      } catch {
        return false;
      }
    },
  };
}

// The app-wide instance. In Node (tests, SSR) indexedDB is absent, so this is
// automatically the no-op variant — safe to import from anywhere.
export const offlineCache: OfflineCache = createOfflineCache();
