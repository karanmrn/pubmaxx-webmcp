import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/ratings/route.ts. The route selects the
// in-memory ratings store, pinned deterministically at the @/lib/supabase seam
// (isSupabaseConfigured() === false) — the house pattern (see
// notificationsRoute / profileOwnershipRoute); backend selection reads
// SUPABASE_*, never NODE_ENV.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { GET, POST } from "@/app/api/ratings/route";
import { __resetMemoryRatings } from "@/lib/ratingsStore";
import type { RatingSummary } from "@/lib/ratings";

const URL_BASE = "http://localhost/api/ratings";

function get(query: string): Promise<Response> {
  return GET(new Request(`${URL_BASE}?${query}`));
}
function post(body: unknown): Promise<Response> {
  return POST(
    new Request(URL_BASE, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

// Unique handles per test so the in-memory rate limiter (per handle+ip window)
// never bleeds across cases.
let seq = 0;
function freshHandle(): string {
  return `rater${++seq}${Date.now().toString(36)}`;
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryRatings();
});

describe("POST /api/ratings — validation", () => {
  it("400s malformed JSON", async () => {
    expect((await post("{not json")).status).toBe(400);
  });

  it("400s a bad kind", async () => {
    const res = await post({ kind: "pub", ref: "v1", handle: "ken", rating: 4 });
    expect(res.status).toBe(400);
  });

  it("400s a missing ref", async () => {
    const res = await post({ kind: "drink", handle: "ken", rating: 4 });
    expect(res.status).toBe(400);
  });

  it("accepts venueId as the ref for a venue rating", async () => {
    const res = await post({
      kind: "venue",
      venueId: "venue-1",
      handle: freshHandle(),
      rating: 4,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ref: string }).ref).toBe("venue-1");
  });

  it("400s a missing handle", async () => {
    const res = await post({ kind: "venue", ref: "v1", rating: 4 });
    expect(res.status).toBe(400);
  });

  it.each([0, 5.5, 4.2, "three", null])("400s illegal rating %s", async (rating) => {
    const res = await post({ kind: "venue", ref: "v1", handle: freshHandle(), rating });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/ratings — writes", () => {
  it("stores a vote and returns the fresh summary (hidden under the floor)", async () => {
    const res = await post({ kind: "drink", ref: "beer-1", venueId: "v1", handle: freshHandle(), rating: 4.5 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ref: string; summary: RatingSummary };
    expect(body.ref).toBe("beer-1");
    expect(body.summary.count).toBe(1);
    expect(body.summary.average).toBe(4.5);
    expect(body.summary.shown).toBe(false); // 1 vote < the 10-vote floor
  });

  it("re-rating upserts (the latest vote replaces the old one)", async () => {
    const handle = freshHandle();
    await post({ kind: "venue", ref: "v1", handle, rating: 2 });
    const res = await post({ kind: "venue", ref: "v1", handle, rating: 5 });
    const body = (await res.json()) as { summary: RatingSummary };
    expect(body.summary.count).toBe(1);
    expect(body.summary.average).toBe(5);
  });

  it("429s a handle hammering the endpoint", async () => {
    const handle = freshHandle();
    let last = 200;
    for (let i = 0; i < 12; i++) {
      last = (await post({ kind: "venue", ref: "v1", handle, rating: 4 })).status;
    }
    expect(last).toBe(429);
  });
});

describe("GET /api/ratings", () => {
  it("400s a bad kind", async () => {
    expect((await get("kind=nope&refs=a")).status).toBe(400);
  });

  it("returns batch summaries keyed by ref (unknown refs honestly blank)", async () => {
    await post({ kind: "venue", ref: "v1", handle: freshHandle(), rating: 4 });
    const res = await get("kind=venue&refs=v1,ghost");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summaries: Record<string, RatingSummary> };
    expect(body.summaries.v1.count).toBe(1);
    expect(body.summaries.ghost.count).toBe(0);
    expect(body.summaries.ghost.average).toBe(null);
  });

  it("no refs → an empty (but valid) map, never an error", async () => {
    const res = await get("kind=drink");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summaries: {} });
  });
});
