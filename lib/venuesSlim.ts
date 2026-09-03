// Client-safe loader for the SLIM venue index (public/data/venues_slim.json,
// built by scripts/build_slim_index.mjs). This is the minimum the map needs to
// render pins + labels + price colour + filter hints: the map fetches THIS
// (~400 KB) on load
// instead of the heavier source datasets, and fetches per-venue detail lazily
// via /api/venue/[id] only when a venue is opened.
//
// Legacy pub ids remain byte-identical to the "venue-…" ids groupVenuePrices
// produces, while curated rows retain their governed seed ids. In both cases a
// slim pin deep-links and fetches detail through the same canonical id.
//
// Mirrors lib/pois.ts#loadPois defensiveness: hand/refresh-generated JSON can
// drift, so malformed rows are dropped rather than allowed to poison the map.
//
// Offline (issue #32): the service worker caches the /data/… bytes; on top of
// that, every COMPLETE load is mirrored into IndexedDB (lib/offlineCache.ts)
// so a fetch that fails ENTIRELY (no SW yet, dead cellar signal on a cold tab)
// can still return the last parsed index instead of an empty map. A payload
// that dropped malformed rows is never stored: a later fetch failure would
// otherwise treat a truncated index as the whole city.

import { discardBody } from "@/lib/responseBody";
import { takeEarlyWarmJson } from "@/lib/mapEarlyWarm";
import { getCity, type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { isFoodCategory, type FoodCategory } from "@/lib/food";
import { offlineCache } from "@/lib/offlineCache";
import { isVenueKind, type VenueFilterHints, type VenueKind } from "@/lib/venues";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

const OFFLINE_KEY_PREFIX = "venues_slim:v2";
/** London legacy path — kept for back-compat with existing caches and tests. */
export const SLIM_VENUES_PATH = "/data/venues_slim.json";
const MAP_DATA_REVISION = process.env.NEXT_PUBLIC_SW_VERSION?.trim() ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error("A deploy revision is required for production map data");
      })()
    : "local");
const slimLoadPromises = new Map<string, Promise<SlimVenueLoadResult>>();

function offlineKeyForPath(path: string): string {
  return path === SLIM_VENUES_PATH
    ? OFFLINE_KEY_PREFIX
    : `${OFFLINE_KEY_PREFIX}:${path}`;
}

export type SlimVenue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  borough: string;
  /**
   * Nearest-station TfL fare zone (1–6, occasionally 7–9 at the London edge).
   * Absent when no station was comparable — honestly unknown, never bucketed.
   */
  zone?: number;
  filterHints?: VenueFilterHints;
  /** Absent means pub, preserving existing payloads and offline caches. */
  kind?: VenueKind;
  /** Type-relative price band for famous non-pub venue anchors. */
  priceBand?: 0 | 1 | 2;
  anchorLabel?: string;
  anchorCourse?: FoodCategory;
  anchorObservedAt?: string;
  anchorSourceUrl?: string;
};

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isFilterHints(value: unknown): value is VenueFilterHints {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.searchText !== "string") return false;
  if (typeof row.amenities !== "object" || row.amenities === null) return false;
  if (typeof row.curation !== "object" || row.curation === null) return false;
  const amenities = row.amenities as Record<string, unknown>;
  const curation = row.curation as Record<string, unknown>;
  // Optional soft arrays (Wave C drink lens + Wave E cuisine tags).
  if (row.cuisineTags !== undefined && !isStringArray(row.cuisineTags))
    return false;
  if (row.drinkCategories !== undefined && !isStringArray(row.drinkCategories))
    return false;
  if (row.drinkBrands !== undefined && !isStringArray(row.drinkBrands))
    return false;
  if (row.drinkSubtypes !== undefined && !isStringArray(row.drinkSubtypes))
    return false;
  if (row.drinkText !== undefined && typeof row.drinkText !== "string")
    return false;
  if (row.topShelf !== undefined && !isBoolean(row.topShelf)) return false;
  if (row.scraped !== undefined && !isBoolean(row.scraped)) return false;
  return (
    isBoolean(amenities.food) &&
    isBoolean(amenities.cocktails) &&
    isBoolean(amenities.beerGarden) &&
    isBoolean(amenities.liveSports) &&
    isBoolean(amenities.nonAlcoholic) &&
    isBoolean(curation.nearWater) &&
    isBoolean(curation.hasStory) &&
    isBoolean(row.canonical)
  );
}

function hasValidAnchor(row: Record<string, unknown>): boolean {
  const hasAnyAnchor =
    row.anchorLabel !== undefined ||
    row.anchorObservedAt !== undefined ||
    row.anchorSourceUrl !== undefined;
  const courseOk =
    row.kind === "restaurant"
      ? isFoodCategory(row.anchorCourse)
      : row.anchorCourse === undefined || isFoodCategory(row.anchorCourse);
  const hasCompleteAnchor =
    courseOk &&
    typeof row.anchorLabel === "string" &&
    row.anchorLabel.trim().length > 0 &&
    typeof row.anchorObservedAt === "string" &&
    row.anchorObservedAt.trim().length > 0 &&
    typeof row.anchorSourceUrl === "string" &&
    row.anchorSourceUrl.trim().length > 0;

  return row.kind === "bar" || row.kind === "food" || row.kind === "restaurant"
    ? hasCompleteAnchor
    : !hasAnyAnchor || hasCompleteAnchor;
}

// Light runtime guard: a row must have a non-empty id + name, finite coords, a
// borough string, and a cheapestPrice that is either a finite number or null.
function isValidSlimVenue(value: unknown): value is SlimVenue {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length === 0) return false;
  if (typeof row.name !== "string" || row.name.length === 0) return false;
  if (typeof row.borough !== "string") return false;
  if (typeof row.lat !== "number" || !Number.isFinite(row.lat)) return false;
  if (typeof row.lng !== "number" || !Number.isFinite(row.lng)) return false;
  const price = row.cheapestPrice;
  const priceOk =
    price === null || (typeof price === "number" && Number.isFinite(price));
  // zone, when present, must be a positive integer (fare zone). Absent is fine.
  const zoneOk =
    row.zone === undefined ||
    (typeof row.zone === "number" &&
      Number.isInteger(row.zone) &&
      row.zone > 0);
  const kindOk = row.kind === undefined || isVenueKind(row.kind);
  const priceBandOk =
    row.priceBand === undefined ||
    row.priceBand === 0 ||
    row.priceBand === 1 ||
    row.priceBand === 2;
  return (
    priceOk &&
    zoneOk &&
    kindOk &&
    priceBandOk &&
    hasValidAnchor(row) &&
    (row.filterHints === undefined || isFilterHints(row.filterHints))
  );
}

// Normalise each surviving row to exactly the SlimVenue shape so no stray
// dataset field ever rides along into the client render path. Applied to BOTH
// the network payload and the IndexedDB fallback (a stored payload from an
// older build gets the same distrust as fresh JSON).
function normalizeRows(data: unknown): SlimVenue[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isValidSlimVenue).map((venue) => ({
    id: venue.id,
    name: venue.name,
    lat: venue.lat,
    lng: venue.lng,
    cheapestPrice: venue.cheapestPrice,
    borough: venue.borough,
    ...(venue.zone !== undefined ? { zone: venue.zone } : {}),
    ...(venue.filterHints ? { filterHints: venue.filterHints } : {}),
    ...(venue.kind !== undefined ? { kind: venue.kind } : {}),
    ...(venue.priceBand !== undefined ? { priceBand: venue.priceBand } : {}),
    ...(venue.anchorLabel !== undefined
      ? { anchorLabel: venue.anchorLabel }
      : {}),
    ...(venue.anchorCourse !== undefined
      ? { anchorCourse: venue.anchorCourse }
      : {}),
    ...(venue.anchorObservedAt !== undefined
      ? { anchorObservedAt: venue.anchorObservedAt }
      : {}),
    ...(venue.anchorSourceUrl !== undefined
      ? { anchorSourceUrl: venue.anchorSourceUrl }
      : {}),
  }));
}

/**
 * Fetches a slim venue index from an explicit public path (client-side).
 * Malformed rows are filtered out so callers always get a clean SlimVenue[];
 * a non-array payload yields [] so the map degrades to "no pins" rather than
 * throwing.
 *
 * Offline: a complete load is mirrored to IndexedDB (fire-and-forget); if the
 * fetch itself fails, the last mirrored index for that path is returned
 * instead. A payload that dropped malformed rows is unavailable and is not
 * cached. Only when there is no fallback either does the original error
 * propagate. That preserves the pre-offline contract for callers that show a
 * load-error state.
 */
export type SlimVenueLoadOptions = {
  bypassInFlight?: boolean;
  expectedRevision?: string;
};

export type SlimVenueLoadResult = {
  rows: SlimVenue[];
  status: "ready" | "unavailable";
};

function directMonolithRequest(path: string): {
  path: string;
  options: SlimVenueLoadOptions;
} {
  if (MAP_DATA_REVISION === "local") return { path, options: {} };
  return {
    path: `${path}?v=${encodeURIComponent(MAP_DATA_REVISION)}`,
    options: { expectedRevision: MAP_DATA_REVISION },
  };
}

async function readSlimPayload(
  path: string,
  options: SlimVenueLoadOptions = {},
  cache: RequestCache = "default",
): Promise<unknown> {
  let earlyPayloadRejected = false;
  const early =
    cache === "no-store" || options.bypassInFlight
      ? undefined
      : takeEarlyWarmJson(path);
  if (early) {
    try {
      return await early;
    } catch {
      earlyPayloadRejected = true;
    }
  }
  const response = earlyPayloadRejected || cache === "no-store"
    ? await fetch(path, { cache: "no-store" })
    : await fetch(path);
  if (!response.ok) {
    discardBody(response);
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function rowsFromPayload(
  value: unknown,
  expectedRevision?: string,
): unknown[] | null {
  const rows = rowsFromSlimPayload(value);
  if (!rows) return null;
  if (expectedRevision === undefined) return rows;
  if (Array.isArray(value) || typeof value !== "object" || value === null) return null;
  const revision = (value as { revision?: unknown }).revision;
  return revision === expectedRevision ? rows : null;
}

function normalizedRowsFromPayload(
  value: unknown,
  expectedRevision?: string,
): { rows: SlimVenue[]; complete: boolean } | null {
  const payloadRows = rowsFromPayload(value, expectedRevision);
  if (!payloadRows) return null;
  const rows = normalizeRows(payloadRows);
  return { rows, complete: rows.length === payloadRows.length };
}

async function readOfflineFallback(
  offlineKey: string,
  expectedRevision?: string,
): Promise<SlimVenue[] | null> {
  const stored = await offlineCache.get<unknown>(offlineKey);
  const payload = normalizedRowsFromPayload(stored, expectedRevision);
  return payload?.complete && payload.rows.length > 0 ? payload.rows : null;
}

export function loadSlimVenuesFromPathResult(
  path: string,
  options: SlimVenueLoadOptions = {},
): Promise<SlimVenueLoadResult> {
  if (!options.bypassInFlight) {
    const inFlight = slimLoadPromises.get(path);
    if (inFlight) return inFlight;
  }

  const pending = loadSlimVenuesFromPathUnshared(path, options);
  slimLoadPromises.set(path, pending);
  const clearInFlight = () => {
    if (slimLoadPromises.get(path) === pending) slimLoadPromises.delete(path);
  };
  void pending.then(clearInFlight, clearInFlight);
  return pending;
}

export async function loadSlimVenuesFromPath(
  path: string,
  options: SlimVenueLoadOptions = {},
): Promise<SlimVenue[]> {
  const result = await loadSlimVenuesFromPathResult(path, options);
  return result.rows;
}

async function loadSlimVenuesFromPathUnshared(
  path: string,
  options: SlimVenueLoadOptions = {},
): Promise<SlimVenueLoadResult> {
  const offlineKey = offlineKeyForPath(path);
  try {
    let data: unknown = await readSlimPayload(path, options);
    let payload = normalizedRowsFromPayload(data, options.expectedRevision);
    if (
      options.expectedRevision !== undefined &&
      (!payload || !payload.complete)
    ) {
      data = await readSlimPayload(path, options, "no-store");
      payload = normalizedRowsFromPayload(data, options.expectedRevision);
    }
    if (
      !payload ||
      (options.expectedRevision !== undefined && !payload.complete)
    ) {
      const fallback = await readOfflineFallback(
        offlineKey,
        options.expectedRevision,
      );
      if (fallback) return { rows: fallback, status: "ready" };
      return { rows: [], status: "unavailable" };
    }
    const { rows, complete } = payload;
    if (complete && rows.length > 0) {
      const stored = options.expectedRevision
        ? { revision: options.expectedRevision, rows }
        : rows;
      void offlineCache.set(offlineKey, stored);
    }
    return {
      rows,
      status: complete ? "ready" : "unavailable",
    };
  } catch (error) {
    const fallback = await readOfflineFallback(
      offlineKey,
      options.expectedRevision,
    );
    if (fallback) return { rows: fallback, status: "ready" };
    throw error;
  }
}

/**
 * London default loader — same contract as before multi-city routing.
 */
export async function loadSlimVenues(): Promise<SlimVenue[]> {
  const request = directMonolithRequest(SLIM_VENUES_PATH);
  return loadSlimVenuesFromPath(request.path, request.options);
}

/**
 * City-aware slim loader. Uses CityConfig.slimVenuesPath so non-London maps
 * hit `/data/cities/{id}/venues_slim.json` without 404ing on London paths.
 */
export async function loadSlimVenuesForCity(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): Promise<SlimVenue[]> {
  const city = getCity(cityId);
  const request = directMonolithRequest(city.slimVenuesPath);
  return loadSlimVenuesFromPath(request.path, request.options);
}

export function loadSlimVenuesForCityResult(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): Promise<SlimVenueLoadResult> {
  const city = getCity(cityId);
  const request = directMonolithRequest(city.slimVenuesPath);
  return loadSlimVenuesFromPathResult(request.path, request.options);
}
