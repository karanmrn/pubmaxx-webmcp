import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/citymcp/status/route";
import { resetCityStatusCache } from "@/lib/citymcp/client";

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
  resetCityStatusCache();
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

describe("GET /api/citymcp/status", () => {
  it("fails soft with 200 + empty signals when the upstream errors", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 503 }));
    const res = await GET(new Request("http://localhost/api/citymcp/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals).toEqual([]);
    expect(body.tubeLines).toEqual([]);
    expect(body.weather).toBeNull();
    expect(body.error).toMatch(/HTTP 503|CityMCP/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns trimmed tube lines (dropping 'Good Service') and top-8 signals by severity", async () => {
    const signals = Array.from({ length: 12 }, (_, i) => ({
      headline: `Signal ${i}`,
      severity: i % 3 === 0 ? "major" : i % 3 === 1 ? "notable" : "info",
    }));
    const tubeLines = [
      { line: "Victoria", status: "Good Service" },
      { line: "Circle", status: "Minor Delays", disruption: "Trains cancelled" },
      { line: "Piccadilly", status: "Part Closure" },
    ];
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              asOf: "2026-07-11T00:00:00Z",
              weather: { condition: "clear", tempC: 20 },
              signals,
              tubeLines,
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(new Request("http://localhost/api/citymcp/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asOf).toBe("2026-07-11T00:00:00Z");
    expect(body.signals).toHaveLength(8);
    // All top signals should be `major` first, then `notable` — never `info`.
    expect(body.signals.every((s: { severity: string }) => s.severity !== "info")).toBe(true);
    expect(body.tubeLines).toHaveLength(2);
    expect(body.tubeLines.every((t: { status: string }) => t.status !== "Good Service")).toBe(true);
    expect(res.headers.get("cache-control")).toMatch(/public/);
  });

  it("drops flight-side aviation noise before trimming, keeping ground-transport signals", async () => {
    const signals = [
      { headline: "Victoria line part closure", severity: "major" },
      { headline: "EasyJet cancels flights at Gatwick", detail: "crew shortage", severity: "major" },
      { headline: "Gatwick Express suspended", detail: "overnight rail works", severity: "notable" },
      { headline: "Heathrow baggage system down", severity: "notable" },
    ];
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { asOf: "2026-07-11T00:00:00Z", signals } },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(new Request("http://localhost/api/citymcp/status"));
    const body = await res.json();
    const headlines = body.signals.map((s: { headline: string }) => s.headline);
    expect(headlines).toContain("Victoria line part closure");
    expect(headlines).toContain("Gatwick Express suspended");
    expect(headlines).not.toContain("EasyJet cancels flights at Gatwick");
    expect(headlines).not.toContain("Heathrow baggage system down");
  });

  it("forwards the borough parameter when short enough", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { asOf: "z", signals: [] } },
        }),
        { status: 200 },
      ),
    );
    const res = await GET(new Request("http://localhost/api/citymcp/status?borough=Hackney"));
    expect(res.status).toBe(200);
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.params.arguments).toEqual({ borough: "Hackney" });
  });

  it("serves last-known-good stamped stale (no-store) when a refresh fails past TTL", async () => {
    vi.useFakeTimers();
    try {
      global.fetch = vi.fn(async () =>
        new Response(
          sseFrame({
            jsonrpc: "2.0",
            id: 1,
            result: {
              structuredContent: {
                asOf: "2026-07-11T00:00:00Z",
                signals: [{ headline: "Roadworks", severity: "notable" }],
              },
            },
          }),
          { status: 200 },
        ),
      );
      const fresh = await GET(new Request("http://localhost/api/citymcp/status"));
      const freshBody = await fresh.json();
      expect(freshBody.stale).toBeUndefined();
      expect(fresh.headers.get("cache-control")).toMatch(/public/);

      // Age past the 5min city_status TTL so the next request refetches.
      vi.advanceTimersByTime(6 * 60 * 1000);
      global.fetch = vi.fn(async () => new Response("down", { status: 503 }));

      const stale = await GET(new Request("http://localhost/api/citymcp/status"));
      expect(stale.status).toBe(200);
      const staleBody = await stale.json();
      expect(staleBody.stale).toBe(true);
      expect(staleBody.asOf).toBe("2026-07-11T00:00:00Z");
      expect(staleBody.signals).toHaveLength(1);
      // A stale answer is never pinned at the edge.
      expect(stale.headers.get("cache-control")).toBe("no-store");
    } finally {
      vi.useRealTimers();
    }
  });
});
