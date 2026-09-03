import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/night-calm/route";
import { resetNightCalmCache } from "@/lib/nightCalmSource";

const realFetch = global.fetch;
// The route rate-limits per IP before anything else. Vercel's vitest run sets
// real Supabase env vars, which would send the limiter down its durable (network)
// path; deleting them keeps it on the deterministic in-memory path (same
// technique as __tests__/citymcpAreaRoute.test.ts).
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Build a street-level crime array: `night` night-relevant rows + `other` benign. */
function crimeRows(night: number, other: number): Array<{ category: string }> {
  const rows: Array<{ category: string }> = [];
  for (let i = 0; i < night; i += 1) rows.push({ category: "anti-social-behaviour" });
  for (let i = 0; i < other; i += 1) rows.push({ category: "other-theft" });
  return rows;
}

/** Mock fetch that answers the two police endpoints the loader hits. */
function mockPolice(crimes: unknown, lastUpdated = "2026-05-01") {
  return vi.fn(async (input: string | URL) => {
    const href = String(input);
    if (href.includes("crime-last-updated")) return json({ date: lastUpdated });
    if (href.includes("crimes-street")) {
      return crimes instanceof Response ? crimes : json(crimes);
    }
    throw new Error(`unexpected fetch ${href}`);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetNightCalmCache();
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

describe("GET /api/night-calm", () => {
  it("422s with a flat error for an unknown area", async () => {
    const res = await GET(new Request("http://localhost/api/night-calm?area=narnia"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("NIGHT_AREA_REQUIRED");
    expect(body.error).toBeTruthy();
    expect(typeof body.retryable).toBe("boolean");
  });

  it("422s when area is missing", async () => {
    const res = await GET(new Request("http://localhost/api/night-calm"));
    expect(res.status).toBe(422);
  });

  it("returns a calm band and NO crime counts on success", async () => {
    global.fetch = mockPolice(crimeRows(6, 94)) as unknown as typeof fetch;
    const res = await GET(new Request("http://localhost/api/night-calm?area=clapham"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.area).toBe("clapham");
    expect(body.month).toBe("2026-05");
    expect(body.available).toBe(true);
    expect(body.calm.band).toBe("settled");
    expect(body.calm.label).toBe("Busy, well-used streets");
    // Guardian posture: never leak counts or per-street point detail.
    expect(body).not.toHaveProperty("calm.sampleSize");
    expect(JSON.stringify(body.calm)).not.toMatch(/sampleSize|count|location/i);
    // Monthly data is edge-cached hard.
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=21600/);
  });

  it("stays silent (available false) on a thin sample", async () => {
    global.fetch = mockPolice(crimeRows(1, 3)) as unknown as typeof fetch;
    const res = await GET(new Request("http://localhost/api/night-calm?area=victoria"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.calm.band).toBeNull();
  });

  it("fails soft (200, available false) when the upstream errors", async () => {
    global.fetch = mockPolice(new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const res = await GET(new Request("http://localhost/api/night-calm?area=shoreditch"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.calm.band).toBeNull();
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
  });

  it("caches the per-area crime fetch per month (only hit once)", async () => {
    const fetchMock = mockPolice(crimeRows(6, 94));
    global.fetch = fetchMock as unknown as typeof fetch;
    await GET(new Request("http://localhost/api/night-calm?area=camden"));
    await GET(new Request("http://localhost/api/night-calm?area=camden"));
    const streetCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("crimes-street"),
    );
    expect(streetCalls).toHaveLength(1);
  });
});
