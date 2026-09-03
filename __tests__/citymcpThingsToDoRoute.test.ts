import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/citymcp/things-to-do/route";
import { resetThingsToDoCache } from "@/lib/citymcp/client";

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
  resetThingsToDoCache();
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

describe("GET /api/citymcp/things-to-do", () => {
  it("400s when window is invalid", async () => {
    const res = await GET(
      new Request("http://localhost/api/citymcp/things-to-do?window=someday"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/window must be/i);
    expect(body.opportunities).toEqual([]);
  });

  it("defaults window to tonight when absent", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { opportunities: [] } },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(new Request("http://localhost/api/citymcp/things-to-do"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.window).toBe("tonight");

    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.name).toBe("things_to_do");
    expect(upstream.params.arguments.window).toBe("tonight");
  });

  it("returns trimmed opportunities and forwards area/kinds/price/limit", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              area: "Shoreditch",
              asOf: "2026-07-11T18:00:00Z",
              opportunities: [
                {
                  title: "Free Jazz at the Blue Post",
                  kind: "gig",
                  areas: ["Shoreditch"],
                  price: "free",
                  timeEvidence: "8pm start",
                  place: {
                    id: "ChIJabc",
                    name: "Blue Post",
                    area: "Shoreditch",
                    location: { lat: 51.526, lng: -0.078 },
                  },
                  source: {
                    label: "Time Out",
                    url: "https://www.timeout.com/london/example",
                  },
                  // Not on whitelist — should be dropped.
                  rawBlob: { anything: "goes" },
                },
                { title: "" }, // Empty title — should be filtered out.
                null,
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(
      new Request(
        "http://localhost/api/citymcp/things-to-do?window=this_weekend&area=Shoreditch&kinds=gig,comedy,bogus&price=free&limit=5",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.window).toBe("this_weekend");
    expect(body.area).toBe("Shoreditch");
    expect(body.opportunities).toHaveLength(1);
    expect(body.opportunities[0].title).toBe("Free Jazz at the Blue Post");
    expect(body.opportunities[0].rawBlob).toBeUndefined();
    expect(body.opportunities[0].source.url).toBe("https://www.timeout.com/london/example");

    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.arguments).toEqual({
      window: "this_weekend",
      area: "Shoreditch",
      kinds: ["gig", "comedy"], // bogus dropped
      price: "free",
      limit: 5,
    });
  });

  it("caps limit at MAX_LIMIT (20)", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { opportunities: [] } },
        }),
        { status: 200 },
      ),
    );
    await GET(
      new Request("http://localhost/api/citymcp/things-to-do?window=tonight&limit=500"),
    );
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.arguments.limit).toBe(20);
  });

  it("fails soft with 200 + empty opportunities on upstream error", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    const res = await GET(
      new Request("http://localhost/api/citymcp/things-to-do?window=tonight"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.opportunities).toEqual([]);
    expect(body.error).toBeTruthy();
  });

  it("trims live object price/availability and source.name → label", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              opportunities: [
                {
                  title: "Late comedy at The Bill Murray",
                  kind: "comedy",
                  price: { label: "From £12", minGbp: 12 },
                  availability: { label: "Tickets available", remaining: 40 },
                  place: {
                    name: "The Bill Murray",
                    area: "Angel",
                    postcode: "N1 2LH",
                    location: { lat: 51.536, lng: -0.103 },
                  },
                  source: {
                    name: "Time Out",
                    url: "https://www.timeout.com/london/comedy/example",
                  },
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(
      new Request("http://localhost/api/citymcp/things-to-do?window=tonight&limit=3"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.opportunities).toHaveLength(1);
    const op = body.opportunities[0];
    expect(op.price).toBe("From £12");
    expect(op.availability).toBe("Tickets available");
    expect(op.source).toEqual({
      label: "Time Out",
      url: "https://www.timeout.com/london/comedy/example",
    });
    expect(op.place.postcode).toBe("N1 2LH");
    expect(op.place.location).toEqual({ lat: 51.536, lng: -0.103 });
  });
});
