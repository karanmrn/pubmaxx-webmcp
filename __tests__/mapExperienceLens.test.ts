import { describe, expect, it } from "vitest";

import {
  drinkLensCoverageNote,
  drinkLensEmptyVenueNote,
  drinkLensPriceNoun,
  drinkLensUnknownRowLabel,
  drinkLensUnknownSentence,
  experienceLensSummary,
  filtersForDrinkPriceLens,
  filtersForExperienceLens,
  filterVenuesForExperienceLens,
  lensPriceForVenue,
  isMapLensDrinkCategory,
  MAP_LENS_DRINK_CATEGORIES,
  type MapLensPrice,
  NO_ALCOHOL_LENS_PRICE_NOUN,
  trustedDrinkLensPrices,
  trustedNoAlcoholLensPrices,
} from "@/lib/mapExperienceLens";
import {
  NO_ALCOHOL_DRINK_CATEGORIES,
  SUBMITTABLE_DRINK_CATEGORIES,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { CATEGORY_META, DRINK_CATEGORIES } from "@/lib/drinks";
import type { Venue } from "@/lib/venues";
import type { Filters } from "@/lib/venues";

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "pub-1",
    name: "The Test Arms",
    address: "Somewhere",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Southwark",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: 6.2,
    cheapestPint: "Lager",
    averagePrice: 6.2,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    kind: "pub",
    ...overrides,
  } as Venue;
}

function price(
  drinkCategory: CommunityPrice["drinkCategory"],
  priceGbp: number,
  overrides: Partial<CommunityPrice> = {},
): CommunityPrice {
  return {
    venueId: "pub-1",
    drinkCategory,
    priceGbp,
    submittedAt: 2_000,
    source: "community",
    corroborations: 2,
    mapCandidate: { priceGbp, submittedAt: 2_000, corroborations: 2 },
    ...overrides,
  };
}

describe("no-alcohol lens price policy", () => {
  it("accepts only current corroborated soft-drink and alcohol-free candidates", () => {
    const rows = new Map<string, CommunityPrice[]>([
      ["pub-1", [
        price("beer", 6.2),
        price("soft-drink", 3.2),
        price("alcohol-free", 5, {
          corroborations: 1,
          mapCandidate: { priceGbp: 5, submittedAt: 2_000, corroborations: 1 },
        }),
      ]],
    ]);

    expect(trustedNoAlcoholLensPrices(rows, 3_000).get("pub-1")).toMatchObject({
      venueId: "pub-1",
      category: "soft-drink",
      priceGbp: 3.2,
      submittedAt: 2_000,
    });
  });

  it("chooses the cheapest trusted no-alcohol option, then the fresher tie", () => {
    const rows = new Map<string, CommunityPrice[]>([
      ["pub-1", [
        price("soft-drink", 3.2, {
          submittedAt: 1_000,
          mapCandidate: { priceGbp: 3.2, submittedAt: 1_000, corroborations: 2 },
        }),
        price("alcohol-free", 4.8),
      ]],
      ["pub-2", [
        price("soft-drink", 3.2, {
          venueId: "pub-2",
          submittedAt: 1_000,
          mapCandidate: { priceGbp: 3.2, submittedAt: 1_000, corroborations: 2 },
        }),
        price("alcohol-free", 3.2, {
          venueId: "pub-2",
          submittedAt: 2_000,
          mapCandidate: { priceGbp: 3.2, submittedAt: 2_000, corroborations: 2 },
        }),
      ]],
    ]);

    const result = trustedNoAlcoholLensPrices(rows, 3_000);
    expect(result.get("pub-1")?.category).toBe("soft-drink");
    expect(result.get("pub-2")?.category).toBe("alcohol-free");
  });
});

describe("selected drink lens price policy", () => {
  it("stands the pint cap down for non-pint prices", () => {
    const filters = {
      maxPrice: 5.5,
      drinkCategory: "whisky",
      drinkBrand: "jameson",
      drinkSubtype: "whisky-irish",
      topShelfOnly: true,
      requireCocktails: true,
    } as Filters;

    expect(filtersForDrinkPriceLens(filters, "whisky")).toMatchObject({
      maxPrice: Number.POSITIVE_INFINITY,
      drinkCategory: "",
      drinkBrand: "",
      drinkSubtype: "",
      topShelfOnly: false,
      requireCocktails: false,
    });
    expect(filtersForDrinkPriceLens(filters, "beer")).toBe(filters);
    expect(filtersForDrinkPriceLens(filters, null)).toBe(filters);
  });

  it("keeps only trusted prices for the selected category", () => {
    const rows = new Map<string, CommunityPrice[]>([
      ["trusted", [
        price("whisky", 6, { venueId: "trusted" }),
        price("wine", 8, { venueId: "trusted" }),
      ]],
      ["uncorroborated", [
        price("whisky", 5, {
          venueId: "uncorroborated",
          corroborations: 1,
          mapCandidate: { priceGbp: 5, submittedAt: 2_000, corroborations: 1 },
        }),
      ]],
      ["wine-only", [price("wine", 7, { venueId: "wine-only" })]],
    ]);

    const result = trustedDrinkLensPrices(rows, "whisky", 3_000);

    expect(result.get("trusted")).toMatchObject({
      venueId: "trusted",
      category: "whisky",
      categoryLabel: "Whisky",
      priceGbp: 6,
    });
    expect(result.has("uncorroborated")).toBe(false);
    expect(result.has("wine-only")).toBe(false);
  });
});

describe("experience lens venue membership and presentation", () => {
  const pub = venue();
  const knownNoAlcohol = venue({
    id: "known",
    amenities: { ...venue().amenities, nonAlcoholic: true },
  });
  const food = venue({
    id: "food",
    kind: "food",
    cheapestPrice: 9.5,
    anchorLabel: "Halloumi wrap",
    anchorObservedAt: "2026-07-20",
    anchorSourceUrl: "https://example.com/menu",
  });
  const restaurantUnknown = venue({
    id: "restaurant",
    kind: "restaurant",
    cheapestPrice: 14,
    anchorLabel: undefined,
    anchorObservedAt: undefined,
    anchorSourceUrl: undefined,
  });
  const lensPrices = new Map([
    ["pub-1", {
      venueId: "pub-1",
      category: "soft-drink" as const,
      categoryLabel: "Soft drinks",
      priceGbp: 3.2,
      submittedAt: 2_000,
      source: "community" as const,
    }],
  ]);

  it("shows known no-alcohol pubs plus food places, and food view only food kinds", () => {
    const all = [pub, knownNoAlcohol, food, restaurantUnknown];
    expect(
      filterVenuesForExperienceLens(all, "no-alcohol", lensPrices).map((row) => row.id),
    ).toEqual(["pub-1", "known", "food", "restaurant"]);
    expect(
      filterVenuesForExperienceLens(all, "food", lensPrices).map((row) => row.id),
    ).toEqual(["food", "restaurant"]);
  });

  it("shows no-alcohol community prices and only complete sourced food anchors", () => {
    expect(lensPriceForVenue(pub, "no-alcohol", lensPrices)).toMatchObject({
      priceGbp: 3.2,
      categoryLabel: "Soft drinks",
      source: "community",
    });
    expect(lensPriceForVenue(food, "food", lensPrices)).toMatchObject({
      priceGbp: 9.5,
      categoryLabel: "Halloumi wrap",
      source: "sourced-anchor",
    });
    expect(lensPriceForVenue(restaurantUnknown, "food", lensPrices)).toBeNull();
  });

  it("names the community category exactly as the submit chips do", () => {
    // Logging under "Soft drinks" and reading back "Soft drink" is the same
    // category wearing two names on surfaces a user sees side by side.
    expect(CATEGORY_META["soft-drink"].label).toBe("Soft drinks");
    expect(
      lensPriceForVenue(pub, "no-alcohol", lensPrices)?.categoryLabel,
    ).toBe(CATEGORY_META["soft-drink"].label);
  });

  it("states honest empty and degraded results", () => {
    expect(experienceLensSummary("no-alcohol", 0, 1, "ready")).toBe(
      "No alcohol-free or soft drink prices logged here yet. Food venues still show sourced menu prices.",
    );
    expect(experienceLensSummary("no-alcohol", 0, 1, "degraded")).toBe(
      "Could not check alcohol-free or soft drink prices right now. Food venues still show sourced menu prices.",
    );
    expect(experienceLensSummary("food", 0, 0, "ready")).toBe(
      "Food venues shown. No sourced menu prices in this view yet.",
    );
  });

  it("never calls a partial read a failed one", () => {
    // A truncated scan ANSWERED, and its rows are already painted. Borrowing
    // the "could not check" sentence would call those figures unchecked.
    const partial = experienceLensSummary("no-alcohol", 4, 1, "partial");
    expect(partial).toContain("4 alcohol-free or soft drink prices shown");
    expect(partial).toContain("part of the list");
    expect(partial).not.toContain("Could not check");
    expect(experienceLensSummary("no-alcohol", 0, 1, "partial")).not.toBe(
      experienceLensSummary("no-alcohol", 0, 1, "degraded"),
    );
    expect(experienceLensSummary("no-alcohol", 0, 1, "partial")).not.toBe(
      experienceLensSummary("no-alcohol", 0, 1, "ready"),
    );
  });
});

describe("experience lens filter isolation", () => {
  const filters = {
    query: "King's Cross",
    maxPrice: 5,
    zone: "1",
    drinkCategory: "beer",
    drinkBrand: "guinness",
    drinkSubtype: "beer-stout",
    topShelfOnly: true,
    requireCocktails: true,
    requirePintDrops: true,
  } as Filters;

  it("leaves ordinary map filters untouched in the all view", () => {
    expect(filtersForExperienceLens(filters, "all")).toBe(filters);
  });

  it("keeps place search but removes hidden pint and drink constraints", () => {
    expect(filtersForExperienceLens(filters, "no-alcohol")).toMatchObject({
      query: "King's Cross",
      maxPrice: Number.POSITIVE_INFINITY,
      zone: "",
      drinkCategory: "",
      drinkBrand: "",
      drinkSubtype: "",
      topShelfOnly: false,
      requireCocktails: false,
      requirePintDrops: false,
    });
  });
});

describe("map lens drink categories", () => {
  it("keeps `other` submittable but never lensable", () => {
    // "Other" is a bag of unrelated drinks, so a pin labelled "£6 Other" names
    // nothing a reader can check. Submit still has to accept it.
    expect(MAP_LENS_DRINK_CATEGORIES).not.toContain("other");
    expect(SUBMITTABLE_DRINK_CATEGORIES).toContain("other");
    expect(isMapLensDrinkCategory("other")).toBe(false);
    expect(isMapLensDrinkCategory("whisky")).toBe(true);
    expect(isMapLensDrinkCategory("beer")).toBe(true);
    expect(isMapLensDrinkCategory("not-a-drink")).toBe(false);
    expect(isMapLensDrinkCategory(null)).toBe(false);
  });

  it("lets coffee own a map lens without joining the no-alcohol lens", () => {
    expect(MAP_LENS_DRINK_CATEGORIES).toContain("coffee");
    expect(SUBMITTABLE_DRINK_CATEGORIES).toContain("coffee");
    expect(isMapLensDrinkCategory("coffee")).toBe(true);
    expect(NO_ALCOHOL_DRINK_CATEGORIES).not.toContain("coffee");
    expect(CATEGORY_META.coffee.label).toBe("Coffee");
  });

  it("offers every other closed-taxonomy category", () => {
    for (const category of DRINK_CATEGORIES) {
      if (category === "other") continue;
      expect(MAP_LENS_DRINK_CATEGORIES).toContain(category);
    }
  });
});

describe("drinkLensCoverageNote — three findings, never merged", () => {
  it("says nothing when the index answered in full", () => {
    expect(drinkLensCoverageNote("whisky", "ready")).toBeNull();
  });

  it("keeps a truncated-but-successful read out of the failure wording", () => {
    const partial = drinkLensCoverageNote("whisky", "partial");
    expect(partial).toContain("part of the whisky prices");
    expect(partial).not.toContain("could not");
  });

  it("never lets an unreadable index pass as a complete answer", () => {
    const degraded = drinkLensCoverageNote("whisky", "degraded");
    expect(degraded).toContain("could not read");
    expect(degraded).not.toBe(drinkLensCoverageNote("whisky", "partial"));
    expect(degraded).not.toBeNull();
  });

  it("marks an unstarted or in-flight read as unfinished", () => {
    expect(drinkLensCoverageNote("whisky", "idle")).toContain("Checking");
    expect(drinkLensCoverageNote("whisky", "loading")).toContain("Checking");
  });
});

describe("drinkLensUnknownRowLabel — a row read on its own", () => {
  it("gives each finding its own row wording", () => {
    expect(drinkLensUnknownRowLabel("whisky", "ready")).toBe(
      "no whisky price logged",
    );
    expect(drinkLensUnknownRowLabel("whisky", "partial")).toBe(
      "no whisky price in what we read",
    );
    expect(drinkLensUnknownRowLabel("whisky", "degraded")).toBe(
      "whisky price could not be read",
    );
    expect(drinkLensUnknownRowLabel("whisky", "loading")).toBe(
      "whisky price not read yet",
    );
  });

  it("never lets an unreadable index claim nothing was logged", () => {
    for (const status of ["degraded", "loading", "idle"] as const) {
      expect(drinkLensUnknownRowLabel("whisky", status)).not.toContain(
        "logged",
      );
    }
  });
});

describe("drink lens sentence nouns", () => {
  it("names coffee from CATEGORY_META, never beer or the no-alcohol noun", () => {
    expect(drinkLensPriceNoun("coffee")).toBe("coffee");
    expect(drinkLensPriceNoun("coffee")).toBe(
      CATEGORY_META.coffee.label.toLowerCase(),
    );
    expect(drinkLensPriceNoun("coffee")).not.toBe(NO_ALCOHOL_LENS_PRICE_NOUN);
    expect(drinkLensPriceNoun("coffee")).not.toMatch(/pint|beer|alcohol/i);
  });

  it("uses a singular soft-drink noun inside empty sentences", () => {
    // Menu label is "Soft drinks"; "no Soft drinks price" fails grammar.
    expect(CATEGORY_META["soft-drink"].label).toBe("Soft drinks");
    expect(drinkLensPriceNoun("soft-drink")).toBe("soft drink");
    expect(drinkLensUnknownRowLabel("soft drink", "ready")).toBe(
      "no soft drink price logged",
    );
    expect(drinkLensEmptyVenueNote("soft drink", "ready")).toBe(
      "No soft drink price logged here yet.",
    );
    expect(drinkLensEmptyVenueNote("soft drink", "ready")).not.toMatch(
      /Soft drinks|soft drinks/,
    );
  });

  it("keeps unknown, coverage and venue empty copy on the coffee noun", () => {
    expect(drinkLensUnknownRowLabel("coffee", "ready")).toBe(
      "no coffee price logged",
    );
    expect(drinkLensUnknownSentence("coffee", "ready")).toBe(
      "No coffee price logged",
    );
    expect(drinkLensCoverageNote("coffee", "degraded")).toContain(
      "coffee prices",
    );
    expect(drinkLensCoverageNote("coffee", "degraded")).not.toContain("pint");
    expect(drinkLensEmptyVenueNote("coffee", "ready")).toBe(
      "No coffee price logged here yet.",
    );
    expect(drinkLensEmptyVenueNote("coffee", "ready")).not.toContain(
      NO_ALCOHOL_LENS_PRICE_NOUN,
    );
    expect(drinkLensEmptyVenueNote("coffee", "degraded")).toContain(
      "this pub's coffee prices",
    );
    expect(drinkLensEmptyVenueNote("coffee", "loading")).toContain(
      "Checking coffee prices",
    );
  });

  it("never hands the no-alcohol experience noun to a coffee category lens", () => {
    const noun = drinkLensPriceNoun("coffee");
    for (const status of [
      "idle",
      "loading",
      "ready",
      "partial",
      "degraded",
    ] as const) {
      expect(drinkLensUnknownRowLabel(noun, status)).not.toContain(
        NO_ALCOHOL_LENS_PRICE_NOUN,
      );
      const note = drinkLensCoverageNote(noun, status);
      if (note !== null) {
        expect(note).not.toContain(NO_ALCOHOL_LENS_PRICE_NOUN);
        expect(note).toContain("coffee");
      }
    }
  });
});

describe("the no-alcohol lens inside a sentence", () => {
  it("does not bury the pub's own fact under a double negative", () => {
    // "no no-alcohol price logged" reads as a negation of a negation; the
    // reader wants to know this pub has none on record.
    const ready = drinkLensUnknownRowLabel(
      NO_ALCOHOL_LENS_PRICE_NOUN,
      "ready",
    );
    expect(ready).toBe("no alcohol-free or soft drink price logged");
    expect(ready).not.toContain("no no-");
  });

  it("keeps could-not-check a separate fact from the pub having none", () => {
    const ready = drinkLensUnknownRowLabel(NO_ALCOHOL_LENS_PRICE_NOUN, "ready");
    const degraded = drinkLensUnknownRowLabel(
      NO_ALCOHOL_LENS_PRICE_NOUN,
      "degraded",
    );
    expect(degraded).toBe(
      "alcohol-free or soft drink price could not be read",
    );
    expect(degraded).not.toBe(ready);
  });

  it("owns the capital in one place", () => {
    expect(drinkLensUnknownSentence("whisky", "ready")).toBe(
      "No whisky price logged",
    );
    expect(drinkLensUnknownSentence("whisky", "degraded")).toBe(
      "Whisky price could not be read",
    );
  });
});

describe("one lens, one name", () => {
  const statuses = ["idle", "loading", "ready", "partial", "degraded"] as const;

  it("names the no-alcohol lens the same way in every sentence", () => {
    // The lens control sits beside the map while the venue list and its rows
    // are open, so a second ordering of the same two drinks reads as a second
    // lens. Every sentence derives its noun from the one constant.
    for (const status of statuses) {
      for (const count of [0, 1, 4]) {
        const summary = experienceLensSummary(
          "no-alcohol",
          count,
          1,
          status,
        );
        expect(summary).toContain(NO_ALCOHOL_LENS_PRICE_NOUN);
      }
      expect(
        drinkLensUnknownRowLabel(NO_ALCOHOL_LENS_PRICE_NOUN, status),
      ).toContain(NO_ALCOHOL_LENS_PRICE_NOUN);
      const note = drinkLensCoverageNote(NO_ALCOHOL_LENS_PRICE_NOUN, status);
      if (note !== null) expect(note).toContain(NO_ALCOHOL_LENS_PRICE_NOUN);
    }
  });

  it("leaves no stale ordering of the same two drinks behind", () => {
    for (const status of statuses) {
      const summary = experienceLensSummary("no-alcohol", 2, 1, status);
      expect(summary).not.toMatch(/soft-drink or alcohol-free/i);
      expect(summary).not.toMatch(/soft-drink and alcohol-free/i);
      expect(summary).not.toMatch(/\bno-alcohol price/i);
    }
  });
});

describe("who the no-alcohol view has to answer for", () => {
  const noAlcoholPrices = new Map<string, MapLensPrice>();

  it("keeps bars, food and restaurants in the view", () => {
    // These kinds mount no pint-submit card, so the surface that names their
    // prices is the only thing that can ask for their read.
    const bar = venue({
      id: "bar-1",
      kind: "bar",
      amenities: { ...venue().amenities, nonAlcoholic: true },
    });
    const food = venue({ id: "food-1", kind: "food" });
    const restaurant = venue({ id: "restaurant-1", kind: "restaurant" });
    const shown = filterVenuesForExperienceLens(
      [bar, food, restaurant],
      "no-alcohol",
      noAlcoholPrices,
    ).map((v) => v.id);

    expect(shown).toContain("bar-1");
    expect(shown).toContain("food-1");
    expect(shown).toContain("restaurant-1");
  });

  it("still refuses to call a non-pub anchor a pint price", () => {
    // Loading a non-pub venue's community rows must not move the pint lane:
    // a food venue's own figure stays a sourced anchor, named as one.
    const restaurant = venue({
      id: "restaurant-1",
      kind: "restaurant",
      cheapestPrice: 12.5,
      anchorLabel: "Signature plate",
      anchorObservedAt: "2026-07-20",
      anchorSourceUrl: "https://example.com/menu",
    });
    const price = lensPriceForVenue(restaurant, "no-alcohol", noAlcoholPrices);
    expect(price?.source).toBe("sourced-anchor");
    expect(price?.category).toBeNull();
    expect(price?.categoryLabel).not.toMatch(/pint/i);
  });
});
