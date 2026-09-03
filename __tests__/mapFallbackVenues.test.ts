import { describe, expect, it } from "vitest";

import { selectMapFallbackPubs } from "@/lib/mapFallbackVenues";

describe("selectMapFallbackPubs", () => {
  it("ranks only pubs by pint price in the renderer failure directory", () => {
    const venues = [
      { id: "bar-cheap", kind: "bar" as const, cheapestPrice: 2 },
      { id: "pub-expensive", kind: "pub" as const, cheapestPrice: 6 },
      { id: "food-cheap", kind: "food" as const, cheapestPrice: 3 },
      { id: "pub-cheap", kind: undefined, cheapestPrice: 4 },
      { id: "pub-unpriced", kind: "pub" as const, cheapestPrice: null },
    ];

    expect(selectMapFallbackPubs(venues, 3).map((venue) => venue.id)).toEqual([
      "pub-cheap",
      "pub-expensive",
      "pub-unpriced",
    ]);
  });
});
