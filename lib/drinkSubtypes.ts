// Second-level drink taxonomy — the "any drink, not just the family" layer.
// ---------------------------------------------------------------------------
// lib/drinks.ts owns the CLOSED twelve-category union (beer/wine/whisky/gin/
// vodka/rum/cocktail/shot/alcohol-free/soft-drink/coffee/other). That union is
// load-bearing: the DB CHECK
// constraint, persona validation (lib/personaDrinks.ts) and the pin-glyph lens
// must change with it. Subtypes live HERE, in a second level that REFINES a
// category instead of widening it:
//
//     rum        → white / dark / spiced / aged / overproof
//     whisky     → scotch / single malt / bourbon / irish / japanese / rye
//     beer       → lager / pilsner / pale ale / IPA / bitter / stout / …
//
// Two invariants keep the old paths untouched:
//   1. A subtype NEVER replaces its category. Picking "dark rum" sets
//      drinkCategory:"rum" AND drinkSubtype:"rum-dark", so every existing
//      consumer (glyph lens, persona lens, ?drink= deep-links, personaDrinks
//      validation) keeps seeing exactly the category it saw before.
//   2. Exactly ONE level. A subtype has no children — the taxonomy is a
//      two-deep tree by construction, not by convention.
//
// Alongside subtypes sits the orthogonal TOP-SHELF flag: "the expensive kind
// of booze". It is a boolean lens, not a subtype, because it cuts ACROSS
// categories (a top-shelf rum and a top-shelf whisky are both top shelf).
//
// Pure + browser-safe: no server imports, no node builtins. Fully unit-tested.

import { DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";
import {
  findBrand,
  haystackMatchesBrand,
  normalizeDrinkHaystack,
} from "@/lib/drinkBrands";

export type DrinkSubtypeId = `${DrinkCategory}-${string}`;

export type DrinkSubtype = {
  /** Globally unique, URL-safe id. Always `${category}-${slug}`. */
  readonly id: DrinkSubtypeId;
  readonly category: DrinkCategory;
  /** Short human label shown on a refinement chip ("Dark", "Japanese"). */
  readonly label: string;
  /** Spoken-out label for a11y / deep-link titles ("Dark rum"). */
  readonly longLabel: string;
  /**
   * Match needles against normalised free text. Single tokens match on word
   * boundaries, multi-word tokens as substrings — same rule as the brand and
   * category matchers, so behaviour is consistent across all three levels.
   */
  readonly tokens: readonly string[];
};

// The curated table. Deliberately shallow and finite: a starter vocabulary a
// London bar menu actually uses, not an exhaustive spirits encyclopedia. Order
// within a category drives chip order; order ACROSS the table drives the
// first-hit-wins classifier, so the more specific subtype is listed first
// (e.g. beer "pale ale" before "ale", whisky "single malt" before "scotch").
const SUBTYPE_TABLE: DrinkSubtype[] = [
  // ── beer ──────────────────────────────────────────────────────────────────
  {
    id: "beer-ipa",
    category: "beer",
    label: "IPA",
    longLabel: "IPA",
    tokens: ["ipa", "india pale ale", "sipa", "neipa", "hazy"],
  },
  {
    id: "beer-pale-ale",
    category: "beer",
    label: "Pale ale",
    longLabel: "Pale ale",
    tokens: ["pale ale", "session ale", "apa"],
  },
  {
    id: "beer-stout",
    category: "beer",
    label: "Stout",
    longLabel: "Stout",
    tokens: ["stout", "porter", "milk stout", "dry stout"],
  },
  {
    id: "beer-pilsner",
    category: "beer",
    label: "Pilsner",
    longLabel: "Pilsner",
    tokens: ["pilsner", "pilsener", "pils", "urquell"],
  },
  {
    id: "beer-lager",
    category: "beer",
    label: "Lager",
    longLabel: "Lager",
    tokens: ["lager", "helles", "hells", "munchner hell", "premium lager"],
  },
  {
    id: "beer-bitter",
    category: "beer",
    label: "Bitter",
    longLabel: "Bitter",
    tokens: ["bitter", "best bitter", "esb"],
  },
  {
    id: "beer-ale",
    category: "beer",
    label: "Ale",
    longLabel: "Ale",
    tokens: ["ale", "cask ale", "real ale", "red ale", "amber ale"],
  },
  {
    id: "beer-wheat",
    category: "beer",
    label: "Wheat",
    longLabel: "Wheat beer",
    tokens: ["wheat", "weissbier", "weisse", "hefeweizen", "witbier", "blanche"],
  },
  {
    id: "beer-cider",
    category: "beer",
    label: "Cider",
    longLabel: "Cider",
    tokens: ["cider", "cyder", "perry"],
  },

  // ── wine ──────────────────────────────────────────────────────────────────
  {
    id: "wine-sparkling",
    category: "wine",
    label: "Sparkling",
    longLabel: "Sparkling wine",
    tokens: ["sparkling", "prosecco", "champagne", "cava", "cremant", "fizz"],
  },
  {
    id: "wine-rose",
    category: "wine",
    label: "Rosé",
    longLabel: "Rosé wine",
    tokens: ["rose", "rosé", "blush"],
  },
  {
    id: "wine-white",
    category: "wine",
    label: "White",
    longLabel: "White wine",
    tokens: [
      "white",
      "white wine",
      "sauvignon",
      "chardonnay",
      "pinot grigio",
      "riesling",
      "albarino",
      "chenin",
    ],
  },
  {
    id: "wine-red",
    category: "wine",
    label: "Red",
    longLabel: "Red wine",
    tokens: [
      "red",
      "red wine",
      "malbec",
      "merlot",
      "rioja",
      "shiraz",
      "syrah",
      "cabernet",
      "pinot noir",
      "tempranillo",
    ],
  },
  {
    id: "wine-fortified",
    category: "wine",
    label: "Fortified",
    longLabel: "Fortified wine",
    tokens: ["port", "sherry", "madeira", "marsala", "vermouth", "fortified"],
  },

  // ── whisky ────────────────────────────────────────────────────────────────
  {
    id: "whisky-single-malt",
    category: "whisky",
    label: "Single malt",
    longLabel: "Single malt whisky",
    tokens: ["single malt", "islay", "speyside", "highland", "cask strength"],
  },
  {
    id: "whisky-bourbon",
    category: "whisky",
    label: "Bourbon",
    longLabel: "Bourbon",
    tokens: ["bourbon", "tennessee whiskey", "sour mash"],
  },
  {
    id: "whisky-irish",
    category: "whisky",
    label: "Irish",
    longLabel: "Irish whiskey",
    tokens: ["irish whiskey", "irish whisky", "pot still"],
  },
  {
    id: "whisky-japanese",
    category: "whisky",
    label: "Japanese",
    longLabel: "Japanese whisky",
    tokens: ["japanese whisky", "japanese whiskey", "hibiki", "nikka", "yamazaki", "toki"],
  },
  {
    id: "whisky-rye",
    category: "whisky",
    label: "Rye",
    longLabel: "Rye whiskey",
    tokens: ["rye"],
  },
  {
    id: "whisky-scotch",
    category: "whisky",
    label: "Scotch",
    longLabel: "Scotch whisky",
    tokens: ["scotch", "blended scotch", "blended whisky"],
  },

  // ── gin ───────────────────────────────────────────────────────────────────
  {
    id: "gin-london-dry",
    category: "gin",
    label: "London dry",
    longLabel: "London dry gin",
    tokens: ["london dry", "dry gin"],
  },
  {
    id: "gin-old-tom",
    category: "gin",
    label: "Old Tom",
    longLabel: "Old Tom gin",
    tokens: ["old tom"],
  },
  {
    id: "gin-navy-strength",
    category: "gin",
    label: "Navy strength",
    longLabel: "Navy strength gin",
    tokens: ["navy strength", "overproof gin"],
  },
  {
    id: "gin-sloe",
    category: "gin",
    label: "Sloe",
    longLabel: "Sloe gin",
    tokens: ["sloe"],
  },
  {
    id: "gin-flavoured",
    category: "gin",
    label: "Flavoured",
    longLabel: "Flavoured gin",
    tokens: ["pink gin", "flavoured gin", "rhubarb gin", "raspberry gin", "citrus gin"],
  },

  // ── vodka ─────────────────────────────────────────────────────────────────
  {
    id: "vodka-flavoured",
    category: "vodka",
    label: "Flavoured",
    longLabel: "Flavoured vodka",
    tokens: ["flavoured vodka", "flavored vodka", "vanilla vodka", "raspberry vodka", "citron"],
  },
  {
    id: "vodka-potato",
    category: "vodka",
    label: "Potato",
    longLabel: "Potato vodka",
    tokens: ["potato vodka"],
  },
  {
    id: "vodka-grain",
    category: "vodka",
    label: "Grain",
    longLabel: "Grain vodka",
    tokens: ["grain vodka", "wheat vodka", "rye vodka"],
  },

  // ── rum ───────────────────────────────────────────────────────────────────
  {
    id: "rum-white",
    category: "rum",
    label: "White",
    longLabel: "White rum",
    tokens: ["white rum", "light rum", "silver rum", "blanco rum"],
  },
  {
    id: "rum-dark",
    category: "rum",
    label: "Dark",
    longLabel: "Dark rum",
    tokens: ["dark rum", "black rum", "navy rum"],
  },
  {
    id: "rum-spiced",
    category: "rum",
    label: "Spiced",
    longLabel: "Spiced rum",
    tokens: ["spiced rum", "spiced"],
  },
  {
    id: "rum-aged",
    category: "rum",
    label: "Aged",
    longLabel: "Aged rum",
    tokens: ["aged rum", "golden rum", "gold rum", "anejo", "añejo", "rhum agricole"],
  },
  {
    id: "rum-overproof",
    category: "rum",
    label: "Overproof",
    longLabel: "Overproof rum",
    tokens: ["overproof", "over proof", "151"],
  },

  // ── cocktail ──────────────────────────────────────────────────────────────
  {
    id: "cocktail-spritz",
    category: "cocktail",
    label: "Spritz",
    longLabel: "Spritz",
    tokens: ["spritz", "aperol", "hugo"],
  },
  {
    id: "cocktail-martini",
    category: "cocktail",
    label: "Martini",
    longLabel: "Martini",
    tokens: ["martini", "espresso martini", "vesper"],
  },
  {
    id: "cocktail-sour",
    category: "cocktail",
    label: "Sour",
    longLabel: "Sour",
    tokens: ["sour", "margarita", "daiquiri", "gimlet"],
  },
  {
    id: "cocktail-highball",
    category: "cocktail",
    label: "Highball",
    longLabel: "Highball",
    tokens: ["highball", "mule", "collins", "spritzer"],
  },
  {
    id: "cocktail-tiki",
    category: "cocktail",
    label: "Tiki",
    longLabel: "Tiki",
    tokens: ["tiki", "mai tai", "pina colada", "piña colada", "zombie", "punch"],
  },
  {
    id: "cocktail-classic",
    category: "cocktail",
    label: "Classic",
    longLabel: "Classic cocktail",
    tokens: ["old fashioned", "negroni", "manhattan", "boulevardier", "classic cocktail"],
  },

  // ── shot ──────────────────────────────────────────────────────────────────
  {
    id: "shot-tequila",
    category: "shot",
    label: "Tequila",
    longLabel: "Tequila",
    tokens: ["tequila", "mezcal"],
  },
  {
    id: "shot-sambuca",
    category: "shot",
    label: "Sambuca",
    longLabel: "Sambuca",
    tokens: ["sambuca"],
  },
  {
    id: "shot-herbal",
    category: "shot",
    label: "Herbal",
    longLabel: "Herbal shot",
    tokens: ["jager", "jäger", "jagermeister", "jägermeister", "jagerbomb", "jägerbomb", "fernet"],
  },
  {
    id: "shot-liqueur",
    category: "shot",
    label: "Liqueur",
    longLabel: "Liqueur shot",
    tokens: ["liqueur", "baileys", "tequila rose", "schnapps", "absinthe"],
  },
];

export const DRINK_SUBTYPES: readonly DrinkSubtype[] = SUBTYPE_TABLE;

const BY_ID: ReadonlyMap<string, DrinkSubtype> = new Map(
  SUBTYPE_TABLE.map((subtype) => [subtype.id, subtype]),
);

const BY_CATEGORY: Record<DrinkCategory, readonly DrinkSubtype[]> = DRINK_CATEGORIES.reduce(
  (acc, category) => {
    acc[category] = SUBTYPE_TABLE.filter((subtype) => subtype.category === category);
    return acc;
  },
  {} as Record<DrinkCategory, readonly DrinkSubtype[]>,
);

/** Subtypes offered for a category, in chip order. Empty for "other". */
export function subtypesForCategory(category: DrinkCategory): readonly DrinkSubtype[] {
  return BY_CATEGORY[category] ?? [];
}

export function findSubtype(id: string | null | undefined): DrinkSubtype | null {
  if (typeof id !== "string") return null;
  return BY_ID.get(id.trim().toLowerCase()) ?? null;
}

/** Guard for URL/query subtype values, optionally pinned to a category. */
export function parseDrinkSubtypeParam(
  value: string | null | undefined,
  category?: DrinkCategory | null,
): DrinkSubtype | null {
  const hit = findSubtype(value);
  if (!hit) return null;
  if (category && hit.category !== category) return null;
  return hit;
}

// ── Top shelf ("the expensive kind of booze") ────────────────────────────────
// Orthogonal to the taxonomy: a cross-category boolean lens. Two signals, both
// conservative — an unknown drink is never promoted to top shelf, matching the
// app-wide "never assert what the data can't back" rule.
//   1. Premium brand ids from the curated lib/drinkBrands catalog.
//   2. Menu language that only appears on a back-bar pour.
export const TOP_SHELF_BRAND_IDS: ReadonlySet<string> = new Set([
  "grey-goose",
  "belvedere",
  "ciroc",
  "ketel-one",
  "sipsmith",
  "hendricks",
  "whitley-neill",
  "lagavulin",
  "talisker",
  "glenlivet",
  "makers-mark",
  "diplomatico",
  "mount-gay",
  "champagne",
]);

// Standalone marketing adjectives ("premium", "vintage", "reserve") are NOT
// signals: ordinary pints wear them too (HENRY WESTON'S VINTAGE CIDER,
// Appleshed Premium Cider). Only category-scoped combinations qualify.
export const TOP_SHELF_TOKENS: readonly string[] = [
  "top shelf",
  "topshelf",
  "single malt",
  "cask strength",
  "small batch",
  "vintage champagne",
  "vintage port",
  "vsop",
  "xo",
  "aged rum",
  "aged whisky",
  "rare",
  "limited edition",
  "back bar",
];

// Age-statement pours ("12 year old", "18 yr") — two digits so a "3 year"
// cider or vinegar-style label never qualifies.
const TOP_SHELF_AGE_STATEMENT = /(^| )\d{2} (years?|yr)( old)?( |$)/;

// ── Matching ─────────────────────────────────────────────────────────────────
// One shared rule for every needle in this module: multi-word needles match as
// substrings; single tokens match on word boundaries, so "rye" never fires
// inside "wryest" and "ipa" never inside "tulipa".
function haystackHasNeedle(hay: string, needle: string): boolean {
  const n = normalizeDrinkHaystack(needle);
  if (!n || !hay) return false;
  if (n.includes(" ")) return hay.includes(n);
  return new RegExp(`(^| )${n}( |$)`).test(hay);
}

/** True when free text names this subtype. Strict: only the curated tokens. */
export function haystackMatchesSubtype(haystack: string, subtype: DrinkSubtype): boolean {
  const hay = normalizeDrinkHaystack(haystack);
  if (!hay) return false;
  return subtype.tokens.some((token) => haystackHasNeedle(hay, token));
}

// Category-relative short forms, derived (never hand-maintained) by stripping
// the family word off a token: under `rum`, "white rum" also answers to bare
// "white". These are ONLY consulted when the caller has already pinned the
// family — bare "white" on its own is white wine as readily as white rum, so
// the unpinned path must never see them.
const SHORT_TOKENS = new Map<DrinkSubtypeId, string[]>(
  SUBTYPE_TABLE.map((subtype) => {
    const family = subtype.category;
    const short = subtype.tokens
      .map((token) => {
        const n = normalizeDrinkHaystack(token);
        if (n.endsWith(` ${family}`)) return n.slice(0, -(family.length + 1));
        if (n.startsWith(`${family} `)) return n.slice(family.length + 1);
        return "";
      })
      .filter(Boolean);
    return [subtype.id, Array.from(new Set(short))];
  }),
);

// Longest matching needle wins, ties broken by table order. Length is the
// honest proxy for specificity: "white rum" (9) beats wine's "white" (5), so
// "White rum" lands on rum even though wine is checked first. Returns 0 for no
// match.
function subtypeScore(hay: string, subtype: DrinkSubtype, pinned: boolean): number {
  let best = 0;
  for (const token of subtype.tokens) {
    const n = normalizeDrinkHaystack(token);
    if (n.length > best && haystackHasNeedle(hay, n)) best = n.length;
  }
  if (!pinned) return best;
  for (const token of SHORT_TOKENS.get(subtype.id) ?? []) {
    if (token.length > best && haystackHasNeedle(hay, token)) best = token.length;
  }
  return best;
}

/** True when free text carries a top-shelf signal (brand or menu language). */
export function haystackIsTopShelf(haystack: string): boolean {
  const hay = normalizeDrinkHaystack(haystack);
  if (!hay) return false;
  if (TOP_SHELF_AGE_STATEMENT.test(hay)) return true;
  if (TOP_SHELF_TOKENS.some((token) => haystackHasNeedle(hay, token))) return true;
  for (const id of TOP_SHELF_BRAND_IDS) {
    const hit = findBrand(id);
    if (hit && haystackMatchesBrand(haystack, hit.brand)) return true;
  }
  return false;
}

// Brand/pint names whose subtype is knowledge, not text: "GUINNESS" says stout
// nowhere in the string. Keyed by the normalised name (and common aliases) that
// the dataset actually ships — spot-checked against
// data/pint_prices_app_dataset.csv, which is beer-only today, hence beer-heavy.
const NAME_SUBTYPE_HINTS: ReadonlyArray<[string, DrinkSubtypeId]> = [
  ["guinness", "beer-stout"],
  ["guiness", "beer-stout"],
  ["murphys", "beer-stout"],
  ["neck oil", "beer-ipa"],
  ["beavertown", "beer-ipa"],
  ["bevertown", "beer-ipa"],
  ["punk ipa", "beer-ipa"],
  ["amstel", "beer-lager"],
  ["estrella", "beer-lager"],
  ["peroni", "beer-lager"],
  ["madri", "beer-lager"],
  ["pravha", "beer-lager"],
  ["carling", "beer-lager"],
  ["fosters", "beer-lager"],
  ["corona", "beer-lager"],
  ["budweiser", "beer-lager"],
  ["bud light", "beer-lager"],
  ["carlsberg", "beer-lager"],
  ["stella artois", "beer-lager"],
  ["stella", "beer-lager"],
  ["san miguel", "beer-lager"],
  ["asahi", "beer-lager"],
  ["coors", "beer-lager"],
  ["camden hells", "beer-lager"],
  ["kronenbourg", "beer-lager"],
  ["birra moretti", "beer-lager"],
  ["moretti", "beer-lager"],
  ["staropramen", "beer-lager"],
  ["cruzcampo", "beer-lager"],
  ["singha", "beer-lager"],
  ["tennents", "beer-lager"],
  ["red stripe", "beer-lager"],
  ["heineken", "beer-lager"],
  ["lucky saint", "beer-lager"],
  ["paulaner", "beer-lager"],
  ["leffe", "beer-ale"],
  ["london pride", "beer-ale"],
  ["old speckled hen", "beer-ale"],
  ["timothy taylor", "beer-ale"],
  ["taylors landlord", "beer-ale"],
  ["spitfire", "beer-ale"],
  ["tribute", "beer-ale"],
  ["youngs original", "beer-ale"],
  ["young s original", "beer-ale"],
  ["aspall", "beer-cider"],
  ["thatchers", "beer-cider"],
  ["strongbow", "beer-cider"],
  ["stowford press", "beer-cider"],
  ["rekorderlig", "beer-cider"],
  ["old mout", "beer-cider"],
  ["henry weston", "beer-cider"],
  ["inch s", "beer-cider"],
  ["pilsner urquell", "beer-pilsner"],
  ["urquell", "beer-pilsner"],
  ["bacardi", "rum-white"],
  ["captain morgan", "rum-spiced"],
  ["sailor jerry", "rum-spiced"],
  ["havana club", "rum-aged"],
  ["diplomatico", "rum-aged"],
  ["mount gay", "rum-aged"],
  ["jameson", "whisky-irish"],
  ["jack daniels", "whisky-bourbon"],
  ["makers mark", "whisky-bourbon"],
  ["johnnie walker", "whisky-scotch"],
  ["lagavulin", "whisky-single-malt"],
  ["talisker", "whisky-single-malt"],
  ["glenlivet", "whisky-single-malt"],
];

// Catalog identities carry punctuation, diacritics, and aliases that the
// dataset-oriented name hints above deliberately do not duplicate.
const BRAND_SUBTYPE_HINTS: ReadonlyArray<[string, DrinkSubtypeId]> = [
  ["guinness", "beer-stout"],
  ["neck-oil", "beer-ipa"],
  ["amstel", "beer-lager"],
  ["estrella", "beer-lager"],
  ["peroni", "beer-lager"],
  ["madri", "beer-lager"],
  ["camden-hells", "beer-lager"],
  ["birra-moretti", "beer-lager"],
  ["bacardi", "rum-white"],
  ["captain-morgan", "rum-spiced"],
  ["sailor-jerry", "rum-spiced"],
  ["havana-club", "rum-aged"],
  ["diplomatico", "rum-aged"],
  ["mount-gay", "rum-aged"],
  ["jameson", "whisky-irish"],
  ["jack-daniels", "whisky-bourbon"],
  ["makers-mark", "whisky-bourbon"],
  ["johnnie-walker", "whisky-scotch"],
  ["lagavulin", "whisky-single-malt"],
  ["talisker", "whisky-single-malt"],
  ["glenlivet", "whisky-single-malt"],
];

function matchingCatalogSubtype(
  drink: string,
  category?: DrinkCategory | null,
  subtypeId?: DrinkSubtypeId,
): DrinkSubtype | null {
  for (const [brandId, hintedSubtypeId] of BRAND_SUBTYPE_HINTS) {
    if (subtypeId && hintedSubtypeId !== subtypeId) continue;
    const subtype = findSubtype(hintedSubtypeId);
    if (!subtype || (category && subtype.category !== category)) continue;
    const hit = findBrand(brandId);
    if (hit && haystackMatchesBrand(drink, hit.brand)) return subtype;
  }
  return null;
}

/**
 * Map a free-text drink label onto a subtype, or `null` when the text carries
 * no confident signal. Honest by construction — an unrecognised label never
 * guesses a subtype, exactly like drinkCategoryFromText.
 *
 * Pass `category` to pin the answer to one family: it both narrows the search
 * (so "white" under `rum` means white rum, not white wine) and rejects a hit
 * belonging to another category.
 */
export function drinkSubtypeFromText(
  drink: string | null | undefined,
  category?: DrinkCategory | null,
): DrinkSubtype | null {
  if (typeof drink !== "string") return null;
  const hay = normalizeDrinkHaystack(drink);
  if (!hay) return null;

  const pool = category ? subtypesForCategory(category) : SUBTYPE_TABLE;

  // Explicit text wins over brand knowledge: "Bacardi Spiced" is spiced rum
  // even though bare "Bacardi" hints white.
  let best: DrinkSubtype | null = null;
  let bestScore = 0;
  for (const subtype of pool) {
    const score = subtypeScore(hay, subtype, Boolean(category));
    if (score > bestScore) {
      best = subtype;
      bestScore = score;
    }
  }
  if (best) return best;

  return subtypeFromBrandName(hay, category);
}

/**
 * Subtype implied by a brand/pint NAME alone — the knowledge the text can't
 * carry ("GUINNESS" is a stout without saying so). Split out from the text
 * classifier so venue filtering can use the strict text rule plus this, and
 * never the lenient category-pinned short forms.
 */
export function subtypeFromBrandName(
  drink: string | null | undefined,
  category?: DrinkCategory | null,
): DrinkSubtype | null {
  if (typeof drink !== "string") return null;
  const hay = normalizeDrinkHaystack(drink);
  if (!hay) return null;
  const catalogHit = matchingCatalogSubtype(drink, category);
  if (catalogHit) return catalogHit;
  for (const [name, subtypeId] of NAME_SUBTYPE_HINTS) {
    if (!haystackHasNeedle(hay, name)) continue;
    const hit = findSubtype(subtypeId);
    if (hit && (!category || hit.category === category)) return hit;
  }
  return null;
}

/** True when any known brand in the text belongs to the requested subtype. */
export function haystackMatchesSubtypeBrand(
  drink: string | null | undefined,
  subtype: DrinkSubtype,
): boolean {
  if (typeof drink !== "string") return false;
  const hay = normalizeDrinkHaystack(drink);
  if (!hay) return false;
  if (matchingCatalogSubtype(drink, subtype.category, subtype.id)) return true;
  return NAME_SUBTYPE_HINTS.some(
    ([name, subtypeId]) =>
      subtypeId === subtype.id && haystackHasNeedle(hay, name),
  );
}
