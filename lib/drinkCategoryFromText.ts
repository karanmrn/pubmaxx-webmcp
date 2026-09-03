// Derive a DrinkCategory from a free-text drink label (E5 colour system).
// ---------------------------------------------------------------------------
// A FeedItem carries `drink` as a free-text string ("Guinness", "House red",
// "Negroni") — never a structured category. The feed's colour language needs a
// category to pick an accent, so this maps the text onto the closed taxonomy.
//
// HONESTY is the contract: this returns `null` when the text gives NO confident
// signal, so the caller can fall back to the honest beer/brass base rather than
// fabricate a category the data doesn't support (WCAG-adjacent: never assert a
// meaning the data can't back). Matching is conservative — a curated keyword set
// per category, whole-word where a substring would over-match — and returns the
// FIRST category whose keywords hit, in a deliberate order (specific spirits and
// wine before the broad "beer" net) so "wine" never loses to a stray "ale".
//
// Pure + browser-safe: no imports beyond the taxonomy type. Fully unit-tested.

import {
  drinkSubtypeFromText,
  haystackIsTopShelf,
} from "@/lib/drinkSubtypes";
import type { DrinkCategory } from "@/lib/drinks";

export type DrinkTextTaxonomy = {
  category: DrinkCategory;
  subtype: string | null;
  topShelf: boolean;
};

// Ordered keyword table. Order matters: the first category with a hit wins, so
// the more specific / less ambiguous families are checked before the broad
// "beer" bucket (which would otherwise swallow "ginger beer", "root beer"…).
// Bare "red"/"white" are NOT wine keywords: they steal "flat white". Use
// "house red", "red wine", grape names, etc. instead. Coffee sits after vodka
// so "espresso martini" stays a spirit.
// Keywords are lowercase; matched as whole words against a normalised label.
const CATEGORY_KEYWORDS: Array<[DrinkCategory, string[]]> = [
  [
    "wine",
    [
      "wine",
      "house red",
      "house white",
      "red wine",
      "white wine",
      "large red",
      "large white",
      "glass of red",
      "glass of white",
      "rose",
      "rosé",
      "merlot",
      "malbec",
      "rioja",
      "shiraz",
      "syrah",
      "cabernet",
      "sauvignon",
      "chardonnay",
      "pinot",
      "prosecco",
      "champagne",
      "cava",
      "sherry",
      "port",
    ],
  ],
  [
    "whisky",
    [
      "whisky",
      "whiskey",
      "scotch",
      "bourbon",
      "rye",
      "islay",
      "speyside",
      "dram",
    ],
  ],
  // Vodka before gin so "espresso martini" is not stolen by gin's "martini".
  ["vodka", ["vodka", "moscow mule", "espresso martini"]],
  [
    "gin",
    ["gin", "g&t", "gin and tonic", "gin & tonic", "negroni", "martini"],
  ],
  ["rum", ["rum", "mojito", "daiquiri", "pina colada", "piña colada", "rhum"]],
  [
    "cocktail",
    [
      "cocktail",
      "spritz",
      "aperol",
      "margarita",
      "cosmopolitan",
      "mai tai",
      "old fashioned",
      "manhattan",
      "sour",
      "highball",
      "punch",
      "sangria",
    ],
  ],
  ["shot", ["shot", "shots", "sambuca", "tequila", "jägerbomb", "jagerbomb", "jager", "jäger"]],
  // No-alcohol and daytime lanes sit above the broad beer net so "ginger beer"
  // / "root beer" stay soft-drink when the label says so, and coffee never
  // collapses into other. Spirits/cocktail (incl. espresso martini) already won
  // above.
  [
    "alcohol-free",
    [
      "alcohol-free",
      "alcohol free",
      "alcoholfree",
      "0.0",
      "0.0%",
      "af pint",
      "af beer",
      "non-alcoholic beer",
      "non alcoholic beer",
      "heineken 0.0",
      "guinness 0.0",
    ],
  ],
  [
    "soft-drink",
    [
      "soft drink",
      "soft drinks",
      "soda",
      "cola",
      "coke",
      "pepsi",
      "lemonade",
      "ginger beer",
      "root beer",
      "squash",
      "juice",
      "tonic water",
      "sparkling water",
    ],
  ],
  [
    "coffee",
    [
      "coffee",
      "latte",
      "cappuccino",
      "flat white",
      "americano",
      "mocha",
      "espresso",
      "macchiato",
      "cortado",
    ],
  ],
  [
    "beer",
    [
      "beer",
      "pint",
      "lager",
      "ale",
      "ipa",
      "stout",
      "porter",
      "bitter",
      "pilsner",
      "guinness",
      "cider",
      "pale",
      "session",
      "draught",
      "draft",
    ],
  ],
];

// Whole-word test for a keyword inside a normalised label. Multi-word keywords
// ("gin and tonic") are matched as a substring on word boundaries. Guards against
// "red" matching inside "shredded" while still catching "House red".
function hasKeyword(label: string, keyword: string): boolean {
  if (keyword.includes(" ")) {
    return label.includes(keyword);
  }
  // Word boundary either side (or string edge). Escape nothing — keywords are
  // plain alphanumerics + a couple of accented letters, no regex metachars.
  const re = new RegExp(`(^|[^a-z0-9])${keyword}([^a-z0-9]|$)`, "i");
  return re.test(label);
}

/**
 * Map a free-text drink label onto the drink taxonomy, or `null` when the text
 * carries no confident signal. Never guesses: an unrecognised label ("a memory",
 * "", "the usual") yields null so the caller falls back honestly.
 */
function categoryFromKeywords(drink: string): DrinkCategory | null {
  const label = drink.trim().toLowerCase();
  if (!label) return null;

  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    for (const keyword of keywords) {
      if (hasKeyword(label, keyword)) return category;
    }
  }
  return null;
}

export function drinkCategoryFromText(
  drink: string | null | undefined,
): DrinkCategory | null {
  if (typeof drink !== "string") return null;
  const category = categoryFromKeywords(drink);
  if (category) return category;

  // Preserve every ordered top-level decision above. Only labels the legacy
  // table cannot classify fall through to subtype/brand knowledge, allowing
  // real price strings such as "AMSTEL" and "BACARDI" to reach their family.
  return drinkSubtypeFromText(drink)?.category ?? null;
}

/**
 * Classify a free-text drink into its backward-compatible category plus at
 * most one subtype and an orthogonal top-shelf signal.
 */
export function drinkTaxonomyFromText(
  drink: string | null | undefined,
): DrinkTextTaxonomy | null {
  if (typeof drink !== "string" || !drink.trim()) return null;
  const category = drinkCategoryFromText(drink);
  if (!category) return null;
  const subtype = drinkSubtypeFromText(drink, category);
  return {
    category,
    subtype: subtype?.id ?? null,
    topShelf: haystackIsTopShelf(drink),
  };
}

export { CATEGORY_KEYWORDS };
