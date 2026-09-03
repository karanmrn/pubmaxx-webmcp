import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUS_ARRIVALS_TIMEOUT_MS,
  BUS_DEPARTURES_REFRESH_MS,
  BUS_DEPARTURES_TICK_MS,
  BUS_MIN_ATTEMPT_MS,
  BUS_ROUTE_BUDGET_MS,
  BUS_STOP_LOOKUP_TIMEOUT_MS,
  BUS_UPSTREAM_BUDGET_MS,
  busDeparturesFreshness,
  busUpstreamTimeoutMs,
  departureDueMinutes,
  freshBusPredictions,
  shouldPollBusDepartures,
  startBusDeparturesPoll,
} from "@/lib/nearbyBusDepartures";

describe("freshBusPredictions", () => {
  const now = new Date("2026-07-28T22:40:00.000Z");

  it("keeps fresh directed predictions and sorts them by expected arrival", () => {
    const result = freshBusPredictions(
      [
        {
          naptanId: "490000123B",
          lineName: "63",
          destinationName: "King's Cross",
          direction: "outbound",
          timestamp: "2026-07-28T22:39:20.000Z",
          expectedArrival: "2026-07-28T22:46:00.000Z",
        },
        {
          naptanId: "490000123B",
          lineName: "45",
          destinationName: "Clapham Park",
          direction: "inbound",
          timestamp: "2026-07-28T22:39:40.000Z",
          expectedArrival: "2026-07-28T22:43:00.000Z",
        },
      ],
      now,
    );

    expect(result).toEqual([
      {
        naptanId: "490000123B",
        lineName: "45",
        destinationName: "Clapham Park",
        direction: "inbound",
        expectedArrival: "2026-07-28T22:43:00.000Z",
      },
      {
        naptanId: "490000123B",
        lineName: "63",
        destinationName: "King's Cross",
        direction: "outbound",
        expectedArrival: "2026-07-28T22:46:00.000Z",
      },
    ]);
  });

  it("removes stale, unaged, past, distant, and undirected predictions", () => {
    const base = {
      naptanId: "490000123B",
      lineName: "63",
      destinationName: "King's Cross",
      direction: "outbound",
      timestamp: "2026-07-28T22:39:00.000Z",
      expectedArrival: "2026-07-28T22:44:00.000Z",
    };

    const result = freshBusPredictions(
      [
        base,
        { ...base, lineName: "stale", timestamp: "2026-07-28T22:37:59.000Z" },
        { ...base, lineName: "missing-age", timestamp: undefined },
        { ...base, lineName: "gone", expectedArrival: "2026-07-28T22:39:59.000Z" },
        { ...base, lineName: "too-far", expectedArrival: "2026-07-28T23:40:01.000Z" },
        { ...base, lineName: "no-destination", destinationName: " " },
      ],
      now,
    );

    expect(result.map((prediction) => prediction.lineName)).toEqual(["63"]);
  });

  it("tolerates a small upstream clock lead without loosening the stale ceiling", () => {
    const base = {
      naptanId: "490000123B",
      lineName: "63",
      destinationName: "King's Cross",
      direction: "outbound",
      expectedArrival: "2026-07-28T22:44:00.000Z",
    };

    const result = freshBusPredictions(
      [
        { ...base, lineName: "skewed", timestamp: "2026-07-28T22:40:03.000Z" },
        { ...base, lineName: "far-future", timestamp: "2026-07-28T22:40:30.000Z" },
        { ...base, lineName: "stale", timestamp: "2026-07-28T22:37:30.000Z" },
      ],
      now,
    );

    expect(result.map((prediction) => prediction.lineName)).toEqual(["skewed"]);
  });
});

describe("departureDueMinutes", () => {
  const expectedArrival = "2026-07-28T22:43:00.000Z";

  it("ages off the arrival's own time rather than a rendered figure", () => {
    expect(
      departureDueMinutes(expectedArrival, new Date("2026-07-28T22:40:00.000Z")),
    ).toBe(3);
    expect(
      departureDueMinutes(expectedArrival, new Date("2026-07-28T22:42:10.000Z")),
    ).toBe(1);
    expect(
      departureDueMinutes(expectedArrival, new Date("2026-07-28T22:43:30.000Z")),
    ).toBeLessThanOrEqual(0);
  });

  it("reports an unreadable arrival as unknown rather than as a number", () => {
    expect(departureDueMinutes("soon", new Date("2026-07-28T22:40:00.000Z"))).toBe(
      null,
    );
  });
});

describe("busDeparturesFreshness", () => {
  const generatedAt = "2026-07-28T22:40:00.000Z";

  it("names a check's age once it is old enough to matter", () => {
    expect(
      busDeparturesFreshness(generatedAt, new Date("2026-07-28T22:40:20.000Z")),
    ).toEqual({ state: "live", ageMinutes: 0 });
    expect(
      busDeparturesFreshness(generatedAt, new Date("2026-07-28T22:41:10.000Z")),
    ).toEqual({ state: "ageing", ageMinutes: 1 });
  });

  it("stops vouching for a countdown once the check is too old", () => {
    expect(
      busDeparturesFreshness(generatedAt, new Date("2026-07-28T22:42:30.000Z")),
    ).toEqual({ state: "out-of-date", ageMinutes: 2 });
  });

  it("treats an undatable check as out of date rather than as a fresh one", () => {
    expect(
      busDeparturesFreshness("", new Date("2026-07-28T22:40:00.000Z")),
    ).toEqual({ state: "out-of-date", ageMinutes: null });
  });
});

describe("shouldPollBusDepartures", () => {
  it("asks TfL again only while the card is open and the page is on screen", () => {
    expect(shouldPollBusDepartures({ open: true, documentVisible: true })).toBe(
      true,
    );
    expect(shouldPollBusDepartures({ open: true, documentVisible: false })).toBe(
      false,
    );
    expect(shouldPollBusDepartures({ open: false, documentVisible: true })).toBe(
      false,
    );
  });
});

describe("tflFetch", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("separates a settled answer from one worth asking again", async () => {
    const { tflFetch, tflGet } = await import("@/lib/tflClient.server");

    global.fetch = vi.fn(async () => new Response("nope", { status: 404 }));
    expect(await tflFetch("/StopPoint?lat=51.5&lon=-0.1")).toEqual({
      ok: false,
      retryable: false,
    });

    global.fetch = vi.fn(async () => new Response("later", { status: 503 }));
    expect(await tflFetch("/StopPoint?lat=51.5&lon=-0.1")).toEqual({
      ok: false,
      retryable: true,
    });

    global.fetch = vi.fn(async () => new Response("later", { status: 429 }));
    expect(await tflFetch("/StopPoint?lat=51.5&lon=-0.1")).toEqual({
      ok: false,
      retryable: true,
    });

    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await tflFetch("/StopPoint?lat=51.5&lon=-0.1")).toEqual({
      ok: false,
      retryable: true,
    });

    expect(await tflFetch("https://evil.example.com/StopPoint")).toEqual({
      ok: false,
      retryable: false,
    });

    global.fetch = vi.fn(async () => Response.json({ stopPoints: [] }));
    expect(await tflFetch("/StopPoint?lat=51.5&lon=-0.1")).toEqual({
      ok: true,
      data: { stopPoints: [] },
    });
    // Callers that only want the answer still read a failure as null.
    expect(await tflGet("/StopPoint?lat=51.5&lon=-0.1")).toEqual({
      stopPoints: [],
    });
    global.fetch = vi.fn(async () => new Response("nope", { status: 404 }));
    expect(await tflGet("/StopPoint?lat=51.5&lon=-0.1")).toBe(null);
  });
});

describe("busUpstreamTimeoutMs", () => {
  it("gives the stop lookup its measured headroom on the first attempt", () => {
    expect(
      busUpstreamTimeoutMs(BUS_STOP_LOOKUP_TIMEOUT_MS, 0, BUS_MIN_ATTEMPT_MS),
    ).toBe(BUS_STOP_LOOKUP_TIMEOUT_MS);
  });

  it("never lets a call outlive what is left of the route's budget", () => {
    const stopAttempt = busUpstreamTimeoutMs(
      BUS_STOP_LOOKUP_TIMEOUT_MS,
      0,
      BUS_MIN_ATTEMPT_MS,
    );
    const retry = busUpstreamTimeoutMs(
      BUS_STOP_LOOKUP_TIMEOUT_MS,
      stopAttempt,
      BUS_MIN_ATTEMPT_MS,
    );
    const arrivals = busUpstreamTimeoutMs(
      BUS_ARRIVALS_TIMEOUT_MS,
      stopAttempt + retry,
    );

    expect(stopAttempt + retry + arrivals).toBeLessThanOrEqual(
      BUS_UPSTREAM_BUDGET_MS,
    );
    expect(BUS_UPSTREAM_BUDGET_MS).toBeLessThan(BUS_ROUTE_BUDGET_MS);
  });

  it("hands back nothing once the budget is spent", () => {
    expect(busUpstreamTimeoutMs(BUS_ARRIVALS_TIMEOUT_MS, BUS_ROUTE_BUDGET_MS)).toBe(
      0,
    );
  });
});

describe("startBusDeparturesPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T22:40:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads once immediately, ticks the clock, and refreshes on cadence", async () => {
    const ticks: number[] = [];
    const loads: AbortSignal[] = [];
    const poll = startBusDeparturesPoll({
      onTick: (at) => ticks.push(at),
      load: async (signal) => {
        loads.push(signal);
      },
    });

    expect(loads).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(BUS_DEPARTURES_TICK_MS);
    expect(ticks).toHaveLength(1);
    expect(loads).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(BUS_DEPARTURES_REFRESH_MS);
    expect(loads).toHaveLength(2);

    poll.stop();
  });

  it("never overlaps loads", async () => {
    let started = 0;
    const poll = startBusDeparturesPoll({
      load: () =>
        new Promise<void>(() => {
          started += 1;
        }),
      onTick: () => {},
    });

    await vi.advanceTimersByTimeAsync(BUS_DEPARTURES_REFRESH_MS * 4);

    expect(started).toBe(1);
    poll.stop();
  });

  it("stops ticking and aborts what is in flight when it is stopped", async () => {
    const ticks: number[] = [];
    const signals: AbortSignal[] = [];
    const poll = startBusDeparturesPoll({
      onTick: (at) => ticks.push(at),
      load: async (signal) => {
        signals.push(signal);
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve());
        });
      },
    });

    poll.stop();

    expect(signals[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(BUS_DEPARTURES_REFRESH_MS * 4);
    expect(ticks).toEqual([]);
    expect(signals).toHaveLength(1);
  });

  it("keeps a floor between restarts instead of reloading data it already holds", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
    };

    const reopened = startBusDeparturesPoll({
      lastLoadAt: Date.now() - (BUS_DEPARTURES_REFRESH_MS - 1_000),
      onTick: () => {},
      load,
    });
    expect(loads).toBe(0);
    reopened.stop();

    const stale = startBusDeparturesPoll({
      lastLoadAt: Date.now() - BUS_DEPARTURES_REFRESH_MS,
      onTick: () => {},
      load,
    });
    expect(loads).toBe(1);
    stale.stop();
  });

  it("reports each load's start so a restart inherits the floor", async () => {
    const starts: number[] = [];
    const poll = startBusDeparturesPoll({
      onLoadStart: (at) => starts.push(at),
      onTick: () => {},
      load: async () => {},
    });

    expect(starts).toEqual([Date.now()]);
    poll.stop();
  });

  it("retries on request without duplicating a load in flight", async () => {
    let loads = 0;
    const releases: (() => void)[] = [];
    const poll = startBusDeparturesPoll({
      onTick: () => {},
      load: () =>
        new Promise<void>((resolve) => {
          loads += 1;
          releases.push(resolve);
        }),
    });

    expect(loads).toBe(1);
    poll.refresh();
    poll.refresh();
    expect(loads).toBe(1);

    releases[0]();
    await vi.advanceTimersByTimeAsync(0);
    poll.refresh();
    expect(loads).toBe(2);

    poll.stop();
  });
});

describe("GET /api/nearby-bus-departures", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T22:40:00.000Z"));
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns bounded fresh departures with stop distance and direction", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/StopPoint?")) {
        return Response.json({
          stopPoints: [
            {
              id: "490000123B",
              commonName: "Blackfriars Station",
              indicator: "Stop B",
              towards: "King's Cross",
              distance: 140.4,
            },
            {
              id: "490000123C",
              commonName: "Blackfriars Station",
              indicator: "Stop C",
              towards: "Waterloo",
              distance: 180,
            },
            {
              id: "490000123D",
              commonName: "Ludgate Circus",
              indicator: "Stop D",
              towards: "Aldwych",
              distance: 260,
            },
            {
              id: "490000123E",
              commonName: "Ludgate Circus",
              indicator: "Stop E",
              towards: "Elephant & Castle",
              distance: 310,
            },
            {
              id: "490000123F",
              commonName: "Fleet Street",
              indicator: "Stop F",
              towards: "Holborn",
              distance: 390,
            },
          ],
        });
      }
      if (url.includes("/Arrivals")) {
        // TfL answers per stop point, so the fixture does too: a stop only ever
        // sees its own predictions.
        const asked = decodeURIComponent(
          new URL(url).pathname.split("/")[2] ?? "",
        );
        const predictions = [
          {
            naptanId: "490000123B",
            lineName: "63",
            destinationName: "King's Cross",
            direction: "outbound",
            timestamp: "2026-07-28T22:39:40.000Z",
            expectedArrival: "2026-07-28T22:43:00.000Z",
          },
          {
            naptanId: "490000123B",
            lineName: "45",
            destinationName: "Clapham Park",
            direction: "inbound",
            timestamp: "2026-07-28T22:39:30.000Z",
            expectedArrival: "2026-07-28T22:45:00.000Z",
          },
          {
            naptanId: "490000123B",
            lineName: "17",
            destinationName: "Archway",
            direction: "outbound",
            timestamp: "2026-07-28T22:39:20.000Z",
            expectedArrival: "2026-07-28T22:47:00.000Z",
          },
          {
            naptanId: "490000123B",
            lineName: "40",
            destinationName: "Dulwich",
            direction: "inbound",
            timestamp: "2026-07-28T22:39:10.000Z",
            expectedArrival: "2026-07-28T22:49:00.000Z",
          },
          ...["C", "D", "E"].map((suffix, index) => ({
            naptanId: `490000123${suffix}`,
            lineName: String(100 + index),
            destinationName: ["Waterloo", "Aldwych", "Elephant & Castle"][index],
            direction: index % 2 === 0 ? "inbound" : "outbound",
            timestamp: "2026-07-28T22:39:30.000Z",
            expectedArrival: `2026-07-28T22:${44 + index}:00.000Z`,
          })),
          {
            naptanId: "490000123C",
            lineName: "stale",
            destinationName: "Old prediction",
            direction: "outbound",
            timestamp: "2026-07-28T22:37:00.000Z",
            expectedArrival: "2026-07-28T22:44:00.000Z",
          },
        ];
        return Response.json(
          predictions.filter((prediction) => prediction.naptanId === asked),
        );
      }
      return new Response("not found", { status: 404 });
    });

    const { GET } = await import("@/app/api/nearby-bus-departures/route");
    const response = await GET(
      new Request(
        "http://localhost/api/nearby-bus-departures?lat=51.512&lng=-0.104",
        { headers: { "x-forwarded-for": "198.51.100.31" } },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.status).toBe("ready");
    expect(body.generatedAt).toBe("2026-07-28T22:40:00.000Z");
    expect(body.stops).toHaveLength(4);
    expect(body.stops[0]).toMatchObject({
      id: "490000123B",
      name: "Blackfriars Station",
      indicator: "Stop B",
      towards: "King's Cross",
      distanceM: 140,
    });
    expect(body.stops[0].departures).toHaveLength(3);
    expect(body.stops[0].departures[0]).toEqual({
      lineName: "63",
      destinationName: "King's Cross",
      direction: "outbound",
      expectedArrival: "2026-07-28T22:43:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("stale");
    expect(JSON.stringify(body)).not.toContain("490000123F");
    // A relative figure frozen at response time is the one thing a countdown
    // must never be rebuilt from, so it is not in the payload to be found.
    expect(JSON.stringify(body)).not.toContain("dueMinutes");

    const calls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    const stopCall = calls.find((url) => url.includes("/StopPoint?"));
    expect(stopCall).toContain("stopTypes=NaptanPublicBusCoachTram");
    expect(stopCall).toContain("radius=500");
    expect(stopCall).toContain("modes=bus");
    // TfL's Arrivals endpoint answers for ONE stop point: a comma-joined id
    // list is a 404, so the capped stops are asked one request each.
    const arrivalCalls = calls.filter((url) => url.includes("/Arrivals"));
    expect(
      arrivalCalls.map((url) => new URL(url).pathname).sort(),
    ).toEqual([
      "/StopPoint/490000123B/Arrivals",
      "/StopPoint/490000123C/Arrivals",
      "/StopPoint/490000123D/Arrivals",
      "/StopPoint/490000123E/Arrivals",
    ]);
  });

  it("keeps its whole upstream budget inside its own function lifetime", async () => {
    const route = await import("@/app/api/nearby-bus-departures/route");

    expect(route.maxDuration).toBe(15);
    expect(BUS_ROUTE_BUDGET_MS).toBe(route.maxDuration * 1000);
    expect(BUS_UPSTREAM_BUDGET_MS).toBeLessThan(route.maxDuration * 1000);
    expect(BUS_STOP_LOOKUP_TIMEOUT_MS).toBe(9_000);
  });

  it("declares maxDuration where the build's static analysis can read it", () => {
    // Next extracts route segment config statically: an expression is dropped
    // and the platform default silently replaces this budget, so the literal
    // is the contract and reading the export back cannot prove it.
    const source = readFileSync(
      join(process.cwd(), "app/api/nearby-bus-departures/route.ts"),
      "utf8",
    );

    expect(source).toMatch(/^export const maxDuration = 15;$/m);
  });

  it("judges predictions against the clock after the calls, not before them", async () => {
    // A stop lookup that really takes six seconds is inside the measured band,
    // and its arrivals are stamped from that later moment. Judging them against
    // a timestamp taken before the lookup reads our own latency as a source
    // clock running ahead and discards working data.
    const startedAt = Date.parse("2026-07-28T22:40:00.000Z");
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/StopPoint?")) {
        vi.setSystemTime(new Date(startedAt + 6_000));
        return Response.json({
          stopPoints: [
            {
              id: "490000123B",
              commonName: "Blackfriars Station",
              indicator: "Stop B",
              distance: 140,
            },
          ],
        });
      }
      return Response.json([
        {
          naptanId: "490000123B",
          lineName: "63",
          destinationName: "King's Cross",
          direction: "outbound",
          timestamp: "2026-07-28T22:40:06.000Z",
          expectedArrival: "2026-07-28T22:43:00.000Z",
        },
      ]);
    });

    const { GET } = await import("@/app/api/nearby-bus-departures/route");
    const body = await (
      await GET(
        new Request(
          "http://localhost/api/nearby-bus-departures?lat=51.512&lng=-0.104",
          { headers: { "x-forwarded-for": "198.51.100.35" } },
        ),
      )
    ).json();

    expect(body.status).toBe("ready");
    expect(body.stops[0].departures[0].lineName).toBe("63");
    expect(body.generatedAt).toBe("2026-07-28T22:40:06.000Z");
  });

  it("does not spend a second request on a lookup that answered for good", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 404 }));

    const { GET } = await import("@/app/api/nearby-bus-departures/route");
    const response = await GET(
      new Request(
        "http://localhost/api/nearby-bus-departures?lat=51.512&lng=-0.104",
        { headers: { "x-forwarded-for": "198.51.100.36" } },
      ),
    );

    expect(await response.json()).toMatchObject({ status: "unavailable" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a failed stop lookup inside its own budget", async () => {
    let stopCalls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/StopPoint?")) {
        stopCalls += 1;
        return stopCalls === 1
          ? new Response("upstream hiccup", { status: 503 })
          : Response.json({
              stopPoints: [
                {
                  id: "490000123B",
                  commonName: "Blackfriars Station",
                  indicator: "Stop B",
                  distance: 140,
                },
              ],
            });
      }
      return Response.json([
        {
          naptanId: "490000123B",
          lineName: "63",
          destinationName: "King's Cross",
          direction: "outbound",
          timestamp: "2026-07-28T22:39:40.000Z",
          expectedArrival: "2026-07-28T22:43:00.000Z",
        },
      ]);
    });

    const { GET } = await import("@/app/api/nearby-bus-departures/route");
    const response = await GET(
      new Request(
        "http://localhost/api/nearby-bus-departures?lat=51.512&lng=-0.104",
        { headers: { "x-forwarded-for": "198.51.100.34" } },
      ),
    );
    const body = await response.json();

    expect(body.status).toBe("ready");
    const calls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    expect(calls.filter((url) => url.includes("/StopPoint?"))).toHaveLength(2);
    expect(calls.filter((url) => url.includes("/Arrivals"))).toHaveLength(1);
  });

  it("rejects invalid and non-London coordinates without calling TfL", async () => {
    global.fetch = vi.fn();
    const { GET } = await import("@/app/api/nearby-bus-departures/route");

    const invalid = await GET(
      new Request("http://localhost/api/nearby-bus-departures?lat=nope&lng=-0.1"),
    );
    const outside = await GET(
      new Request("http://localhost/api/nearby-bus-departures?lat=51.75&lng=-1.26"),
    );

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Add valid lat and lng coordinates.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect(outside.status).toBe(200);
    expect(await outside.json()).toMatchObject({ status: "unavailable", stops: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports unavailable when TfL cannot return stops or fresh predictions", async () => {
    const { GET } = await import("@/app/api/nearby-bus-departures/route");

    global.fetch = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const noStops = await GET(
      new Request(
        "http://localhost/api/nearby-bus-departures?lat=51.512&lng=-0.104",
        { headers: { "x-forwarded-for": "198.51.100.32" } },
      ),
    );
    expect(await noStops.json()).toMatchObject({ status: "unavailable", stops: [] });
    expect(noStops.headers.get("cache-control")).toBe("no-store");

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/StopPoint?")) {
        return Response.json({
          stopPoints: [
            {
              id: "490000123B",
              commonName: "Blackfriars Station",
              indicator: "Stop B",
              distance: 140,
            },
          ],
        });
      }
      return Response.json([
        {
          naptanId: "490000123B",
          lineName: "63",
          destinationName: "King's Cross",
          direction: "outbound",
          timestamp: "2026-07-28T22:35:00.000Z",
          expectedArrival: "2026-07-28T22:43:00.000Z",
        },
      ]);
    });
    const staleOnly = await GET(
      new Request(
        "http://localhost/api/nearby-bus-departures?lat=51.512&lng=-0.104",
        { headers: { "x-forwarded-for": "198.51.100.33" } },
      ),
    );
    expect(await staleOnly.json()).toMatchObject({ status: "unavailable", stops: [] });

    // A stop whose own Arrivals read failed is a failed check, never a stop
    // with no buses coming.
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/StopPoint?")) {
        return Response.json({
          stopPoints: [
            {
              id: "490000123B",
              commonName: "Blackfriars Station",
              indicator: "Stop B",
              distance: 140,
            },
          ],
        });
      }
      return new Response("unavailable", { status: 503 });
    });
    const arrivalsDown = await GET(
      new Request(
        "http://localhost/api/nearby-bus-departures?lat=51.512&lng=-0.104",
        { headers: { "x-forwarded-for": "198.51.100.37" } },
      ),
    );
    expect(await arrivalsDown.json()).toMatchObject({
      status: "unavailable",
      stops: [],
    });
  });
});
