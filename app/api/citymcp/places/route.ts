// GET /api/citymcp/places?q=...&limit=5&openNow=true&minRating=4&maxPrice=££&sort=rating
//
// Thin CityMCP London `search_places` proxy. Returns a small array of place
// rows for scanning — never the full Google Places dossier. Fail-soft:
// upstream errors surface as a 200 with `{ error, places: [] }` (except a
// missing/invalid `q`, which is a client mistake and gets a 400).

import { publicApiError } from "@/lib/apiError";
import {
  CityMcpError,
  searchCityPlaces,
  type SearchCityPlacesOpts,
  type SearchPlacesRow,
} from "@/lib/citymcp/client";
import { isCityMcpLimited } from "@/lib/citymcpRateLimit";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MAX_QUERY_LEN = 200;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// Optional filter params are refinements, not contracts: anything malformed
// is silently dropped (never a 400, never forwarded upstream) so a bad
// querystring can't break the lanes that call this route.

function parseBoolean(raw: string | null): boolean | undefined {
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

const MIN_RATING_FLOOR = 0;
const MIN_RATING_CEIL = 5;

function parseMinRating(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  if (n < MIN_RATING_FLOOR || n > MIN_RATING_CEIL) return undefined;
  return n;
}

const MAX_PRICE_VALUES = ["free", "£", "££", "£££", "££££"] as const;

function parseMaxPrice(raw: string | null): SearchCityPlacesOpts["maxPrice"] {
  if (!raw) return undefined;
  return (MAX_PRICE_VALUES as readonly string[]).includes(raw)
    ? (raw as SearchCityPlacesOpts["maxPrice"])
    : undefined;
}

const SORT_VALUES = ["relevance", "rating", "random"] as const;

function parseSort(raw: string | null): SearchCityPlacesOpts["sort"] {
  if (!raw) return undefined;
  return (SORT_VALUES as readonly string[]).includes(raw)
    ? (raw as SearchCityPlacesOpts["sort"])
    : undefined;
}

function thinRow(row: SearchPlacesRow): SearchPlacesRow {
  // Only return fields we've documented as safe for the UI. Especially, do NOT
  // invent hygiene scores or Order URLs (see task constraints); those come
  // from `get_place` with deep:true if we ever need them.
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    location: row.location,
    types: Array.isArray(row.types) ? row.types.slice(0, 6) : undefined,
    rating: typeof row.rating === "number" ? row.rating : undefined,
    userRatingCount:
      typeof row.userRatingCount === "number" ? row.userRatingCount : undefined,
    priceBand: row.priceBand,
    openNow: row.openNow,
  };
}

export const GET = withRouteTiming("citymcp/places", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isCityMcpLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true, compatibilityFields: { places: [] } });
  }

  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  if (q.length === 0) {
    return publicApiError("Add a search term.", "INVALID_REQUEST", 400);
  }
  if (q.length > MAX_QUERY_LEN) {
    return publicApiError("q is too long.", "INVALID_REQUEST", 400);
  }
  const limit = parseLimit(params.get("limit"));
  const openNow = parseBoolean(params.get("openNow"));
  const minRating = parseMinRating(params.get("minRating"));
  const maxPrice = parseMaxPrice(params.get("maxPrice"));
  const sort = parseSort(params.get("sort"));

  try {
    const places = await searchCityPlaces(q, {
      limit,
      ...(openNow !== undefined ? { openNow } : {}),
      ...(minRating !== undefined ? { minRating } : {}),
      ...(maxPrice !== undefined ? { maxPrice } : {}),
      ...(sort !== undefined ? { sort } : {}),
    });
    return jsonResponse({ places: places.map(thinRow) });
  } catch (err) {
    const message =
      err instanceof CityMcpError ? err.message : "CityMCP request failed";
    return jsonResponse({ places: [], error: message });
  }
}
