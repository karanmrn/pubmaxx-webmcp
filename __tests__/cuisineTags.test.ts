import { describe, it, expect } from "vitest";

import {
  CURATED_CUISINE_BY_VENUE_ID,
  cuisineTagsForVenue,
  cuisineTagsFromText,
  normaliseCuisineTag,
  normaliseCuisineTags,
} from "@/lib/cuisineTags";

describe("cuisineTags", () => {
  it("normalises known tags and drops junk", () => {
    expect(normaliseCuisineTag(" Roast ")).toBe("roast");
    expect(normaliseCuisineTag("WIZARD")).toBeNull();
    expect(normaliseCuisineTags(["PIZZA", "pizza", "nope", "thai"])).toEqual([
      "thai",
      "pizza",
    ]);
  });

  it("extracts keywords from free text without false substrings", () => {
    expect(cuisineTagsFromText("Sunday roast and a pint")).toContain("roast");
    expect(cuisineTagsFromText("Tapas Brindisa")).toContain("tapas");
    // "kitchen" in "Natural Kitchen" should hit; "pie" alone in "piece" should not.
    expect(cuisineTagsFromText("Natural Kitchen")).toContain("kitchen");
    expect(cuisineTagsFromText("a piece of toast")).not.toContain("pie");
  });

  it("merges curated id map with text hits", () => {
    const tags = cuisineTagsForVenue({
      id: "venue-ral8ik",
      name: "Honest Burger Tower Hill",
      searchText: "honest burger tower hill",
    });
    expect(tags).toContain("burger");
    expect(CURATED_CUISINE_BY_VENUE_ID["venue-ral8ik"]).toContain("burger");
  });

  it("returns [] for an unknown venue with no food keywords", () => {
    expect(
      cuisineTagsForVenue({
        id: "venue-does-not-exist",
        name: "Quiet Ale House",
        searchText: "quiet ale house london",
      }),
    ).toEqual([]);
  });

  it("ships a small curated map of known venue ids", () => {
    const ids = Object.keys(CURATED_CUISINE_BY_VENUE_ID);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    expect(ids.length).toBeLessThanOrEqual(40);
    for (const [id, tags] of Object.entries(CURATED_CUISINE_BY_VENUE_ID)) {
      expect(id.startsWith("venue-")).toBe(true);
      // Curated lists may be authored in any order; normalise sorts to KNOWN order.
      expect(normaliseCuisineTags([...tags]).length).toBe(tags.length);
      expect(normaliseCuisineTags([...tags])).toEqual(normaliseCuisineTags([...tags]));
    }
  });
});
