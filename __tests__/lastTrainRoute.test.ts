import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/last-train/route";
import { __resetLastTrainStableCache } from "@/lib/lastTrainStableCache.server";

const realFetch = global.fetch;
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function mockLastTrainResponses(hour: string, minute: string): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/StopPoint?")) {
      return new Response(
        JSON.stringify({
          stopPoints: [
            {
              id: "940GZZLUOXC",
              commonName: "Oxford Circus",
              distance: 0,
              lat: 51.5,
              lon: -0.12,
              lines: [{ id: "victoria", name: "Victoria" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/Line/victoria/Timetable/")) {
      return new Response(
        JSON.stringify({
          timetable: {
            routes: [
              {
                schedules: [{ name: "Saturday", lastJourney: { hour, minute } }],
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/Arrivals")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/Line/victoria/Status")) {
      return new Response(
        JSON.stringify([
          {
            id: "victoria",
            name: "Victoria",
            lineStatuses: [{ statusSeverityDescription: "Good Service" }],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  __resetLastTrainStableCache();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  global.fetch = realFetch;
  vi.useRealTimers();
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
});

describe("GET /api/last-train", () => {
  it("400s when lat/lng are missing or invalid", async () => {
    const res = await GET(new Request("http://localhost/api/last-train"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add valid lat and lng coordinates.", code: "INVALID_REQUEST", retryable: false });
  });

  it("returns live_data_unavailable gracefully when TfL StopPoint lookup fails", async () => {
    global.fetch = vi.fn(async () => new Response("service unavailable", { status: 503 }));

    const res = await GET(new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Static fallback: bundled station near Westminster when TfL is down.
    expect(body.staticFallback).toBe(true);
    expect(body.station).toEqual(
      expect.objectContaining({ name: expect.any(String), distanceM: expect.any(Number) }),
    );
    expect(body.station.name).not.toBe("Nearest station");
    expect(body.nearestPubs).toEqual(expect.any(Array));
    expect(body.decision.decision).toBe("live_data_unavailable");
    expect(body.error).toMatch(/TfL/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("coarsens a viewer point before forwarding it to TfL", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ stopPoints: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await GET(
      new Request(
        "http://localhost/api/last-train?lat=51.50741234&lng=-0.12785678",
        { headers: { "x-forwarded-for": "198.51.100.29" } },
      ),
    );

    expect(res.status).toBe(200);
    const stopPointCall = vi.mocked(global.fetch).mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("/StopPoint?"));
    expect(stopPointCall).toContain("lat=51.507&lon=-0.128");
    expect(stopPointCall).not.toContain("51.50741234");
    expect(stopPointCall).not.toContain("-0.12785678");
  });

  it("fails closed for non-London coordinates instead of querying TfL or London static stations", async () => {
    global.fetch = vi.fn(async () => new Response("should not be called", { status: 500 }));

    const res = await GET(new Request("http://localhost/api/last-train?lat=51.75&lng=-1.26"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.station).toBeNull();
    expect(body.trains).toEqual([]);
    expect(body.departures).toEqual([]);
    expect(body.nearestPubs).toEqual([]);
    expect(body.error).toMatch(/London pubs/i);
    expect(body.staticFallback).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("ignores legacy ?destination= so labels stay client-only", async () => {
    global.fetch = vi.fn(async () => new Response("service unavailable", { status: 503 }));

    const res = await GET(
      new Request(
        "http://localhost/api/last-train?lat=51.5&lng=-0.12&destination=Home%20station",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision.destinationLabel).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not follow off-host TfL disambiguation URIs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/StopPoint?")) {
        return new Response(
          JSON.stringify({
            stopPoints: [
              {
                id: "940GZZLUOXC",
                commonName: "Oxford Circus",
                distance: 210,
                lat: 51.515,
                lon: -0.142,
                lines: [{ id: "victoria", name: "Victoria" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("direction=outbound")) {
        return new Response(
          JSON.stringify({
            timetable: {
              routes: [
                {
                  schedules: [{ name: "Friday", lastJourney: { hour: "23", minute: "58" } }],
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/Line/victoria/Timetable/")) {
        return new Response(
          JSON.stringify({
            disambiguation: {
              disambiguationOptions: [
                { uri: "https://evil.example/Line/victoria/Timetable/940GZZLUOXC" },
                { uri: "http://api.tfl.gov.uk/Line/victoria/Timetable/940GZZLUOXC" },
                { uri: "https://api.tfl.gov.uk.evil.example/Line/victoria/Timetable/940GZZLUOXC" },
                {
                  uri: "https://api.tfl.gov.uk/Line/victoria/Timetable/940GZZLUOXC?direction=outbound",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/Arrivals")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/Line/victoria/Status")) {
        return new Response(
          JSON.stringify([
            {
              id: "victoria",
              name: "Victoria",
              lineStatuses: [{ statusSeverityDescription: "Good Service" }],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const res = await GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.10" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trains[0].clock).toBe("23:58");

    const calls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    expect(calls.some((url) => url.includes("evil.example"))).toBe(false);
    expect(calls.some((url) => url.startsWith("http://api.tfl.gov.uk"))).toBe(false);
    expect(calls.some((url) => url.includes("direction=outbound"))).toBe(true);
  });

  it("rate-limits valid last-train lookups per hashed client IP", async () => {
    global.fetch = vi.fn(async () => new Response("service unavailable", { status: 503 }));

    const responses: Response[] = [];
    for (let i = 0; i < 21; i++) {
      responses.push(
        await GET(
          new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
            headers: { "x-forwarded-for": "198.51.100.20" },
          }),
        ),
      );
    }

    expect(responses.slice(0, 20).every((res) => res.status === 200)).toBe(true);
    expect(responses[20].status).toBe(429);
    expect(await responses[20].json()).toEqual({ error: "Too many requests, slow down.", code: "RATE_LIMITED", retryable: true });
  });

  it("does not spend the live-request budget on stable prefetches", async () => {
    global.fetch = vi.fn(async () => new Response("service unavailable", { status: 503 }));

    for (let i = 0; i < 20; i++) {
      const response = await GET(
        new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12&scope=stable", {
          headers: { "x-forwarded-for": "198.51.100.21" },
        }),
      );
      expect(response.status).toBe(200);
    }

    const liveResponse = await GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.21" },
      }),
    );
    expect(liveResponse.status).toBe(200);
  });

  it("resolves a post-midnight last train against the prior service day", async () => {
    vi.useFakeTimers();
    // Saturday 00:15 Europe/London (BST): still Friday night's service window.
    vi.setSystemTime(new Date("2026-07-10T23:15:00.000Z"));

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/StopPoint?")) {
        return new Response(
          JSON.stringify({
            stopPoints: [
              {
                id: "940GZZLUOXC",
                commonName: "Oxford Circus",
                distance: 210,
                lat: 51.515,
                lon: -0.142,
                lines: [{ id: "victoria", name: "Victoria" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/Line/victoria/Timetable/")) {
        return new Response(
          JSON.stringify({
            timetable: {
              routes: [
                {
                  schedules: [{ name: "Friday", lastJourney: { hour: "24", minute: "28" } }],
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/Arrivals")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/Line/victoria/Status")) {
        return new Response(
          JSON.stringify([
            {
              id: "victoria",
              name: "Victoria",
              lineStatuses: [{ statusSeverityDescription: "Good Service" }],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const prefetched = await GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12&scope=stable"),
    );
    expect(prefetched.status).toBe(200);
    const prefetchedBody = await prefetched.json();
    expect(prefetchedBody.station?.name).toBe("Oxford Circus");
    expect(prefetchedBody.departures).toEqual([
      expect.objectContaining({ lineId: "victoria", live: false }),
    ]);
    expect(prefetchedBody.decision).toBeUndefined();
    expect(prefetched.headers.get("cache-control")).toContain("s-maxage=3600");
    let calls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    expect(calls.some((url) => url.includes("/Arrivals"))).toBe(false);
    expect(calls.some((url) => url.includes("/Status"))).toBe(false);

    const res = await GET(new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.station?.name).toBe("Oxford Circus");
    expect(body.trains).toHaveLength(1);
    expect(body.trains[0].clock).toBe("00:28");
    expect(body.trains[0].pastMidnight).toBe(true);
    expect(body.decision.decision).not.toBe("live_data_unavailable");
    expect(body.decision.leaveByIso).toBeTruthy();
    expect(res.headers.get("cache-control")).toBe("no-store");

    calls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    expect(calls.filter((url) => url.includes("/StopPoint?"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/Line/victoria/Timetable/"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/Arrivals"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/Status"))).toHaveLength(1);
  });

  it.each([
    {
      label: "spring-forward night",
      nowIso: "2026-03-28T23:00:00.000Z",
      expectedLeaveByIso: "2026-03-29T01:57:00.000Z",
      ip: "198.51.100.31",
    },
    {
      label: "fall-back night",
      nowIso: "2026-10-24T22:00:00.000Z",
      expectedLeaveByIso: "2026-10-25T02:57:00.000Z",
      ip: "198.51.100.32",
    },
  ])(
    "calculates a post-midnight 26:57 departure across the $label",
    async ({ nowIso, expectedLeaveByIso, ip }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(nowIso));

      global.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/StopPoint?")) {
          return new Response(
            JSON.stringify({
              stopPoints: [
                {
                  id: "940GZZLUOXC",
                  commonName: "Oxford Circus",
                  distance: 0,
                  lat: 51.5,
                  lon: -0.12,
                  lines: [{ id: "victoria", name: "Victoria" }],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/Line/victoria/Timetable/")) {
          return new Response(
            JSON.stringify({
              timetable: {
                routes: [
                  {
                    schedules: [{ name: "Saturday", lastJourney: { hour: "26", minute: "57" } }],
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/Arrivals")) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/Line/victoria/Status")) {
          return new Response(
            JSON.stringify([
              {
                id: "victoria",
                name: "Victoria",
                lineStatuses: [{ statusSeverityDescription: "Good Service" }],
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      });

      const res = await GET(
        new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
          headers: { "x-forwarded-for": ip },
        }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.trains[0]).toMatchObject({ clock: "02:57", pastMidnight: true });
      expect(body.decision.leaveByIso).toBe(expectedLeaveByIso);
    },
  );

  it("keeps TfL 25:30 on first fall-back 01:30, while 24:30 stays at 00:30", async () => {
    vi.useFakeTimers();
    mockLastTrainResponses("25", "30");

    vi.setSystemTime(new Date("2026-10-24T22:00:00.000Z"));
    const beforeFallback = await GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.33" },
      }),
    );
    const beforeBody = await beforeFallback.json();
    expect(beforeBody.trains[0]).toMatchObject({ clock: "01:30", pastMidnight: true });
    expect(beforeBody.decision.leaveByIso).toBe("2026-10-25T00:30:00.000Z");

    mockLastTrainResponses("24", "30");
    __resetLastTrainStableCache();
    vi.setSystemTime(new Date("2026-10-24T22:00:00.000Z"));
    const twentyFourHour = await GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.34" },
      }),
    );
    const twentyFourBody = await twentyFourHour.json();
    expect(twentyFourBody.trains[0]).toMatchObject({ clock: "00:30", pastMidnight: true });
    expect(twentyFourBody.decision.leaveByIso).toBe("2026-10-24T23:30:00.000Z");

    mockLastTrainResponses("25", "30");
    __resetLastTrainStableCache();
    vi.setSystemTime(new Date("2026-10-25T01:15:00.000Z"));
    const afterFallback = await GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.35" },
      }),
    );
    const afterBody = await afterFallback.json();
    expect(afterBody.trains[0]).toMatchObject({ clock: "01:30", pastMidnight: true });
    expect(afterBody.decision.leaveByIso).toBe("2026-10-25T00:30:00.000Z");
  });
});
