// GET /api/walk-route?stops=lng,lat;lng,lat;...
//
// Turns an ordered crawl's stop coordinates into ONE drawable LineString that
// follows real walking roads. Per leg: serve the cached routed geometry, else
// route it through OpenRouteService foot-walking (server-side ORS_API_KEY), else
// fall back to the straight segment. Stitched into a single line with a `source`
// flag ("ors" only when every leg routed, "straight" otherwise) so the map
// draws it SOLID only for a complete road route and DASHED for any approximate
// fallback.
//
// ALWAYS 200 with a drawable line (fail-soft, never blocks the map). Keyless is
// the documented default: no ORS_API_KEY ⇒ the straight fallback, no network.
// A GET (stops in the query) keeps this off the social write-surface fence — it
// reads and caches routed geometry, it is not a user-content write.
//
// RATE LIMIT: this endpoint is public and, with a key set, ONE request fans out
// to up to WALK_ROUTE_MAX_STOPS-1 ORS calls. So it carries the house per-client
// limiter (lib/pintDrops isLimited, keyed on the hashed client IP, same seam as
// /api/plans/generate) at WALK_ROUTE_RATE_LIMIT requests per
// WALK_ROUTE_RATE_WINDOW_MS — 20/min per client, enough for the debounced map
// route effect but far below what would drain ORS quota. Over budget ⇒ a flat
// 429 { error, code: "RATE_LIMITED", retryable: true }. Durable (Supabase) when
// configured, degrading to a per-instance in-memory budget otherwise — the same
// documented fail-open behaviour as every other rate-limited route.
//
// GLOBAL DAILY BUDGET: the per-client cap can't bound aggregate ORS spend, and
// under the degraded (per-instance) limiter many instances each grant their own
// 20/min. So an ACTUAL provider call also draws down a durable global daily
// budget (lib/walkRouteBudget consumeOrsBudget, keyed ors-global:<UTC-date>,
// ORS_DAILY_BUDGET default 2000). Over the daily cap ⇒ skip the provider and
// serve the straight leg — the same fail-soft the keyless/unroutable paths use.
// Cache hits and the keyless path never call it, so they never consume budget.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import {
  legCacheKey,
  legDistances,
  legsToLineString,
  parseStops,
  routeSource,
  stopPairs,
  straightLegCoordinates,
  WALK_ROUTE_MAX_STOPS,
  WALK_ROUTE_RATE_LIMIT,
  WALK_ROUTE_RATE_WINDOW_MS,
  type LngLat,
  type WalkLeg,
} from "@/lib/walkRoute";
import { consumeOrsBudget } from "@/lib/walkRouteBudget";
import { fetchWalkLeg, orsApiKey } from "@/lib/walkRouteProvider";
import { walkRouteStore } from "@/lib/walkRouteStore";

assertServerEnv();

export const runtime = "nodejs";

// The rate-limit and stop-cap values, and the reasoning behind each, live in
// lib/walkRoute.ts. Next's generated route types allow a route module to export
// only its handlers and the known segment-config fields, so a constant exported
// here fails the type check.

const EMPTY_LINE: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

async function resolveLegs(stops: LngLat[]): Promise<WalkLeg[]> {
  const store = walkRouteStore();
  const hasKey = orsApiKey() !== null;
  return Promise.all(
    stopPairs(stops).map(async (pair): Promise<WalkLeg> => {
      const straight: WalkLeg = {
        fromIndex: pair.fromIndex,
        toIndex: pair.toIndex,
        coordinates: straightLegCoordinates(pair.from, pair.to),
        source: "straight",
      };
      const key = legCacheKey(pair.from, pair.to);
      const cached = await store.getLeg(key);
      if (cached) return { ...straight, coordinates: cached, source: "ors" };
      if (!hasKey) return straight;
      // A real provider call is about to happen (cache miss + key present).
      // Draw down the global daily ORS budget FIRST; over the cap ⇒ serve the
      // straight leg (fail-soft), so the day's quota can't be silently drained.
      if (!(await consumeOrsBudget())) return straight;
      const routed = await fetchWalkLeg(pair.from, pair.to);
      if (!routed) return straight;
      await store.putLeg(key, routed);
      return { ...straight, coordinates: routed, source: "ors" };
    }),
  );
}

export async function GET(request: Request): Promise<Response> {
  const limiterKey = `walk-route:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, WALK_ROUTE_RATE_LIMIT, WALK_ROUTE_RATE_WINDOW_MS)) {
    return publicApiError("Too many requests.", "RATE_LIMITED", 429, { retryable: true });
  }
  const url = new URL(request.url);
  const stops = parseStops(url.searchParams.get("stops")).slice(0, WALK_ROUTE_MAX_STOPS);
  if (stops.length < 2) {
    return jsonNoStore({ line: EMPTY_LINE, source: "straight", legs: [] });
  }
  const legs = await resolveLegs(stops);
  // `legs` carries each leg's real drawn-polyline distance + source so a client
  // can label it source-aware ("walking route" vs "straight-line") without
  // re-measuring the stitched line; `line`/`source` stay the drawable payload.
  return jsonNoStore({
    line: legsToLineString(legs),
    source: routeSource(legs),
    legs: legDistances(legs),
  });
}
