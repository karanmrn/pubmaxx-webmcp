import { describe, it, expect } from "vitest";

import { hasNonAlcoholic, isNonAlcoholicDrink } from "@/lib/nonAlcoholicDrinks";

// Names taken from the real pub dataset (public/data/pint_prices_app_dataset.json)
// plus common 0.0 brands, so this locks the detector to what it must catch — and,
// just as important, what it must NOT (a bare "ERDINGER" is the alcoholic beer).
describe("isNonAlcoholicDrink", () => {
  it("flags real non-alcoholic dataset names", () => {
    for (const name of [
      "LUCKY SAINT",
      "Lucky Saint",
      "PUNK IPA ALCOHOL FREE 0.5%",
      "LOST ALCOHOL FREE 0.5%",
      "Nanny State 0.5%",
    ]) {
      expect(isNonAlcoholicDrink(name), name).toBe(true);
    }
  });

  it("flags common 0.0 / AF brands", () => {
    for (const name of [
      "Guinness 0.0",
      "Heineken 0.0",
      "BECK'S BLUE",
      "Punk AF",
      "Big Drop Pale Ale",
      "Erdinger Alkoholfrei",
    ]) {
      expect(isNonAlcoholicDrink(name), name).toBe(true);
    }
  });

  it("does NOT flag ordinary alcoholic beers (incl. bare Erdinger)", () => {
    for (const name of [
      "ERDINGER",
      "GUINNESS",
      "HEINEKEN",
      "LANDLORD",
      "NECK OIL",
      "CARLING",
      "LONDON PRIDE",
      "CAMDEN HELLS",
      "",
    ]) {
      expect(isNonAlcoholicDrink(name), name).toBe(false);
    }
  });
});

describe("hasNonAlcoholic", () => {
  it("is true when any drink is non-alcoholic", () => {
    expect(hasNonAlcoholic(["CARLING", "LUCKY SAINT", "GUINNESS"])).toBe(true);
  });
  it("is false for an all-alcoholic list and empty input", () => {
    expect(hasNonAlcoholic(["CARLING", "GUINNESS", "ERDINGER"])).toBe(false);
    expect(hasNonAlcoholic([])).toBe(false);
  });
});
