import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  DRINK_CATEGORIES,
  CATEGORY_META,
  abvForBrand,
  beerDrinksToLegacy,
  categoryLabel,
  formatAbv,
  groupDrinksByCategory,
  isDrinkCategory,
  legacyPricesToDrinks,
  type Drink,
  type LegacyPintPrice,
} from "@/lib/drinks";

// Convention: pure lib, no Supabase — clear env so nothing reaches a backend.
beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const OBSERVED = "2026-07-01T12:00:00.000Z";

// The taxonomy is closed on BOTH sides of the wire: lib/drinks.ts states it and
// a Postgres CHECK enforces it, so a category that exists in one and not the
// other is a row the app will happily build and the database will refuse. The
// constraints are redefined over time (0016 → 0054 → 0056), so this reads the
// migrations in order and holds only the LAST definition of each name to the
// current union - exactly what a fresh database ends up with.
function latestCheckedCategories(constraint: string): string[] | undefined {
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  let latest: string[] | undefined;
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const pattern = new RegExp(
      `add\\s+constraint\\s+${constraint}\\s+check\\s*\\([^()]*in\\s*\\(([^)]*)\\)`,
      "gi",
    );
    for (const match of sql.matchAll(pattern)) {
      latest = [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
    }
  }
  return latest;
}

describe("database CHECK constraints mirror the closed taxonomy", () => {
  for (const constraint of [
    "drinks_category_check",
    "community_prices_category_check",
  ]) {
    it(`${constraint} accepts exactly DRINK_CATEGORIES`, () => {
      const checked = latestCheckedCategories(constraint);
      expect(checked, `no ${constraint} found in supabase/migrations`).toBeDefined();
      expect([...(checked ?? [])].sort()).toEqual([...DRINK_CATEGORIES].sort());
    });
  }

  it("both no-alcohol lanes are named, and never collapsed into other", () => {
    for (const constraint of [
      "drinks_category_check",
      "community_prices_category_check",
    ]) {
      const checked = latestCheckedCategories(constraint) ?? [];
      expect(checked).toContain("soft-drink");
      expect(checked).toContain("alcohol-free");
    }
  });

  it("names coffee as its own lane, never collapsed into soft-drink or other", () => {
    expect(DRINK_CATEGORIES).toContain("coffee");
    for (const constraint of [
      "drinks_category_check",
      "community_prices_category_check",
    ]) {
      const checked = latestCheckedCategories(constraint) ?? [];
      expect(checked).toContain("coffee");
    }
  });
});

function drink(overrides: Partial<Drink> = {}): Drink {
  return {
    id: "d1",
    category: "wine",
    name: "House Red",
    priceGbp: 7,
    provenance: { source: "seed", licence: "n/a", observedAt: OBSERVED },
    ...overrides,
  };
}

describe("category taxonomy", () => {
  it("every category has display metadata with a unique order", () => {
    const orders = new Set<number>();
    for (const cat of DRINK_CATEGORIES) {
      const meta = CATEGORY_META[cat];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(orders.has(meta.order)).toBe(false);
      orders.add(meta.order);
    }
    expect(orders.size).toBe(DRINK_CATEGORIES.length);
  });

  it("beer sorts first (the app's spine), other last", () => {
    const orders = DRINK_CATEGORIES.map((c) => CATEGORY_META[c].order);
    expect(CATEGORY_META.beer.order).toBe(Math.min(...orders));
    expect(CATEGORY_META.other.order).toBe(Math.max(...orders));
  });

  it("isDrinkCategory guards the closed set", () => {
    expect(isDrinkCategory("beer")).toBe(true);
    expect(isDrinkCategory("gin")).toBe(true);
    expect(isDrinkCategory("soft-drink")).toBe(true);
    expect(isDrinkCategory("alcohol-free")).toBe(true);
    expect(isDrinkCategory("coffee")).toBe(true);
    expect(isDrinkCategory("cider")).toBe(false);
    expect(isDrinkCategory(42)).toBe(false);
    expect(isDrinkCategory(undefined)).toBe(false);
  });

  it("categoryLabel returns the human label", () => {
    expect(categoryLabel("whisky")).toBe("Whisky");
    expect(categoryLabel("beer")).toBe("Beer");
    expect(categoryLabel("soft-drink")).toBe("Soft drinks");
    expect(categoryLabel("alcohol-free")).toBe("Alcohol-free");
    expect(categoryLabel("coffee")).toBe("Coffee");
  });
});

describe("formatAbv", () => {
  it("formats a numeric ABV as X%", () => {
    expect(formatAbv(4.2)).toBe("4.2%");
    expect(formatAbv(40)).toBe("40%");
  });

  it("returns empty string when ABV is missing", () => {
    expect(formatAbv(undefined)).toBe("");
    expect(formatAbv(null)).toBe("");
    expect(formatAbv(Number.NaN)).toBe("");
  });

  it("abvForBrand reads brand.abv when present", () => {
    expect(abvForBrand({ abv: 41.6 })).toBe(41.6);
    expect(abvForBrand({})).toBeUndefined();
  });
});

describe("groupDrinksByCategory", () => {
  it("returns empty for no drinks", () => {
    expect(groupDrinksByCategory([])).toEqual([]);
  });

  it("groups into ordered sections, omitting empty categories", () => {
    const groups = groupDrinksByCategory([
      drink({ id: "w1", category: "wine", name: "Wine A", priceGbp: 8 }),
      drink({ id: "b1", category: "beer", name: "Lager", priceGbp: 6 }),
      drink({ id: "g1", category: "gin", name: "Gin A", priceGbp: 8 }),
    ]);
    // Only the three present categories, in CATEGORY_META order (beer < wine < gin).
    expect(groups.map((g) => g.category)).toEqual(["beer", "wine", "gin"]);
    expect(groups.every((g) => g.drinks.length === 1)).toBe(true);
    expect(groups[0].label).toBe("Beer");
  });

  it("sorts within a section by price then name, deterministically", () => {
    const groups = groupDrinksByCategory([
      drink({ id: "a", category: "wine", name: "Zeta", priceGbp: 7 }),
      drink({ id: "b", category: "wine", name: "Alpha", priceGbp: 7 }),
      drink({ id: "c", category: "wine", name: "Cheap", priceGbp: 5 }),
    ]);
    expect(groups[0].drinks.map((d) => d.name)).toEqual(["Cheap", "Alpha", "Zeta"]);
  });

  it("does not mutate its input", () => {
    const input = [
      drink({ id: "a", category: "wine", name: "B", priceGbp: 9 }),
      drink({ id: "b", category: "wine", name: "A", priceGbp: 5 }),
    ];
    const snapshot = input.map((d) => d.id);
    groupDrinksByCategory(input);
    expect(input.map((d) => d.id)).toEqual(snapshot);
  });
});

describe("legacyPricesToDrinks", () => {
  it("views pint rows as beer drinks, carrying dataset provenance", () => {
    const prices: LegacyPintPrice[] = [
      { app_price_id: "p1", pint_name: "London Pride", price_gbp: 6.4 },
      { app_price_id: "p2", pint_name: "Guinness", price_gbp: 6.1 },
    ];
    const drinks = legacyPricesToDrinks(prices, OBSERVED);
    expect(drinks).toHaveLength(2);
    expect(drinks[0]).toMatchObject({
      id: "beer-p1",
      category: "beer",
      name: "London Pride",
      servingSize: "pint",
      priceGbp: 6.4,
    });
    // Unknown brand → no invented ABV (keeps low/no name matching honest).
    expect(drinks[0].abv).toBeUndefined();
    expect(drinks[1]).toMatchObject({
      id: "beer-p2",
      name: "Guinness",
      abv: 4.2,
    });
    expect(drinks[0].provenance).toEqual({
      source: "app-dataset",
      licence: "first-party",
      observedAt: OBSERVED,
      lane: "dataset",
    });
  });

  it("keeps the named publisher from a price record instead of a generic dataset label", () => {
    const sourceUrl =
      "https://www.pint-prices.com/pub/19%20Upper%20Mall,%20London%20W6%209TA/The%20Dove";
    const [drink] = legacyPricesToDrinks(
      [
        {
          app_price_id: "app_price_001178",
          pint_name: "ASAHI",
          price_gbp: 7.25,
          pub_url: sourceUrl,
        },
      ],
      OBSERVED,
    );

    expect(drink.provenance).toMatchObject({
      source: "Pint Prices",
      sourceUrl,
    });
  });

  it("skips rows without a numeric price (a menu item must carry a price)", () => {
    const drinks = legacyPricesToDrinks(
      [
        { app_price_id: "p1", pint_name: "No price", price_gbp: null },
        { app_price_id: "p2", pint_name: "Priced", price_gbp: 5 },
      ],
      OBSERVED,
    );
    expect(drinks.map((d) => d.id)).toEqual(["beer-p2"]);
  });

  it("falls back to a name when the pint name is blank", () => {
    const drinks = legacyPricesToDrinks(
      [{ app_price_id: "p1", pint_name: "", price_gbp: 5 }],
      OBSERVED,
    );
    expect(drinks[0].name).toBe("Pint");
  });
});

describe("beerDrinksToLegacy (inverse view)", () => {
  it("round-trips beer drinks back to the pint shape, recovering the id", () => {
    const prices: LegacyPintPrice[] = [
      { app_price_id: "p1", pint_name: "London Pride", price_gbp: 6.4 },
    ];
    const back = beerDrinksToLegacy(legacyPricesToDrinks(prices, OBSERVED));
    expect(back).toEqual(prices);
  });

  it("drops non-beer drinks (the pint model can only represent beer)", () => {
    const mixed: Drink[] = [
      drink({ id: "beer-p1", category: "beer", name: "Lager", priceGbp: 6 }),
      drink({ id: "w1", category: "wine", name: "Wine", priceGbp: 8 }),
    ];
    const back = beerDrinksToLegacy(mixed);
    expect(back).toEqual([
      { app_price_id: "p1", pint_name: "Lager", price_gbp: 6 },
    ]);
  });

  it("keeps a non-prefixed id as-is", () => {
    const back = beerDrinksToLegacy([
      drink({ id: "raw-id", category: "beer", name: "X", priceGbp: 5 }),
    ]);
    expect(back[0].app_price_id).toBe("raw-id");
  });
});
