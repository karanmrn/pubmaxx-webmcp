import { promises as fs } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/last-train/route";
import { __resetLastTrainStableCache } from "@/lib/lastTrainStableCache.server";
import {
  getPricedVenues,
  resetVenuePriceIndexForTests,
} from "@/lib/venuePriceIndex";

const realFetch = global.fetch;
const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function mockFastStationResponse(): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/StopPoint?") && !url.includes("/Arrivals")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            stopPoints: [
              {
                id: "940GZZLUOXC",
                commonName: "Oxford Circus",
                distance: 120,
                lat: 51.515,
                lon: -0.141,
                lines: [],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}

describe("GET /api/last-train latency boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T22:00:00.000Z"));
    __resetLastTrainStableCache();
    resetVenuePriceIndexForTests();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    global.fetch = realFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseServiceRoleKey;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns an honest degraded answer within two seconds when TfL stalls", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      return new Promise<Response>((resolve, reject) => {
        const abort = () => reject(new DOMException("upstream aborted", "AbortError"));
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener("abort", abort, { once: true });
        setTimeout(() => resolve(new Response("upstream still pending", { status: 503 })), 30_000);
      });
    });

    let response: Response | undefined;
    const request = GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.90" },
      }),
    ).then((result) => {
      response = result;
      return result;
    });

    await vi.advanceTimersByTimeAsync(2_000);
    const settledWithinBudget = response !== undefined;
    expect(calls.filter((url) => url.includes("/StopPoint?")).length).toBe(1);

    // If a regression removes the deadline, let the route finish its timeout
    // path so this test remains deterministic while the red assertion records
    // the missed budget.
    await vi.advanceTimersByTimeAsync(30_000);
    const completed = await request;
    const body = await completed.json();

    expect(settledWithinBudget).toBe(true);
    expect(completed.status).toBe(200);
    expect(body.staticFallback).toBe(true);
    expect(body.trains).toEqual([]);
    expect(body.departures).toEqual([]);
    expect(body.decision.decision).toBe("live_data_unavailable");
    expect(body.error).toMatch(/Couldn't reach TfL/i);
    expect(completed.headers.get("cache-control")).toBe("no-store");
  });

  it("stops an orphaned shared producer after its three-second lifetime", async () => {
    const upstreamSignals: AbortSignal[] = [];
    const calls: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/StopPoint?") && !url.includes("/Arrivals")) {
        if (init?.signal) upstreamSignals.push(init.signal);
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(new Response("upstream still pending", { status: 503 })),
            30_000,
          );
          const abort = () => {
            clearTimeout(timer);
            reject(new DOMException("upstream aborted", "AbortError"));
          };
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });

    const request = GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.95" },
      }),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    const response = await request;
    const body = await response.json();
    expect(body.staticFallback).toBe(true);

    // Route wait ends at 1.8s. Shared producer is allowed to finish at 3s,
    // then its upstream signal must be aborted and no retry may start.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(upstreamSignals[0]?.aborted).toBe(true);
    expect(calls.filter((url) => url.includes("/StopPoint?")).length).toBe(1);
  });

  it("starts line timetable, arrivals, and status reads together and cuts them off", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/StopPoint?") && !url.includes("/Arrivals")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              stopPoints: [
                {
                  id: "940GZZLUOXC",
                  commonName: "Oxford Circus",
                  distance: 120,
                  lines: [
                    { id: "victoria", name: "Victoria" },
                    { id: "central", name: "Central" },
                  ],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return new Promise<Response>((resolve, reject) => {
        const abort = () => reject(new DOMException("upstream aborted", "AbortError"));
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener("abort", abort, { once: true });
        setTimeout(() => resolve(new Response("upstream still pending", { status: 503 })), 30_000);
      });
    });

    let response: Response | undefined;
    const request = GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.91" },
      }),
    ).then((result) => {
      response = result;
      return result;
    });

    await vi.advanceTimersByTimeAsync(2_000);
    const settledWithinBudget = response !== undefined;
    const completed = await request;
    const body = await completed.json();

    expect(settledWithinBudget).toBe(true);
    expect(body.station).toEqual(
      expect.objectContaining({ id: "940GZZLUOXC", name: "Oxford Circus" }),
    );
    expect(body.staticFallback).toBeUndefined();
    expect(body.trains).toEqual([]);
    expect(body.departures).toEqual([]);
    expect(body.decision.decision).toBe("live_data_unavailable");
    expect(calls.some((url) => url.includes("/Line/victoria/Timetable/"))).toBe(true);
    expect(calls.some((url) => url.includes("/Line/central/Timetable/"))).toBe(true);
    expect(calls.some((url) => url.includes("/StopPoint/940GZZLUOXC/Arrivals"))).toBe(true);
    expect(calls.some((url) => url.includes("/Line/victoria%2Ccentral/Status"))).toBe(true);
  });

  it("does not start optional venue enrichment after the critical-read deadline", async () => {
    resetVenuePriceIndexForTests();
    const readFile = vi.spyOn(fs, "readFile");
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/StopPoint?") && !url.includes("/Arrivals")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              stopPoints: [
                {
                  id: "940GZZLUOXC",
                  commonName: "Oxford Circus",
                  distance: 120,
                  lat: 51.515,
                  lon: -0.141,
                  lines: [{ id: "victoria", name: "Victoria" }],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return new Promise<Response>((resolve, reject) => {
        const abort = () => reject(new DOMException("upstream aborted", "AbortError"));
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener("abort", abort, { once: true });
        setTimeout(() => resolve(new Response("upstream still pending", { status: 503 })), 30_000);
      });
    });

    const request = GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.92" },
      }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await request;

    expect(response.status).toBe(200);
    expect(
      readFile.mock.calls.some(([file]) => String(file).includes("pint_prices_app_dataset.json")),
    ).toBe(false);
  });

  it("skips cold nearest-pub data without starting a dataset read", async () => {
    resetVenuePriceIndexForTests();
    const readFile = vi.spyOn(fs, "readFile");
    mockFastStationResponse();

    const response = await GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.96" },
      }),
    );
    const body = await response.json();

    expect(body.nearestPubs).toEqual([]);
    expect(readFile.mock.calls.some(([file]) => String(file).includes("pint_prices_app_dataset.json"))).toBe(
      false,
    );
  });

  it("uses warm nearest-pub data without another dataset read", async () => {
    resetVenuePriceIndexForTests();
    const warmVenues = await getPricedVenues();
    expect(warmVenues.length).toBeGreaterThan(0);
    const readFile = vi.spyOn(fs, "readFile");
    mockFastStationResponse();

    const response = await GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.97" },
      }),
    );
    const body = await response.json();

    expect(body.nearestPubs).toHaveLength(3);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("does not let one request's deadline cancel a shared station producer", async () => {
    let stationResponse: Promise<Response> | null = null;
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/StopPoint?") && !url.includes("/Arrivals")) {
        if (!stationResponse) {
          stationResponse = new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                resolve(
                  new Response(
                    JSON.stringify({
                      stopPoints: [
                        {
                          id: "940GZZLUOXC",
                          commonName: "Oxford Circus",
                          distance: 120,
                          lines: [{ id: "victoria", name: "Victoria" }],
                        },
                      ],
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                  ),
                ),
              2_000,
            );
            const abort = () => {
              clearTimeout(timer);
              reject(new DOMException("upstream aborted", "AbortError"));
            };
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        return stationResponse;
      }
      if (url.includes("/Line/victoria/Timetable/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              timetable: {
                routes: [{ schedules: [{ name: "Friday", lastJourney: { hour: "23", minute: "30" } }] }],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url.includes("/Arrivals")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/Line/victoria/Status")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "victoria",
                name: "Victoria",
                lineStatuses: [{ statusSeverityDescription: "Good Service" }],
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("upstream aborted", "AbortError"));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });

    const first = GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.93" },
      }),
    );
    await vi.advanceTimersByTimeAsync(500);
    const second = GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.94" },
      }),
    );

    await vi.advanceTimersByTimeAsync(1_300);
    const firstBody = await (await first).json();
    await vi.advanceTimersByTimeAsync(300);
    const secondBody = await (await second).json();

    expect(firstBody.staticFallback).toBe(true);
    expect(secondBody.staticFallback).toBeUndefined();
    expect(secondBody.station).toEqual(
      expect.objectContaining({ id: "940GZZLUOXC", name: "Oxford Circus" }),
    );
    expect(secondBody.trains).toEqual([
      expect.objectContaining({ lineId: "victoria", clock: "23:30" }),
    ]);
  });
});
