import { beforeEach, describe, expect, it } from "vitest";

import type { Drink, LegacyPintPrice } from "@/lib/drinks";
import { hasMenuBeyondPints, venueDrinkMenu } from "@/lib/drinkMenu";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const OBSERVED = "2026-07-01T12:00:00.000Z";

function seedDrink(id: string, category: Drink["category"] = "wine"): Drink {
  return {
    id,
    category,
    name: "Seed " + id,
    priceGbp: 8,
    provenance: { source: "seed", licence: "n/a", observedAt: OBSERVED },
  };
}

const PRICES: LegacyPintPrice[] = [
  { app_price_id: "p1", pint_name: "London Pride", price_gbp: 6.4 },
  { app_price_id: "p2", pint_name: "Guinness", price_gbp: 6.1 },
];

describe("venueDrinkMenu", () => {
  it("composes legacy beer first, then the seeded non-beer menu", () => {
    const menu = venueDrinkMenu("v1", PRICES, () => [seedDrink("s1", "wine")]);
    expect(menu.map((d) => d.category)).toEqual(["beer", "beer", "wine"]);
    expect(menu.map((d) => d.id)).toEqual(["beer-p1", "beer-p2", "s1"]);
  });

  it("keeps each drink's own provenance (never flattens)", () => {
    const menu = venueDrinkMenu("v1", PRICES, () => [seedDrink("s1")]);
    expect(menu.find((d) => d.id === "beer-p1")!.provenance.source).toBe("app-dataset");
    expect(menu.find((d) => d.id === "s1")!.provenance.source).toBe("seed");
  });

  it("marks low/no legacy pint rows from conservative name matching", () => {
    const menu = venueDrinkMenu(
      "v1",
      [{ app_price_id: "na1", pint_name: "Lucky Saint 0.5%", price_gbp: 4.6 }],
      () => [],
    );
    expect(menu[0].alcoholType).toBe("low-no");
  });

  it("returns only beer when a venue has no seeded menu", () => {
    const menu = venueDrinkMenu("v1", PRICES, () => []);
    expect(menu.every((d) => d.category === "beer")).toBe(true);
    expect(menu).toHaveLength(2);
  });

  it("returns an empty menu for no prices and no seeds", () => {
    expect(venueDrinkMenu("v1", [], () => [])).toEqual([]);
  });

  it("dedupes by id so an overlapping source never doubles a row", () => {
    const menu = venueDrinkMenu(
      "v1",
      PRICES,
      () => [seedDrink("beer-p1", "beer"), seedDrink("s1")],
    );
    expect(menu.filter((d) => d.id === "beer-p1")).toHaveLength(1);
  });

  it("defaults legacyPrices to empty", () => {
    const menu = venueDrinkMenu("v1", undefined, () => [seedDrink("s1")]);
    expect(menu.map((d) => d.id)).toEqual(["s1"]);
  });
});

describe("hasMenuBeyondPints", () => {
  it("is true when a non-beer drink exists", () => {
    expect(hasMenuBeyondPints([seedDrink("s1", "gin")])).toBe(true);
  });

  it("is false for beer-only", () => {
    const beerOnly = venueDrinkMenu("v1", PRICES, () => []);
    expect(hasMenuBeyondPints(beerOnly)).toBe(false);
  });

  it("is false for an empty menu", () => {
    expect(hasMenuBeyondPints([])).toBe(false);
  });
});
