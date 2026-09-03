import { describe, it, expect } from "vitest";

import { computeThenVsNow, type ThenVsNowDrop } from "@/lib/thenVsNow";
import type { Venue } from "@/lib/venues";

// computeThenVsNow only reads id/name/cheapestPrice, so a partial cast keeps the
// fixtures readable without spelling out every Venue field.
function v(
  over: Partial<Venue> & { id: string; name: string; cheapestPrice: number | null },
): Venue {
  return { primaryBorough: "", visibleBoroughs: [], cheapestPint: "", ...over } as Venue;
}

function drop(over: Partial<ThenVsNowDrop> & { venueId: string }): ThenVsNowDrop {
  return { priceGbp: null, createdAt: "2026-01-01T00:00:00.000Z", ...over };
}

describe("computeThenVsNow", () => {
  it("needs BOTH a baseline price and a priced community drop", () => {
    const venues = [
      v({ id: "both", name: "Both", cheapestPrice: 5 }),
      v({ id: "no-then", name: "No baseline", cheapestPrice: null }),
      v({ id: "no-now", name: "No community price", cheapestPrice: 6 }),
      v({ id: "now-null", name: "Community note only", cheapestPrice: 4 }),
    ];
    const drops = [
      drop({ venueId: "both", priceGbp: 6 }),
      drop({ venueId: "no-then", priceGbp: 7 }), // has "now" but no "then"
      // "no-now" has no drop at all
      drop({ venueId: "now-null", priceGbp: null }), // drop exists but carries no price
    ];

    const items = computeThenVsNow(venues, drops);
    expect(items.map((i) => i.venueId)).toEqual(["both"]);
    expect(items[0]).toMatchObject({ venueName: "Both", thenGbp: 5, nowGbp: 6 });
  });

  it("uses the MOST-RECENT priced drop as 'now'", () => {
    const venues = [v({ id: "a", name: "Anchor", cheapestPrice: 5 })];
    const drops = [
      drop({ venueId: "a", priceGbp: 5.5, createdAt: "2026-02-01T00:00:00.000Z" }),
      drop({ venueId: "a", priceGbp: 8, createdAt: "2026-06-01T00:00:00.000Z" }), // newest
      drop({ venueId: "a", priceGbp: 6, createdAt: "2026-04-01T00:00:00.000Z" }),
    ];

    const [item] = computeThenVsNow(venues, drops);
    expect(item.nowGbp).toBe(8);
    expect(item.deltaGbp).toBe(3);
  });

  it("skips a newer un-priced drop and falls back to the newest PRICED one", () => {
    const venues = [v({ id: "a", name: "Anchor", cheapestPrice: 5 })];
    const drops = [
      drop({ venueId: "a", priceGbp: 6, createdAt: "2026-04-01T00:00:00.000Z" }),
      drop({ venueId: "a", priceGbp: null, createdAt: "2026-09-01T00:00:00.000Z" }), // newest but no price
    ];

    const [item] = computeThenVsNow(venues, drops);
    expect(item.nowGbp).toBe(6);
  });

  it("computes delta/pct sign correctly for both directions", () => {
    const venues = [
      v({ id: "up", name: "Dearer", cheapestPrice: 4 }),
      v({ id: "down", name: "Cheaper", cheapestPrice: 8 }),
    ];
    const drops = [
      drop({ venueId: "up", priceGbp: 5 }), // +£1 → +25%
      drop({ venueId: "down", priceGbp: 6 }), // -£2 → -25%
    ];

    const items = computeThenVsNow(venues, drops);
    const up = items.find((i) => i.venueId === "up")!;
    const down = items.find((i) => i.venueId === "down")!;

    expect(up.deltaGbp).toBe(1);
    expect(up.pct).toBeCloseTo(25);
    expect(down.deltaGbp).toBe(-2);
    expect(down.pct).toBeCloseTo(-25);
  });

  it("ranks biggest absolute movers first, ties broken on name", () => {
    const venues = [
      v({ id: "small", name: "Small mover", cheapestPrice: 5 }),
      v({ id: "big", name: "Big mover", cheapestPrice: 5 }),
      v({ id: "tieB", name: "Bravo", cheapestPrice: 5 }),
      v({ id: "tieA", name: "Alpha", cheapestPrice: 5 }),
    ];
    const drops = [
      drop({ venueId: "small", priceGbp: 5.5 }), // Δ 0.5
      drop({ venueId: "big", priceGbp: 9 }), // Δ 4
      drop({ venueId: "tieB", priceGbp: 7 }), // Δ 2
      drop({ venueId: "tieA", priceGbp: 7 }), // Δ 2 (ties with tieB → name breaks)
    ];

    const order = computeThenVsNow(venues, drops).map((i) => i.venueId);
    // big (4) > tie group (2, Alpha before Bravo) > small (0.5)
    expect(order).toEqual(["big", "tieA", "tieB", "small"]);
  });

  it("respects the limit", () => {
    const venues = Array.from({ length: 12 }, (_, i) =>
      v({ id: `v${i}`, name: `V${i}`, cheapestPrice: 5 }),
    );
    const drops = venues.map((venue, i) =>
      drop({ venueId: venue.id, priceGbp: 5 + i }), // ascending delta so ranking is stable
    );

    expect(computeThenVsNow(venues, drops, 3)).toHaveLength(3);
    expect(computeThenVsNow(venues, drops, 0)).toHaveLength(0);
    // default limit is 8
    expect(computeThenVsNow(venues, drops)).toHaveLength(8);
  });

  it("guards pct when the baseline is 0 (no divide-by-zero)", () => {
    const venues = [v({ id: "free", name: "Free pint", cheapestPrice: 0 })];
    const drops = [drop({ venueId: "free", priceGbp: 3 })];

    const [item] = computeThenVsNow(venues, drops);
    expect(item.deltaGbp).toBe(3);
    expect(item.pct).toBe(0);
    expect(Number.isFinite(item.pct)).toBe(true);
  });

  it("returns an empty array when there are no community drops at all", () => {
    const venues = [v({ id: "a", name: "Anchor", cheapestPrice: 5 })];
    expect(computeThenVsNow(venues, [])).toEqual([]);
  });
});
