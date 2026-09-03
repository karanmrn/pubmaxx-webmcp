import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/citymcp/place/route";
import { resetCityPlaceCache } from "@/lib/citymcp/client";

const realFetch = global.fetch;
// The route now rate-limits per IP (S2) before anything else. Vercel's vitest
// run sets NODE_ENV=production with real Supabase env vars, which would send
// the limiter down its durable (network) path here; deleting the two env vars
// for the test keeps it on the deterministic in-memory path (same technique
// as __tests__/lastTrainRoute.test.ts).
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetCityPlaceCache();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  global.fetch = realFetch;
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
});

describe("GET /api/citymcp/place", () => {
  it("400s when id is missing", async () => {
    const res = await GET(new Request("http://localhost/api/citymcp/place"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Place id is missing.");
    expect(body.place).toBeNull();
  });

  it("400s when id is absurdly long", async () => {
    const long = "x".repeat(300);
    const res = await GET(
      new Request(`http://localhost/api/citymcp/place?id=${encodeURIComponent(long)}`),
    );
    expect(res.status).toBe(400);
  });

  it("returns a trimmed place dossier on success (deep:1)", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              name: "The George",
              address: "75 Borough High St, London",
              area: "Southwark",
              location: { lat: 51.5042, lng: -0.0904 },
              types: ["pub", "bar"],
              rating: 4.3,
              userRatingCount: 7373,
              priceBand: "££",
              openNow: true,
              hygiene: {
                value: { businessName: "The George Inn", rating: 5 },
                source: "FSA",
                fetchedAt: "2026-07-11T00:00:00Z",
              },
              transit: {
                value: {
                  nearest: "London Bridge",
                  lines: ["Northern", "Jubilee"],
                  walkMinutes: 4,
                },
                source: "TfL",
              },
              // Fields not in whitelist — should be dropped.
              rawDump: { anything: "goes" },
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(
      new Request("http://localhost/api/citymcp/place?id=ChIJoTest&deep=1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.place.id).toBe("ChIJoTest");
    expect(body.place.name).toBe("The George");
    expect(body.place.rating).toBe(4.3);
    expect(body.place.hygiene.value.rating).toBe(5);
    expect(body.place.transit.value.nearest).toBe("London Bridge");
    // Whitelist trimming — rawDump must not leak through.
    expect(body.place.rawDump).toBeUndefined();
    // Verify upstream call included deep:true.
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.name).toBe("get_place");
    expect(upstream.params.arguments).toEqual({ id: "ChIJoTest", deep: true });
  });

  it("does not send deep:true when deep param is absent/0", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { name: "X" } },
        }),
        { status: 200 },
      ),
    );

    await GET(new Request("http://localhost/api/citymcp/place?id=abc"));
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.arguments).toEqual({ id: "abc" });
  });

  it("fails soft with 200 + null place on upstream error", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    const res = await GET(new Request("http://localhost/api/citymcp/place?id=abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.place).toBeNull();
    expect(body.error).toBeTruthy();
  });
});
