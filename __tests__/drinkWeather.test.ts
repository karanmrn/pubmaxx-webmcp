import { describe, expect, it } from "vitest";

import {
  DRINK_WEATHER_RULES,
  evaluateDrinkWeather,
  type DrinkWeatherInput,
} from "@/lib/drinkWeather";

const base: DrinkWeatherInput = { tempC: 12, precipitationProbabilityPct: 20, month: 7 };

describe("evaluateDrinkWeather rules table", () => {
  it("warm dry summer evening is beer-garden lager or cider", () => {
    const verdict = evaluateDrinkWeather({ tempC: 22, precipitationProbabilityPct: 10, month: 7 });
    expect(verdict).toMatchObject({
      ruleId: "summer-garden",
      venueLens: "beer-garden",
      drinkSuggestion: "a cold lager or cider",
    });
    expect(verdict?.line).toBe("Beer garden weather. Lager or cider.");
  });

  it("warm dry spell outside summer still reads as a garden, distinctly", () => {
    const verdict = evaluateDrinkWeather({ tempC: 20, precipitationProbabilityPct: 15, month: 5 });
    expect(verdict).toMatchObject({ ruleId: "warm-dry", venueLens: "beer-garden" });
    expect(verdict?.line).toBe("Warm and dry. Beer garden weather.");
  });

  it("hard rain sends you to the fireplace with a stout, whatever the temperature", () => {
    const warmButWet = evaluateDrinkWeather({ tempC: 21, precipitationProbabilityPct: 80, month: 7 });
    expect(warmButWet).toMatchObject({ ruleId: "hard-rain", venueLens: "fireplace" });
    expect(warmButWet?.drinkSuggestion).toBe("a stout");
  });

  it("cold night is fireplace stout weather", () => {
    const verdict = evaluateDrinkWeather({ tempC: 4, precipitationProbabilityPct: 20, month: 1 });
    expect(verdict).toMatchObject({ ruleId: "cold", venueLens: "fireplace" });
  });

  it("mild calm evening is a riverside pale ale", () => {
    const verdict = evaluateDrinkWeather({ tempC: 16, precipitationProbabilityPct: 20, month: 6 });
    expect(verdict).toMatchObject({ ruleId: "mild-riverside", venueLens: "riverside" });
    expect(verdict?.drinkSuggestion).toBe("a pale ale");
  });

  it("crisp autumn 8-14C is amber ale weather (any lens)", () => {
    const verdict = evaluateDrinkWeather({ tempC: 11, precipitationProbabilityPct: 20, month: 10 });
    expect(verdict).toMatchObject({ ruleId: "crisp-autumn", venueLens: "any" });
    expect(verdict?.drinkSuggestion).toBe("an amber ale");
  });

  it("cool spring 8-14C is bitter weather", () => {
    const verdict = evaluateDrinkWeather({ tempC: 11, precipitationProbabilityPct: 20, month: 4 });
    expect(verdict).toMatchObject({ ruleId: "cool-spring", venueLens: "any" });
    expect(verdict?.drinkSuggestion).toBe("a best bitter");
  });

  it("cool settled evening outside a named season falls through to the default bitter", () => {
    // A cool August night: not garden-warm, not cold, and August owns no
    // seasonal band, so it lands on the neutral default.
    const verdict = evaluateDrinkWeather({ tempC: 10, precipitationProbabilityPct: 20, month: 8 });
    expect(verdict).toMatchObject({ ruleId: "cool-default", venueLens: "any" });
  });

  it("clear January evening at 2C is cold fireplace stout weather", () => {
    const verdict = evaluateDrinkWeather({ tempC: 2, precipitationProbabilityPct: 10, month: 1 });
    expect(verdict).toMatchObject({ ruleId: "cold", venueLens: "fireplace" });
    expect(verdict?.drinkSuggestion).toBe("a stout or a dark ale");
  });

  it("cold January rain is fireplace stout (cold rule, below the hard-rain cutoff)", () => {
    // 4C, 55% rain: below hard-rain's 60, but tempC < 8 sends you indoors anyway.
    const verdict = evaluateDrinkWeather({ tempC: 4, precipitationProbabilityPct: 55, month: 1 });
    expect(verdict).toMatchObject({ ruleId: "cold", venueLens: "fireplace" });
  });

  it("cool December evening (8-18C) is winter porter weather, indoor-leaning", () => {
    const verdict = evaluateDrinkWeather({ tempC: 10, precipitationProbabilityPct: 20, month: 12 });
    expect(verdict).toMatchObject({ ruleId: "winter-porter", venueLens: "fireplace" });
    expect(verdict?.drinkSuggestion).toBe("a porter");
    expect(verdict?.line).toBe("Winter evening, dark early. Porter weather.");
  });

  it("damp winter evening still earns a verdict, not the old null (50-59% rain)", () => {
    // Was a table gap: 10C, 55% in January previously returned null. Winter now
    // claims it (no precip guard) rather than showing an empty strip.
    const verdict = evaluateDrinkWeather({ tempC: 10, precipitationProbabilityPct: 55, month: 1 });
    expect(verdict?.ruleId).toBe("winter-porter");
  });

  it("mild dry January evening reads as winter porter, not a January riverside", () => {
    // 16C dry in January would trip mild-riverside on temperature alone; winter
    // preempts it so the dark-by-teatime months never suggest a towpath pint.
    const verdict = evaluateDrinkWeather({ tempC: 16, precipitationProbabilityPct: 20, month: 1 });
    expect(verdict?.ruleId).toBe("winter-porter");
    expect(verdict?.venueLens).toBe("fireplace");
  });

  it("the same mild dry 16C evening in June is still a riverside pale ale", () => {
    // Seasonal boundary: only the temperature moved seasons, and it flips lens.
    const verdict = evaluateDrinkWeather({ tempC: 16, precipitationProbabilityPct: 20, month: 6 });
    expect(verdict).toMatchObject({ ruleId: "mild-riverside", venueLens: "riverside" });
  });

  it("seasonal boundary: 11C at the Nov/Dec turn moves from autumn amber to winter porter", () => {
    const november = evaluateDrinkWeather({ tempC: 11, precipitationProbabilityPct: 20, month: 11 });
    const december = evaluateDrinkWeather({ tempC: 11, precipitationProbabilityPct: 20, month: 12 });
    expect(november?.ruleId).toBe("crisp-autumn");
    expect(december?.ruleId).toBe("winter-porter");
  });

  it("seasonal boundary: 11C at the Feb/Mar turn moves from winter porter to spring bitter", () => {
    const february = evaluateDrinkWeather({ tempC: 11, precipitationProbabilityPct: 20, month: 2 });
    const march = evaluateDrinkWeather({ tempC: 11, precipitationProbabilityPct: 20, month: 3 });
    expect(february?.ruleId).toBe("winter-porter");
    expect(march?.ruleId).toBe("cool-spring");
  });

  it("hot dry July heatwave stays a beer-garden verdict", () => {
    const verdict = evaluateDrinkWeather({ tempC: 28, precipitationProbabilityPct: 5, month: 7 });
    expect(verdict).toMatchObject({ ruleId: "summer-garden", venueLens: "beer-garden" });
  });

  it("11C October drizzle is crisp autumn amber (no precip guard on the season)", () => {
    const verdict = evaluateDrinkWeather({ tempC: 11, precipitationProbabilityPct: 45, month: 10 });
    expect(verdict).toMatchObject({ ruleId: "crisp-autumn", venueLens: "any" });
  });

  it("returns null for an in-between evening no rule claims (mild but drizzly, 40-49%)", () => {
    // 15C, 45% rain: too wet for riverside (needs <40), not garden warm, not cold.
    expect(evaluateDrinkWeather({ tempC: 15, precipitationProbabilityPct: 45, month: 6 })).toBeNull();
  });

  it("winter hard rain still beats the winter porter row at 60%+", () => {
    // Winter does not swallow the extreme: a 60%+ downpour is hard-rain stout,
    // listed first, whatever the month.
    const verdict = evaluateDrinkWeather({ tempC: 10, precipitationProbabilityPct: 70, month: 1 });
    expect(verdict?.ruleId).toBe("hard-rain");
  });

  it("hard-rain precedence beats the cold rule at the boundary", () => {
    // 5C AND 65% rain: both cold and hard-rain qualify; hard-rain is listed first.
    const verdict = evaluateDrinkWeather({ tempC: 5, precipitationProbabilityPct: 65, month: 1 });
    expect(verdict?.ruleId).toBe("hard-rain");
  });

  it("guards malformed inputs to null rather than a bad suggestion", () => {
    expect(evaluateDrinkWeather({ ...base, tempC: Number.NaN })).toBeNull();
    expect(evaluateDrinkWeather({ ...base, precipitationProbabilityPct: Number.POSITIVE_INFINITY })).toBeNull();
    expect(evaluateDrinkWeather({ ...base, month: 0 })).toBeNull();
    expect(evaluateDrinkWeather({ ...base, month: 13 })).toBeNull();
    expect(evaluateDrinkWeather({ ...base, month: 7.5 })).toBeNull();
  });
});

describe("DRINK_WEATHER_RULES copy discipline", () => {
  it("has 6-10 deterministic rules with unique ids", () => {
    expect(DRINK_WEATHER_RULES.length).toBeGreaterThanOrEqual(6);
    expect(DRINK_WEATHER_RULES.length).toBeLessThanOrEqual(10);
    const ids = DRINK_WEATHER_RULES.map((rule) => rule.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses no em dashes and honest, non-empty copy in every rule", () => {
    for (const rule of DRINK_WEATHER_RULES) {
      expect(rule.line).not.toContain("—");
      expect(rule.drinkSuggestion).not.toContain("—");
      expect(rule.line.trim().length).toBeGreaterThan(0);
      expect(rule.drinkSuggestion.trim().length).toBeGreaterThan(0);
    }
  });

  it("only claims lenses backed by data or the neutral 'any'", () => {
    const lenses = new Set(DRINK_WEATHER_RULES.map((rule) => rule.venueLens));
    for (const lens of lenses) {
      expect(["beer-garden", "fireplace", "riverside", "any"]).toContain(lens);
    }
  });
});
