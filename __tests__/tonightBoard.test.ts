import { describe, it, expect } from "vitest";

import { cheapestTonight, type TonightDrop } from "@/lib/leaderboard";

// A fixed "now" so "the last 24h" is deterministic. All fixtures date their
// createdAt relative to this instant via the ISO helper below.
const NOW = Date.parse("2026-07-06T22:00:00.000Z");
const HOUR = 60 * 60 * 1000;

// createdAt N hours before NOW, as an ISO string (the drop shape's format).
function hoursAgo(h: number): string {
  return new Date(NOW - h * HOUR).toISOString();
}

function d(over: Partial<TonightDrop> & { venueId: string }): TonightDrop {
  return { priceGbp: 5, createdAt: hoursAgo(1), ...over };
}

describe("cheapestTonight", () => {
  it("returns [] for empty input", () => {
    expect(cheapestTonight([], { now: NOW })).toEqual([]);
  });

  it("only ranks priced drops from the last 24h (injected now)", () => {
    const drops = [
      d({ venueId: "in-window", priceGbp: 4, createdAt: hoursAgo(2) }),
      d({ venueId: "too-old", priceGbp: 3, createdAt: hoursAgo(25) }),
      d({ venueId: "no-price", priceGbp: null, createdAt: hoursAgo(1) }),
      d({ venueId: "bad-date", priceGbp: 2, createdAt: "not-a-date" }),
    ];
    const result = cheapestTonight(drops, { now: NOW });
    expect(result.map((e) => e.venueId)).toEqual(["in-window"]);
  });

  it("excludes the exact 24h-boundary drop (window is the open trailing 24h)", () => {
    const drops = [
      d({ venueId: "boundary", priceGbp: 1, createdAt: new Date(NOW - 24 * HOUR).toISOString() }),
      d({ venueId: "fresh", priceGbp: 5, createdAt: hoursAgo(1) }),
    ];
    const result = cheapestTonight(drops, { now: NOW });
    expect(result.map((e) => e.venueId)).toEqual(["fresh"]);
  });

  it("ranks cheapest-first and assigns 1-based ranks", () => {
    const drops = [
      d({ venueId: "a", priceGbp: 6 }),
      d({ venueId: "b", priceGbp: 4 }),
      d({ venueId: "c", priceGbp: 5 }),
    ];
    const result = cheapestTonight(drops, { now: NOW });
    expect(result.map((e) => e.venueId)).toEqual(["b", "c", "a"]);
    expect(result.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("keeps one row per venue — the cheapest drop for that venue wins", () => {
    const drops = [
      d({ venueId: "dupe", priceGbp: 7, createdAt: hoursAgo(3) }),
      d({ venueId: "dupe", priceGbp: 3, createdAt: hoursAgo(1) }), // cheapest → wins
      d({ venueId: "dupe", priceGbp: 5, createdAt: hoursAgo(2) }),
      d({ venueId: "other", priceGbp: 6, createdAt: hoursAgo(1) }),
    ];
    const result = cheapestTonight(drops, { now: NOW });
    expect(result).toHaveLength(2);
    const dupe = result.find((e) => e.venueId === "dupe");
    expect(dupe?.priceGbp).toBe(3);
    // cheapest overall (3) leads
    expect(result[0].venueId).toBe("dupe");
  });

  it("respects the cap", () => {
    const drops = Array.from({ length: 15 }, (_, i) =>
      d({ venueId: `v${i}`, priceGbp: i + 1 }),
    );
    expect(cheapestTonight(drops, { now: NOW, limit: 10 })).toHaveLength(10);
    expect(cheapestTonight(drops, { now: NOW, limit: 3 })).toHaveLength(3);
    // default cap is 10
    expect(cheapestTonight(drops, { now: NOW })).toHaveLength(10);
  });

  it("breaks price ties deterministically: createdAt (older first), then venueId", () => {
    const drops = [
      d({ venueId: "z", priceGbp: 5, createdAt: hoursAgo(1) }),
      d({ venueId: "a", priceGbp: 5, createdAt: hoursAgo(1) }), // same time → venueId breaks
      d({ venueId: "m", priceGbp: 5, createdAt: hoursAgo(3) }), // older → leads
    ];
    const result = cheapestTonight(drops, { now: NOW });
    expect(result.map((e) => e.venueId)).toEqual(["m", "a", "z"]);
  });

  it("carries handle and venueName through, falling back for a missing name", () => {
    const drops = [
      d({ venueId: "named", priceGbp: 4, handle: "karan", venueName: "The Landlord" }),
      d({ venueId: "anon", priceGbp: 5 }),
    ];
    const result = cheapestTonight(drops, { now: NOW });
    const named = result.find((e) => e.venueId === "named");
    const anon = result.find((e) => e.venueId === "anon");
    expect(named?.handle).toBe("karan");
    expect(named?.venueName).toBe("The Landlord");
    expect(anon?.handle).toBeUndefined();
    expect(anon?.venueName).toBe("A London pub");
  });
});
