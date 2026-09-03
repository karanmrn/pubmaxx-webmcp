import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/hygiene/route";
import { resetHygieneCache } from "@/lib/foodHygiene";

const realFetch = global.fetch;
// The route rate-limits per IP before anything else. Vercel's vitest run sets
// real Supabase env vars, which would send the limiter down its durable
// (network) path; deleting them keeps it on the deterministic in-memory path
// (same technique as __tests__/citymcpAreaRoute.test.ts).
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PUB = {
  FHRSID: 1026539,
  BusinessName: "The Arnos Arms",
  BusinessType: "Pub/bar/nightclub",
  PostCode: "N11 1AN",
  RatingValue: "5",
  RatingDate: "2025-06-05T00:00:00",
  SchemeType: "FHRS",
  LocalAuthorityName: "Enfield",
};

function fhrsResponse(establishments: unknown[]): Response {
  return new Response(JSON.stringify({ establishments }), { status: 200 });
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetHygieneCache();
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

describe("GET /api/hygiene", () => {
  it("returns the matched FSA rating on success", async () => {
    global.fetch = vi.fn(async () => fhrsResponse([PUB]));
    const res = await GET(
      new Request(
        "http://localhost/api/hygiene?name=The%20Arnos%20Arms&postcode=N11%201AN",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rating.fhrsid).toBe(1026539);
    expect(body.rating.ratingValue).toBe(5);

    const [url, init] = (global.fetch as unknown as {
      mock: { calls: [string, RequestInit][] };
    }).mock.calls[0]!;
    expect(String(url)).toContain("api.ratings.food.gov.uk");
    expect((init.headers as Record<string, string>)["x-api-version"]).toBe("2");
  });

  it("200s with rating null when name or postcode is missing", async () => {
    const res = await GET(new Request("http://localhost/api/hygiene?name=The%20Ship"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rating).toBeNull();
  });

  it("200s with rating null for an unmatched pub", async () => {
    global.fetch = vi.fn(async () => fhrsResponse([PUB]));
    const res = await GET(
      new Request(
        "http://localhost/api/hygiene?name=The%20Kings%20Head&postcode=N11%201AN",
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).rating).toBeNull();
  });

  it("fails soft with rating null on an upstream error", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    const res = await GET(
      new Request(
        "http://localhost/api/hygiene?name=The%20Arnos%20Arms&postcode=N11%201AN",
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).rating).toBeNull();
  });
});
