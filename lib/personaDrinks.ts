// Persona drinks ("Drink like...") — the data layer behind the pub-tied lens.
//
// Famous people's and fictional characters' REPORTED / canon drink orders, each
// mapped to the app's closed drink-category taxonomy (lib/drinks.ts) so the lens
// can ride the existing drinkCategory filter path rather than fork a new one.
//
// Guardrails baked in here, not left to the UI (PRD Part 2, non-negotiable):
//   - copy framing is always "reported favourite" / "as ordered in [work]";
//   - no images or likenesses ever (this module carries text + a source only);
//   - a fixed disclaimer string ships with every surface;
//   - no em dashes anywhere (the dataset is sanitised at build time, and the
//     validator FAILS LOUD if one ever slips through into the loaded data).
//
// PURE + browser-safe: no server imports, no node builtins. The JSON is inlined
// by the bundler at build time (webpack), same pattern as lib/dataFreshness.ts.
// Every exported helper is deterministic so the whole surface is unit-testable.

import personaData from "@/data/persona_drinks.json";
import {
  DRINK_CATEGORIES,
  isDrinkCategory,
  MAP_LENS_DRINK_CATEGORIES,
  type DrinkCategory,
} from "@/lib/drinks";

// ── Types ────────────────────────────────────────────────────────────────────
export type PersonaKind = "person" | "fictional";
export type PersonaConfidence = "high" | "medium" | "low";

// A single persona-drink fact. `drinkCategory` is already the closed
// DrinkCategory id (the crawl mapped its raw categories to our set); the loader
// re-asserts that so a bad row can never reach the UI.
export type PersonaDrink = {
  id: string;
  name: string;
  kind: PersonaKind;
  // Short "known for" line, e.g. "US rapper" or "Motorhead frontman".
  knownFor: string;
  // Human drink name as ordered, e.g. "Gin and juice", "Vesper martini".
  drink: string;
  drinkCategory: DrinkCategory;
  // One sourced sentence (real people) or a canon citation (fictional).
  why: string;
  sourceUrl: string;
  // Publication (real) or the work it is canon in (fictional).
  sourceName: string;
  // ISO date the preference was observed / the source is dated.
  observedAt: string;
  // Mixed-drink ingredients; empty for a plain pint/spirit order.
  ingredients: string[];
  // One line for the bar, e.g. "A dry martini, shaken, not stirred.".
  howToOrder: string;
  confidence: PersonaConfidence;
};

// The one disclaimer that must appear on every persona surface (PRD guardrail).
export const PERSONA_DISCLAIMER =
  "Reported favourites and fictional orders. No endorsement implied.";

const PERSONA_KINDS: readonly PersonaKind[] = ["person", "fictional"];
const PERSONA_CONFIDENCES: readonly PersonaConfidence[] = [
  "high",
  "medium",
  "low",
];

// Em (U+2014) and en (U+2013) dash. Banned everywhere in persona copy; the
// validator treats any occurrence as a hard failure so the guardrail is
// enforced by the type boundary, not just by the build script.
const BANNED_DASH = /[—–]/;

// ── Validator ────────────────────────────────────────────────────────────────
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertNoDash(id: string, field: string, value: string): void {
  if (BANNED_DASH.test(value)) {
    throw new Error(
      `personaDrinks: entry ${id}: em/en dash in "${field}" (banned copy)`,
    );
  }
}

/**
 * Validate one raw record into a typed PersonaDrink, or throw. This is the
 * single schema authority: the build script mirrors it, and the loader runs it
 * over the shipped dataset so an invalid row is a loud failure, never a silent
 * bad card. Guards the closed drink-category join and the no-dash guardrail.
 */
export function validatePersonaDrink(raw: unknown): PersonaDrink {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("personaDrinks: entry is not an object");
  }
  const row = raw as Record<string, unknown>;
  const id = row.id;
  if (!isNonEmptyString(id)) throw new Error("personaDrinks: missing id");

  for (const field of ["name", "knownFor", "drink", "why", "howToOrder"]) {
    if (!isNonEmptyString(row[field])) {
      throw new Error(`personaDrinks: entry ${id}: missing/empty "${field}"`);
    }
    assertNoDash(id, field, row[field] as string);
  }

  if (!PERSONA_KINDS.includes(row.kind as PersonaKind)) {
    throw new Error(`personaDrinks: entry ${id}: bad kind "${String(row.kind)}"`);
  }
  // The category JOIN to lib/drinks.ts: enforce the closed DrinkCategory set.
  if (!isDrinkCategory(row.drinkCategory)) {
    throw new Error(
      `personaDrinks: entry ${id}: drinkCategory "${String(
        row.drinkCategory,
      )}" is not a DrinkCategory`,
    );
  }
  if (!PERSONA_CONFIDENCES.includes(row.confidence as PersonaConfidence)) {
    throw new Error(
      `personaDrinks: entry ${id}: bad confidence "${String(row.confidence)}"`,
    );
  }
  if (!isNonEmptyString(row.sourceUrl) || !/^https?:\/\//.test(row.sourceUrl)) {
    throw new Error(
      `personaDrinks: entry ${id}: sourceUrl must be an absolute http(s) URL`,
    );
  }
  if (!isNonEmptyString(row.sourceName)) {
    throw new Error(`personaDrinks: entry ${id}: missing sourceName`);
  }
  assertNoDash(id, "sourceName", row.sourceName as string);
  if (!isNonEmptyString(row.observedAt) || !/^\d{4}-\d{2}-\d{2}/.test(row.observedAt)) {
    throw new Error(`personaDrinks: entry ${id}: observedAt must be an ISO date`);
  }
  if (!Array.isArray(row.ingredients)) {
    throw new Error(`personaDrinks: entry ${id}: ingredients must be an array`);
  }
  const ingredients = row.ingredients.map((ing, index) => {
    if (!isNonEmptyString(ing)) {
      throw new Error(`personaDrinks: entry ${id}: empty ingredient at ${index}`);
    }
    assertNoDash(id, `ingredients[${index}]`, ing);
    return ing;
  });

  return {
    id,
    name: row.name as string,
    kind: row.kind as PersonaKind,
    knownFor: row.knownFor as string,
    drink: row.drink as string,
    drinkCategory: row.drinkCategory,
    why: row.why as string,
    sourceUrl: row.sourceUrl,
    sourceName: row.sourceName as string,
    observedAt: row.observedAt as string,
    ingredients,
    howToOrder: row.howToOrder as string,
    confidence: row.confidence as PersonaConfidence,
  };
}

// ── Loader ───────────────────────────────────────────────────────────────────
// Validate the shipped dataset once, at module load, and memoise. A duplicate
// id or a bad row is a build/boot break, never a silently dropped persona.
let cached: PersonaDrink[] | null = null;

export function loadPersonaDrinks(): PersonaDrink[] {
  if (cached) return cached;
  const seen = new Set<string>();
  const list = (personaData as unknown[]).map((raw) => {
    const persona = validatePersonaDrink(raw);
    if (seen.has(persona.id)) {
      throw new Error(`personaDrinks: duplicate id "${persona.id}"`);
    }
    seen.add(persona.id);
    return persona;
  });
  cached = list;
  return list;
}

// ── Category join ────────────────────────────────────────────────────────────
/** Every DrinkCategory a persona in the dataset actually uses (sorted, unique). */
export function personaDrinkCategories(
  personas: PersonaDrink[] = loadPersonaDrinks(),
): DrinkCategory[] {
  const present = new Set(personas.map((p) => p.drinkCategory));
  return DRINK_CATEGORIES.filter((c) => present.has(c));
}

// Categories the pub drink-category filter can meaningfully match against -
// the map's own lens list, so a persona can never set a filter the picker
// cannot show or clear. "other" is the uncovered-order bucket with no clean
// per-pub menu signal, so a persona in it must NOT push the map to an empty
// filtered state. Such a persona still shows its card, just without pub
// highlighting. Every named category, including soft drinks and alcohol-free
// drinks, rides the filter.
const PUB_MATCHABLE_CATEGORIES: ReadonlySet<DrinkCategory> = new Set(
  MAP_LENS_DRINK_CATEGORIES,
);

/**
 * True when selecting this persona should drive the map's drink-category
 * highlight. False for uncovered "other" orders: the card still renders, but
 * the map stays unfiltered.
 */
export function personaHighlightsPubs(persona: PersonaDrink): boolean {
  return PUB_MATCHABLE_CATEGORIES.has(persona.drinkCategory);
}

/** Personas whose order maps to a given drink category (the lens filter seam). */
export function personasForCategory(
  category: DrinkCategory,
  personas: PersonaDrink[] = loadPersonaDrinks(),
): PersonaDrink[] {
  return personas.filter((p) => p.drinkCategory === category);
}

// Re-export tonight bridge helpers from the leaf module (no persona JSON).
export { drinkCategoryForSuggestion, drinkCategoryForVerdict } from "@/lib/personaTonightCategories";

/** True when a persona's order matches the category that fits tonight. */
export function personaFitsCategory(
  persona: PersonaDrink,
  tonightCategory: DrinkCategory | null | undefined,
): boolean {
  return Boolean(tonightCategory) && persona.drinkCategory === tonightCategory;
}

// ── Picker model ─────────────────────────────────────────────────────────────
export type PersonaPickerSection = {
  kind: PersonaKind;
  label: string;
  personas: PersonaDrink[];
};

const KIND_LABEL: Record<PersonaKind, string> = {
  person: "People",
  fictional: "Fictional",
};

// A person/fictional group's display order in the picker (people first).
const KIND_ORDER: Record<PersonaKind, number> = { person: 0, fictional: 1 };

/** Case-insensitive substring match over the fields a searcher would type. */
export function personaMatchesQuery(persona: PersonaDrink, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    persona.name.toLowerCase().includes(q) ||
    persona.knownFor.toLowerCase().includes(q) ||
    persona.drink.toLowerCase().includes(q)
  );
}

/**
 * Ordering rule for the picker, within a kind group:
 *   1. personas that FIT TONIGHT first (the quiet "fits tonight" tag), then
 *   2. by name (locale, stable).
 * Pure comparator so the sort is unit-testable in isolation.
 */
export function comparePersonasForPicker(
  a: PersonaDrink,
  b: PersonaDrink,
  tonightCategory: DrinkCategory | null | undefined,
): number {
  const aFits = personaFitsCategory(a, tonightCategory) ? 0 : 1;
  const bFits = personaFitsCategory(b, tonightCategory) ? 0 : 1;
  if (aFits !== bFits) return aFits - bFits;
  return a.name.localeCompare(b.name);
}

/**
 * Build the searchable, grouped picker model: person/fictional sections (people
 * first), each filtered by `query` and ordered fits-tonight-first then by name.
 * Empty sections are omitted. Drives the "Drink like..." control directly.
 */
export function buildPersonaPickerSections(
  options: {
    personas?: PersonaDrink[];
    query?: string;
    tonightCategory?: DrinkCategory | null;
  } = {},
): PersonaPickerSection[] {
  const {
    personas = loadPersonaDrinks(),
    query = "",
    tonightCategory = null,
  } = options;

  const byKind = new Map<PersonaKind, PersonaDrink[]>();
  for (const persona of personas) {
    if (!personaMatchesQuery(persona, query)) continue;
    const list = byKind.get(persona.kind) ?? [];
    list.push(persona);
    byKind.set(persona.kind, list);
  }

  return Array.from(byKind.entries())
    .map(([kind, list]) => ({
      kind,
      label: KIND_LABEL[kind],
      personas: [...list].sort((a, b) =>
        comparePersonasForPicker(a, b, tonightCategory),
      ),
    }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/** Look up a single persona by id (for restoring a selected lens from a param). */
export function findPersonaById(
  id: string,
  personas: PersonaDrink[] = loadPersonaDrinks(),
): PersonaDrink | null {
  return personas.find((p) => p.id === id) ?? null;
}
