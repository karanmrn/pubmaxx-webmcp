// The UK BASE layer: every `amenity=pub` in the UK, streamed to the map one
// grid cell at a time.
//
// These are not venues in the product sense. They have no price, no amenities,
// no curation and no detail record - only "a pub is here, and nobody has said
// what a pint costs yet". So they deliberately live OUTSIDE the venue index:
// they never enter `venues`, which is what keeps them out of curated search,
// the price filters and the crawl router. Map search may match RESIDENT
// streamed pubs client-side (lib/ukBasePubSearch.ts) and NATIONAL name hits
// via GET /api/map-search (lib/ukNationalPubSearch.server.ts) — the browser
// never downloads the country-wide pack.
// They exist as map features, a separate in-viewport unverified list, and
// price-submission targets.
//
// DELIVERY. scripts/build_uk_base_shards.mjs emits a manifest plus one file per
// ~28 x ~17 km cell under /data/uk_base/. This module fetches:
//   • the manifest once, the first time the camera crosses UK_BASE_MIN_ZOOM;
//   • a cell body only when the (padded) viewport overlaps its bbox.
// London's normal city-centre opening starts at the gate and loads only its
// viewport cells. A wider camera that stays below the gate pays zero bytes for
// the whole layer.
//
// RESIDENCY. Shards are held in a small LRU (MAX_RESIDENT_SHARDS) rather than
// accumulated, so panning the length of the country cannot grow the tab without
// bound. An evicted cell is simply refetched (and the service worker's
// stale-while-revalidate `/data/*.json` rule usually answers it from disk).

import {
  bboxContainsPoint,
  bboxIntersects,
  type MapBounds,
  type ShardEntry,
  type ShardManifest,
  parseShardManifest,
} from "@/lib/slimShards";
import { discardBody } from "@/lib/responseBody";
import { offlineCache } from "@/lib/offlineCache";

export const UK_BASE_MANIFEST_PATH = "/data/uk_base/manifest.json";
export const UK_BASE_SHARD_VERSION = 1;
const UK_BASE_URL_PREFIX =
  /^\/data\/uk_base\/(?:packs\/[a-f0-9]{16}\/)?$/;

/**
 * Base ids are salted so they can never collide with a curated `venue-…` id
 * (the convention data/cities/README.md sets for city packs) and so any
 * consumer - the map, the sheet, a submitted price - can tell at a glance that
 * a row is an unverified OSM pub rather than a curated venue.
 */
export const UK_BASE_ID_PREFIX = "venue-uk-";
/** Maximum stable base ids one viewport visibility read may carry. */
export const MAX_PROVISIONAL_BASE_VENUE_IDS = 64;

/** A pub on the base layer. No price field exists: OSM is not a price source. */
export type UkBasePub = {
  /** `venue-uk-<osm ref>`, e.g. `venue-uk-n251829660`. Stable across refreshes. */
  id: string;
  name: string;
  /** OSM address, or "" when the pack had none. Never invented. */
  address: string;
  lat: number;
  lng: number;
  curatedVenueId: string;
};

export function ukBaseIdFor(osmRef: string): string {
  return `${UK_BASE_ID_PREFIX}${osmRef}`;
}

export function isUkBaseId(id: string): boolean {
  return id.startsWith(UK_BASE_ID_PREFIX);
}

/**
 * One shard row is a tuple, not an object: the bodies are machine-generated and
 * the map fetches them while the user pans, so repeating six keys across the
 * country-wide pack is paid for in the one place that matters.
 * `[osmRef, name, address, lat, lng, curatedVenueId]`.
 */
type ShardRow = [string, string, string, number, number, string];

function isShardRow(value: unknown): value is ShardRow {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    typeof value[0] === "string" &&
    value[0].length > 0 &&
    typeof value[1] === "string" &&
    value[1].length > 0 &&
    typeof value[2] === "string" &&
    typeof value[3] === "number" &&
    Number.isFinite(value[3]) &&
    typeof value[4] === "number" &&
    Number.isFinite(value[4]) &&
    typeof value[5] === "string"
  );
}

/**
 * Parse a shard body into pubs, dropping malformed rows rather than letting a
 * drifted refresh poison the map (same defensiveness as lib/venuesSlim.ts).
 */
export function parseUkBaseShard(value: unknown): UkBasePub[] {
  if (typeof value !== "object" || value === null) return [];
  const rows = (value as Record<string, unknown>).pubs;
  if (!Array.isArray(rows)) return [];
  const pubs: UkBasePub[] = [];
  for (const row of rows) {
    if (!isShardRow(row)) continue;
    pubs.push({
      id: ukBaseIdFor(row[0]),
      name: row[1],
      address: row[2],
      lat: row[3],
      lng: row[4],
      curatedVenueId: row[5],
    });
  }
  return pubs;
}

export function parseUkBaseShardForEntry(
  value: unknown,
  entry: ShardEntry,
): UkBasePub[] | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== UK_BASE_SHARD_VERSION ||
    record.cell !== entry.id ||
    !Array.isArray(record.pubs) ||
    record.pubs.length !== entry.count
  ) {
    return null;
  }
  const pubs = parseUkBaseShard(value);
  return pubs.length === entry.count ? pubs : null;
}

export function parseUkBaseManifest(value: unknown): ShardManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.urlPrefix !== "string" ||
    !UK_BASE_URL_PREFIX.test(manifest.urlPrefix) ||
    !Array.isArray(manifest.shards)
  ) {
    return null;
  }
  const shards: Record<string, unknown>[] = [];
  for (const raw of manifest.shards) {
    if (typeof raw !== "object" || raw === null || "url" in raw) return null;
    const shard = raw as Record<string, unknown>;
    if (
      typeof shard.id !== "string" ||
      !shard.id ||
      shard.id.includes("/") ||
      shard.id.includes("\\") ||
      shard.id.includes("..")
    ) {
      return null;
    }
    shards.push({
      ...shard,
      url: `${manifest.urlPrefix}${shard.id}.json`,
    });
  }
  return parseShardManifest({ ...manifest, shards });
}

/**
 * How many cell bodies stay resident. Twelve covers a wide desktop viewport
 * (~3-4 cells at the zoom gate), ordinary pad neighbours, and a short long-pan
 * trail so a reverse swipe does not blank, without holding the country-wide
 * pack (605 cells). Cap stays ≤12 so residency cannot quietly become "download
 * the UK"; the prune path still refuses to drop a cell the current draw set
 * needs.
 */
export const MAX_RESIDENT_SHARDS = 12;

/**
 * Viewport padding, as a fraction of the viewport's own span, applied before
 * choosing cells. Pubs just off-screen are fetched before they are panned to,
 * so a slow pan reveals pins rather than a blank strip that fills in late.
 */
export const BOUNDS_PAD_RATIO = 0.35;

/**
 * Extra pad applied only on the leading edges of a detected pan, as a fraction
 * of the viewport span. Ordinary BOUNDS_PAD_RATIO covers a slow nudge; this
 * covers a sustained swipe so the next cell is already in flight before the
 * camera settles on it. Kept below one full viewport so a long pan still pays
 * per settle rather than prefetching a corridor down the country.
 */
export const PAN_AHEAD_PAD_RATIO = 0.5;

/**
 * Max neighbour shards warmed beyond the drawn (padded) viewport on one settle.
 * Prefetch only fills residency; it does not widen the GeoJSON source, so pin
 * count and payload stay honest to what the camera covers.
 */
export const MAX_PAN_PREFETCH_SHARDS = 2;

/** Centre drift below this (degrees) is treated as zoom-only, not a pan. */
export const PAN_EPSILON_DEG = 1e-5;

export type PanDelta = { dLng: number; dLat: number };

export function padBounds(bounds: MapBounds, ratio = BOUNDS_PAD_RATIO): MapBounds {
  const lonPad = Math.abs(bounds.east - bounds.west) * ratio;
  const latPad = Math.abs(bounds.north - bounds.south) * ratio;
  return {
    west: bounds.west - lonPad,
    east: bounds.east + lonPad,
    south: bounds.south - latPad,
    north: bounds.north + latPad,
  };
}

export function boundsCenter(bounds: MapBounds): { lat: number; lng: number } {
  return {
    lat: (bounds.south + bounds.north) / 2,
    lng: (bounds.west + bounds.east) / 2,
  };
}

/**
 * Camera centre delta between two settles. Null when there is no previous
 * settle or the centre barely moved (a zoom-only settle must not stretch pad
 * along a ghost pan).
 */
export function panDeltaBetween(
  previous: MapBounds | null,
  next: MapBounds,
): PanDelta | null {
  if (!previous) return null;
  const from = boundsCenter(previous);
  const to = boundsCenter(next);
  const dLng = to.lng - from.lng;
  const dLat = to.lat - from.lat;
  if (Math.abs(dLng) < PAN_EPSILON_DEG && Math.abs(dLat) < PAN_EPSILON_DEG) {
    return null;
  }
  return { dLng, dLat };
}

/**
 * Ordinary viewport pad, then stretch the leading edges when the camera is
 * mid-pan so the next cell intersects the prefetch window before it enters the
 * draw pad.
 */
export function padBoundsForPan(
  bounds: MapBounds,
  pan: PanDelta | null,
  padRatio = BOUNDS_PAD_RATIO,
  panAheadRatio = PAN_AHEAD_PAD_RATIO,
): MapBounds {
  const padded = padBounds(bounds, padRatio);
  if (!pan) return padded;
  const lonSpan = Math.abs(bounds.east - bounds.west);
  const latSpan = Math.abs(bounds.north - bounds.south);
  const aheadLon = lonSpan * panAheadRatio;
  const aheadLat = latSpan * panAheadRatio;
  return {
    west: padded.west - (pan.dLng < 0 ? aheadLon : 0),
    east: padded.east + (pan.dLng > 0 ? aheadLon : 0),
    south: padded.south - (pan.dLat < 0 ? aheadLat : 0),
    north: padded.north + (pan.dLat > 0 ? aheadLat : 0),
  };
}

/**
 * Pick up to `budget` shards that sit in the pan-ahead pad but are not already
 * in the draw set. Pure: no fetch. Used to warm residency without widening the
 * drawn source to the trail behind the camera.
 */
export function selectPanPrefetchShards(
  shards: readonly ShardEntry[],
  drawnUrls: ReadonlySet<string>,
  panPad: MapBounds,
  budget = MAX_PAN_PREFETCH_SHARDS,
): ShardEntry[] {
  if (budget <= 0) return [];
  const out: ShardEntry[] = [];
  for (const shard of shards) {
    if (drawnUrls.has(shard.url)) continue;
    if (!bboxIntersects(shard.bbox, panPad)) continue;
    out.push(shard);
    if (out.length >= budget) break;
  }
  return out;
}

export type UkBaseLoader = {
  /**
   * Every base pub from the cells covering `bounds`, fetching the ones that are
   * not resident. Returns the WHOLE viewport's set (not just the new cells), so
   * a caller can hand the result straight to a map source. Never throws. A read
   * that cannot load every drawn cell is unavailable, never ready-empty, and
   * failed cells are retried on the next call.
   * On a sustained pan, neighbour cells along the pan direction are warmed into
   * residency (up to MAX_PAN_PREFETCH_SHARDS) but not returned here.
   */
  pubsForBounds(bounds: MapBounds): Promise<UkBaseViewportRead>;
  /** A resident pub by id, for the sheet a tap opens. Null when not resident. */
  find(id: string): UkBasePub | null;
  /**
   * Resolve a `venue-uk-*` id without waiting for the current viewport stream.
   * Uses residency first; with a location hint, fetches the one cell that
   * contains the point. Without a hint (or when the hint's cell does not carry
   * the id), returns null so the caller can fail closed or ask the server.
   */
  restorePub(
    id: string,
    hint?: { lat: number; lng: number } | null,
  ): Promise<UkBasePub | null>;
};

export type UkBaseViewportRead = {
  status: "ready" | "unavailable";
  pubs: UkBasePub[];
};

export type UkBaseStreamStatus =
  | "zoom_required"
  | "loading"
  | "ready"
  | "unavailable"
  | "suspended";

type UkBaseShardRead = UkBaseViewportRead;

const MANIFEST_OFFLINE_KEY = "uk_base_manifest:v1";

/**
 * Build the loader. One per map instance; state (manifest promise + resident
 * shards) is private to it.
 *
 * Offline: the MANIFEST is mirrored to IndexedDB because without it no cell can
 * be addressed at all. Cell bodies are not mirrored - public/sw.js already
 * serves `/data/*.json` stale-while-revalidate, and duplicating the whole shard pack into
 * IndexedDB to re-paint a layer that carries no prices is not worth the quota.
 */
export function createUkBaseLoader(): UkBaseLoader {
  let manifestPromise: Promise<ShardManifest | null> | null = null;
  // Insertion-ordered LRU: re-reading a shard moves it to the back.
  const resident = new Map<string, UkBasePub[]>();
  // In-flight fetches, so a burst of moveends cannot stack duplicate requests.
  const inFlight = new Map<string, Promise<UkBaseShardRead>>();
  // Previous settle, for pan-direction prefetch. Null until the first call.
  let lastBounds: MapBounds | null = null;

  async function fetchManifest(): Promise<ShardManifest | null> {
    try {
      const response = await fetch(UK_BASE_MANIFEST_PATH);
      if (!response.ok) {
        discardBody(response);
        throw new Error(`HTTP ${response.status}`);
      }
      const payload: unknown = await response.json();
      const parsed = parseUkBaseManifest(payload);
      if (parsed) void offlineCache.set(MANIFEST_OFFLINE_KEY, payload);
      return parsed;
    } catch {
      return parseUkBaseManifest(
        await offlineCache.get<unknown>(MANIFEST_OFFLINE_KEY),
      );
    }
  }

  function manifest(): Promise<ShardManifest | null> {
    if (!manifestPromise) {
      // A null resolution (offline first crossing, no IndexedDB mirror yet) is
      // NOT memoized: the next call refetches, matching how shard-body
      // failures already retry, so a transient failure never kills the layer
      // for the whole map session.
      manifestPromise = fetchManifest().then((parsed) => {
        if (!parsed) manifestPromise = null;
        return parsed;
      });
    }
    return manifestPromise;
  }

  function touch(url: string, pubs: UkBasePub[]): void {
    resident.delete(url);
    resident.set(url, pubs);
  }

  /**
   * Evict least-recently-used cells back to the cap, but never one the current
   * viewport still needs - a wide desktop camera can straddle more cells than
   * the cap, and dropping one it is painting would thrash it straight back.
   */
  function prune(keep: Set<string>): void {
    for (const url of [...resident.keys()]) {
      if (resident.size <= MAX_RESIDENT_SHARDS) break;
      if (keep.has(url)) continue;
      resident.delete(url);
    }
  }

  function loadShard(entry: ShardEntry): Promise<UkBaseShardRead> {
    const cached = resident.get(entry.url);
    if (cached) {
      touch(entry.url, cached);
      return Promise.resolve({ status: "ready", pubs: cached });
    }
    const pending = inFlight.get(entry.url);
    if (pending) return pending;
    const request = fetch(entry.url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const pubs = parseUkBaseShardForEntry(await response.json(), entry);
        if (!pubs) throw new Error("Invalid UK base shard");
        touch(entry.url, pubs);
        return { status: "ready" as const, pubs };
      })
      .catch(() => ({ status: "unavailable" as const, pubs: [] }))
      .finally(() => {
        inFlight.delete(entry.url);
      });
    inFlight.set(entry.url, request);
    return request;
  }

  function findResident(id: string): UkBasePub | null {
    if (!isUkBaseId(id)) return null;
    for (const pubs of resident.values()) {
      const hit = pubs.find((pub) => pub.id === id);
      if (hit) return hit;
    }
    return null;
  }

  return {
    async pubsForBounds(bounds: MapBounds): Promise<UkBaseViewportRead> {
      const loaded = await manifest();
      if (!loaded) return { status: "unavailable", pubs: [] };
      const pan = panDeltaBetween(lastBounds, bounds);
      lastBounds = bounds;
      const drawPad = padBounds(bounds);
      const drawEntries = loaded.shards.filter((shard) =>
        bboxIntersects(shard.bbox, drawPad),
      );
      if (drawEntries.length === 0) return { status: "ready", pubs: [] };
      const drawUrls = new Set(drawEntries.map((entry) => entry.url));
      const prefetchEntries = selectPanPrefetchShards(
        loaded.shards,
        drawUrls,
        padBoundsForPan(bounds, pan),
      );
      const results = await Promise.all([
        ...drawEntries.map(loadShard),
        ...prefetchEntries.map(loadShard),
      ]);
      prune(
        new Set([
          ...drawUrls,
          ...prefetchEntries.map((entry) => entry.url),
        ]),
      );
      const drawn = results.slice(0, drawEntries.length);
      return {
        status: drawn.some((result) => result.status === "unavailable")
          ? "unavailable"
          : "ready",
        pubs: drawn.flatMap((result) => result.pubs),
      };
    },

    find(id: string): UkBasePub | null {
      return findResident(id);
    },

    async restorePub(
      id: string,
      hint: { lat: number; lng: number } | null = null,
    ): Promise<UkBasePub | null> {
      if (!isUkBaseId(id)) return null;
      const residentHit = findResident(id);
      if (residentHit) return residentHit;
      if (
        !hint ||
        !Number.isFinite(hint.lat) ||
        !Number.isFinite(hint.lng) ||
        Math.abs(hint.lat) > 90 ||
        Math.abs(hint.lng) > 180
      ) {
        return null;
      }
      const loaded = await manifest();
      if (!loaded) return null;
      const entry = loaded.shards.find((shard) =>
        bboxContainsPoint(shard.bbox, hint.lat, hint.lng),
      );
      if (!entry) return null;
      const { pubs } = await loadShard(entry);
      prune(new Set([entry.url]));
      return pubs.find((pub) => pub.id === id) ?? null;
    },
  };
}

/**
 * Base pubs → GeoJSON for the `uk-base` source. Points only, and deliberately
 * no price/bucket/story properties: there is nothing on a base pub for the
 * price-colour system to read, and inventing a property would invite exactly
 * the fake-parity styling this layer exists to avoid.
 *
 * The whole record rides in the feature so a tap can open the sheet straight
 * from what MapLibre hands back, with no second lookup.
 */
export function ukBasePubsToGeoJSON(
  pubs: UkBasePub[],
  provisionalVenueIds: ReadonlySet<string> | null = null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pubs.map((pub) => ({
      type: "Feature" as const,
      properties: {
        id: pub.id,
        name: pub.name,
        address: pub.address,
        curatedVenueId: pub.curatedVenueId,
        provisional: Boolean(provisionalVenueIds?.has(pub.id)),
      },
      geometry: { type: "Point" as const, coordinates: [pub.lng, pub.lat] },
    })),
  };
}

export function ukBasePubsForDrawableVenues(
  pubs: UkBasePub[],
  drawableVenueIds: ReadonlySet<string>,
): UkBasePub[] {
  return pubs.filter(
    (pub) =>
      !pub.curatedVenueId || !drawableVenueIds.has(pub.curatedVenueId),
  );
}

/** Recover a base pub from a rendered `uk-base-point` feature. Null if it isn't one. */
export function ukBasePubFromFeature(feature: {
  properties?: GeoJSON.GeoJsonProperties;
  geometry?: GeoJSON.Geometry;
}): UkBasePub | null {
  const props = feature.properties;
  const geometry = feature.geometry;
  if (!props || geometry?.type !== "Point") return null;
  const { id, name, address, curatedVenueId } = props;
  if (typeof id !== "string" || !isUkBaseId(id)) return null;
  if (typeof name !== "string" || name.length === 0) return null;
  const [lng, lat] = geometry.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return {
    id,
    name,
    address: typeof address === "string" ? address : "",
    lat,
    lng,
    curatedVenueId: typeof curatedVenueId === "string" ? curatedVenueId : "",
  };
}
