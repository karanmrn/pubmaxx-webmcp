import { describe, expect, it } from "vitest";

import { DRINK_CATEGORIES, isDrinkCategory } from "@/lib/drinks";
import {
  DRINK_SUBTYPES,
  drinkSubtypeFromText,
  findSubtype,
  haystackIsTopShelf,
  parseDrinkSubtypeParam,
  subtypesForCategory,
} from "@/lib/drinkSubtypes";

describe("drink subtype taxonomy", () => {
  it("keeps every subtype anchored to a real top-level category (two levels, no deeper)", () => {
    for (const subtype of DRINK_SUBTYPES) {
      expect(isDrinkCategory(subtype.category)).toBe(true);
      expect(subtype.id.startsWith(`${subtype.category}-`)).toBe(true);
      expect(subtype.tokens.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    const ids = DRINK_SUBTYPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps subtypes inside the closed twelve-category union", () => {
    expect(DRINK_CATEGORIES).toHaveLength(12);
    for (const subtype of DRINK_SUBTYPES) {
      expect(DRINK_CATEGORIES).toContain(subtype.category);
    }
  });

  it("offers refinements for the categories the chips expose", () => {
    for (const cat of ["beer", "wine", "whisky", "gin", "rum", "cocktail"] as const) {
      expect(subtypesForCategory(cat).length).toBeGreaterThan(0);
    }
    // "other" is the honest catch-all — refining it would be a fabrication.
    expect(subtypesForCategory("other")).toEqual([]);
  });

  it("resolves ids and rejects unknown ones instead of no-opping", () => {
    expect(findSubtype("rum-dark")?.category).toBe("rum");
    expect(findSubtype("whisky-japanese")?.category).toBe("whisky");
    expect(findSubtype("not-a-subtype")).toBeNull();
  });

  it("pins a parsed subtype to its own category", () => {
    expect(parseDrinkSubtypeParam("rum-dark", "rum")?.id).toBe("rum-dark");
    expect(parseDrinkSubtypeParam("rum-dark", "gin")).toBeNull();
    expect(parseDrinkSubtypeParam("  RUM-DARK ")?.id).toBe("rum-dark");
  });
});

describe("drinkSubtypeFromText", () => {
  it("classifies the captain's examples", () => {
    expect(drinkSubtypeFromText("White rum")?.id).toBe("rum-white");
    expect(drinkSubtypeFromText("Black rum")?.id).toBe("rum-dark");
    expect(drinkSubtypeFromText("Dark rum & coke")?.id).toBe("rum-dark");
    expect(drinkSubtypeFromText("Spiced rum")?.id).toBe("rum-spiced");
    expect(drinkSubtypeFromText("Japanese whisky")?.id).toBe("whisky-japanese");
    expect(drinkSubtypeFromText("Islay single malt")?.id).toBe("whisky-single-malt");
  });

  it("disambiguates a bare token by the category it is pinned to", () => {
    expect(drinkSubtypeFromText("white", "rum")?.id).toBe("rum-white");
    expect(drinkSubtypeFromText("white", "wine")?.id).toBe("wine-white");
    // A hit belonging to another family is rejected, never coerced.
    expect(drinkSubtypeFromText("Japanese whisky", "rum")).toBeNull();
  });

  it("stays honest when the text carries no subtype signal", () => {
    expect(drinkSubtypeFromText("")).toBeNull();
    expect(drinkSubtypeFromText(null)).toBeNull();
    expect(drinkSubtypeFromText("the usual")).toBeNull();
    expect(drinkSubtypeFromText("a memory")).toBeNull();
  });

  it("matches on word boundaries, not substrings", () => {
    expect(drinkSubtypeFromText("tulipa flower")).toBeNull();
    expect(drinkSubtypeFromText("wryest")).toBeNull();
  });

  it("prefers explicit text over brand knowledge", () => {
    // Bare Bacardi hints white rum; "Bacardi Spiced" says otherwise.
    expect(drinkSubtypeFromText("Bacardi")?.id).toBe("rum-white");
    expect(drinkSubtypeFromText("Bacardi Spiced")?.id).toBe("rum-spiced");
  });

  it("uses canonical catalog labels and aliases for brand knowledge", () => {
    expect(drinkSubtypeFromText("Jack Daniel's")?.id).toBe("whisky-bourbon");
    expect(drinkSubtypeFromText("Maker's Mark")?.id).toBe("whisky-bourbon");
  });

  // Spot-check against the real strings in data/pint_prices_app_dataset.csv.
  it.each([
    ["GUINNESS", "beer-stout"],
    ["Guiness", "beer-stout"],
    ["AMSTEL", "beer-lager"],
    ["CARLSBERG PILSNER", "beer-pilsner"],
    ["PILSNER URQUELL", "beer-pilsner"],
    ["NECK OIL", "beer-ipa"],
    ["BEVERTOWN NECK OIL", "beer-ipa"],
    ["PUNK IPA", "beer-ipa"],
    ["SAMBROOKS SESSION IPA", "beer-ipa"],
    ["PALE ALE", "beer-pale-ale"],
    ["NICHOLSON'S PALE ALE", "beer-pale-ale"],
    ["CASK ALE", "beer-ale"],
    ["LONDON PRIDE", "beer-ale"],
    ["YOUNG'S BITTER", "beer-bitter"],
    ["THORNBRIDGE 'LORD MARPLES' BITTER", "beer-bitter"],
    ["ASPALL CYDER", "beer-cider"],
    ["THATCHERS GOLD", "beer-cider"],
    ["STRONGBOW DARK FRUIT", "beer-cider"],
    ["HENRY WESTON'S VINTAGE CIDER", "beer-cider"],
    ["PAULANER MUNCHNER HELL", "beer-lager"],
    ["PAULANER WEISSBIER", "beer-wheat"],
    ["HOUSE LAGER", "beer-lager"],
    ["CAMDEN HELLS", "beer-lager"],
    ["PECKHAM RYE RED ALE", "beer-ale"],
  ])("classifies dataset string %s as %s", (name, expected) => {
    expect(drinkSubtypeFromText(name, "beer")?.id).toBe(expected);
  });
});

describe("top shelf", () => {
  it("fires on premium menu language and premium brands", () => {
    expect(haystackIsTopShelf("Top shelf pour")).toBe(true);
    expect(haystackIsTopShelf("Lagavulin 16")).toBe(true);
    expect(haystackIsTopShelf("Grey Goose")).toBe(true);
    expect(haystackIsTopShelf("Cask strength single malt")).toBe(true);
    expect(haystackIsTopShelf("Hendrick's")).toBe(true);
    expect(haystackIsTopShelf("Maker's Mark")).toBe(true);
    expect(haystackIsTopShelf("Cîroc")).toBe(true);
  });

  it("fires on category-scoped premium language and age statements", () => {
    expect(haystackIsTopShelf("Vintage Champagne")).toBe(true);
    expect(haystackIsTopShelf("Glenfiddich 12 Year Old")).toBe(true);
    expect(haystackIsTopShelf("Redbreast 12 yr")).toBe(true);
    expect(haystackIsTopShelf("Courvoisier XO")).toBe(true);
    expect(haystackIsTopShelf("Aged rum")).toBe(true);
  });

  it("never promotes an ordinary pour", () => {
    expect(haystackIsTopShelf("")).toBe(false);
    expect(haystackIsTopShelf("Carling")).toBe(false);
    expect(haystackIsTopShelf("House lager")).toBe(false);
  });

  it("ignores standalone marketing adjectives on ordinary pints", () => {
    expect(haystackIsTopShelf("HENRY WESTON'S VINTAGE CIDER")).toBe(false);
    expect(haystackIsTopShelf("HENRY WESTONS VINTAGE STILL CIDER")).toBe(false);
    expect(haystackIsTopShelf("Appleshed Premium Cider Dark Fruit")).toBe(false);
    expect(haystackIsTopShelf("Premium lager")).toBe(false);
    expect(haystackIsTopShelf("Special Reserve")).toBe(false);
    expect(haystackIsTopShelf("3 year cider")).toBe(false);
  });
});
