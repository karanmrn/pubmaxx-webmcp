import { describe, it, expect } from "vitest";

import { cheapestPints, cheapestByArea, venueArea, UNKNOWN_AREA } from "@/lib/leaderboard";
import type { Venue } from "@/lib/venues";

// The ranking helpers only read id/name/cheapestPrice/primaryBorough/
// visibleBoroughs, so a partial cast keeps the fixtures readable without
// spelling out every Venue field.
function v(
  over: Partial<Venue> & { id: string; name: string; cheapestPrice: number | null },
): Venue {
  return { primaryBorough: "", visibleBoroughs: [], cheapestPint: "", ...over } as Venue;
}

describe("cheapestPints", () => {
  it("sorts ascending, drops null-priced venues, and respects the limit", () => {
    const venues = [
      v({ id: "a", name: "A", cheapestPrice: 6 }),
      v({ id: "b", name: "B", cheapestPrice: null }),
      v({ id: "c", name: "C", cheapestPrice: 4 }),
      v({ id: "d", name: "D", cheapestPrice: 5 }),
    ];
    const top2 = cheapestPints(venues, 2);
    expect(top2.map((e) => e.venue.id)).toEqual(["c", "d"]);
    expect(top2.map((e) => e.rank)).toEqual([1, 2]);
    // the null-priced venue is never ranked
    expect(cheapestPints(venues, 10).some((e) => e.venue.id === "b")).toBe(false);
  });

  it("breaks price ties on name deterministically", () => {
    const venues = [
      v({ id: "z", name: "Zebra", cheapestPrice: 5 }),
      v({ id: "a", name: "Anchor", cheapestPrice: 5 }),
    ];
    expect(cheapestPints(venues).map((e) => e.venue.name)).toEqual(["Anchor", "Zebra"]);
  });
});

describe("cheapestByArea", () => {
  it("returns the single cheapest venue per area, cheapest area first", () => {
    const venues = [
      v({ id: "1", name: "Soho Cheap", cheapestPrice: 4, primaryBorough: "Westminster" }),
      v({ id: "2", name: "Soho Pricey", cheapestPrice: 7, primaryBorough: "Westminster" }),
      v({ id: "3", name: "Hackney One", cheapestPrice: 5, primaryBorough: "Hackney" }),
    ];
    const result = cheapestByArea(venues);
    expect(result).toHaveLength(2);
    expect(result.find((e) => e.area === "Westminster")?.venue.id).toBe("1");
    expect(result.map((e) => e.area)).toEqual(["Westminster", "Hackney"]);
  });

  it("falls back to UNKNOWN_AREA when a venue has no borough", () => {
    const venues = [v({ id: "x", name: "Nowhere", cheapestPrice: 4 })];
    expect(venueArea(venues[0])).toBe(UNKNOWN_AREA);
    expect(cheapestByArea(venues)[0].area).toBe(UNKNOWN_AREA);
  });
});
