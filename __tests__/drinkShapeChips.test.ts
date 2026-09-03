import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHIP_CATEGORIES,
  nextDrinkShapeFilters,
  nextDrinkSubtypeFilters,
  nextTopShelfFilters,
  showsDrinkRefinements,
} from "@/components/map/DrinkShapeChips";
import { categoryLabel } from "@/lib/drinks";
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

describe("nextDrinkShapeFilters", () => {
  it("sets the drink lens and clears a stale brand when a shape is selected (leaves text query alone)", () => {
    expect(
      nextDrinkShapeFilters(
        filters({ query: "Guinness", drinkCategory: "beer", drinkBrand: "guinness" }),
        "wine",
      ),
    ).toMatchObject({
      query: "Guinness",
      requireCocktails: false,
      drinkCategory: "wine",
      drinkBrand: "",
    });
  });

  it("clears drink lens filters when the active shape is toggled off (leaves text query alone)", () => {
    expect(
      nextDrinkShapeFilters(
        filters({ query: "borough", drinkCategory: "gin", drinkBrand: "sipsmith" }),
        "gin",
      ),
    ).toMatchObject({
      query: "borough",
      requireCocktails: false,
      drinkCategory: "",
      drinkBrand: "",
    });
  });

  it("drops a stale subtype when the category changes or is switched off", () => {
    expect(
      nextDrinkShapeFilters(
        filters({ drinkCategory: "rum", drinkSubtype: "rum-dark" }),
        "whisky",
      ),
    ).toMatchObject({ drinkCategory: "whisky", drinkSubtype: "" });

    expect(
      nextDrinkShapeFilters(
        filters({
          drinkCategory: "rum",
          drinkSubtype: "rum-dark",
          topShelfOnly: true,
        }),
        "rum",
      ),
    ).toMatchObject({
      drinkCategory: "",
      drinkSubtype: "",
      topShelfOnly: false,
    });
  });

  it("keeps cocktail amenity in sync with the cocktail shape", () => {
    expect(nextDrinkShapeFilters(filters(), "cocktail")).toMatchObject({
      query: "",
      requireCocktails: true,
      drinkCategory: "cocktail",
      drinkBrand: "",
    });
  });
});

describe("nextDrinkSubtypeFilters", () => {
  it("sets the subtype ALONGSIDE its parent category, never replacing it", () => {
    expect(nextDrinkSubtypeFilters(filters(), "rum-dark")).toMatchObject({
      drinkCategory: "rum",
      drinkSubtype: "rum-dark",
    });
    expect(
      nextDrinkSubtypeFilters(filters({ drinkCategory: "whisky" }), "whisky-japanese"),
    ).toMatchObject({ drinkCategory: "whisky", drinkSubtype: "whisky-japanese" });
  });

  it("toggles the active subtype off while keeping the category lens", () => {
    expect(
      nextDrinkSubtypeFilters(
        filters({ drinkCategory: "rum", drinkSubtype: "rum-dark" }),
        "rum-dark",
      ),
    ).toMatchObject({ drinkCategory: "rum", drinkSubtype: "" });
  });

  it("keeps the cocktail amenity in sync and ignores unknown ids", () => {
    expect(nextDrinkSubtypeFilters(filters(), "cocktail-spritz")).toMatchObject({
      drinkCategory: "cocktail",
      requireCocktails: true,
      drinkSubtype: "cocktail-spritz",
    });
    const before = filters({ drinkCategory: "rum" });
    expect(nextDrinkSubtypeFilters(before, "rum-unicorn")).toBe(before);
  });
});

describe("nextTopShelfFilters", () => {
  it("toggles without disturbing the active drink lens", () => {
    const lens = filters({ drinkCategory: "rum", drinkSubtype: "rum-dark" });
    const on = nextTopShelfFilters(lens);
    expect(on).toMatchObject({
      topShelfOnly: true,
      drinkCategory: "rum",
      drinkSubtype: "rum-dark",
    });
    expect(nextTopShelfFilters(on).topShelfOnly).toBe(false);
  });

  it("does not create a hidden top-shelf filter without a category", () => {
    const before = filters();
    expect(nextTopShelfFilters(before)).toBe(before);
    expect(
      nextTopShelfFilters(filters({ drinkCategory: "vodka" })).topShelfOnly,
    ).toBe(true);
  });

  it("pins the category when the row was disclosed by the cocktails amenity alone", () => {
    const on = nextTopShelfFilters(filters({ requireCocktails: true }));
    expect(on).toMatchObject({
      drinkCategory: "cocktail",
      requireCocktails: true,
      topShelfOnly: true,
    });
    // Unchecking the ControlRail cocktails box afterwards leaves the pinned
    // category, so the refinement row (and the toggle) stays reachable.
    const unchecked = { ...on, requireCocktails: false };
    expect(unchecked.drinkCategory).toBe("cocktail");
    expect(nextTopShelfFilters(unchecked).topShelfOnly).toBe(false);
  });
});

describe("selected drink price lens controls", () => {
  it("does not offer brandless subtype claims for non-pint price lenses", () => {
    expect(showsDrinkRefinements(filters({ drinkCategory: "whisky" }))).toBe(false);
    expect(showsDrinkRefinements(filters({ drinkCategory: "beer" }))).toBe(true);
  });
});


describe("CHIP_CATEGORIES outing lenses", () => {
  it("ends the compact strip with coffee, alcohol-free, and soft-drink", () => {
    expect(CHIP_CATEGORIES).toEqual([
      "beer",
      "wine",
      "cocktail",
      "whisky",
      "gin",
      "rum",
      "coffee",
      "alcohol-free",
      "soft-drink",
    ]);
  });

  it("uses British category labels for accessible names", () => {
    expect(CHIP_CATEGORIES.map(categoryLabel)).toEqual([
      "Beer",
      "Wine",
      "Cocktails",
      "Whisky",
      "Gin",
      "Rum",
      "Coffee",
      "Alcohol-free",
      "Soft drinks",
    ]);
    for (const label of CHIP_CATEGORIES.map(categoryLabel)) {
      expect(label).not.toMatch(/!/);
      expect(label).not.toMatch(/\u2014|\u2013/);
    }
  });

  it("sets the drink lens for an outing category without disclosing beer refinements", () => {
    expect(nextDrinkShapeFilters(filters(), "coffee")).toMatchObject({
      drinkCategory: "coffee",
      drinkBrand: "",
      drinkSubtype: "",
      requireCocktails: false,
    });
    expect(showsDrinkRefinements(filters({ drinkCategory: "coffee" }))).toBe(false);
    expect(showsDrinkRefinements(filters({ drinkCategory: "alcohol-free" }))).toBe(false);
    expect(showsDrinkRefinements(filters({ drinkCategory: "soft-drink" }))).toBe(false);
  });
});

// The mobile filter sheet renders DrinkShapeChips without MapToolbar (a
// desktop-only dynamic chunk), so the chip styles only reach a 390px viewport
// if the component imports its stylesheet itself. Locked from source, the same
// idiom as mapBannerStagingCss.test.ts.
describe("drink chip styling ships with the component", () => {
  const component = readFileSync(
    join(process.cwd(), "components/map/DrinkShapeChips.tsx"),
    "utf8",
  );
  const css = readFileSync(
    join(process.cwd(), "components/map/mapToolbar.css"),
    "utf8",
  );

  it("imports the chip stylesheet directly (not only via MapToolbar)", () => {
    expect(component).toMatch(/import\s+"\.\/mapToolbar\.css"/);
  });

  it("keeps selected-state rules for subtype and top-shelf chips in that stylesheet", () => {
    expect(css).toMatch(/\.drinkShapeChip\.isOn/);
    expect(css).toMatch(/\.drinkSubtypeChip\.isOn/);
    expect(css).toMatch(/\.drinkSubtypeChip\.isTopShelf\.isOn/);
  });

  it("keeps the category strip de-boxed at rest (no resting border)", () => {
    const chip = /\.drinkShapeChip\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(chip).toMatch(/border:\s*0/);
    expect(chip).toMatch(/background:\s*transparent/);
  });

  it("selected category chips use panel-raised and ink, never a coral CTA fill", () => {
    const selected = /\.drinkShapeChip\.isOn\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const background = /background:\s*([^;]+);/.exec(selected)?.[1] ?? "";
    expect(background).toBe("var(--panel-raised)");
    expect(selected).toMatch(/color:\s*var\(--ink\)/);
    // Brass may cue selection (underline / inset), never own the fill.
    expect(selected).toMatch(/var\(--brass\)/);
    expect(background).not.toMatch(/--brass/);
  });

  it("edge-fades the horizontal chip strips and clears the mask in the filter grid", () => {
    const strip = /\.drinkShapeChips\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(strip).toMatch(/mask-image:\s*linear-gradient/);
    expect(strip).toMatch(/-webkit-mask-image:\s*linear-gradient/);
    expect(css).toMatch(
      /\.mobileMapFilters\s+\.drinkShapeChips\s*\{[^}]*mask-image:\s*none/,
    );
  });

  it("keeps the 44px phone tap target and gates chip motion behind reduced-motion", () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.drinkShapeChip\s*\{[^}]*min-height:\s*44px/,
    );
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*?\.drinkShapeChip\s*\{[^}]*transition:/,
    );
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.drinkShapeChip/,
    );
  });

  it("keeps dark-mode selected and label rules so outing glyphs stay readable", () => {
    expect(css).toMatch(
      /html\[data-theme="dark"\]\s+\.drinkShapeChip\.isOn\s*\{[^}]*color:\s*var\(--ink\)/,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\]\s+\.drinkShapeChip\s*\{[^}]*color:\s*var\(--ink-soft\)/,
    );
  });
});
