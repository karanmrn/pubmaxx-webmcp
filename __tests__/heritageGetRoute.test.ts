import { beforeEach, describe, expect, it, vi } from "vitest";

// The route asserts production secrets at module load; neutralise it so the
// test runs offline regardless of NODE_ENV (Vercel runs vitest as production).
vi.mock("@/lib/serverEnv", () => ({
  assertServerEnv: () => {},
  assertProductionSecrets: () => {},
}));

import { GET } from "@/app/api/heritage/route";

// The trusted/sourced source labels. A fact that isn't one of these would be a
// provenance leak, so the shape assertion pins them.
const SOURCED_SOURCES = new Set(["osm", "wikidata", "wikipedia", "seed"]);

// Fully offline: no Supabase, no network. Facts come only from the shipped
// heritage_cache.json (server-side), keyed by normalised venue name — the same
// trust boundary the POST route enforces.
beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/heritage?${query}`));
}

describe("GET /api/heritage — cited heritage facts", () => {
  it("returns 200 + non-empty, correctly-shaped facts for a venue with cached heritage", async () => {
    const res = await get(`venueName=${encodeURIComponent("Prospect of Whitby")}`);
    expect(res.status).toBe(200);
    // Static-ish facts → short public/CDN cache, not no-store.
    expect(res.headers.get("Cache-Control")).toContain("public");

    const body = await res.json();
    expect(Array.isArray(body.facts)).toBe(true);
    expect(body.facts.length).toBeGreaterThan(0);
    for (const fact of body.facts) {
      // HeritageFact = { source, fact, sourceRef? } — only server-sourced.
      expect(SOURCED_SOURCES.has(fact.source)).toBe(true);
      expect(typeof fact.fact).toBe("string");
      expect(fact.fact.length).toBeGreaterThan(0);
    }
    // The shipped Whitby cache carries the Grade II* listing fact.
    expect(
      body.facts.some((f: { fact: string }) => f.fact.includes("Grade II* listed")),
    ).toBe(true);
  });

  it("returns 200 + empty facts for a venue with nothing on record (never invented)", async () => {
    const res = await get(`venueName=${encodeURIComponent("Nowhere Tavern")}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facts).toEqual([]);
  });

  it("returns 400 when venueName is missing", async () => {
    const res = await get("venueId=abc123");
    expect(res.status).toBe(400);
  });
});
