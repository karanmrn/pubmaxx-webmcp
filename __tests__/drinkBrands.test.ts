import { describe, expect, it } from "vitest";

import {
  brandMatchNeedles,
  brandsForCategory,
  categoryHasBrandCoverage,
  findBrand,
  haystackMatchesBrand,
  haystackMatchesCategory,
  normalizeBrandQuery,
  parseDrinkCategoryParam,
} from "@/lib/drinkBrands";
import { DRINK_CATEGORIES } from "@/lib/drinks";

describe("drinkBrands", () => {
  it("exposes a catalog entry for every DrinkCategory", () => {
    for (const category of DRINK_CATEGORIES) {
      expect(Array.isArray(brandsForCategory(category))).toBe(true);
    }
  });

  it("ships starter brands for the core spirits / wine / beer / cocktail families", () => {
    for (const category of ["vodka", "gin", "whisky", "rum", "wine", "beer", "cocktail"] as const) {
      expect(brandsForCategory(category).length).toBeGreaterThanOrEqual(4);
      expect(brandsForCategory(category).length).toBeLessThanOrEqual(10);
    }
  });

  it("keeps thin categories honestly empty", () => {
    expect(brandsForCategory("shot")).toEqual([]);
    expect(brandsForCategory("other")).toEqual([]);
    expect(brandsForCategory("soft-drink")).toEqual([]);
    expect(brandsForCategory("alcohol-free")).toEqual([]);
    expect(categoryHasBrandCoverage("shot")).toBe(false);
    expect(categoryHasBrandCoverage("gin")).toBe(true);
  });

  it("normalizes brand query ids", () => {
    expect(normalizeBrandQuery(" SipSmith ")).toBe("sipsmith");
    expect(normalizeBrandQuery("Grey Goose")).toBe("grey-goose");
    expect(normalizeBrandQuery("Hendrick's")).toBe("hendrick-s");
    expect(normalizeBrandQuery(null)).toBe("");
    expect(normalizeBrandQuery(undefined)).toBe("");
  });

  it("records typical UK ABV on curated brands", () => {
    expect(findBrand("sipsmith")?.brand.abv).toBe(41.6);
    expect(findBrand("guinness")?.brand.abv).toBe(4.2);
    expect(findBrand("negroni")?.brand.abv).toBe(24);
  });

  it("finds brands by id across categories", () => {
    expect(findBrand("sipsmith")).toEqual({
      category: "gin",
      brand: expect.objectContaining({ id: "sipsmith", label: "Sipsmith" }),
    });
    expect(findBrand("SIPSMITH")).toEqual({
      category: "gin",
      brand: expect.objectContaining({ id: "sipsmith" }),
    });
    expect(findBrand("not-a-brand")).toBeNull();
  });

  it("matches brand aliases in haystacks", () => {
    const hit = findBrand("hendricks");
    expect(hit).not.toBeNull();
    expect(haystackMatchesBrand("Hendrick's Gin & Tonic", hit!.brand)).toBe(true);
    expect(haystackMatchesBrand("house lager", hit!.brand)).toBe(false);
    expect(brandMatchNeedles(hit!.brand).length).toBeGreaterThan(0);
  });

  it("matches brand needles on word boundaries, not bare substrings", () => {
    const jd = findBrand("jack-daniels");
    expect(jd).not.toBeNull();
    // Alias "jd" must not match inside unrelated words.
    expect(haystackMatchesBrand("adjourned tasting notes", jd!.brand)).toBe(false);
    expect(haystackMatchesBrand("JD and coke", jd!.brand)).toBe(true);

    const moretti = findBrand("birra-moretti");
    expect(moretti).not.toBeNull();
    // Alias "moretti" must not match inside "amoretti".
    expect(haystackMatchesBrand("amoretti biscuit stout", moretti!.brand)).toBe(false);
    expect(haystackMatchesBrand("Birra Moretti pint", moretti!.brand)).toBe(true);
  });

  it("matches category tokens in haystacks", () => {
    expect(haystackMatchesCategory("house red wine list", "wine")).toBe(true);
    expect(haystackMatchesCategory("vodka soda", "vodka")).toBe(true);
    expect(haystackMatchesCategory("guinness pint", "vodka")).toBe(false);
    // "g&t" must not collapse into "g t" and hit "canning town".
    expect(haystackMatchesCategory("canning town carlsberg", "gin")).toBe(false);
    expect(haystackMatchesCategory("classic g&t", "gin")).toBe(true);
    expect(haystackMatchesCategory("Coca-Cola zero", "soft-drink")).toBe(true);
    expect(haystackMatchesCategory("Guinness 0.0", "alcohol-free")).toBe(true);
  });

  it("parses drink category params defensively", () => {
    expect(parseDrinkCategoryParam("gin")).toBe("gin");
    expect(parseDrinkCategoryParam("GIN")).toBe("gin");
    expect(parseDrinkCategoryParam("SOFT-DRINK")).toBe("soft-drink");
    expect(parseDrinkCategoryParam("alcohol-free")).toBe("alcohol-free");
    expect(parseDrinkCategoryParam("coffee")).toBe("coffee");
    expect(parseDrinkCategoryParam("COFFEE")).toBe("coffee");
    expect(parseDrinkCategoryParam("low-no")).toBeNull();
    expect(parseDrinkCategoryParam("wizard")).toBeNull();
  });
});
