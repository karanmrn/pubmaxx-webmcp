/*
 * PUBMAXXING service worker — offline resilience (issue #32, PRD § The Spill).
 * Pubs (especially cellars) have terrible signal; the map must survive it.
 *
 * Design rules (in order of importance):
 *  1. NEVER break a fresh deploy. Caches are keyed by a per-build VERSION
 *     (injected via the ?v= query on the registration URL — see
 *     components/OfflineReady.tsx and next.config.mjs). `activate` preserves
 *     valid offline entries and retires old caches only when safely covered.
 *  2. NEVER serve stale HTML for navigations. Navigations are network-first;
 *     the cache is only a fallback when the network is genuinely down.
 *  3. NEVER cache API responses (GET or POST). Last-train times and pint
 *     prices must be live or absent — stale data here is a lie (honesty rule).
 *     Non-GET requests are never intercepted at all.
 *
 * Strategy table:
 *   /data/*.json (slim index, POIs, heritage)
 *       → stale-while-revalidate (versioned, bounded)
 *   tiles.openfreemap.org + /_next/static/*
 *       → stale-while-revalidate, trimmed FIFO/LRU-ish at MAX_SWR_ENTRIES
 *   navigations
 *       → network-first → cached copy of that page → cached "/" → /offline.html
 *   /api/* GETs
 *       → untouched (network-only); the app already renders honest
 *         empty/error states when these fail.
 */

const WORKER_URL = new URL(self.location.href);
const VERSION = WORKER_URL.searchParams.get("v")?.trim() || "local";
const CACHE_POLICY = WORKER_URL.searchParams.get("cache-policy");
const PRE_FIX_CACHE_POLICIES = new Set(["cache-write-coupled-v1"]);

const PREFIX = "pubmax-sw-";
const DATA_CACHE = `${PREFIX}data-${VERSION}`;
const SWR_CACHE = `${PREFIX}swr-${VERSION}`;
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
// Locked-plan pages a crew opened earlier, so they reopen offline (U18, #457
// coordination: caching logic lives in the separate sw-plan-cache.js module).
const PLAN_CACHE = `${PREFIX}plan-${VERSION}`;
const DATA_CACHE_FAMILY = {
  current: DATA_CACHE,
  prefix: `${PREFIX}data-`,
  copyEntries: false,
};
const CACHE_FAMILIES = [
  DATA_CACHE_FAMILY,
  { current: SWR_CACHE, prefix: `${PREFIX}swr-`, purgeTileHost: true },
  { current: SHELL_CACHE, prefix: `${PREFIX}shell-` },
  { current: PLAN_CACHE, prefix: `${PREFIX}plan-` },
];

// Load the plan-navigation cache helpers (self.planCache). Version-busted like
// every other asset, and non-fatal: if it fails to load the SW keeps its prior
// behaviour rather than failing to install. Every use below is guarded on
// self.planCache so a missing module degrades cleanly.
try {
  importScripts(`/sw-plan-cache.js?v=${VERSION}`);
} catch {
  // no-op: plan caching is an enhancement, offline shell still works
}

// Tiles + hashed build assets can grow without bound (a long crawl-planning
// session pulls hundreds of tiles). Cache.keys() returns entries oldest-first,
// so trimming from the front is a cheap LRU-ish FIFO cap.
const MAX_SWR_ENTRIES = 200;
const MAX_TILE_ENTRIES = 150;
const MAX_DATA_ENTRIES = 350;

const TILE_HOST = "tiles.openfreemap.org";
const OFFLINE_URL = "/offline.html";
// Pages worth having offline: the landing shell, the map shell, and /tonight
// (the installed-app start_url, issue #439). Precache is best-effort
// (allSettled) — a failed precache must never fail the install.
const SHELL_URLS = ["/", "/map", "/tonight", OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(
        SHELL_URLS.map((url) =>
          fetch(url, { cache: "no-cache" }).then((response) => {
            if (response.ok) return cache.put(url, response);
            return undefined;
          }),
        ),
      ),
    ),
  );
  if (isPreFixActiveWorker()) {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.allSettled(CACHE_FAMILIES.map(migrateCacheFamily))
      .then(() => self.clients.claim()),
  );
});

function isPreFixActiveWorker() {
  const activeUrl = self.registration.active?.scriptURL;
  if (!activeUrl || !CACHE_POLICY) return false;
  try {
    const activePolicy = new URL(activeUrl).searchParams.get("cache-policy");
    return (
      activePolicy === null ||
      PRE_FIX_CACHE_POLICIES.has(activePolicy)
    );
  } catch {
    return false;
  }
}

async function cacheFamilyNames(currentName) {
  const family = CACHE_FAMILIES.find(({ current }) => current === currentName);
  if (!family) return [currentName];
  const names = await caches.keys();
  return [
    currentName,
    ...names
      .filter((name) => name.startsWith(family.prefix) && name !== currentName)
      .reverse(),
  ];
}

async function migrateCacheFamily({
  current,
  prefix,
  purgeTileHost = false,
  copyEntries = true,
}) {
  const names = await caches.keys();
  const oldNames = names.filter(
    (name) => name.startsWith(prefix) && name !== current,
  ).reverse();
  if (oldNames.length === 0) return;

  const destination = await caches.open(current);
  for (const name of oldNames) {
    const source = await caches.open(name);
    let covered = true;
    for (const request of await source.keys()) {
      if (purgeTileHost && new URL(request.url).hostname === TILE_HOST) {
        if (!(await source.delete(request))) covered = false;
        continue;
      }
      if (await destination.match(request)) continue;
      if (!copyEntries) {
        covered = false;
        continue;
      }
      const response = await source.match(request);
      if (!response) continue;
      try {
        await destination.put(request, response);
      } catch {
        covered = false;
      }
    }
    if (covered) await caches.delete(name);
  }
}

async function matchCacheFamily(currentName, request, options) {
  const requestUrl = new URL(
    typeof request === "string" ? request : request.url,
    self.location.origin,
  );
  const names = await cacheFamilyNames(currentName);
  const candidates =
    currentName === SWR_CACHE && requestUrl.hostname === TILE_HOST
      ? [currentName]
      : names;
  for (const name of candidates) {
    const response = await (await caches.open(name)).match(request, options);
    if (response) return response;
  }
  return undefined;
}

async function matchPlanNavigationAcrossCaches(url) {
  if (!self.planCache) return undefined;
  for (const name of await cacheFamilyNames(PLAN_CACHE)) {
    const response = await self.planCache.matchPlanNavigation(url, name);
    if (response) return response;
  }
  return undefined;
}

// Web Push payloads are always user-visible. Treat provider data as untrusted:
// copy only short strings and reduce click-through to a same-origin path. A
// malformed or empty push still shows a useful, honest fallback notification.
function pushText(value, fallback, maxLength) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function safeNotificationPath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/today";
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return "/today";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/today";
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    payload = {};
  }
  const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data
    : {};
  const url = safeNotificationPath(data.url);
  event.waitUntil(
    self.registration.showNotification(
      pushText(payload.title, "PUBMAXX", 80),
      {
        body: pushText(payload.body, "Your London brief is ready.", 240),
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: pushText(payload.tag, "pubmax-update", 80),
        data: { url },
      },
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeNotificationPath(event.notification.data?.url);
  const target = new URL(path, self.location.origin).toString();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const exact = windows.find((client) => client.url === target);
    if (exact) return exact.focus();

    const existing = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });
    if (existing) {
      if (typeof existing.navigate === "function") await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Rule 3: never intercept writes. POST/PUT/etc. go straight to the network.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  const sameOrigin = url.origin === self.location.origin;

  // API GETs (last-train, pint-drops, …): network-only. Not intercepted, so
  // a failure surfaces to the app's existing empty/error states — never a
  // stale price or a train that already left.
  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  // Navigations: network-first with an offline ladder.
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, request, url));
    return;
  }

  // Static data JSON: stale-while-revalidate for versioned-ish indices. Price
  // updates retain network-first behaviour because their observed-at claim has
  // a shorter honest window than the map index.
  if (sameOrigin && url.pathname.startsWith("/data/") && url.pathname.endsWith(".json")) {
    if (
      url.pathname.includes("/price_updates/") ||
      url.pathname.includes("/drink_price_updates/") ||
      url.pathname.includes("/food_price_updates/")
    ) {
      event.respondWith(networkFirstWithCache(event, request));
      return;
    }
    event.respondWith(
      staleWhileRevalidate(
        event,
        request,
        DATA_CACHE,
        MAX_DATA_ENTRIES,
        () => true,
        false,
        () => migrateCacheFamily(DATA_CACHE_FAMILY),
      ),
    );
    return;
  }

  // Map tiles / glyphs / sprites + Next's hashed static assets:
  // stale-while-revalidate with a capped cache.
  if (url.hostname === TILE_HOST || (sameOrigin && url.pathname.startsWith("/_next/static/"))) {
    const isTile = url.hostname === TILE_HOST;
    event.respondWith(
      staleWhileRevalidate(
        event,
        request,
        SWR_CACHE,
        isTile ? MAX_TILE_ENTRIES : MAX_SWR_ENTRIES,
        isTile ? (candidate) => new URL(candidate.url).hostname === TILE_HOST :
          (candidate) => new URL(candidate.url).pathname.startsWith("/_next/static/"),
      ),
    );
    return;
  }
  // Everything else: untouched.
});

function isCacheable(response) {
  if (!response || !response.ok || (response.type !== "basic" && response.type !== "cors")) {
    return false;
  }
  const cacheControl = response.headers?.get?.("cache-control")?.toLowerCase() || "";
  return !cacheControl.split(",").some((directive) => {
    const [name, value] = directive.trim().split("=", 2);
    return (
      ["no-store", "no-cache", "private", "must-revalidate", "proxy-revalidate"].includes(name) ||
      (["max-age", "s-maxage"].includes(name) && value?.trim() === "0")
    );
  });
}

function requestedVenueRevision(request) {
  const revision = new URL(request.url).searchParams.get("v")?.trim();
  return revision || (VERSION === "local" ? null : VERSION);
}

function expectedVenueManifestVersion(pathname) {
  if (pathname === "/data/venues_slim.manifest.json") return 2;
  if (/^\/data\/cities\/[^/]+\/venues_slim\.manifest\.json$/.test(pathname)) return 1;
  return null;
}

function isVenueShardPath(pathname) {
  return (
    pathname === "/data/venues_slim.json" ||
    /^\/data\/cities\/[^/]+\/venues_slim\.json$/.test(pathname) ||
    pathname === "/data/venues_slim.core.json" ||
    /^\/data\/venues_slim\.cell\..+\.json$/.test(pathname) ||
    /^\/data\/venues_slim\.(?!manifest|core|cell\.).+\.json$/.test(pathname) ||
    /^\/data\/cities\/[^/]+\/venues_slim\.core\.json$/.test(pathname)
  );
}

async function isCompatibleVenueManifest(request, response, options = {}) {
  const expectedVersion = expectedVenueManifestVersion(new URL(request.url).pathname);
  if (expectedVersion === null || !response) return true;
  const requestRevision = new URL(request.url).searchParams.get("v");
  if (!options.network && requestRevision && requestRevision !== VERSION) return false;
  try {
    const manifest = await response.clone().json();
    const expectedRevision = requestedVenueRevision(request);
    return (
      manifest?.version === expectedVersion &&
      Array.isArray(manifest.shards) &&
      (expectedRevision === null || manifest.revision === expectedRevision)
    );
  } catch {
    return false;
  }
}

async function isCompatibleVenueShard(request, response, options = {}) {
  const requestUrl = new URL(request.url);
  if (!isVenueShardPath(requestUrl.pathname) || !response) return true;
  const requestRevision = requestUrl.searchParams.get("v");
  if (!options.network && requestRevision && requestRevision !== VERSION) return false;
  if (!options.network && !requestRevision && VERSION !== "local") return false;
  try {
    const payload = await response.clone().json();
    const expectedRevision = requestedVenueRevision(request);
    return (
      (expectedRevision === null || payload?.revision === expectedRevision) &&
      Array.isArray(payload.rows)
    );
  } catch {
    return false;
  }
}

// Cache Storage is progressive enhancement. Safari may reject writes under
// storage pressure (especially while an update temporarily keeps two
// versioned cache sets). A valid network response must still reach its caller:
// cache.put() failure is never a network failure.
async function cachePutBestEffort(cache, request, response) {
  if (!isCacheable(response)) return false;
  try {
    await cache.put(request, response.clone());
    return true;
  } catch {
    return false;
  }
}

async function handleNavigation(event, request, url) {
  try {
    const response = await fetch(request);
    // Keep the shell copies fresh so the offline fallback is the latest deploy
    // this browser has seen — but only for the pages we deliberately shelve.
    if (response.ok && SHELL_URLS.includes(url.pathname)) {
      const copy = response.clone();
      event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) => cache.put(url.pathname, copy)),
      );
    } else if (response.ok && self.planCache && self.planCache.isPlanPath(url.pathname)) {
      // U18: shelve locked-plan pages so a crew that opened the link earlier
      // can reopen it with no signal. Cache-on-success, bounded + LRU inside
      // the module; best-effort via waitUntil so it never delays the response.
      const copy = response.clone();
      event.waitUntil(self.planCache.cachePlanNavigation(request, copy, url, PLAN_CACHE));
    }
    return response;
  } catch {
    // U18: offline, a locked plan reopens from its own cached HTML before the
    // generic shell ladder — that copy carries the night's stops/route/times.
    const plan = await matchPlanNavigationAcrossCaches(url);
    if (plan) return plan;
    const exact = await matchCacheFamily(SHELL_CACHE, url.pathname, {
      ignoreSearch: true,
    });
    if (exact) return exact;
    const home = await matchCacheFamily(SHELL_CACHE, "/", {
      ignoreSearch: true,
    });
    if (home) return home;
    const offline = await matchCacheFamily(SHELL_CACHE, OFFLINE_URL, {
      ignoreSearch: true,
    });
    if (offline) return offline;
    return new Response("You're offline and nothing is cached yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/** Prefer network for freshness-sensitive JSON; fall back to cache when offline. */
async function networkFirstWithCache(event, request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      event.waitUntil(
        cachePutBestEffort(cache, request, response).then(async (stored) => {
          if (stored) await migrateCacheFamily(DATA_CACHE_FAMILY);
        }),
      );
    }
    return response;
  } catch {
    const cached = await matchCacheFamily(DATA_CACHE, request, {
      ignoreSearch: true,
    });
    if (cached) return cached;
    return new Response("[]", {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function staleWhileRevalidate(
  event,
  request,
  cacheName = SWR_CACHE,
  maxEntries = MAX_SWR_ENTRIES,
  belongsToCache = () => true,
  preferNetworkForLegacy = false,
  afterStore = async () => undefined,
) {
  const cache = await caches.open(cacheName);
  const current = await cache.match(request);
  const cachedCandidate = current ?? await matchCacheFamily(cacheName, request);
  const cachedManifest = await isCompatibleVenueManifest(request, cachedCandidate);
  const cachedShard = await isCompatibleVenueShard(request, cachedCandidate);
  const cached = cachedManifest && cachedShard ? cachedCandidate : undefined;
  const network = fetch(request)
    .then(async (response) =>
      (await isCompatibleVenueManifest(request, response, { network: true })) &&
      (await isCompatibleVenueShard(request, response, { network: true }))
        ? response
        : undefined,
    )
    .catch(() => undefined);
  const update = network.then(async (response) => {
    if (!isCacheable(response)) return;
    const stored = await cachePutBestEffort(cache, request, response);
    if (!stored) return;
    await afterStore();
    try {
      await trimCache(cacheName, maxEntries, belongsToCache);
    } catch {
      // Trimming is best-effort for the same reason as the write.
    }
  });

  if (cached && (!preferNetworkForLegacy || current)) {
    event.waitUntil(update);
    return cached;
  }
  const fresh = await network;
  event.waitUntil(update);
  if (fresh) return fresh;
  if (cached) return cached;
  return Response.error();
}

// FIFO trim: Cache.keys() yields insertion order, so deleting from the front
// drops the oldest-written entries first.
async function trimCache(cacheName, maxEntries, belongsToCache = () => true) {
  const cache = await caches.open(cacheName);
  const keys = (await cache.keys()).filter((key) => {
    try {
      return belongsToCache(key);
    } catch {
      return false;
    }
  });
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}
