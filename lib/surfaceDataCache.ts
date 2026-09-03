"use client";

// A returning tab should show the LAST answer it was given, not an empty frame
// while the same request is made again. This is that memory: one in-process
// store of the JSON a surface has already read, handed back on the way in and
// refreshed quietly behind the render.
//
// Four rules make it safe to keep an answer past a navigation.
//
// IT LIVES IN THE BROWSER ONLY. The store is a module Map backed by a
// sessionStorage namespace, so it dies with the browser session. A device
// cache of who you are is the exact thing lib/deviceAccountIdentity.ts exists
// to close, and this must never reopen it from the other side.
//
// IT NEVER HOLDS IDENTITY. A key under an auth or identity path is REFUSED,
// loudly, rather than quietly passed through: a helper that silently declines
// to cache is a helper somebody later assumes cached. The closed set is below
// and __tests__/surfaceDataCache.test.ts sweeps the call sites for it.
//
// IT LEAVES WITH THE ACCOUNT. Much of what a tab reads is viewer-scoped (a lot,
// a follow edge, a saved list). The key carries the viewer, so a second account
// never READS the first one's entry — but leaving those rows in memory after a
// sign-out is the same shape of defect as leaving `@karan` on the device, so
// the account boundary drops the whole store in one pass. The listener binds
// during browser module evaluation and rebinds on first use if the global
// window is replaced. It rides the existing device-identity announcement,
// which fires on both an account switch and a sign-out.
//
// And one honesty rule on top: an entry has a maximum age. A snapshot may seed a
// first paint, never stand in for an answer nobody asked for again.

import { subscribeDeviceIdentity } from "@/lib/deviceAccountIdentity";
import { discardBody } from "@/lib/responseBody";

/**
 * Paths whose answers may never be held past the request that asked for them.
 * Identity is tri-state and account-owned; a cached "who you are" is a stale
 * handle waiting to name the wrong person.
 */
export const SURFACE_CACHE_DENIED_PREFIXES = [
  "/api/auth",
  "/api/identity",
  "/api/admin",
  "/api/price-impact",
] as const;

/** The default a caller gets when it has no sharper opinion: five minutes. */
export const DEFAULT_SURFACE_SNAPSHOT_MAX_AGE_MS = 5 * 60_000;

/** One short pause absorbs a brief mobile-network wobble without adding UI state. */
export const SURFACE_CACHE_RETRY_BACKOFF_MS = 50;

/** Versioned sessionStorage namespace for reloadable surface answers. */
export const SURFACE_CACHE_NAMESPACE = "pubmax.surface.v1:";

/** Keep large venue packs and other oversized answers out of tab storage. */
export const MAX_PERSISTED_SURFACE_ENTRY_BYTES = 256 * 1024;

const SURFACE_CACHE_NAMESPACE_ROOT = "pubmax.surface.";

type Entry = { value: unknown; storedAt: number };

// A "use client" module still EXECUTES on the server during SSR, so a module
// Map here would be one Map shared by every request the server handles — a
// viewer-scoped answer handed to the next stranger. The store is therefore
// browser-only: on the server every read misses and every write is dropped,
// which also keeps a first paint identical on both sides.
const store = new Map<string, Entry>();
const inBrowser = (): boolean => typeof window !== "undefined";
// The window the boundary listener is attached to, rather than a latched
// boolean: a document only ever has one, so this binds exactly once in the app,
// and it rebinds honestly wherever the global is replaced instead of leaving
// the listener on something nobody dispatches to any more.
let boundWindow: unknown = null;

function getSessionStorage(): Storage | null {
  if (!inBrowser()) return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function removeStoredKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Blocked or unavailable storage degrades to the memory tier.
  }
}

function listNamespacedKeys(storage: Storage): string[] {
  const keys: string[] = [];
  let length: number;
  try {
    length = storage.length;
  } catch {
    return keys;
  }
  for (let index = 0; index < length; index += 1) {
    try {
      const key = storage.key(index);
      if (key?.startsWith(SURFACE_CACHE_NAMESPACE_ROOT)) keys.push(key);
    } catch {
      // A storage read failure should not affect the in-memory tier.
    }
  }
  return keys;
}

function clearPersistentSurfaceCache(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  for (const key of listNamespacedKeys(storage)) removeStoredKey(storage, key);
}

function pruneOldPersistentNamespaces(storage: Storage): void {
  for (const key of listNamespacedKeys(storage)) {
    if (!key.startsWith(SURFACE_CACHE_NAMESPACE)) removeStoredKey(storage, key);
  }
}

function removePersistentSnapshot(storage: Storage, key: string): void {
  removeStoredKey(storage, `${SURFACE_CACHE_NAMESPACE}${key}`);
}

function forgetSurfaceSnapshot(key: string): void {
  store.delete(key);
  const storage = getSessionStorage();
  if (storage) removePersistentSnapshot(storage, key);
}

function persistedEntryBytes(serialized: string): number {
  try {
    return new TextEncoder().encode(serialized).byteLength;
  } catch {
    return serialized.length;
  }
}

function persistSurfaceSnapshot(
  key: string,
  value: unknown,
  storedAt: number,
): void {
  if (value === undefined) return;
  const storage = getSessionStorage();
  if (!storage) return;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify({ value, storedAt });
  } catch {
    return;
  }
  if (
    serialized === undefined ||
    serialized.length > MAX_PERSISTED_SURFACE_ENTRY_BYTES ||
    persistedEntryBytes(serialized) > MAX_PERSISTED_SURFACE_ENTRY_BYTES
  ) {
    return;
  }
  try {
    storage.setItem(`${SURFACE_CACHE_NAMESPACE}${key}`, serialized);
  } catch {
    // Quota and private-mode errors leave the memory tier working.
  }
}

function isPersistedEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(candidate, "value") &&
    typeof candidate.storedAt === "number" &&
    Number.isFinite(candidate.storedAt)
  );
}

function readPersistentSurfaceSnapshot<T>(
  key: string,
  maxAgeMs: number,
  now: number,
): T | undefined {
  const storage = getSessionStorage();
  if (!storage) return undefined;
  const storageKey = `${SURFACE_CACHE_NAMESPACE}${key}`;
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedEntry(parsed)) {
      removePersistentSnapshot(storage, key);
      return undefined;
    }
    if (now - parsed.storedAt > maxAgeMs) {
      removePersistentSnapshot(storage, key);
      return undefined;
    }
    store.set(key, parsed);
    return parsed.value as T;
  } catch {
    removePersistentSnapshot(storage, key);
    return undefined;
  }
}

/** Is this key one the store is allowed to remember? */
export function isSurfaceCacheable(key: string): boolean {
  return !SURFACE_CACHE_DENIED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function assertCacheable(key: string): void {
  if (isSurfaceCacheable(key)) return;
  throw new Error(
    `surfaceDataCache refuses ${key}: identity and auth answers are never held past their request.`,
  );
}

function bindIdentityBoundary(): void {
  if (!inBrowser() || boundWindow === window) return;
  boundWindow = window;
  const storage = getSessionStorage();
  if (storage) pruneOldPersistentNamespaces(storage);
  subscribeDeviceIdentity(() => {
    store.clear();
    clearPersistentSurfaceCache();
  });
}

if (inBrowser()) bindIdentityBoundary();

function isTransientResponse(response: Response): boolean {
  return response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500;
}

function waitForRetry(signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(true), SURFACE_CACHE_RETRY_BACKOFF_MS);
    const onAbort = () => {
      clearTimeout(timer);
      finish(false);
    };
    const finish = (shouldRetry: boolean) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(shouldRetry);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/** The held answer for this key, or undefined when there is none young enough. */
export function readSurfaceSnapshot<T>(
  key: string,
  maxAgeMs: number = DEFAULT_SURFACE_SNAPSHOT_MAX_AGE_MS,
  now: number = Date.now(),
): T | undefined {
  assertCacheable(key);
  if (!inBrowser()) return undefined;
  bindIdentityBoundary();
  const entry = store.get(key);
  if (entry) {
    if (now - entry.storedAt <= maxAgeMs) return entry.value as T;
    store.delete(key);
  }
  return readPersistentSurfaceSnapshot<T>(key, maxAgeMs, now);
}

/** Hold this answer for the next arrival on the surface that read it. */
export function writeSurfaceSnapshot<T>(
  key: string,
  value: T,
  now: number = Date.now(),
): void {
  assertCacheable(key);
  if (!inBrowser()) return;
  bindIdentityBoundary();
  store.set(key, { value, storedAt: now });
  persistSurfaceSnapshot(key, value, now);
}

/** The account boundary, and the test seam. */
export function clearSurfaceCache(): void {
  store.clear();
  clearPersistentSurfaceCache();
}

/** Test seam only: how many answers are held. */
export function surfaceCacheSize(): number {
  return store.size;
}

export type LoadSurfaceJsonOptions<T = unknown> = {
  signal?: AbortSignal;
  init?: RequestInit;
  maxAgeMs?: number;
  fetchImpl?: typeof fetch;
  validate?: (value: T) => boolean;
};

/**
 * Stale-while-revalidate for one surface read.
 *
 * `apply` is called with the held answer FIRST when there is one, so the tab
 * paints its last state in the same frame it mounts, and then again with the
 * network answer. It is never called after the caller's signal aborts, and a
 * failed revalidate leaves the held answer standing rather than blanking a
 * surface that already had real data on it.
 *
 * Returns the source of the last answer applied, so a caller that must report
 * its own read status can tell a served snapshot from a fresh read.
 */
export async function loadSurfaceJson<T>(
  key: string,
  options: LoadSurfaceJsonOptions<T>,
  apply: (value: T, source: "snapshot" | "network") => void | boolean,
): Promise<"snapshot" | "network" | "failed"> {
  assertCacheable(key);
  const { signal, init, maxAgeMs, fetchImpl, validate } = options;
  let applied: "snapshot" | "network" | "failed" = "failed";
  const requestSignal = signal ?? init?.signal ?? undefined;

  // Yield once before touching state, so a caller may start this in an effect
  // body without setState firing synchronously during render (the same rule the
  // rest of the client surfaces follow). One microtask still lands the held
  // answer in the mount frame.
  await Promise.resolve();
  if (requestSignal?.aborted) return applied;

  const held = readSurfaceSnapshot<T>(key, maxAgeMs);
  if (held !== undefined && !requestSignal?.aborted) {
    let valid = true;
    if (validate) {
      try {
        valid = validate(held);
      } catch {
        valid = false;
      }
    }
    if (valid) {
      applied = "snapshot";
      apply(held, "snapshot");
    } else {
      forgetSurfaceSnapshot(key);
    }
  }

  const doFetch = fetchImpl ?? fetch;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (requestSignal?.aborted) return applied;
    try {
      const response = await doFetch(key, { ...init, signal: requestSignal });
      if (!response.ok) {
        const retryable = isTransientResponse(response);
        discardBody(response);
        if (retryable && attempt === 0 && await waitForRetry(requestSignal)) continue;
        return applied;
      }
      const body = (await response.json()) as T;
      if (requestSignal?.aborted) return applied;
      if (validate && !validate(body)) {
        if (attempt === 0 && await waitForRetry(requestSignal)) continue;
        return applied;
      }
      const shouldCache = apply(body, "network") !== false;
      if (shouldCache) writeSurfaceSnapshot(key, body);
      return "network";
    } catch {
      if (requestSignal?.aborted) return applied;
      if (attempt === 0 && await waitForRetry(requestSignal)) continue;
      // Aborted, offline, or a blip. A surface that already showed a real
      // answer keeps it; one that showed nothing reports the failure to its
      // caller.
      return applied;
    }
  }
  return applied;
}
