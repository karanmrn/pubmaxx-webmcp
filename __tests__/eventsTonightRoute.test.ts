import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/events/tonight/route";
import { resetEventbriteCache } from "@/lib/events/eventbrite";

const realFetch = global.fetch;
// The route rate-limits per IP before anything else. Vercel's vitest run sets
// NODE_ENV=production with real Supabase env vars, which would send the limiter
// down its durable (network) path; deleting the two env vars keeps it on the
// deterministic in-memory path (same technique as citymcpAreaRoute.test.ts).
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINAL_TOKEN = process.env.EVENTBRITE_API_TOKEN;
const FIXTURE_NOW = new Date("2026-07-18T17:00:00.000Z");

const musicEvent = {
  id: "eb-1",
  name: { text: "Basement Live Session" },
  url: "https://www.eventbrite.com/e/basement-live-session-eb-1",
  start: { utc: "2026-07-18T19:00:00Z" },
  category_id: "103",
  venue: { name: "The Windmill Brixton", latitude: "51.4626", longitude: "-0.1145" },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXTURE_NOW);
  resetEventbriteCache();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.EVENTBRITE_API_TOKEN = "test-token";
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = realFetch;
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
  if (ORIGINAL_TOKEN === undefined) delete process.env.EVENTBRITE_API_TOKEN;
  else process.env.EVENTBRITE_API_TOKEN = ORIGINAL_TOKEN;
});

describe("GET /api/events/tonight", () => {
  it("200s with the Eventbrite provider reported unconfigured when no token is set", async () => {
    delete process.env.EVENTBRITE_API_TOKEN;
    const res = await GET(new Request("http://localhost/api/events/tonight"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.providers).toEqual([{ name: "eventbrite", configured: false, rows: 0 }]);
    expect(typeof body.asOf).toBe("string");
  });

  it("200s with zero rows (fail-soft) and reports the provider error when Eventbrite is down", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 503 }));
    const res = await GET(new Request("http://localhost/api/events/tonight"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.providers[0].error).toMatch(/503/);
  });

  it("surfaces mapped own-org events on success and sets an edge-cache header", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("/organizations/org-1/events/")
        ? new Response(JSON.stringify({ events: [musicEvent] }), { status: 200 })
        : new Response(JSON.stringify({ organizations: [{ id: "org-1" }] }), { status: 200 }),
    );
    const res = await GET(new Request("http://localhost/api/events/tonight"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=/);
    const body = await res.json();
    expect(body.rows).toEqual([
      {
        id: "events-eb-1fe06oj",
        placeName: "The Windmill Brixton",
        kind: "music",
        startsAt: "2026-07-18T19:00:00.000Z",
        title: "Basement Live Session",
        source: {
          label: "Eventbrite",
          url: musicEvent.url,
        },
        observedAt: FIXTURE_NOW.toISOString(),
        confidence: "listed",
        lat: 51.4626,
        lng: -0.1145,
      },
    ]);
    expect(body.providers).toEqual([
      { name: "eventbrite", configured: true, rows: 1 },
    ]);
  });

  it("honours the flat { error, rows: [] } contract with a 429 when rate-limited", async () => {
    // The limiter allows the first 60 requests through to the provider. Keep
    // this contract test hermetic: using the real fetch here turns it into 60
    // Eventbrite network calls and makes the limiter assertion depend on
    // external latency rather than application behaviour.
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ organizations: [] }), { status: 200 }),
    );
    // Exhaust the 60/min in-memory budget from one IP.
    const req = () =>
      new Request("http://localhost/api/events/tonight", { headers: { "x-forwarded-for": "9.9.9.9" } });
    let last: Response | undefined;
    for (let i = 0; i < 65; i += 1) last = await GET(req());
    expect(last?.status).toBe(429);
    const body = await last!.json();
    // Flat { error, rows: [] } shape preserved atop publicApiError's canonical fields.
    expect(body).toMatchObject({ error: "Too many requests, slow down.", rows: [] });
    expect(body.code).toBe("rate_limited");
    expect(body.retryable).toBe(true);
  });
});
