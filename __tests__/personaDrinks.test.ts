import { describe, expect, it } from "vitest";

import personaData from "@/data/persona_drinks.json";
import { DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";
import { DRINK_WEATHER_RULES } from "@/lib/drinkWeather";
import {
  buildPersonaPickerSections,
  comparePersonasForPicker,
  drinkCategoryForSuggestion,
  drinkCategoryForVerdict,
  findPersonaById,
  loadPersonaDrinks,
  personaDrinkCategories,
  personaFitsCategory,
  personaHighlightsPubs,
  personaMatchesQuery,
  personasForCategory,
  validatePersonaDrink,
  type PersonaDrink,
} from "@/lib/personaDrinks";

// Em (U+2014) and en (U+2013) dash. The guardrail is "no em dashes anywhere".
const BANNED_DASH = /[—–]/;

const STRING_FIELDS: (keyof PersonaDrink)[] = [
  "name",
  "knownFor",
  "drink",
  "why",
  "sourceName",
  "howToOrder",
];

describe("persona dataset schema", () => {
  const personas = loadPersonaDrinks();

  it("loads and validates every shipped entry", () => {
    expect(personas.length).toBe((personaData as unknown[]).length);
    expect(personas.length).toBeGreaterThan(50);
    for (const raw of personaData as unknown[]) {
      expect(() => validatePersonaDrink(raw)).not.toThrow();
    }
  });

  it("carries no low-confidence entries (they are dropped at build)", () => {
    expect(personas.every((p) => p.confidence !== "low")).toBe(true);
  });

  it("has unique ids", () => {
    const ids = personas.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the confidence field", () => {
    for (const persona of personas) {
      expect(["high", "medium"]).toContain(persona.confidence);
    }
  });

  it("carries a fictional citation on every fictional entry", () => {
    for (const persona of personas.filter((p) => p.kind === "fictional")) {
      expect(persona.sourceName.trim().length).toBeGreaterThan(0);
      expect(persona.sourceUrl).toMatch(/^https?:\/\//);
    }
  });

  it("rejects a bad drinkCategory", () => {
    expect(() =>
      validatePersonaDrink({
        ...personas[0],
        drinkCategory: "tequila",
      }),
    ).toThrow();
  });
});

describe("category join to lib/drinks", () => {
  const personas = loadPersonaDrinks();

  it("maps every entry's drinkCategory into the closed DrinkCategory set", () => {
    for (const persona of personas) {
      expect(DRINK_CATEGORIES).toContain(persona.drinkCategory);
    }
  });

  it("only reports categories that exist in the taxonomy", () => {
    for (const category of personaDrinkCategories(personas)) {
      expect(DRINK_CATEGORIES).toContain(category);
    }
  });

  it("personasForCategory returns only that category", () => {
    for (const category of personaDrinkCategories(personas)) {
      const list = personasForCategory(category, personas);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((p) => p.drinkCategory === category)).toBe(true);
    }
  });
});

describe("no em/en dash sweep of the dataset", () => {
  const personas = loadPersonaDrinks();

  it("has no banned dash in any string field", () => {
    for (const persona of personas) {
      for (const field of STRING_FIELDS) {
        expect(BANNED_DASH.test(String(persona[field]))).toBe(false);
      }
      for (const ingredient of persona.ingredients) {
        expect(BANNED_DASH.test(ingredient)).toBe(false);
      }
    }
  });

  it("validator throws when a dash is present", () => {
    const [first] = personas;
    expect(() =>
      validatePersonaDrink({ ...first, why: "a great drink — reportedly" }),
    ).toThrow(/dash/);
  });
});

describe("conditions cross-link", () => {
  it("maps every weather rule to a real DrinkCategory (no duplicated rules)", () => {
    for (const rule of DRINK_WEATHER_RULES) {
      const viaVerdict = drinkCategoryForVerdict({
        ruleId: rule.ruleId,
        venueLens: rule.venueLens,
        drinkSuggestion: rule.drinkSuggestion,
        line: rule.line,
      });
      const viaSuggestion = drinkCategoryForSuggestion(rule.drinkSuggestion);
      expect(viaVerdict).not.toBeNull();
      expect(DRINK_CATEGORIES).toContain(viaVerdict as DrinkCategory);
      // The two client/server bridges agree for the same rule.
      expect(viaSuggestion).toBe(viaVerdict);
    }
  });

  it("returns null for no verdict / unknown inputs", () => {
    expect(drinkCategoryForVerdict(null)).toBeNull();
    expect(drinkCategoryForSuggestion(undefined)).toBeNull();
    expect(drinkCategoryForSuggestion("a drink we never suggest")).toBeNull();
  });

  it("personaFitsCategory only matches the tonight category", () => {
    const beerPersona = loadPersonaDrinks().find((p) => p.drinkCategory === "beer");
    const winePersona = loadPersonaDrinks().find((p) => p.drinkCategory === "wine");
    expect(beerPersona && personaFitsCategory(beerPersona, "beer")).toBe(true);
    expect(winePersona && personaFitsCategory(winePersona, "beer")).toBe(false);
    expect(beerPersona && personaFitsCategory(beerPersona, null)).toBe(false);
  });
});

describe("picker sort logic", () => {
  function persona(overrides: Partial<PersonaDrink>): PersonaDrink {
    return {
      id: "x",
      name: "Zed",
      kind: "person",
      knownFor: "Test",
      drink: "Test drink",
      drinkCategory: "wine",
      why: "Because.",
      sourceUrl: "https://example.com",
      sourceName: "Example",
      observedAt: "2026-01-01",
      ingredients: [],
      howToOrder: "A test drink.",
      confidence: "high",
      ...overrides,
    };
  }

  it("orders fits-tonight first, then by name", () => {
    const list: PersonaDrink[] = [
      persona({ id: "a", name: "Anna", drinkCategory: "wine" }),
      persona({ id: "b", name: "Bella", drinkCategory: "beer" }),
      persona({ id: "c", name: "Cara", drinkCategory: "beer" }),
    ];
    const sorted = [...list].sort((a, b) =>
      comparePersonasForPicker(a, b, "beer"),
    );
    // Both beer entries (fit tonight) come first, alphabetised within the tier.
    expect(sorted.map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("falls back to name order with no tonight category", () => {
    const list: PersonaDrink[] = [
      persona({ id: "c", name: "Cara" }),
      persona({ id: "a", name: "Anna" }),
    ];
    const sorted = [...list].sort((a, b) =>
      comparePersonasForPicker(a, b, null),
    );
    expect(sorted.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("groups person before fictional and filters by query", () => {
    const sections = buildPersonaPickerSections({
      personas: [
        persona({ id: "p1", name: "Real One", kind: "person" }),
        persona({ id: "f1", name: "Fictional One", kind: "fictional" }),
        persona({ id: "p2", name: "Elsewhere", kind: "person" }),
      ],
      query: "one",
    });
    expect(sections.map((s) => s.kind)).toEqual(["person", "fictional"]);
    // "Elsewhere" is filtered out by the "one" query.
    const ids = sections.flatMap((s) => s.personas.map((p) => p.id));
    expect(ids).toContain("p1");
    expect(ids).toContain("f1");
    expect(ids).not.toContain("p2");
  });

  it("matches queries across name, knownFor and drink", () => {
    const p = persona({ name: "Snoop", knownFor: "rapper", drink: "Gin and juice" });
    expect(personaMatchesQuery(p, "snoop")).toBe(true);
    expect(personaMatchesQuery(p, "rapper")).toBe(true);
    expect(personaMatchesQuery(p, "juice")).toBe(true);
    expect(personaMatchesQuery(p, "whisky")).toBe(false);
    expect(personaMatchesQuery(p, "")).toBe(true);
  });

  it("real dataset sections surface fits-tonight personas at the top", () => {
    const sections = buildPersonaPickerSections({ tonightCategory: "beer" });
    const personSection = sections.find((s) => s.kind === "person");
    expect(personSection).toBeDefined();
    const first = personSection!.personas[0];
    // With a beer verdict, the first person in the group drinks beer.
    expect(first.drinkCategory).toBe("beer");
  });
});

describe("non-alcoholic personas are first-class (no lens dead-end)", () => {
  const personas = loadPersonaDrinks();

  it("includes non-alcoholic orders mapped to the 'other' bucket", () => {
    const nonAlc = personasForCategory("other", personas);
    expect(nonAlc.length).toBeGreaterThan(0);
    for (const id of ["cristiano-ronaldo", "warren-buffett", "ron-burgundy"]) {
      const found = nonAlc.find((p) => p.id === id);
      expect(found, `${id} should be an 'other' persona`).toBeDefined();
    }
  });

  it("Ron Burgundy is a canon-cited fictional milk order", () => {
    const ron = findPersonaById("ron-burgundy", personas);
    expect(ron).not.toBeNull();
    expect(ron!.kind).toBe("fictional");
    expect(ron!.drinkCategory).toBe("other");
    expect(ron!.sourceName).toMatch(/Anchorman/);
    expect(ron!.sourceUrl).toMatch(/^https?:\/\//);
  });

  it("marks non-alcoholic personas as NOT pub-highlighting, others as highlighting", () => {
    for (const persona of personas) {
      expect(personaHighlightsPubs(persona)).toBe(persona.drinkCategory !== "other");
    }
  });

  it("surfaces non-alcoholic personas in the searchable picker", () => {
    const sections = buildPersonaPickerSections({ personas, query: "milk" });
    const ids = sections.flatMap((s) => s.personas.map((p) => p.id));
    expect(ids).toContain("ron-burgundy");
  });
});

describe("coffee personas lens as coffee", () => {
  const personas = loadPersonaDrinks();
  const coffeeIds = [
    "lorelai-gilmore",
    "emma-chamberlain",
    "howard-schultz",
    "jeff-bezos",
    "bob-iger",
  ] as const;

  it("maps coffee orders to the coffee category, never other", () => {
    const coffee = personasForCategory("coffee", personas);
    const other = personasForCategory("other", personas);
    for (const id of coffeeIds) {
      const found = coffee.find((p) => p.id === id);
      expect(found, `${id} should be a coffee persona`).toBeDefined();
      expect(found!.drinkCategory).toBe("coffee");
      expect(
        other.find((p) => p.id === id),
        `${id} must not remain in other`,
      ).toBeUndefined();
    }
  });

  it("lets a coffee persona highlight pubs under the coffee lens", () => {
    for (const id of coffeeIds) {
      const persona = findPersonaById(id, personas);
      expect(persona).not.toBeNull();
      expect(personaHighlightsPubs(persona!)).toBe(true);
      expect(personaFitsCategory(persona!, "coffee")).toBe(true);
      expect(personaFitsCategory(persona!, "other")).toBe(false);
    }
  });
});

describe("findPersonaById", () => {
  it("resolves a known id and returns null for an unknown one", () => {
    const [first] = loadPersonaDrinks();
    expect(findPersonaById(first.id)?.id).toBe(first.id);
    expect(findPersonaById("no-such-persona")).toBeNull();
  });
});
