import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic route tests. The keyless default (ORS_API_KEY stripped in
// vitest.setup.ts) exercises the straight-line fallback with no network; the
// key-present path stubs the ORS provider so a routed line is proven without a
// live call. The cache uses the process-memory backend (isSupabaseConfigured is
// false under the test baseline), reset between tests.

import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetWalkRouteStore } from "@/lib/walkRouteStore";
import { encodeStops, WALK_ROUTE_RATE_LIMIT, type LngLat, type WalkLegDistance } from "@/lib/walkRoute";

// The route module runs assertServerEnv() at import scope (the house pattern).
// On Vercel vitest reads as production without test-scoped Supabase vars, so the
// import would throw — mock it to a no-op, exactly like every sibling route test
// (see __tests__/opsFreeze.test.ts). Pin the supabase seam to unconfigured so
// walkRouteStore() selects the process-memory backend the cache tests rely on.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const fetchWalkLeg = vi.hoisted(() => vi.fn());
const orsApiKey = vi.hoisted(() => vi.fn<() => string | null>(() => null));

vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLeg,
  orsApiKey,
  ORS_FOOT_WALKING_URL: "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
}));

// Stub the global daily ORS budget so the route's budget contract (consume only
// on a real provider call; over budget ⇒ straight) is proven deterministically
// without exercising the durable limiter's arithmetic. The budget module's own
// logic is unit-tested in __tests__/walkRouteBudget.test.ts. Defaults to "budget
// remains" so every pre-existing test behaves exactly as before.
const consumeOrsBudget = vi.hoisted(() => vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)));

vi.mock("@/lib/walkRouteBudget", () => ({ consumeOrsBudget }));

import { GET } from "@/app/api/walk-route/route";

const A: LngLat = [-0.1005, 51.5136];
const B: LngLat = [-0.0975, 51.5142];
const C: LngLat = [-0.0951, 51.5155];

function get(stops: LngLat[] | string): Promise<Response> {
  const raw = typeof stops === "string" ? stops : encodeStops(stops);
  return GET(new Request(`https://pubmaxxing.com/api/walk-route?stops=${encodeURIComponent(raw)}`));
}

async function body(res: Response) {
  return (await res.json()) as {
    line: GeoJSON.FeatureCollection;
    source: "ors" | "straight";
    legs: WalkLegDistance[];
  };
}

beforeEach(() => {
  __resetWalkRouteStore();
  // The route now carries the house per-client rate limiter (in-memory under the
  // unconfigured-supabase test baseline); reset its window so each test starts
  // from a clean budget.
  __resetPintDrops();
  fetchWalkLeg.mockReset();
  orsApiKey.mockReset();
  orsApiKey.mockReturnValue(null);
  consumeOrsBudget.mockReset();
  consumeOrsBudget.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/walk-route", () => {
  it("returns an empty line for fewer than two stops", async () => {
    const res = await get([A]);
    expect(res.status).toBe(200);
    const { line, source } = await body(res);
    expect(line.features).toEqual([]);
    expect(source).toBe("straight");
  });

  it("keyless: draws the straight line and never calls ORS", async () => {
    const res = await get([A, B, C]);
    expect(res.status).toBe(200);
    const { line, source } = await body(res);
    expect(source).toBe("straight");
    expect(line.features[0].properties).toEqual({ source: "straight" });
    expect((line.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([A, B, C]);
    expect(fetchWalkLeg).not.toHaveBeenCalled();
  });

  it("key present: routes each leg through ORS and returns a solid ors line", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    fetchWalkLeg.mockImplementation(async (from: LngLat, to: LngLat) => [
      from,
      [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as LngLat,
      to,
    ]);
    const res = await get([A, B, C]);
    const { line, source } = await body(res);
    expect(source).toBe("ors");
    expect(fetchWalkLeg).toHaveBeenCalledTimes(2);
    // Two 3-point legs stitched (shared vertices B dropped once) => 5 points.
    expect((line.features[0].geometry as GeoJSON.LineString).coordinates).toHaveLength(5);
  });

  it("serves a cached leg without re-calling ORS", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    fetchWalkLeg.mockResolvedValue([A, B]);
    await get([A, B]);
    expect(fetchWalkLeg).toHaveBeenCalledTimes(1);
    fetchWalkLeg.mockClear();
    const res = await get([A, B]);
    const { source } = await body(res);
    expect(source).toBe("ors");
    expect(fetchWalkLeg).not.toHaveBeenCalled();
  });

  it("keeps a mixed route approximate when ORS cannot route one leg", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    fetchWalkLeg
      .mockResolvedValueOnce([A, [-0.099, 51.5139], B]) // leg 1 routed
      .mockResolvedValueOnce(null); // leg 2 unroutable -> straight
    const res = await get([A, B, C]);
    const { line, source } = await body(res);
    expect(source).toBe("straight");
    const coords = (line.features[0].geometry as GeoJSON.LineString).coordinates;
    expect(coords[coords.length - 1]).toEqual(C);
  });

  it("ignores malformed stops and never 500s", async () => {
    const res = await get("garbage;also,garbage");
    expect(res.status).toBe(200);
    const { source } = await body(res);
    expect(source).toBe("straight");
  });

  it("returns per-leg distances (routed length) so a client can label source-aware", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    // Leg 1 routed via a dog-leg (longer than straight A->B); leg 2 straight.
    fetchWalkLeg
      .mockResolvedValueOnce([A, [-0.098, 51.516], B])
      .mockResolvedValueOnce(null);
    const { legs } = await body(await get([A, B, C]));
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ fromIndex: 0, toIndex: 1, source: "ors" });
    expect(legs[1]).toMatchObject({ fromIndex: 1, toIndex: 2, source: "straight" });
    expect(legs[0].distanceKm).toBeGreaterThan(0);
  });

  it("rate-limits a client past its per-window budget with a flat 429", async () => {
    // The limiter allows WALK_ROUTE_RATE_LIMIT requests, then trips on the next.
    for (let i = 0; i < WALK_ROUTE_RATE_LIMIT; i += 1) {
      expect((await get([A, B])).status).toBe(200);
    }
    const limited = await get([A, B]);
    expect(limited.status).toBe(429);
    const payload = (await limited.json()) as { code: string; retryable: boolean };
    expect(payload.code).toBe("RATE_LIMITED");
    expect(payload.retryable).toBe(true);
  });
});

describe("GET /api/walk-route — global daily ORS budget", () => {
  it("keyless: never draws down the daily budget", async () => {
    // No key ⇒ no provider call, so the budget must be untouched.
    const { source } = await body(await get([A, B, C]));
    expect(source).toBe("straight");
    expect(fetchWalkLeg).not.toHaveBeenCalled();
    expect(consumeOrsBudget).not.toHaveBeenCalled();
  });

  it("a cached leg is served without drawing down the daily budget", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    fetchWalkLeg.mockResolvedValue([A, B]);
    await get([A, B]); // warms the cache: one provider call, one budget draw
    expect(consumeOrsBudget).toHaveBeenCalledTimes(1);
    consumeOrsBudget.mockClear();
    fetchWalkLeg.mockClear();

    const { source } = await body(await get([A, B])); // now served from cache
    expect(source).toBe("ors");
    expect(fetchWalkLeg).not.toHaveBeenCalled();
    expect(consumeOrsBudget).not.toHaveBeenCalled();
  });

  it("draws exactly one budget unit per ACTUAL provider call", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    fetchWalkLeg.mockImplementation(async (from: LngLat, to: LngLat) => [from, to]);
    const { source } = await body(await get([A, B, C])); // two uncached legs
    expect(source).toBe("ors");
    expect(fetchWalkLeg).toHaveBeenCalledTimes(2);
    expect(consumeOrsBudget).toHaveBeenCalledTimes(2);
  });

  it("over the daily budget: skips the provider and serves the straight line", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    consumeOrsBudget.mockResolvedValue(false); // day exhausted
    fetchWalkLeg.mockResolvedValue([A, B]); // would route if ever called
    const { line, source } = await body(await get([A, B, C]));
    expect(source).toBe("straight");
    expect(fetchWalkLeg).not.toHaveBeenCalled();
    // The drawable line is the straight fallback through every stop.
    expect((line.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([A, B, C]);
  });

  it("partial budget: only the funded leg calls the provider, the denied leg is straight", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    // Exactly one leg still has budget; the other is denied (order-independent
    // under Promise.all — whichever leg reserves first gets the single unit).
    consumeOrsBudget.mockResolvedValueOnce(true).mockResolvedValue(false);
    fetchWalkLeg.mockImplementation(async (from: LngLat, to: LngLat) => [from, to]);
    const { legs } = await body(await get([A, B, C]));
    // Both legs asked the budget; only the funded one reached the provider.
    expect(consumeOrsBudget).toHaveBeenCalledTimes(2);
    expect(fetchWalkLeg).toHaveBeenCalledTimes(1);
    // One leg routed, one fell back to straight (order-independent).
    const sources = legs.map((leg) => leg.source).sort();
    expect(sources).toEqual(["ors", "straight"]);
  });
});
