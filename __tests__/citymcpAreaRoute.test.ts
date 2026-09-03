import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/citymcp/area/route";
import { resetCityAreaCache } from "@/lib/citymcp/area";

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
  resetCityAreaCache();
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

describe("GET /api/citymcp/area", () => {
  it("200s with nulls + error when borough is missing", async () => {
    const res = await GET(new Request("http://localhost/api/citymcp/area"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.averagePintGbp).toBeNull();
    expect(body.error).toBe("Add a borough.");
  });

  it("returns the trimmed average pint price on success", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              pint: { asOf: "2026-07-01T00:00:00Z", value: { averagePriceGbp: 5.85 } },
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(
      new Request("http://localhost/api/citymcp/area?borough=Hackney"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.borough).toBe("Hackney");
    expect(body.averagePintGbp).toBe(5.85);
    expect(body.asOf).toBe("2026-07-01T00:00:00Z");

    const [, init] = (global.fetch as unknown as {
      mock: { calls: [string, RequestInit][] };
    }).mock.calls[0]!;
    const upstream = JSON.parse(String(init.body));
    expect(upstream.params.name).toBe("get_area");
    expect(upstream.params.arguments).toEqual({ borough: "Hackney" });
  });

  it("fails soft with 200 + nulls on upstream error", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    const res = await GET(
      new Request("http://localhost/api/citymcp/area?borough=Hackney"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.borough).toBe("Hackney");
    expect(body.averagePintGbp).toBeNull();
    expect(body.error).toBeTruthy();
  });
});
