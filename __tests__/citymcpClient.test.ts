import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callCityMcpTool,
  CityMcpError,
  fetchCityPlace,
  fetchCityStatus,
  fetchThingsToDo,
  parseSseJsonRpcBody,
  resetCityPlaceCache,
  resetCityStatusCache,
  resetThingsToDoCache,
  searchCityPlaces,
  trimCityPlace,
  trimSignals,
} from "@/lib/citymcp/client";

function sseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

beforeEach(() => {
  resetCityStatusCache();
  resetCityPlaceCache();
  resetThingsToDoCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseSseJsonRpcBody", () => {
  it("parses a single event: message frame", () => {
    const body = sseFrame({
      jsonrpc: "2.0",
      id: 1,
      result: { structuredContent: { asOf: "2026-07-11T00:00:00Z", signals: [] } },
    });
    const parsed = parseSseJsonRpcBody(body);
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBe(1);
    expect((parsed.result as { structuredContent: { asOf: string } }).structuredContent.asOf).toBe(
      "2026-07-11T00:00:00Z",
    );
  });

  it("joins multi-line data fields within one event", () => {
    const body = `event: message\ndata: {"jsonrpc":"2.0","id":2,\ndata: "result":{"structuredContent":{"ok":true}}}\n\n`;
    const parsed = parseSseJsonRpcBody(body);
    expect((parsed.result as { structuredContent: { ok: boolean } }).structuredContent.ok).toBe(true);
  });

  it("skips heartbeat comments and unknown events", () => {
    const body = `: keep-alive\n\nevent: notice\ndata: {"nope":true}\n\n${sseFrame({
      jsonrpc: "2.0",
      id: 3,
      result: { structuredContent: { asOf: "z", signals: [] } },
    })}`;
    const parsed = parseSseJsonRpcBody(body);
    expect(parsed.id).toBe(3);
  });

  it("falls back to parsing a plain JSON body", () => {
    const parsed = parseSseJsonRpcBody(
      '{"jsonrpc":"2.0","id":4,"result":{"structuredContent":{"asOf":"z","signals":[]}}}',
    );
    expect(parsed.id).toBe(4);
  });

  it("throws CityMcpError on invalid JSON", () => {
    expect(() => parseSseJsonRpcBody(`event: message\ndata: {not json}\n\n`)).toThrow(
      CityMcpError,
    );
  });

  it("throws CityMcpError when no message frame is present", () => {
    expect(() => parseSseJsonRpcBody(`event: ping\ndata: {}\n\n`)).toThrow(CityMcpError);
  });
});

describe("trimSignals", () => {
  const s = (severity: string, headline: string) => ({ headline, severity });

  it("returns [] when signals is undefined or empty", () => {
    expect(trimSignals(undefined, 5)).toEqual([]);
    expect(trimSignals([], 5)).toEqual([]);
  });

  it("caps to the requested limit", () => {
    const signals = [s("info", "a"), s("info", "b"), s("info", "c")];
    expect(trimSignals(signals, 2)).toHaveLength(2);
  });

  it("returns [] when limit is 0 or negative", () => {
    expect(trimSignals([s("major", "a")], 0)).toEqual([]);
    expect(trimSignals([s("major", "a")], -1)).toEqual([]);
  });

  it("orders by severity major > notable > info and preserves upstream order for ties", () => {
    const signals = [
      s("info", "info-1"),
      s("major", "major-1"),
      s("notable", "notable-1"),
      s("major", "major-2"),
    ];
    const out = trimSignals(signals, 4).map((x) => x.headline);
    expect(out).toEqual(["major-1", "major-2", "notable-1", "info-1"]);
  });

  it("treats unknown severities as lowest priority", () => {
    const signals = [
      s("mystery", "unknown"),
      s("info", "info"),
      s("major", "major"),
    ];
    const out = trimSignals(signals, 3).map((x) => x.headline);
    expect(out).toEqual(["major", "info", "unknown"]);
  });
});

describe("callCityMcpTool", () => {
  it("POSTs a JSON-RPC tools/call with the correct headers and body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { ok: true } },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    const result = await callCityMcpTool<{ ok: boolean }>(
      "city_status",
      { borough: "Hackney" },
      { fetchImpl, endpoint: "https://example.test/mcp" },
    );
    expect(result.structuredContent?.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://example.test/mcp");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.accept).toBe("application/json, text/event-stream");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(String(init.body));
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("city_status");
    expect(body.params.arguments).toEqual({ borough: "Hackney" });
    expect(body.jsonrpc).toBe("2.0");
  });

  it("throws CityMcpError with kind http on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 }));
    await expect(
      callCityMcpTool("city_status", {}, { fetchImpl }),
    ).rejects.toMatchObject({ kind: "http", httpStatus: 503 });
  });

  it("throws CityMcpError with kind rpc when the envelope carries an error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "no such tool" } }),
        { status: 200 },
      ),
    );
    await expect(
      callCityMcpTool("city_status", {}, { fetchImpl }),
    ).rejects.toMatchObject({ kind: "rpc", rpcCode: -32601 });
  });

  it("throws CityMcpError with kind rpc when the tool reports isError:true", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({ jsonrpc: "2.0", id: 1, result: { isError: true, structuredContent: {} } }),
        { status: 200 },
      ),
    );
    await expect(
      callCityMcpTool("city_status", {}, { fetchImpl }),
    ).rejects.toMatchObject({ kind: "rpc" });
  });
});

describe("fetchCityStatus", () => {
  it("caches results per borough key within the TTL", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              asOf: "2026-07-11T00:00:00Z",
              weather: { condition: "clear", tempC: 20 },
              signals: [{ headline: "Test", severity: "info" }],
              tubeLines: [{ line: "Victoria", status: "Good Service" }],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const first = await fetchCityStatus({}, { fetchImpl });
    const second = await fetchCityStatus({}, { fetchImpl });
    expect(first.asOf).toBe("2026-07-11T00:00:00Z");
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Different borough key → new fetch.
    await fetchCityStatus({ borough: "Hackney" }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    resetCityStatusCache();
    await fetchCityStatus({}, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("normalises missing signals/tubeLines to safe shapes", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { asOf: "2026-07-11T00:00:00Z" } },
        }),
        { status: 200 },
      ),
    );
    const status = await fetchCityStatus({}, { fetchImpl });
    expect(status.signals).toEqual([]);
    expect(status.tubeLines).toBeUndefined();
  });
});

describe("searchCityPlaces", () => {
  it("passes optional filters and returns thin place rows", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              places: [
                { id: "abc", name: "George", area: "SE1", rating: 4.3 },
                { name: "no id — should be filtered" },
                null,
                "not an object",
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );
    const places = await searchCityPlaces("The George", {
      limit: 3,
      near: "Southwark",
      openNow: true,
      minRating: 4,
      maxPrice: "££",
      sort: "rating",
      fetchImpl,
    });
    expect(places).toHaveLength(1);
    expect(places[0]?.id).toBe("abc");

    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.params.arguments).toEqual({
      query: "The George",
      limit: 3,
      near: "Southwark",
      openNow: true,
      minRating: 4,
      maxPrice: "££",
      sort: "rating",
    });
  });

  it("returns [] when structuredContent.places is missing", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({ jsonrpc: "2.0", id: 1, result: { structuredContent: {} } }),
        { status: 200 },
      ),
    );
    expect(await searchCityPlaces("anything", { fetchImpl })).toEqual([]);
  });
});

describe("trimCityPlace", () => {
  it("whitelists identity + enrichment fields and drops unknown blobs", () => {
    const place = trimCityPlace("abc", {
      name: "The George",
      address: "75 Borough High St",
      area: "Southwark",
      location: { lat: 51.5, lng: -0.09 },
      types: ["pub", "bar", "restaurant", "food", "point_of_interest", "establishment", "extra_type"],
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
          summary: "London Bridge — 4 min walk",
        },
        source: "TfL",
      },
      air: { value: { index: "Low", site: "Southwark" }, source: "LAQN" },
      // Not on whitelist — must be dropped.
      rawDump: { anything: true },
    });
    expect(place.id).toBe("abc");
    expect(place.name).toBe("The George");
    expect(place.types).toHaveLength(6);
    expect(place.hygiene?.value?.rating).toBe(5);
    expect(place.transit?.value?.summary).toBe("London Bridge — 4 min walk");
    expect(place.air?.value?.index).toBe("Low");
    expect((place as unknown as { rawDump?: unknown }).rawDump).toBeUndefined();
  });

  it("returns just the id when structured content is empty/nonsense", () => {
    expect(trimCityPlace("id-only", undefined)).toEqual({ id: "id-only" });
    expect(trimCityPlace("id-2", { name: "" }).name).toBeUndefined();
  });

  it("skips enrichment blocks with no usable value", () => {
    const place = trimCityPlace("abc", {
      hygiene: { source: "FSA" },
      transit: { value: {} },
    });
    expect(place.hygiene).toBeUndefined();
    expect(place.transit).toBeUndefined();
  });

  // A2 — the live get_place shape: transit.value.nearbyStops[]. The legacy
  // nearest/lines/walkMinutes fields stopped arriving, which made the strip
  // render nothing; the trim now reads the live shape first.
  it("keeps live nearbyStops transit, capped at 3, dropping malformed stops", () => {
    const place = trimCityPlace("abc", {
      transit: {
        value: {
          nearbyStops: [
            { name: "Old Street", modes: ["tube"], distanceM: 210 },
            { name: "Moorgate", modes: ["tube", "rail"], distanceM: 480 },
            { notAName: true },
            { name: "Liverpool Street", distanceM: 700 },
            { name: "Bank", modes: ["tube"], distanceM: 900 },
          ],
        },
        source: "TfL",
      },
    });
    expect(place.transit?.value?.nearbyStops).toEqual([
      { name: "Old Street", modes: ["tube"], distanceM: 210 },
      { name: "Moorgate", modes: ["tube", "rail"], distanceM: 480 },
      { name: "Liverpool Street", distanceM: 700 },
    ]);
  });

  it("still accepts the legacy transit shape (back-compat)", () => {
    const place = trimCityPlace("abc", {
      transit: {
        value: { nearest: "London Bridge", walkMinutes: 4 },
        source: "TfL",
      },
    });
    expect(place.transit?.value?.nearest).toBe("London Bridge");
    expect(place.transit?.value?.nearbyStops).toBeUndefined();
  });

  it("drops transit when every nearbyStop is malformed and no legacy fields exist", () => {
    const place = trimCityPlace("abc", {
      transit: { value: { nearbyStops: [{ distanceM: 100 }, {}] } },
    });
    expect(place.transit).toBeUndefined();
  });
});

describe("fetchCityPlace", () => {
  it("caches per (id, deep) within TTL and passes deep:true through", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: { name: "Blue Post", openNow: true },
          },
        }),
        { status: 200 },
      ),
    );

    const a = await fetchCityPlace("place-1", { fetchImpl });
    const b = await fetchCityPlace("place-1", { fetchImpl });
    expect(a.name).toBe("Blue Post");
    expect(b).toEqual(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Different deep flag = different cache key.
    await fetchCityPlace("place-1", { deep: true, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Deep flag was forwarded to the upstream args.
    const call = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.params.arguments).toEqual({ id: "place-1", deep: true });

    // Reset drops all cache entries.
    resetCityPlaceCache();
    await fetchCityPlace("place-1", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws CityMcpError when id is empty", async () => {
    await expect(fetchCityPlace("")).rejects.toBeInstanceOf(CityMcpError);
  });
});

describe("fetchThingsToDo", () => {
  it("trims opportunities, caps by limit, and caches per args", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              area: "Soho",
              opportunities: [
                {
                  title: "Show 1",
                  kind: "gig",
                  areas: ["Soho"],
                  startsAt: "2026-07-29T20:00:00+01:00",
                },
                { title: "Show 2", price: "cheap" },
                { title: "" },
                null,
                { title: "Show 3", place: { name: "Ronnie Scott's" } },
                { title: "Show 4" },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const first = await fetchThingsToDo({
      window: "tonight",
      area: "Soho",
      limit: 2,
      fetchImpl,
    });
    expect(first.opportunities).toHaveLength(2);
    expect(first.opportunities.map((o) => o.title)).toEqual(["Show 1", "Show 2"]);
    expect(first.opportunities[0].startsAt).toBe("2026-07-29T20:00:00+01:00");

    // Cache hit — no new upstream call.
    const second = await fetchThingsToDo({
      window: "tonight",
      area: "Soho",
      limit: 2,
      fetchImpl,
    });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Different window bypasses cache.
    await fetchThingsToDo({ window: "tomorrow_night", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    resetThingsToDoCache();
    await fetchThingsToDo({ window: "tonight", area: "Soho", limit: 2, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws CityMcpError when window is invalid", async () => {
    await expect(
      // @ts-expect-error — invalid window on purpose
      fetchThingsToDo({ window: "someday" }),
    ).rejects.toBeInstanceOf(CityMcpError);
  });
});

describe("callCityMcpTool transient retry", () => {
  it("retries once on a transient 503 then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) return new Response("boom", { status: 503 });
      return new Response(
        sseFrame({ jsonrpc: "2.0", id: 1, result: { structuredContent: {} } }),
        { status: 200 },
      );
    });
    const res = await callCityMcpTool("city_status", {}, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res).toBeDefined();
  });

  it("does NOT retry a deterministic rpc error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "no such tool" } }),
        { status: 200 },
      ),
    );
    await expect(
      callCityMcpTool("city_status", {}, { fetchImpl }),
    ).rejects.toMatchObject({ kind: "rpc" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("respects retries:0 (no extra attempt on a transient failure)", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 }));
    await expect(
      callCityMcpTool("city_status", {}, { fetchImpl, retries: 0 }),
    ).rejects.toMatchObject({ kind: "http", httpStatus: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("serve-last-known-on-error (stale-serve)", () => {
  const statusFrame = (asOf: string) =>
    new Response(
      sseFrame({
        jsonrpc: "2.0",
        id: 1,
        result: {
          structuredContent: {
            asOf,
            weather: { condition: "clear", tempC: 18 },
            signals: [{ headline: "Roadworks", severity: "notable" }],
          },
        },
      }),
      { status: 200 },
    );

  it("serves the last-known city_status stamped stale after a failed refresh past TTL", async () => {
    vi.useFakeTimers();
    try {
      const good = vi.fn(async () => statusFrame("2026-07-11T00:00:00Z"));
      const first = await fetchCityStatus({}, { fetchImpl: good });
      expect(first.stale).toBeUndefined();
      expect(first.asOf).toBe("2026-07-11T00:00:00Z");

      // Age the entry past CITY_STATUS_TTL_MS (5min) so the next read refetches.
      vi.advanceTimersByTime(6 * 60 * 1000);

      const bad = vi.fn(async () => new Response("down", { status: 503 }));
      const second = await fetchCityStatus({}, { fetchImpl: bad, retries: 0 });
      expect(second.stale).toBe(true);
      // Original upstream timestamp is preserved so the UI labels it as old.
      expect(second.asOf).toBe("2026-07-11T00:00:00Z");
      expect(second.signals).toEqual(first.signals);
      // The retained cache entry itself must stay clean (no leaked stale flag).
      const third = await fetchCityStatus({}, { fetchImpl: good });
      expect(third.stale).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves the last-known get_place stamped stale after a failed refresh", async () => {
    vi.useFakeTimers();
    try {
      const good = vi.fn(async () =>
        new Response(
          sseFrame({
            jsonrpc: "2.0",
            id: 1,
            result: { structuredContent: { id: "p1", name: "The Anchor" } },
          }),
          { status: 200 },
        ),
      );
      const first = await fetchCityPlace("p1", { fetchImpl: good });
      expect(first.name).toBe("The Anchor");
      expect(first.stale).toBeUndefined();

      vi.advanceTimersByTime(11 * 60 * 1000); // > PLACE_TTL_MS (10min)

      const bad = vi.fn(async () => new Response("x", { status: 500 }));
      const second = await fetchCityPlace("p1", { fetchImpl: bad, retries: 0 });
      expect(second.stale).toBe(true);
      expect(second.name).toBe("The Anchor");
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates the error on a cold miss with no last-known value", async () => {
    const bad = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(
      fetchCityStatus({}, { fetchImpl: bad, retries: 0 }),
    ).rejects.toMatchObject({ kind: "http" });
  });
});
