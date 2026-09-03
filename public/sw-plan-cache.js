/*
 * PUBMAXXING plan-navigation cache — a LOCKED PLAN must survive offline (U18).
 *
 * Tonight's failure mode: the crew is in a cellar with no signal and someone
 * reopens the plan link. Today public/sw.js only shelves ["/","/map",
 * "/tonight","/offline.html"]; a /plan/<id> or /p/<id> navigation is never
 * cached, so offline it falls back to "/" — the plan is gone exactly when it
 * matters. This module adds network-first, cache-on-success caching for plan
 * permalinks so a page opened earlier (with signal) reopens later (without).
 *
 * The server component already renders stops, route order, times and crew into
 * the HTML (they are server props, not client fetches), so the cached HTML
 * alone restores the night — no API replay required.
 *
 * It lives in its own file, loaded by public/sw.js via
 *   importScripts("/sw-plan-cache.js?v=" + VERSION)
 * deliberately: sw.js is being extended concurrently by the #457 web-push
 * handler, so the collision surface in sw.js is kept to a few clearly-marked
 * lines (one import + two hooks inside handleNavigation + one cache name).
 *
 * Cache identity/eviction:
 *  - The cache name is owned by sw.js (PREFIX + "plan-" + VERSION) and passed
 *    in, so it is versioned and migrated by sw.js during activate().
 *  - Keyed by pathname (like the shell cache) so a plan reopens regardless of
 *    ?vibe=/utm query, and one plan is never stored twice.
 *  - Bounded to the last MAX_PLAN_ENTRIES plans, LRU-ish: Cache.put replaces
 *    then appends, so a re-opened plan moves to the end and trimming from the
 *    front (Cache.keys() is oldest-first) drops the least-recently-seen plan.
 *
 * Never caches non-GET or /api/* — that gating lives in sw.js before a
 * navigation ever reaches here; isPlanPath is an extra guard, not the only one.
 */
(function (scope) {
  "use strict";

  const MAX_PLAN_ENTRIES = 10;

  // A LOCKED plan permalink is /plan/<id> or /p/<id>. The bare /plan composer
  // and a bare /p are not a night to restore, so they must NOT match (they
  // need at least one non-slash character after the segment).
  function isPlanPath(pathname) {
    return /^\/plan\/[^/]/.test(pathname) || /^\/p\/[^/]/.test(pathname);
  }

  // Which cache keys to delete to keep at most maxEntries. Cache.keys() yields
  // oldest-first, so the surplus at the FRONT is the least-recently-cached.
  // Pure + synchronous so the eviction rule is unit-testable without a Cache.
  function planEvictionKeys(keys, maxEntries) {
    if (!Array.isArray(keys) || keys.length <= maxEntries) return [];
    return keys.slice(0, keys.length - maxEntries);
  }

  async function trimPlanCache(cacheName, maxEntries) {
    const cache = await scope.caches.open(cacheName);
    const keys = await cache.keys();
    const doomed = planEvictionKeys(keys, maxEntries);
    await Promise.all(doomed.map((key) => cache.delete(key)));
  }

  // Store a successful plan navigation. Keyed by pathname so it is query- and
  // duplicate-proof, then trimmed to the LRU bound. Best-effort: a cache write
  // failing must never break the response the user is already being handed.
  async function cachePlanNavigation(request, response, url, cacheName) {
    if (!response || !response.ok || !isPlanPath(url.pathname)) return;
    try {
      const cache = await scope.caches.open(cacheName);
      await cache.put(url.pathname, response.clone());
      await trimPlanCache(cacheName, MAX_PLAN_ENTRIES);
    } catch {
      // swallow: caching is an optimisation, not a correctness requirement
    }
  }

  // Offline fallback: the exact plan page this browser shelved earlier.
  async function matchPlanNavigation(url, cacheName) {
    if (!isPlanPath(url.pathname)) return undefined;
    try {
      const cache = await scope.caches.open(cacheName);
      return await cache.match(url.pathname, { ignoreSearch: true });
    } catch {
      return undefined;
    }
  }

  const api = {
    MAX_PLAN_ENTRIES,
    isPlanPath,
    planEvictionKeys,
    trimPlanCache,
    cachePlanNavigation,
    matchPlanNavigation,
  };

  // Runtime: expose on the SW global for public/sw.js to call.
  if (scope) scope.planCache = api;
  // Test: allow a Node/vitest import of the pure helpers (no self required).
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : undefined);
