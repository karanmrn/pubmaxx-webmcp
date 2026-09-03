import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// House pattern (followingRoute / planIdempotencyRoutes): the route asserts
// server env at module load, and CI has no Supabase vars.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
// The preflight is a live unauthenticated GET now that its 404 gate is gone, so
// it spends a per-IP budget like every other read-heavy route. Held open here
// and closed in its own case below.
const limiterCalls: string[] = [];
let limiterClosed = false;
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return {
    ...actual,
    isLimited: async (key: string) => {
      limiterCalls.push(key);
      return limiterClosed;
    },
  };
});

import { GET } from "@/app/api/plans/anchor/route";

function get(query: Record<string, string>): Promise<Response> {
  const url = new URL("http://localhost/api/plans/anchor");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return GET(new Request(url, { method: "GET" }));
}

describe("GET /api/plans/anchor", () => {
  it("resolves accepted Venue preflight by default without a rollout flag", async () => {
    const response = await get({ cityId: "london", venueId: "venue-x" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "conflict", code: "ANCHOR_VENUE_INVALID" });
  });

  it("rejects a missing Venue, bad city, and bad area by default", async () => {
    expect((await get({ cityId: "london" })).status).toBe(400);
    expect((await get({ cityId: "atlantis", venueId: "venue-x" })).status).toBe(400);
    expect((await get({ cityId: "london", venueId: "venue-x", areaKind: "night-patch", areaId: "nowhere" })).status).toBe(400);
  });

  it("returns a machine-readable conflict for an unknown Venue", async () => {
    const response = await get({ cityId: "london", venueId: "venue-does-not-exist-zzz" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "conflict", code: "ANCHOR_VENUE_INVALID" });
  });
});

describe("GET /api/plans/anchor rate limit", () => {
  it("spends one per-IP budget per call and answers 429 when it runs out", async () => {
    limiterCalls.length = 0;
    limiterClosed = false;
    await get({ cityId: "london", venueId: "venue-x" });
    expect(limiterCalls).toHaveLength(1);
    expect(limiterCalls[0]).toMatch(/^plan-anchor:/);
    // The hashed IP is the key; a raw address must never be one.
    expect(limiterCalls[0]).not.toContain("127.0.0.1");

    limiterClosed = true;
    const limited = await get({ cityId: "london", venueId: "venue-x" });
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe("RATE_LIMITED");

    // The limiter is consulted before the query is parsed, so a flood of
    // malformed calls costs the same as a flood of valid ones.
    const malformed = await get({ cityId: "atlantis" });
    expect(malformed.status).toBe(429);
    limiterClosed = false;
  });
});
