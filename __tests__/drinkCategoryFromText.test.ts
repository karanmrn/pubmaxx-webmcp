import { describe, expect, it } from "vitest";

import {
  drinkCategoryFromText,
  drinkTaxonomyFromText,
} from "@/lib/drinkCategoryFromText";

describe("drinkCategoryFromText", () => {
  it("returns null for empty / unknown / non-string input", () => {
    expect(drinkCategoryFromText("")).toBeNull();
    expect(drinkCategoryFromText("   ")).toBeNull();
    expect(drinkCategoryFromText("a memory")).toBeNull();
    expect(drinkCategoryFromText("the usual")).toBeNull();
    expect(drinkCategoryFromText(null)).toBeNull();
    expect(drinkCategoryFromText(undefined)).toBeNull();
  });

  it("classifies beer/pint labels", () => {
    expect(drinkCategoryFromText("Guinness")).toBe("beer");
    expect(drinkCategoryFromText("A cheeky pint")).toBe("beer");
    expect(drinkCategoryFromText("Neck Oil IPA")).toBe("beer");
    expect(drinkCategoryFromText("House lager")).toBe("beer");
    expect(drinkCategoryFromText("Rekorderlig cider")).toBe("beer");
  });

  it("classifies wine including bare 'red'/'white'", () => {
    expect(drinkCategoryFromText("House red")).toBe("wine");
    expect(drinkCategoryFromText("Large white wine")).toBe("wine");
    expect(drinkCategoryFromText("Malbec")).toBe("wine");
    expect(drinkCategoryFromText("Prosecco")).toBe("wine");
  });

  it("classifies spirits and cocktails", () => {
    expect(drinkCategoryFromText("Single malt whisky")).toBe("whisky");
    expect(drinkCategoryFromText("Bourbon, neat")).toBe("whisky");
    expect(drinkCategoryFromText("Gin and tonic")).toBe("gin");
    expect(drinkCategoryFromText("Negroni")).toBe("gin");
    expect(drinkCategoryFromText("Vodka soda")).toBe("vodka");
    expect(drinkCategoryFromText("Dark rum")).toBe("rum");
    expect(drinkCategoryFromText("Mojito")).toBe("rum");
    expect(drinkCategoryFromText("Aperol spritz")).toBe("cocktail");
    expect(drinkCategoryFromText("Tequila shot")).toBe("shot");
  });

  it("does not let a substring over-match (word boundaries)", () => {
    // "red" must not match inside another word.
    expect(drinkCategoryFromText("Shredded nachos")).toBeNull();
    // "ale" must not match inside "kale".
    expect(drinkCategoryFromText("Kale smoothie")).toBeNull();
  });

  it("prefers the more specific family over the broad beer net", () => {
    expect(drinkCategoryFromText("Red wine")).toBe("wine");
    expect(drinkCategoryFromText("Whisky sour")).toBe("whisky");
    // Soft-drink keywords beat the beer net so ginger beer is not a pint.
    expect(drinkCategoryFromText("Ginger beer")).toBe("soft-drink");
  });

  it("classifies alcohol-free, soft drink, and coffee daytime lanes", () => {
    expect(drinkCategoryFromText("Heineken 0.0")).toBe("alcohol-free");
    expect(drinkCategoryFromText("Alcohol-free pint")).toBe("alcohol-free");
    expect(drinkCategoryFromText("Coke")).toBe("soft-drink");
    expect(drinkCategoryFromText("Lime and lemonade")).toBe("soft-drink");
    expect(drinkCategoryFromText("Flat white")).toBe("coffee");
    expect(drinkCategoryFromText("Americano")).toBe("coffee");
    // Espresso martini stays a spirit/cocktail lane, not coffee.
    expect(drinkCategoryFromText("Espresso martini")).toBe("vodka");
  });

  it("returns one-level subtype and top-shelf evidence without changing legacy category order", () => {
    expect(drinkTaxonomyFromText("Black rum")).toEqual({
      category: "rum",
      subtype: "rum-dark",
      topShelf: false,
    });
    expect(drinkTaxonomyFromText("Japanese whisky")).toEqual({
      category: "whisky",
      subtype: "whisky-japanese",
      topShelf: false,
    });
    expect(drinkTaxonomyFromText("Lagavulin 16")).toEqual({
      category: "whisky",
      subtype: "whisky-single-malt",
      topShelf: true,
    });
    // Existing ordered mapper treats Negroni as gin. Subtype enrichment must
    // refine that category, never reorder the closed top-level behavior.
    expect(drinkTaxonomyFromText("Negroni")).toEqual({
      category: "gin",
      subtype: null,
      topShelf: false,
    });
  });

  it("uses subtype brand knowledge as a category fallback for real dataset labels", () => {
    expect(drinkCategoryFromText("AMSTEL")).toBe("beer");
    expect(drinkCategoryFromText("BACARDI")).toBe("rum");
  });
});
