import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/citymcp/journey/route";
import { resetJourneyCache } from "@/lib/citymcp/client";

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

const FROM_LAT = "51.51200";
const FROM_LNG = "-0.10400";
const TO_LAT = "51.51000";
const TO_LNG = "-0.12100";

function journeyUrl(extra = ""): string {
  const base =
    `http://localhost/api/citymcp/journey?fromLat=${FROM_LAT}&fromLng=${FROM_LNG}` +
    `&toLat=${TO_LAT}&toLng=${TO_LNG}`;
  return extra ? `${base}&${extra}` : base;
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetJourneyCache();
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

describe("GET /api/citymcp/journey", () => {
  it("400s when coords are missing", async () => {
    const res = await GET(
      new Request("http://localhost/api/citymcp/journey?fromLat=51.5"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Add valid start and end coordinates.");
    expect(body.journeys).toEqual([]);
  });

  it("400s when coords are outside the UK box", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/citymcp/journey?fromLat=40&fromLng=-74&toLat=41&toLng=-73",
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/UK/i);
    expect(body.journeys).toEqual([]);
  });

  it("returns a trimmed journey and formats lat/lng points", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              journeys: [
                {
                  durationMinutes: 15,
                  departureTime: "2026-07-11T15:26:00",
                  arrivalTime: "2026-07-11T15:41:00",
                  legs: [
                    {
                      mode: "walking",
                      summary: "Walk to stop",
                      durationMinutes: 4,
                      departureTime: "2026-07-11T15:26:00",
                      arrivalTime: "2026-07-11T15:30:00",
                    },
                    {
                      mode: "bus",
                      summary: "15 bus to Savoy Street",
                      durationMinutes: 9,
                    },
                    {
                      mode: "walking",
                      summary: "Walk to destination",
                      durationMinutes: 2,
                    },
                  ],
                  // Not on whitelist — should be dropped.
                  rawBlob: { anything: "goes" },
                },
                {
                  durationMinutes: 20,
                  legs: [{ mode: "tube", summary: "Northern" }],
                },
                { durationMinutes: "NaN", legs: [] }, // invalid — filtered
                null,
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(new Request(journeyUrl("limit=2")));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/^public,/);
    const body = await res.json();
    expect(body.from).toBe("51.51200,-0.10400");
    expect(body.to).toBe("51.51000,-0.12100");
    expect(body.asOf).toBeNull();
    expect(body.journeys).toHaveLength(2);
    expect(body.journeys[0].durationMinutes).toBe(15);
    expect(body.journeys[0].legs).toHaveLength(3);
    expect(body.journeys[0].legs[0].mode).toBe("walking");
    expect(body.journeys[0].rawBlob).toBeUndefined();
    expect(body.journeys[1].durationMinutes).toBe(20);

    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.name).toBe("get_journey");
    expect(upstream.params.arguments).toEqual({
      from: "51.51200,-0.10400",
      to: "51.51000,-0.12100",
    });
  });

  it("defaults limit to 1 (best journey only)", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              journeys: [
                { durationMinutes: 10, legs: [{ mode: "walking" }] },
                { durationMinutes: 12, legs: [{ mode: "bus" }] },
                { durationMinutes: 14, legs: [{ mode: "tube" }] },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(new Request(journeyUrl()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.journeys).toHaveLength(1);
    expect(body.journeys[0].durationMinutes).toBe(10);
  });

  it("fails soft with 200 + empty journeys on upstream error", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    const res = await GET(new Request(journeyUrl()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from).toBe("51.51200,-0.10400");
    expect(body.to).toBe("51.51000,-0.12100");
    expect(body.journeys).toEqual([]);
    expect(body.asOf).toBeNull();
    expect(body.error).toBeTruthy();
  });
});

describe("POST /api/citymcp/journey", () => {
  it("keeps viewer coordinates out of URLs, response echoes, and shared caches", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              journeys: [
                { durationMinutes: 14, legs: [{ mode: "walking" }, { mode: "bus" }] },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const request = new Request("http://localhost/api/citymcp/journey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromLat: 51.51234567,
        fromLng: -0.10456789,
        toLat: Number(TO_LAT),
        toLng: Number(TO_LNG),
        limit: 3,
      }),
    });
    expect(request.url).not.toContain(FROM_LAT);
    expect(request.url).not.toContain(FROM_LNG);

    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.from).toBeUndefined();
    expect(body.to).toBeUndefined();
    expect(body.journeys).toHaveLength(1);

    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.arguments).toEqual({
      from: "51.51200,-0.10500",
      to: "51.51000,-0.12100",
    });
  });

  it("rejects malformed JSON without caching it", async () => {
    const res = await POST(
      new Request("http://localhost/api/citymcp/journey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
