// GET /api/citymcp/things-to-do?window=tonight|tomorrow_night|this_weekend
//                                &area=&kinds=a,b&price=any|cheap|free&limit=
//
// Thin CityMCP London `things_to_do` proxy — cached curated opportunities for
// a plan window. The window enum is validated (defaults to `tonight`), the
// list is capped, and unknown `price` / `kinds` values are dropped rather
// than 400-ing so the "Tonight nearby" lane always renders.
//
// Fail-soft: any upstream failure lands as 200 + `{ error, opportunities: [] }`.

import { publicApiError } from "@/lib/apiError";
import {
  CityMcpError,
  fetchThingsToDo,
  THINGS_TO_DO_WINDOWS,
  type ThingsToDoKind,
  type ThingsToDoPrice,
  type ThingsToDoResult,
  type ThingsToDoWindow,
} from "@/lib/citymcp/client";
import { enrichOpportunityLocations } from "@/lib/citymcp/enrichOpportunityLocations";
import { isCityMcpLimited } from "@/lib/citymcpRateLimit";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;
const MAX_AREA_LEN = 60;
const CACHE_MAX_AGE_S = 120;
const CACHE_STALE_WHILE_REVALIDATE_S = 600;

const ALLOWED_KINDS = new Set<ThingsToDoKind>([
  "exhibition",
  "gig",
  "comedy",
  "theatre",
  "popup",
  "food_drink",
  "market",
  "family",
  "talk",
  "nightlife",
  "free_event",
  "other",
]);

const ALLOWED_PRICES = new Set<ThingsToDoPrice>(["any", "cheap", "free"]);

function jsonResponse(
  body: unknown,
  opts: { status?: number; cache?: boolean } = {},
): Response {
  const { status = 200, cache = false } = opts;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
        ? `public, s-maxage=${CACHE_MAX_AGE_S}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_S}`
        : "no-store",
    },
  });
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseWindow(raw: string | null): ThingsToDoWindow | null {
  if (!raw) return "tonight";
  const trimmed = raw.trim();
  if ((THINGS_TO_DO_WINDOWS as readonly string[]).includes(trimmed)) {
    return trimmed as ThingsToDoWindow;
  }
  return null;
}

function parseKinds(raw: string | null): ThingsToDoKind[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const kinds = parts.filter((k): k is ThingsToDoKind =>
    ALLOWED_KINDS.has(k as ThingsToDoKind),
  );
  return kinds.length > 0 ? kinds : undefined;
}

function parsePrice(raw: string | null): ThingsToDoPrice | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase() as ThingsToDoPrice;
  return ALLOWED_PRICES.has(v) ? v : undefined;
}

export const GET = withRouteTiming("citymcp/things-to-do", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isCityMcpLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      compatibilityFields: { opportunities: [] },
    });
  }

  const params = new URL(request.url).searchParams;

  const windowParam = parseWindow(params.get("window"));
  if (!windowParam) {
    return publicApiError(
      `window must be one of ${THINGS_TO_DO_WINDOWS.join(", ")}.`,
      "INVALID_REQUEST",
      400,
      { compatibilityFields: { opportunities: [] } },
    );
  }

  const areaRaw = params.get("area")?.trim() ?? "";
  const area =
    areaRaw.length > 0 && areaRaw.length <= MAX_AREA_LEN ? areaRaw : undefined;
  const kinds = parseKinds(params.get("kinds"));
  const price = parsePrice(params.get("price"));
  const limit = parseLimit(params.get("limit"));

  let result: ThingsToDoResult;
  try {
    result = await fetchThingsToDo({
      window: windowParam,
      ...(area ? { area } : {}),
      ...(kinds ? { kinds } : {}),
      ...(price ? { price } : {}),
      limit,
    });
  } catch (err) {
    const message =
      err instanceof CityMcpError ? err.message : "CityMCP request failed";
    return jsonResponse({
      window: windowParam,
      area: area ?? null,
      asOf: null,
      opportunities: [],
      error: message,
    });
  }

  // Resolve missing place.location via search_places so map pins can render.
  // Fail-soft: enrichment errors leave the upstream rows as-is.
  try {
    const enriched = await enrichOpportunityLocations(result.opportunities);
    result = { ...result, opportunities: enriched };
  } catch {
    // Keep un-enriched opportunities.
  }

  const stale = result.stale === true;
  return jsonResponse(
    {
      window: result.window,
      area: result.area ?? null,
      asOf: result.asOf ?? null,
      opportunities: result.opportunities,
      ...(stale ? { stale: true } : {}),
    },
    // A stale last-known-good answer is served no-store so the edge never pins
    // it and the next request re-attempts a live refresh.
    { cache: !stale },
  );
}
