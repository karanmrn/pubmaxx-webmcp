// Client-side loader that transparently resolves the SLIM venue index's shards.
//
// #315 grew venues_slim.json to ~805 KB by adding Outer-London presence pins.
// scripts/build_slim_index.mjs now emits, alongside the monolithic file:
//   • venues_slim.manifest.json — shard -> { url, bbox, count } (tiny, eager)
//   • venues_slim.core.json     — the central compatibility cell
//   • venues_slim.cell.*.json   - lazy location cells
//
// The MAP is the only true first-paint surface, so it loads the viewport first,
// starts one neighbouring grid ring after pins settle, and pulls another cell
// only when needed.
// Everything is one code path: consumers hold a loader from
// createSlimShardLoader() and call initial()/inBounds()/nearPoint()/all(); the
// loader hides fetching, dedup, offline mirroring, and the non-sharded
// fallback for cities that ship a single file (no manifest).
//
// Degradation: a shard fetch that fails with no offline mirror yields [] and is
// NOT marked loaded, so the next moveend / near-me retries it. The map keeps
// working with whatever shards did load. Stale-while-revalidate `/data/*.json`
// handling in public/sw.js covers every shard URL (see its strategy table).

import { discardBody } from "@/lib/responseBody";
import { takeEarlyWarmJson } from "@/lib/mapEarlyWarm";
import { getCity, type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { offlineCache } from "@/lib/offlineCache";
import { loadSlimVenuesFromPathResult, type SlimVenue } from "@/lib/venuesSlim";
import { WALKABLE_RADIUS_KM } from "@/lib/nearMeAnswer";

/** [minLng, minLat, maxLng, maxLat] — GeoJSON bbox order (matches the build). */
export type ShardBbox = [number, number, number, number];

export type ShardEntry = {
  id: string;
  core: boolean;
  url: string;
  count: number;
  bbox: ShardBbox;
  partition?: "borough" | "kind" | "grid";
  borough?: string;
};

export type ShardManifest = {
  version: number;
  revision?: string;
  grid?: { originLat: number; originLon: number; latStep: number; lonStep: number };
  shards: ShardEntry[];
};

/** A map viewport as edges (west/east longitude, south/north latitude). */
export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type SlimShardLoadResult = {
  rows: SlimVenue[];
  status: "ready" | "unavailable";
};

const LEGACY_SHARD_MANIFEST_VERSION = 1;
const SPATIAL_SHARD_MANIFEST_VERSION = 2;
const MAP_DATA_REVISION = process.env.NEXT_PUBLIC_SW_VERSION?.trim() ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error("A deploy revision is required for production map data");
      })()
    : "local");

// --- pure geometry + manifest validation (unit-tested) -----------------------

function isBbox(value: unknown): value is ShardBbox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isGrid(value: unknown): value is ShardManifest["grid"] {
  if (typeof value !== "object" || value === null) return false;
  const grid = value as Record<string, unknown>;
  return ["originLat", "originLon", "latStep", "lonStep"].every(
    (key) => typeof grid[key] === "number" && Number.isFinite(grid[key]),
  );
}

/** Parse an unknown payload into a ShardManifest, or null if malformed. */
export function parseShardManifest(
  value: unknown,
  expectedVersion?: number,
  expectedRevision?: string,
): ShardManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.version !== "number" ||
    !Number.isInteger(obj.version) ||
    (obj.version !== LEGACY_SHARD_MANIFEST_VERSION &&
      obj.version !== SPATIAL_SHARD_MANIFEST_VERSION) ||
    (expectedVersion !== undefined && obj.version !== expectedVersion)
  ) {
    return null;
  }
  if (
    (obj.revision !== undefined &&
      (typeof obj.revision !== "string" || obj.revision.length === 0)) ||
    (expectedRevision !== undefined && obj.revision !== expectedRevision)
  ) {
    return null;
  }
  if (!Array.isArray(obj.shards)) return null;
  const shards: ShardEntry[] = [];
  for (const raw of obj.shards) {
    if (typeof raw !== "object" || raw === null) return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string" || !s.id) return null;
    if (typeof s.url !== "string" || !s.url) return null;
    if (typeof s.count !== "number") return null;
    if (typeof s.core !== "boolean") return null;
    if (!isBbox(s.bbox)) return null;
    if (
      s.partition !== undefined &&
      s.partition !== "borough" &&
      s.partition !== "kind" &&
      s.partition !== "grid"
    ) {
      return null;
    }
    if (s.partition === "borough" && typeof s.borough !== "string") return null;
    if (s.partition === "kind" && s.borough !== undefined) return null;
    if (s.partition === "grid" && s.borough !== undefined) return null;
    shards.push({
      id: s.id,
      core: s.core,
      url: s.url,
      count: s.count,
      bbox: s.bbox,
      ...(s.partition !== undefined
        ? { partition: s.partition as "borough" | "kind" }
        : {}),
      ...(typeof s.borough === "string" ? { borough: s.borough } : {}),
    });
  }
  if (obj.grid !== undefined && !isGrid(obj.grid)) return null;
  return {
    version: obj.version,
    ...(typeof obj.revision === "string" ? { revision: obj.revision } : {}),
    ...(obj.grid ? { grid: obj.grid } : {}),
    shards,
  };
}

/** Does a shard bbox overlap the viewport bounds? (inclusive edges) */
export function bboxIntersects(bbox: ShardBbox, bounds: MapBounds): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return (
    minLng <= bounds.east &&
    maxLng >= bounds.west &&
    minLat <= bounds.north &&
    maxLat >= bounds.south
  );
}

/** Is a point inside a shard bbox? */
export function bboxContainsPoint(bbox: ShardBbox, lat: number, lng: number): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

const METRES_PER_DEGREE_LAT = 111_320;

function boundsForRadius(lat: number, lng: number, radiusKm: number): MapBounds {
  const radiusMetres = Math.max(0, radiusKm) * 1_000;
  const latitudeDelta = radiusMetres / METRES_PER_DEGREE_LAT;
  const longitudeDelta = radiusMetres / (
    METRES_PER_DEGREE_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  );
  return {
    west: lng - longitudeDelta,
    south: Math.max(-90, lat - latitudeDelta),
    east: lng + longitudeDelta,
    north: Math.min(90, lat + latitudeDelta),
  };
}

/** Non-core shards whose bbox intersects the viewport. */
export function shardsForBounds(
  manifest: ShardManifest,
  bounds: MapBounds,
  ring = 0,
  includeCore = false,
): ShardEntry[] {
  const grid = manifest.grid;
  const padLat = grid && Number.isFinite(ring) ? Math.max(0, ring) * grid.latStep : 0;
  const padLng = grid && Number.isFinite(ring) ? Math.max(0, ring) * grid.lonStep : 0;
  const padded = {
    west: bounds.west - padLng,
    south: bounds.south - padLat,
    east: bounds.east + padLng,
    north: bounds.north + padLat,
  };
  return manifest.shards.filter(
    (s) => (includeCore || !s.core) && bboxIntersects(s.bbox, padded),
  );
}

/**
 * Has every shard that could hold a venue inside `bounds` already loaded?
 *
 * The counter-question to `shardsForBounds`: that one asks what to FETCH, this
 * one asks whether a figure derived from the loaded pins is the whole truth for
 * that patch of the map. Core counts too - a bbox that only core covers is
 * complete the moment core lands.
 */
export function boundsCoveredByLoadedShards(
  manifest: ShardManifest,
  loadedShardUrls: ReadonlySet<string>,
  bounds: MapBounds,
): boolean {
  return manifest.shards
    .filter((shard) => bboxIntersects(shard.bbox, bounds))
    .every((shard) => loadedShardUrls.has(shard.url));
}

/**
 * The shard a point falls in. Prefers core when its bbox contains the point;
 * otherwise picks the containing outer shard when one exists.
 */
export function shardForPoint(
  manifest: ShardManifest,
  lat: number,
  lng: number,
): ShardEntry | null {
  const core = manifest.shards.find(
    (s) => s.core && bboxContainsPoint(s.bbox, lat, lng),
  );
  if (core) return core;

  const outer = manifest.shards.filter(
    (s) => !s.core && s.partition !== "kind",
  );
  const containing = outer.filter((s) => bboxContainsPoint(s.bbox, lat, lng));
  const pool = containing.length > 0 ? containing : [];
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  let best: ShardEntry | null = null;
  let bestDist = Infinity;
  for (const s of pool) {
    const cLng = (s.bbox[0] + s.bbox[2]) / 2;
    const cLat = (s.bbox[1] + s.bbox[3]) / 2;
    const d = (cLng - lng) ** 2 + (cLat - lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

// --- stateful per-city loader ------------------------------------------------

const MANIFEST_OFFLINE_PREFIX = "venues_slim_manifest:v2";

function manifestPathFor(slimVenuesPath: string): string {
  return slimVenuesPath.replace(/\.json$/, ".manifest.json");
}

function manifestRequestPath(path: string): string {
  if (MAP_DATA_REVISION === "local") return path;
  return `${path}?v=${encodeURIComponent(MAP_DATA_REVISION)}`;
}

function shardRequestPath(path: string): string {
  if (MAP_DATA_REVISION === "local") return path;
  return `${path}?v=${encodeURIComponent(MAP_DATA_REVISION)}`;
}

/** Guessed core shard URL for a city's slim index (London: venues_slim.core.json). */
export function guessedCoreShardUrl(slimVenuesPath: string): string {
  return slimVenuesPath.replace(/\.json$/, ".core.json");
}

export type SlimShardLoader = {
  /** Compatibility read for consumers that need the central shard. */
  core(): Promise<SlimVenue[]>;
  /**
   * Venues from location shards intersecting `bounds` that are not already
   * loaded. Returns [] when nothing new is needed. Never throws.
   */
  inBounds(bounds: MapBounds, ring?: number): Promise<SlimVenue[]>;
  /** First map read: viewport cells, or the legacy core. */
  initial(bounds: MapBounds): Promise<SlimVenue[]>;
  initialResult(bounds: MapBounds): Promise<SlimShardLoadResult>;
  /**
   * Venues from location shards intersecting the walk radius, loaded (with one
   * retry) if needed. Status reports whether all required shards loaded.
   */
  nearPoint(lat: number, lng: number): Promise<SlimShardLoadResult>;
  /** Every shard (for by-id / whole-index consumers). */
  all(): Promise<SlimVenue[]>;
  /**
   * Whether every shard that could hold a venue inside `bounds` has loaded, so
   * a count taken over the loaded pins is complete for that patch. TRI-STATE:
   * `null` while the manifest has not answered, because "we cannot tell yet"
   * is not "incomplete" and neither is it a figure anybody may print.
   */
  coverageComplete(bounds: MapBounds): boolean | null;
};

export type SlimShardViewportLoadKind = "target" | "refresh";

export function openingLocationCancellationAfterAttempt({
  openingLocationResolved,
  openingLocationCancelledBeforeResolution,
}: {
  openingLocationResolved: boolean;
  openingLocationCancelledBeforeResolution: boolean;
}): boolean {
  return (
    openingLocationCancelledBeforeResolution || !openingLocationResolved
  );
}

export function resolveInitialSlimShardLifecycle<Viewport>({
  openingLocationResolved,
  openingLocationCancelled,
  openingLocationSettled,
  deferInitialSpatialLoad,
  initialMapView,
  openingLoadViewport,
}: {
  openingLocationResolved: boolean;
  openingLocationCancelled: boolean;
  openingLocationSettled: boolean;
  deferInitialSpatialLoad: boolean;
  initialMapView: Viewport;
  openingLoadViewport: Viewport;
}): { ready: boolean; viewport: Viewport } {
  return {
    ready:
      deferInitialSpatialLoad ||
      (openingLocationCancelled
        ? openingLocationSettled
        : openingLocationResolved),
    viewport:
      deferInitialSpatialLoad || openingLocationCancelled
        ? initialMapView
        : openingLoadViewport,
  };
}

/**
 * A viewport that names nowhere, so nothing spatial may be read from it.
 *
 * The map holds this placeholder (centre [0, 0] at zoom 0) while the opening
 * location question is still open. Turned into bounds it is the whole WORLD,
 * and the first-visit shard read took it literally: a cold `/map` on a phone
 * asked for 163 of London's 244 cells - the entire city - before the map was
 * interactive, for a screen covering about four kilometres. That is the whole
 * request budget spent on pins nobody is looking at.
 */
export function viewportNamesNowhere(viewport: {
  center: [number, number];
  zoom: number;
}): boolean {
  return (
    viewport.zoom <= 0 && viewport.center[0] === 0 && viewport.center[1] === 0
  );
}

/**
 * The viewport the OPENING shard read may use.
 *
 * A placeholder is answered with the city's own default view, which is where
 * the camera lands the moment the location question resolves to no. Never the
 * placeholder itself: a read is about a place, and this one has none.
 */
export function openingLoadViewportFor<
  Viewport extends { center: [number, number]; zoom: number },
>(viewport: Viewport, cityView: Viewport): Viewport {
  return viewportNamesNowhere(viewport) ? cityView : viewport;
}

/**
 * How far past the settled viewport each shard lane reaches.
 *
 * The viewport is loaded on the caller's turn; the ring around it waits for
 * idle time. Captain's law: the map a reader is looking at loads first, and
 * the sides fill in afterwards.
 */
export const VIEWPORT_SHARD_RING = 0;
export const NEIGHBOUR_SHARD_RING = 1;

type SlimShardViewportTiming = {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  setTimeout(callback: () => void, delay: number): unknown;
};

/**
 * Start the settled target viewport on the caller's turn. Only later ring
 * refreshes may wait for idle time, with the existing timeout fallback.
 */
export function scheduleSlimShardViewportLoad(
  load: () => void,
  kind: SlimShardViewportLoadKind,
  timing: SlimShardViewportTiming = window,
): void {
  if (kind === "target") {
    load();
    return;
  }
  if (typeof timing.requestIdleCallback === "function") {
    timing.requestIdleCallback(load, { timeout: 3_000 });
  } else {
    timing.setTimeout(load, 1_000);
  }
}

export function scheduleSlimShardRingLoads(
  loadViewport: () => void,
  loadNeighbour: () => void,
  timing: SlimShardViewportTiming = window,
): void {
  loadViewport();
  scheduleSlimShardViewportLoad(loadNeighbour, "refresh", timing);
}

/**
 * Build a loader bound to one city. Fetches (and offline-mirrors) the manifest
 * once; on a manifest miss (a city that still ships a single slim file) it
 * degrades to loading that whole file as "core", with inBounds/nearPoint
 * returning [] — exactly today's non-sharded behaviour.
 */
export function createSlimShardLoader(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
  options: { bypassInFlight?: boolean; deferSpatial?: boolean } = {},
): SlimShardLoader {
  const city = getCity(cityId);
  const slimVenuesPath = city.slimVenuesPath;
  const manifestPath = manifestPathFor(slimVenuesPath);
  const manifestOfflineKey = `${MANIFEST_OFFLINE_PREFIX}:${manifestPath}`;
  const expectedManifestVersion =
    manifestPath === "/data/venues_slim.manifest.json"
      ? SPATIAL_SHARD_MANIFEST_VERSION
      : LEGACY_SHARD_MANIFEST_VERSION;

  let manifestPromise: Promise<ShardManifest | null> | null = null;
  // Settled manifest snapshot, so coverage can be answered without awaiting.
  let manifestAnswered = false;
  let settledManifest: ShardManifest | null = null;
  let manifestRevisionRejected = false;
  // A city with no manifest ships one file, so loading it covers everything.
  let wholeIndexLoaded = false;
  // url -> in-flight/settled fetch of that shard's venues.
  const shardPromises = new Map<string, Promise<SlimShardLoadResult>>();
  // shard urls that have successfully contributed venues (so inBounds skips them).
  const loadedUrls = new Set<string>();

  async function fetchManifest(): Promise<ShardManifest | null> {
    try {
      let payload: unknown;
      let earlyPayloadRejected = false;
      const early = options.bypassInFlight
        ? undefined
        : takeEarlyWarmJson(manifestPath);
      if (early) {
        try {
          payload = await early;
        } catch {
          payload = undefined;
          earlyPayloadRejected = true;
        }
      }
      if (payload === undefined) {
        const response = earlyPayloadRejected
          ? await fetch(manifestRequestPath(manifestPath), { cache: "no-store" })
          : await fetch(manifestRequestPath(manifestPath));
        if (!response.ok) {
          discardBody(response);
          throw new Error(`HTTP ${response.status}`);
        }
        payload = await response.json();
      }
      let parsed = parseShardManifest(
        payload,
        expectedManifestVersion,
        MAP_DATA_REVISION === "local" ? undefined : MAP_DATA_REVISION,
      );
      if (!parsed && expectedManifestVersion === SPATIAL_SHARD_MANIFEST_VERSION) {
        manifestRevisionRejected = true;
        if (!earlyPayloadRejected) {
          try {
            const response = await fetch(manifestRequestPath(manifestPath), {
              cache: "no-store",
            });
            if (response.ok) {
              parsed = parseShardManifest(
                await response.json(),
                expectedManifestVersion,
                MAP_DATA_REVISION === "local" ? undefined : MAP_DATA_REVISION,
              );
            } else {
              discardBody(response);
            }
          } catch {
            parsed = null;
          }
        }
      }
      if (parsed) void offlineCache.set(manifestOfflineKey, parsed);
      if (parsed) manifestRevisionRejected = false;
      return parsed;
    } catch {
      const stored = await offlineCache.get<unknown>(manifestOfflineKey);
      const parsed = parseShardManifest(
        stored,
        expectedManifestVersion,
        MAP_DATA_REVISION === "local" ? undefined : MAP_DATA_REVISION,
      );
      if (
        stored !== null &&
        stored !== undefined &&
        !parsed &&
        expectedManifestVersion === SPATIAL_SHARD_MANIFEST_VERSION
      ) {
        manifestRevisionRejected = true;
      }
      return parsed;
    }
  }

  function manifest(): Promise<ShardManifest | null> {
    if (!manifestPromise) {
      manifestPromise = fetchManifest().then((parsed) => {
        settledManifest = parsed;
        manifestAnswered = true;
        return parsed;
      });
    }
    return manifestPromise;
  }

  function loadWholeIndexResult(): Promise<SlimShardLoadResult> {
    const wholeIndexPath = shardRequestPath(slimVenuesPath);
    const wholeIndexOptions =
      MAP_DATA_REVISION === "local"
        ? options
        : { ...options, expectedRevision: MAP_DATA_REVISION };
    return loadSlimVenuesFromPathResult(wholeIndexPath, wholeIndexOptions).then((result) => {
      if (result.status === "ready") wholeIndexLoaded = true;
      return result;
    });
  }

  function loadWholeIndex(): Promise<SlimVenue[]> {
    return loadWholeIndexResult().then((result) => result.rows);
  }

  // Fetch one shard body once; a failure (no offline mirror) is NOT memoized as
  // loaded, so a later call retries it.
  function loadShard(url: string): Promise<SlimShardLoadResult> {
    const existing = shardPromises.get(url);
    if (existing) return existing;
    const shardOptions =
      MAP_DATA_REVISION === "local"
        ? options
        : { ...options, expectedRevision: MAP_DATA_REVISION };
    const p = loadSlimVenuesFromPathResult(shardRequestPath(url), shardOptions)
      .then((result) => {
        if (result.status === "ready") {
          loadedUrls.add(url);
        } else {
          shardPromises.delete(url);
        }
        return result;
      })
      .catch(() => {
        shardPromises.delete(url); // allow retry
        return { rows: [], status: "unavailable" as const };
      });
    shardPromises.set(url, p);
    return p;
  }

  function coreEntry(m: ShardManifest): ShardEntry | undefined {
    return m.shards.find((s) => s.core);
  }

  async function initialResult(bounds: MapBounds): Promise<SlimShardLoadResult> {
    // Keep first visit on the compatibility path. The spatial manifest and
    // cell requests are useful after pins appear, but they must not tax the
    // first pin-ready measurement.
    if (
      options.deferSpatial &&
      manifestPath === "/data/venues_slim.manifest.json"
    ) {
      return loadShard(guessedCoreShardUrl(slimVenuesPath));
    }
    const m = await manifest();
    if (!m) {
      return manifestRevisionRejected
        ? { rows: [], status: "unavailable" }
        : loadWholeIndexResult();
    }
    const needed = shardsForBounds(m, bounds, 0, true).filter(
      (s) => !loadedUrls.has(s.url),
    );
    if (needed.length === 0) return { rows: [], status: "ready" };
    const results = await Promise.all(needed.map((s) => loadShard(s.url)));
    return {
      rows: results.flatMap((result) => result.rows),
      status: results.every((result) => result.status === "ready") ? "ready" : "unavailable",
    };
  }

  return {
    async core(): Promise<SlimVenue[]> {
      const guessedCoreUrl = guessedCoreShardUrl(slimVenuesPath);
      // Speculative: started beside the manifest so first paint does not wait
      // for one round trip before starting the next. It is only ever AWAITED
      // once the manifest names that very URL as its core, so a city with no
      // manifest (or a differently named core) is not serialised behind a
      // request its answer discards. loadShard never rejects.
      const guessedRows = loadShard(guessedCoreUrl);
      const m = await manifest();
      if (!m) return manifestRevisionRejected ? [] : loadWholeIndex();
      const core = coreEntry(m);
      if (!core) return manifestRevisionRejected ? [] : loadWholeIndex();
      if (core.url === guessedCoreUrl) {
        const result = await guessedRows;
        if (result.rows.length > 0) return result.rows;
      }
      return (await loadShard(core.url)).rows;
    },

    async inBounds(bounds: MapBounds, ring = 0): Promise<SlimVenue[]> {
      const m = await manifest();
      if (!m) return [];
      const needed = shardsForBounds(m, bounds, ring, true).filter((s) => !loadedUrls.has(s.url));
      if (needed.length === 0) return [];
      const results = await Promise.all(needed.map((s) => loadShard(s.url)));
      return results.flatMap((result) => result.rows);
    },

    async initial(bounds: MapBounds): Promise<SlimVenue[]> {
      return (await initialResult(bounds)).rows;
    },

    initialResult,

    async nearPoint(lat: number, lng: number): Promise<SlimShardLoadResult> {
      const m = await manifest();
      if (!m) {
        return {
          rows: [],
          status: wholeIndexLoaded && !manifestRevisionRejected ? "ready" : "unavailable",
        };
      }
      const needed = shardsForBounds(
        m,
        boundsForRadius(lat, lng, WALKABLE_RADIUS_KM),
        0,
        true,
      ).filter((s) => s.partition !== "kind" && !loadedUrls.has(s.url));
      if (needed.length === 0) return { rows: [], status: "ready" };
      let results = await Promise.all(needed.map((s) => loadShard(s.url)));
      const unavailable = needed.filter((s, index) => results[index].status === "unavailable");
      if (unavailable.length > 0) {
        const retries = await Promise.all(unavailable.map((s) => loadShard(s.url)));
        const retryByUrl = new Map(unavailable.map((s, index) => [s.url, retries[index]]));
        results = results.map((result, index) => retryByUrl.get(needed[index].url) ?? result);
      }
      return {
        rows: results.flatMap((result) => result.rows),
        status: results.every((result) => result.status === "ready")
          ? "ready"
          : "unavailable",
      };
    },

    async all(): Promise<SlimVenue[]> {
      const m = await manifest();
      if (!m) return manifestRevisionRejected ? [] : loadWholeIndex();
      const results = await Promise.all(m.shards.map((s) => loadShard(s.url)));
      return results.flatMap((result) => result.rows);
    },

    coverageComplete(bounds: MapBounds): boolean | null {
      if (wholeIndexLoaded) return true;
      if (!manifestAnswered) return null;
      if (!settledManifest) return false;
      return boundsCoveredByLoadedShards(settledManifest, loadedUrls, bounds);
    },
  };
}
