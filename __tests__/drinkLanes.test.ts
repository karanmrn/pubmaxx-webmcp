import { describe, expect, it } from "vitest";

import {
  activeDrinkLane,
  applyDrinkLane,
  DEFAULT_DRINK_LANE,
  DEFAULT_DRINK_LANE_LABEL,
  drinkLaneLabel,
  drinkLaneLogActionLabel,
  drinkLaneLogInvite,
  drinkLaneNoun,
  MAP_DRINK_LANES,
  orderVenueDrinkPrices,
  submitCategoriesForLane,
} from "@/lib/drinkLanes";
import type { CommunityPrice } from "@/lib/communityPrice";
import { SUBMITTABLE_DRINK_CATEGORIES } from "@/lib/communityPrice";
import { CATEGORY_META, MAP_LENS_DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";
import type { CategoryPriceIndexStatus } from "@/lib/mapExperienceLens";
import type { Filters } from "@/lib/venues";

function filters(overrides: Partial<Filters> = {}): Filters {
  return {
    query: "",
    maxPrice: 100,
    crawlStyle: "balanced",
    stopCount: 4,
    routeWindow: 90,
    requireBeerGarden: false,
    requireNonAlcoholic: false,
    requireLiveSports: false,
    requireFood: false,
    requireCocktails: false,
    requireWater: false,
    requireHeritage: false,
    requirePintDrops: false,
    canonicalOnly: false,
    openNow: false,
    requireStepFree: false,
    requireAccessibleToilet: false,
    requireSeatedService: false,
    drinkCategory: "",
    drinkBrand: "",
    drinkSubtype: "",
    topShelfOnly: false,
    zone: "",
    ...overrides,
  };
}

function price(
  drinkCategory: DrinkCategory,
  priceGbp: number,
  submittedAt: number,
): CommunityPrice {
  return {
    venueId: "the-crown",
    drinkCategory,
    priceGbp,
    submittedAt,
    source: "community",
  };
}

describe("MAP_DRINK_LANES", () => {
  it("offers exactly the categories the map can lens, in menu order", () => {
    expect(MAP_DRINK_LANES.map((lane) => lane.category).sort()).toEqual(
      [...MAP_LENS_DRINK_CATEGORIES].sort(),
    );
    const orders = MAP_DRINK_LANES.map((lane) => CATEGORY_META[lane.category].order);
    expect(orders).toEqual([...orders].sort((left, right) => left - right));
  });

  it("never offers a lane the picker could not clear", () => {
    // `other` stays submittable, but a pin reading "£6 Other" names no drink.
    expect(MAP_DRINK_LANES.some((lane) => lane.category === "other")).toBe(false);
  });

  it("calls the resting lane by the map's word for it", () => {
    expect(drinkLaneLabel(DEFAULT_DRINK_LANE)).toBe(DEFAULT_DRINK_LANE_LABEL);
    expect(drinkLaneNoun("cocktail")).toBe("cocktail");
  });
});

describe("activeDrinkLane", () => {
  it("reads an empty drink filter as the pint lane", () => {
    expect(activeDrinkLane("")).toBe(DEFAULT_DRINK_LANE);
  });

  it("falls back to the pint lane for a category the map cannot lens", () => {
    expect(activeDrinkLane("other")).toBe(DEFAULT_DRINK_LANE);
    expect(activeDrinkLane("not-a-drink")).toBe(DEFAULT_DRINK_LANE);
  });

  it("reads a lensable category as its own lane", () => {
    expect(activeDrinkLane("cocktail")).toBe("cocktail");
  });
});

describe("applyDrinkLane", () => {
  it("re-keys the map to the chosen drink", () => {
    expect(applyDrinkLane(filters(), "cocktail")).toMatchObject({
      drinkCategory: "cocktail",
      requireCocktails: true,
    });
  });

  it("leaves the pint refinements behind when the lane changes", () => {
    // A brand, a subtype and a top shelf are refinements of the lane you left.
    const next = applyDrinkLane(
      filters({ drinkBrand: "guinness", drinkSubtype: "stout", topShelfOnly: true }),
      "wine",
    );
    expect(next).toMatchObject({
      drinkCategory: "wine",
      drinkBrand: "",
      drinkSubtype: "",
      topShelfOnly: false,
      requireCocktails: false,
    });
  });

  it("clears the drink lens when the map returns to pints", () => {
    expect(applyDrinkLane(filters({ drinkCategory: "cocktail", requireCocktails: true }), "beer"))
      .toMatchObject({ drinkCategory: "", requireCocktails: false });
  });

  it("is a no-op when the reader re-taps the lane they are already in", () => {
    // Otherwise tapping "Pints" twice would silently drop the pint they chose.
    const held = filters({ drinkBrand: "guinness", drinkSubtype: "stout" });
    expect(applyDrinkLane(held, "beer")).toBe(held);
    const wine = filters({ drinkCategory: "wine", topShelfOnly: true });
    expect(applyDrinkLane(wine, "wine")).toBe(wine);
  });

  it("leaves every filter that is not about the drink alone", () => {
    expect(
      applyDrinkLane(filters({ query: "Camden", maxPrice: 6, requireStepFree: true }), "wine"),
    ).toMatchObject({ query: "Camden", maxPrice: 6, requireStepFree: true });
  });
});

describe("orderVenueDrinkPrices", () => {
  it("puts the viewer's lane first and keeps menu order below it", () => {
    const rows = orderVenueDrinkPrices(
      [price("beer", 6.2, 300), price("wine", 8, 200), price("cocktail", 12, 100)],
      "cocktail",
    );
    expect(rows.map((row) => row.category)).toEqual(["cocktail", "beer", "wine"]);
    expect(rows[0].inActiveLane).toBe(true);
    expect(rows.slice(1).every((row) => row.inActiveLane === false)).toBe(true);
  });

  it("never lets one lane's figure answer another lane's question", () => {
    // Ordering is the ONLY thing the lane touches: every row keeps its own tag,
    // its own figure and its own date, so no row can be read as the lane's.
    const rows = orderVenueDrinkPrices(
      [price("beer", 6.2, 300), price("cocktail", 12, 100)],
      "cocktail",
    );
    for (const row of rows) {
      expect(row.label).toBe(CATEGORY_META[row.category].label);
      expect(row.price.drinkCategory).toBe(row.category);
    }
    expect(rows.find((row) => row.category === "cocktail")?.price.priceGbp).toBe(12);
    expect(rows.find((row) => row.category === "beer")?.price.priceGbp).toBe(6.2);
  });

  it("prints one current answer per drink, the freshest", () => {
    const rows = orderVenueDrinkPrices(
      [price("beer", 5, 100), price("beer", 6, 400), price("beer", 5.5, 250)],
      "beer",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].price.priceGbp).toBe(6);
  });

  it("answers nothing for a pub with no community prices", () => {
    expect(orderVenueDrinkPrices(undefined, "beer")).toEqual([]);
    expect(orderVenueDrinkPrices([], "cocktail")).toEqual([]);
  });

  it("does not invent a row for the active lane", () => {
    // An empty lane is an empty state, not a zero. A placeholder row here would
    // read as a logged price of nothing.
    const rows = orderVenueDrinkPrices([price("beer", 6.2, 300)], "cocktail");
    expect(rows.some((row) => row.category === "cocktail")).toBe(false);
  });
});

describe("submitCategoriesForLane", () => {
  it("keeps the standard shortcut row for a lane already on it", () => {
    expect(submitCategoriesForLane("beer")).toEqual(SUBMITTABLE_DRINK_CATEGORIES);
    expect(submitCategoriesForLane("wine")).toEqual(SUBMITTABLE_DRINK_CATEGORIES);
  });

  it("offers the lane a viewer is actually under", () => {
    // A gin map opening the composer with no gin chip in sight is the defect.
    const chips = submitCategoriesForLane("gin");
    expect(chips).toContain("gin");
    expect(chips.indexOf("gin")).toBe(1);
    for (const category of SUBMITTABLE_DRINK_CATEGORIES) {
      expect(chips).toContain(category);
    }
  });
});

describe("drinkLaneLogInvite", () => {
  it("invites a contribution only once the read has answered", () => {
    // Asking for a price off the back of our own failed read would claim the
    // pub has none, which is exactly what the empty-state helpers refuse.
    for (const status of ["idle", "loading", "degraded"] satisfies CategoryPriceIndexStatus[]) {
      expect(drinkLaneLogInvite("cocktail", status)).toBeNull();
    }
    expect(drinkLaneLogInvite("cocktail", "ready")).toContain("cocktail");
    expect(drinkLaneLogInvite("cocktail", "partial")).toContain("cocktail");
  });

  it("names the drink on its action", () => {
    expect(drinkLaneLogActionLabel("cocktail")).toBe("Log a cocktail price");
  });
});
