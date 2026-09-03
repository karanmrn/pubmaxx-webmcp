// Curated drink-brand catalogs for Discover → map deep-links and the map
// drink lens. Pure + browser-safe: no server imports. Brands are a starter
// vocabulary (~4–8 per category) so `?drink=gin&brand=sipsmith` can filter
// without inventing a full menu DB. Identity is the `id`; matching uses the
// normalised label + optional aliases against venue search text / hints.

import {
  DRINK_CATEGORIES,
  type DrinkCategory,
  isMapLensDrinkCategory,
} from "@/lib/drinks";

export type DrinkBrand = {
  id: string;
  label: string;
  aliases?: string[];
  // Typical UK ABV (%). Optional — honestly unknown when absent.
  abv?: number;
};

export type DrinkBrandCatalog = Record<DrinkCategory, DrinkBrand[]>;

// Starter lists. Beer ids intentionally overlap lib/beers.ts where possible so
// the map favorite-pint path and the brand catalog can share an id. Shot/other
// stay empty — honest thin coverage until real menu rows land.
// ABV values are typical UK retail strengths (researched); beer overlaps match
// lib/beers.ts.
export const DRINK_BRANDS: DrinkBrandCatalog = {
  vodka: [
    { id: "absolut", label: "Absolut", abv: 40 },
    { id: "smirnoff", label: "Smirnoff", abv: 37.5 },
    { id: "grey-goose", label: "Grey Goose", aliases: ["gray goose"], abv: 40 },
    { id: "belvedere", label: "Belvedere", abv: 40 },
    { id: "ketel-one", label: "Ketel One", abv: 40 },
    { id: "ciroc", label: "Cîroc", aliases: ["ciroc"], abv: 40 },
  ],
  gin: [
    { id: "sipsmith", label: "Sipsmith", abv: 41.6 },
    { id: "tanqueray", label: "Tanqueray", abv: 43.1 },
    { id: "bombay-sapphire", label: "Bombay Sapphire", aliases: ["bombay"], abv: 40 },
    { id: "hendricks", label: "Hendrick's", aliases: ["hendricks"], abv: 41.4 },
    { id: "gordon", label: "Gordon's", aliases: ["gordons"], abv: 37.5 },
    { id: "beefeater", label: "Beefeater", abv: 40 },
    { id: "whitley-neill", label: "Whitley Neill", abv: 43 },
  ],
  whisky: [
    { id: "jameson", label: "Jameson", abv: 40 },
    { id: "jack-daniels", label: "Jack Daniel's", aliases: ["jack daniels", "jd"], abv: 40 },
    { id: "johnnie-walker", label: "Johnnie Walker", aliases: ["johnny walker"], abv: 40 },
    { id: "makers-mark", label: "Maker's Mark", aliases: ["makers mark"], abv: 45 },
    { id: "lagavulin", label: "Lagavulin", abv: 43 },
    { id: "glenlivet", label: "The Glenlivet", aliases: ["glenlivet"], abv: 40 },
    { id: "talisker", label: "Talisker", abv: 45.8 },
  ],
  rum: [
    { id: "bacardi", label: "Bacardi", abv: 37.5 },
    { id: "captain-morgan", label: "Captain Morgan", abv: 35 },
    { id: "havana-club", label: "Havana Club", abv: 40 },
    { id: "diplomatico", label: "Diplomático", aliases: ["diplomatico"], abv: 40 },
    { id: "mount-gay", label: "Mount Gay", abv: 40 },
    { id: "sailor-jerry", label: "Sailor Jerry", aliases: ["sailor jerry"], abv: 40 },
  ],
  wine: [
    { id: "prosecco", label: "Prosecco", abv: 11 },
    { id: "rioja", label: "Rioja", abv: 13.5 },
    { id: "malbec", label: "Malbec", abv: 13.5 },
    { id: "chardonnay", label: "Chardonnay", abv: 12.5 },
    { id: "pinot-grigio", label: "Pinot Grigio", aliases: ["pinot grigio"], abv: 12 },
    { id: "sauvignon-blanc", label: "Sauvignon Blanc", abv: 12.5 },
    { id: "champagne", label: "Champagne", abv: 12 },
  ],
  beer: [
    { id: "guinness", label: "Guinness", abv: 4.2 },
    { id: "neck-oil", label: "Neck Oil", aliases: ["neck oil", "beavertown", "bevertown"], abv: 4.3 },
    { id: "estrella", label: "Estrella", aliases: ["estrella damm"], abv: 4.6 },
    { id: "peroni", label: "Peroni", abv: 5.0 },
    { id: "amstel", label: "Amstel", abv: 4.0 },
    { id: "madri", label: "Madrí", aliases: ["madri"], abv: 4.6 },
    { id: "camden-hells", label: "Camden Hells", aliases: ["camden hell", "hells lager"], abv: 4.6 },
    { id: "birra-moretti", label: "Birra Moretti", aliases: ["moretti"], abv: 4.6 },
  ],
  cocktail: [
    { id: "negroni", label: "Negroni", abv: 24 },
    { id: "espresso-martini", label: "Espresso Martini", abv: 15 },
    { id: "aperol-spritz", label: "Aperol Spritz", aliases: ["aperol"], abv: 9 },
    { id: "old-fashioned", label: "Old Fashioned", abv: 30 },
    { id: "margarita", label: "Margarita", abv: 18 },
    { id: "mojito", label: "Mojito", abv: 10 },
  ],
  shot: [],
  "alcohol-free": [],
  "soft-drink": [],
  coffee: [],
  other: [],
};

// Category tokens used when a venue has no structured drinkCategories hint —
// matched as substrings against normalised search text / pint names.
export const CATEGORY_SEARCH_TOKENS: Record<DrinkCategory, string[]> = {
  beer: ["beer", "pint", "lager", "ale", "ipa", "stout", "porter", "cider"],
  wine: ["wine", "prosecco", "champagne", "rioja", "malbec", "chardonnay"],
  whisky: ["whisky", "whiskey", "scotch", "bourbon", "dram"],
  gin: ["gin", "gin and tonic"],
  vodka: ["vodka"],
  rum: ["rum", "rhum"],
  cocktail: ["cocktail", "spritz", "negroni", "martini", "margarita", "mojito"],
  shot: ["shot", "shots", "tequila", "sambuca"],
  "alcohol-free": [
    "alcohol free",
    "alcohol-free",
    "low alcohol",
    "low-alcohol",
    "0.0",
    "0%",
    "zero beer",
  ],
  "soft-drink": [
    "soft drink",
    "coca cola",
    "coca-cola",
    "coke",
    "pepsi",
    "lemonade",
    "lime and soda",
    "tonic water",
    "juice",
  ],
  coffee: [
    "coffee",
    "espresso",
    "americano",
    "latte",
    "cappuccino",
    "flat white",
  ],
  other: [],
};

// Tokens matched against the raw (lowercased) string before punctuation collapse,
// so "g&t" does not become the over-broad "g t" (which hits "canning town").
const CATEGORY_RAW_TOKENS: Partial<Record<DrinkCategory, string[]>> = {
  gin: ["g&t", "g & t"],
};

/** Brands listed for a category (empty array for thin-coverage categories). */
export function brandsForCategory(cat: DrinkCategory): DrinkBrand[] {
  return DRINK_BRANDS[cat] ?? [];
}

/** Look up a brand by id across every category. */
export function findBrand(
  id: string,
): { category: DrinkCategory; brand: DrinkBrand } | null {
  const needle = normalizeBrandQuery(id);
  if (!needle) return null;
  for (const category of DRINK_CATEGORIES) {
    for (const brand of DRINK_BRANDS[category]) {
      if (brand.id === needle) return { category, brand };
    }
  }
  return null;
}

/** Lowercase + collapse punctuation so URL/query brand ids stay stable. */
export function normalizeBrandQuery(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normalise free text for substring brand/category matching. */
export function normalizeDrinkHaystack(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** All match needles for a brand (id, label, aliases), normalised for haystacks. */
export function brandMatchNeedles(brand: DrinkBrand): string[] {
  const raw = [brand.id.replace(/-/g, " "), brand.label, ...(brand.aliases ?? [])];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw) {
    const n = normalizeDrinkHaystack(part);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** True when haystack contains any brand needle as a word-ish token. */
export function haystackMatchesBrand(haystack: string, brand: DrinkBrand): boolean {
  const hay = normalizeDrinkHaystack(haystack);
  if (!hay) return false;
  return brandMatchNeedles(brand).some((needle) => {
    if (!needle) return false;
    // Multi-word needles stay substring (same as category tokens); single
    // tokens use word boundaries so "jd" does not match inside "adjourned".
    if (needle.includes(" ")) return hay.includes(needle);
    const re = new RegExp(`(^| )${needle}( |$)`);
    return re.test(hay);
  });
}

/** True when haystack mentions the category via curated tokens (word-ish). */
export function haystackMatchesCategory(
  haystack: string,
  category: DrinkCategory,
): boolean {
  const raw = haystack.toLowerCase();
  if ((CATEGORY_RAW_TOKENS[category] ?? []).some((token) => raw.includes(token))) {
    return true;
  }
  const hay = normalizeDrinkHaystack(haystack);
  if (!hay) return false;
  return CATEGORY_SEARCH_TOKENS[category].some((token) => {
    const n = normalizeDrinkHaystack(token);
    if (!n) return false;
    if (n.includes(" ")) return hay.includes(n);
    // Word-boundary guard so "gin" does not match inside "engineering".
    const re = new RegExp(`(^| )${n}( |$)`);
    return re.test(hay);
  });
}

/**
 * Guard for URL/query/session drink values. It answers the LENS question, not
 * the taxonomy one: only a category the map can show and the picker can clear
 * may become an active drink filter, so `other` is refused here even though it
 * stays a valid submitted category.
 */
export function parseDrinkCategoryParam(
  value: string | null | undefined,
): DrinkCategory | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return isMapLensDrinkCategory(trimmed) ? trimmed : null;
}

/** Categories with at least one curated brand (for UI empty-state honesty). */
export function categoryHasBrandCoverage(cat: DrinkCategory): boolean {
  return brandsForCategory(cat).length > 0;
}
