import { describe, expect, it } from "vitest";

import {
  buildMapSearchIndex,
  searchMapSearchIndex,
  type MapSearchPack,
} from "@/lib/mapSearchIndex";

const cities = [
  { id: "bath" as const, displayName: "Bath" },
  { id: "london" as const, displayName: "London" },
];

const packs: MapSearchPack[] = [
  {
    cityId: "bath",
    venues: [
      { id: "venue-bath-crown", name: "Crown and Anchor", area: "Bath" },
      { id: "venue-bath-royal", name: "Royal Crescent Tavern", area: "Bath" },
      { id: "venue-bath-the-royal", name: "The Royal Crown", area: "Bath" },
    ],
  },
  { cityId: "london", venues: [] },
];

describe("map search index", () => {
  it("keeps only compact city and venue search fields", () => {
    const index = buildMapSearchIndex(cities, packs);

    expect(index.cities).toEqual([
      { id: "bath", name: "Bath" },
      { id: "london", name: "London" },
    ]);
    expect(index.venues[0]).toEqual({
      id: "venue-bath-crown",
      name: "Crown and Anchor",
      area: "Bath",
      cityId: "bath",
    });
    expect(Object.keys(index.venues[0])).toEqual(["id", "name", "area", "cityId"]);
  });

  it("ranks an exact name prefix ahead of a fuzzy venue match", () => {
    const index = buildMapSearchIndex(cities, packs);

    expect(searchMapSearchIndex(index, "royal")[0]).toMatchObject({
      id: "venue-bath-royal",
      kind: "venue",
    });
    expect(searchMapSearchIndex(index, "royal")[1]).toMatchObject({
      id: "venue-bath-the-royal",
      kind: "venue",
    });
    expect(searchMapSearchIndex(index, "crwn")[0].id).toBe("venue-bath-crown");
  });

  it("ranks an area or city match above venues named for that area", () => {
    const index = buildMapSearchIndex(cities, packs);

    expect(searchMapSearchIndex(index, "bath").slice(0, 2)).toEqual([
      { kind: "city", id: "bath", name: "Bath" },
      {
        kind: "venue",
        id: "venue-bath-crown",
        name: "Crown and Anchor",
        area: "Bath",
        cityId: "bath",
      },
    ]);
  });
});
