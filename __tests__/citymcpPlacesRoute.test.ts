import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/citymcp/places/route";

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

describe("GET /api/citymcp/places", () => {
  it("400s when q is missing or empty", async () => {
    const res = await GET(new Request("http://localhost/api/citymcp/places"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Add a search term.");
  });

  it("400s when q is absurdly long", async () => {
    const long = "x".repeat(300);
    const res = await GET(
      new Request(`http://localhost/api/citymcp/places?q=${encodeURIComponent(long)}`),
    );
    expect(res.status).toBe(400);
  });

  it("returns thin rows from search_places on success", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              places: [
                {
                  id: "abc123",
                  name: "The George",
                  area: "75 Borough High St, London",
                  location: { lat: 51.5, lng: -0.09 },
                  types: ["pub", "bar", "restaurant"],
                  rating: 4.3,
                  userRatingCount: 7373,
                  priceBand: "££",
                  openNow: true,
                  // A field we don't proxy through the thin row — should be dropped.
                  hygiene: { rating: 5 },
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(
      new Request("http://localhost/api/citymcp/places?q=George%20Southwark&limit=3"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.places).toHaveLength(1);
    expect(body.places[0]).toEqual({
      id: "abc123",
      name: "The George",
      area: "75 Borough High St, London",
      location: { lat: 51.5, lng: -0.09 },
      types: ["pub", "bar", "restaurant"],
      rating: 4.3,
      userRatingCount: 7373,
      priceBand: "££",
      openNow: true,
    });
    // Verify the upstream call actually happened with the right args.
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.name).toBe("search_places");
    expect(upstream.params.arguments).toEqual({ query: "George Southwark", limit: 3 });
  });

  it("forwards validated filter params to search_places", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { places: [] } },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const res = await GET(
      new Request(
        "http://localhost/api/citymcp/places?q=beer%20garden&limit=3&openNow=true&minRating=4.2&maxPrice=%C2%A3%C2%A3&sort=rating",
      ),
    );
    expect(res.status).toBe(200);
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.arguments).toEqual({
      query: "beer garden",
      limit: 3,
      openNow: true,
      minRating: 4.2,
      maxPrice: "££",
      sort: "rating",
    });
  });

  it("drops invalid filter params instead of forwarding or erroring", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { places: [] } },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const res = await GET(
      new Request(
        "http://localhost/api/citymcp/places?q=pub&openNow=maybe&minRating=99&maxPrice=cheap&sort=chaos",
      ),
    );
    expect(res.status).toBe(200);
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.arguments).toEqual({ query: "pub", limit: 5 });
  });

  it("fails soft with 200 + empty places on upstream error", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    const res = await GET(new Request("http://localhost/api/citymcp/places?q=anything"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.places).toEqual([]);
    expect(body.error).toBeTruthy();
  });
});
