import { describe, expect, it } from "vitest";

import { loadWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import type { WhatsOnRow } from "@/lib/whatsOn";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

const validRow: WhatsOnRow = {
  id: "r1",
  venueId: "v1",
  placeName: "The Test Arms",
  kind: "quiz",
  startsAt: "2026-07-12T19:00:00.000Z",
  title: "Quiz night",
  source: { label: "Org", url: "https://example.com" },
  observedAt: "2026-07-12T09:00:00.000Z",
  confidence: "listed",
};

describe("loadWhatsOnTonight (W1 primary-spine loader)", () => {
  it("returns ready with validated rows on a good response", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () =>
        jsonResponse({ rows: [validRow, { junk: true }], asOf: "2026-07-12T10:00:00.000Z" }),
    });
    expect(result.status).toBe("ready");
    expect(result.rows).toHaveLength(1);
    expect(result.asOf).toBe("2026-07-12T10:00:00.000Z");
  });

  it("carries provider-observed source freshness through, distinct from request time", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () =>
        jsonResponse({
          rows: [validRow],
          servedAt: "2026-07-12T20:00:00.000Z",
          sourceObservedAt: "2026-07-12T18:30:00.000Z",
          sourceFreshnessKind: "provider-observed",
          asOf: "2026-07-12T18:30:00.000Z",
        }),
    });
    expect(result.sourceFreshnessKind).toBe("provider-observed");
    expect(result.sourceObservedAt).toBe("2026-07-12T18:30:00.000Z");
    expect(result.asOf).toBe("2026-07-12T18:30:00.000Z");
  });

  it("reports unknown freshness with a null source time (never request time)", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () =>
        jsonResponse({
          rows: [validRow],
          servedAt: "2026-07-12T20:00:00.000Z",
          sourceObservedAt: null,
          sourceFreshnessKind: "unknown",
          asOf: null,
        }),
    });
    expect(result.sourceFreshnessKind).toBe("unknown");
    expect(result.sourceObservedAt).toBeNull();
    expect(result.asOf).toBeNull();
  });

  it("defaults to unknown freshness for a legacy body carrying only asOf", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () => jsonResponse({ rows: [validRow], asOf: "2026-07-12T10:00:00.000Z" }),
    });
    // No sourceFreshnessKind field → unknown; asOf still aliases sourceObservedAt.
    expect(result.sourceFreshnessKind).toBe("unknown");
    expect(result.sourceObservedAt).toBe("2026-07-12T10:00:00.000Z");
  });

  it("carries a per-kind source date through, so one lane cannot borrow another's", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () =>
        jsonResponse({
          rows: [validRow],
          sourceObservedAt: "2026-08-10T08:43:37.191Z",
          sourceFreshnessKind: "dataset-generated",
          kindObservedAt: {
            deal: "2026-08-10T08:43:37.191Z",
            music: "2026-07-18T21:25:03.316Z",
            // Unusable values must not become a date printed beside a listing.
            quiz: "not-a-time",
            nonsense: "2026-08-10T08:43:37.191Z",
          },
          asOf: "2026-08-10T08:43:37.191Z",
        }),
    });
    expect(result.kindObservedAt).toEqual({
      deal: "2026-08-10T08:43:37.191Z",
      music: "2026-07-18T21:25:03.316Z",
    });
  });

  it("carries no per-kind dates when the server sends none", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () => jsonResponse({ rows: [validRow], asOf: "2026-07-12T10:00:00.000Z" }),
    });
    expect(result.kindObservedAt).toEqual({});
  });

  it("reports unknown freshness with no source time on an outage", async () => {
    const result = await loadWhatsOnTonight({ fetchImpl: async () => jsonResponse({}, false) });
    expect(result.status).toBe("error");
    expect(result.sourceFreshnessKind).toBe("unknown");
    expect(result.sourceObservedAt).toBeNull();
  });

  it("returns empty (not error) when the spine is up but quiet", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () => jsonResponse({ rows: [], asOf: "2026-07-12T10:00:00.000Z" }),
    });
    expect(result.status).toBe("empty");
  });

  it("returns error on a non-OK response — an outage, not a quiet night", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () => jsonResponse({ error: "boom" }, false),
    });
    expect(result.status).toBe("error");
    expect(result.rows).toHaveLength(0);
  });

  it("returns error for the route's fail-soft HTTP 200 envelope", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () =>
        jsonResponse({
          rows: [],
          asOf: "2026-07-12T10:00:00.000Z",
          error: "Store unavailable",
        }),
    });
    expect(result.status).toBe("error");
    expect(result.rows).toEqual([]);
    expect(result.asOf).toBe("2026-07-12T10:00:00.000Z");
  });

  it("returns error when fetch throws", async () => {
    const result = await loadWhatsOnTonight({
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    expect(result.status).toBe("error");
  });

  it("aborts a hung request after the timeout and returns error", async () => {
    const result = await loadWhatsOnTonight({
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    expect(result.status).toBe("error");
  });
});
