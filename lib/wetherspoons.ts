// J D Wetherspoon (official site) drink-menu parser — Wave 3 of the approved
// drink-price plan. PURE + TESTED: no network here. scripts/refresh_drink_prices.mjs
// does the (rate-limited, robots-gated) fetching and hands raw payloads to these
// functions.
//
// PROBE FINDING (2026-07-07, honest record — see __tests__/fixtures/wetherspoons-*):
//   Wetherspoons publishes 824 per-pub menu pages at
//   https://www.jdwetherspoon.com/pub-menus/{slug}/ (slug = name+locality).
//   robots.txt is permissive (Disallow: empty; Crawl-delay: 10). Each page is a
//   WordPress page that carries the pub's identity (title, canonical URL, slug
//   locality) and a link to a menu PDF — but NO structured per-drink prices:
//     - the pub-menu WP REST post type (wp-json/wp/v2/pub-menus) has acf: [] — no
//       menu/price payload;
//     - the only menu artifact is a single CHAIN-WIDE MENU_*.pdf that is a vector
//       graphics poster (no extractable text, no per-pub prices);
//     - live, pub-varying prices exist ONLY inside the native Order & Pay mobile
//       app (private backend, per-pub/table session) — out of scope for the
//       owner-confirmed first-party WEBSITE TOS, and we do not reverse app APIs.
//   => There is NO first-party WEB target that yields per-pub drink PRICES. This
//      module therefore parses everything that IS first-party-available (pub
//      identity, menu link, any embedded priced rows should the shape ever gain
//      them) and emits priced candidate rows only when a payload actually carries
//      a price. Against today's real payloads that is zero rows — reported
//      honestly by the caller, never faked.
//
// The parser is written against a GENERIC menu payload shape so that if/when a
// first-party priced feed appears (e.g. an official pub menu JSON), only the
// extraction adapter changes — the category map, venue matcher, and row builder
// are already correct and snapshot-pinned.

import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The identity we can extract for a pub from its first-party menu page. Every
// field here is really present on the live page (see fixture).
export type WetherspoonsPubIdentity = {
  // Pub display name, e.g. "The Rochester Castle".
  name: string;
  // Locality parsed from the URL slug, e.g. "Stoke Newington". Used for venue
  // matching against our dataset's addresses/boroughs.
  locality: string;
  // Canonical first-party menu-page URL — the attribution link stamped on rows.
  pageUrl: string;
  // The menu PDF/document link if the page exposes one (attribution / audit).
  menuDocUrl: string | null;
};

// A raw priced item as it might appear in a first-party menu payload. This is
// the ONLY place a price can enter the pipeline. `priceGbp` is required — an
// item with no price is not a candidate row (we never guess a price).
export type WetherspoonsMenuItem = {
  name: string;
  // The site's own section/category label (e.g. "Draught beer", "Wines").
  section: string;
  priceGbp: number;
  producer?: string;
  abv?: number;
  servingSize?: string;
};

// A menu payload for one pub: identity + zero-or-more priced items. Today the
// real first-party payload carries an empty `items` (no web-available prices);
// the shape is future-proof for a real priced feed.
export type WetherspoonsMenuPayload = {
  identity: WetherspoonsPubIdentity;
  items: WetherspoonsMenuItem[];
};

// A candidate row this parser emits per priced item, pre-venue-match. venueKey
// is filled by matchVenue against OUR dataset; unmatched rows are DROPPED by the
// caller.
export type WetherspoonsCandidateRow = {
  drinkName: string;
  category: DrinkCategory;
  priceGbp: number;
  producer?: string;
  abv?: number;
  servingSize?: string;
  identity: WetherspoonsPubIdentity;
};

// ---------------------------------------------------------------------------
// Slug / identity parsing (real, from the live page + sitemap)
// ---------------------------------------------------------------------------

const MENU_PATH_RE = /\/pub-menus\/([^/]+)\/?$/;

// A curated set of multi-word UK locality tails so we split "name-locality"
// slugs correctly (e.g. "hamilton-hall-city-of-london" → locality
// "City Of London"). Falls back to the last slug segment.
const MULTIWORD_LOCALITY_TAILS = [
  "city-of-london",
  "stoke-newington",
  "newton-abbot",
  "ruislip-manor",
  "st-andrews",
];

function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Extract the slug from a /pub-menus/{slug}/ URL. Returns null for anything else.
export function slugFromMenuUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(MENU_PATH_RE);
    return m ? m[1] : null;
  } catch {
    const m = url.match(MENU_PATH_RE);
    return m ? m[1] : null;
  }
}

// Split a pub slug into { name, locality } using the multi-word tail list, then
// a single trailing segment as locality. Best-effort — locality is only a
// matching hint (name carries the weight), so a wrong split never fabricates a
// match, it just weakens one.
export function splitPubSlug(slug: string): { name: string; locality: string } {
  const clean = slug.trim().toLowerCase();
  for (const tail of MULTIWORD_LOCALITY_TAILS) {
    if (clean.endsWith(`-${tail}`)) {
      const name = clean.slice(0, clean.length - tail.length - 1);
      return { name: titleCase(name), locality: titleCase(tail) };
    }
  }
  const parts = clean.split("-");
  if (parts.length <= 1) return { name: titleCase(clean), locality: "" };
  const locality = parts[parts.length - 1];
  const name = parts.slice(0, -1).join("-");
  return { name: titleCase(name), locality: titleCase(locality) };
}

// Parse a pub menu HTML page → identity. Reads the real first-party structures:
// the <h1>/og:title for the display name, the canonical URL, the slug locality,
// and the first menu PDF link. Returns null if it isn't a recognisable menu page.
export function parsePubMenuPage(html: string, sourceUrl: string): WetherspoonsPubIdentity | null {
  const slug = slugFromMenuUrl(sourceUrl) ?? extractCanonicalSlug(html);
  if (!slug) return null;
  const { name: slugName, locality } = splitPubSlug(slug);

  const h1 = matchGroup(html, /<h1[^>]*>([^<]+)<\/h1>/i);
  const ogTitle = matchGroup(html, /<meta\s+property="og:title"\s+content="([^"]+)"/i);
  const displayName = cleanName(h1 ?? ogTitle ?? slugName);

  const canonical =
    matchGroup(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i) ??
    matchGroup(html, /<meta\s+property="og:url"\s+content="([^"]+)"/i) ??
    sourceUrl;

  const menuDocUrl = matchGroup(
    html,
    /href="(https:\/\/www\.jdwetherspoon\.com\/wp-content\/uploads\/menus\/[^"']+\.pdf)"/i,
  );

  return {
    name: displayName,
    locality,
    pageUrl: canonical,
    menuDocUrl: menuDocUrl ?? null,
  };
}

function extractCanonicalSlug(html: string): string | null {
  const canonical = matchGroup(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
  return canonical ? slugFromMenuUrl(canonical) : null;
}

function matchGroup(input: string, re: RegExp): string | null {
  const m = input.match(re);
  return m ? m[1].trim() : null;
}

// Strip the chain suffix Wetherspoons appends to titles, e.g.
// "The Rochester Castle - J D Wetherspoon" → "The Rochester Castle".
function cleanName(value: string): string {
  return value
    .replace(/\s*[-–|]\s*J\.?\s*D\.?\s*Wetherspoon.*$/i, "")
    .replace(/\s*[-–|]\s*Wetherspoon.*$/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Category mapping (their sections → our closed DrinkCategory taxonomy)
// ---------------------------------------------------------------------------

// Ordered, longest-match-wins keyword rules from Wetherspoons' own drink section
// vocabulary to our closed DrinkCategory set. Anything unmatched → null (DROPPED,
// never coerced into "other" silently unless the section is explicitly Other).
// Soft drinks and alcohol-free are distinct lanes; coffee is its own daytime lane.
const CATEGORY_RULES: Array<{ test: RegExp; category: DrinkCategory }> = [
  { test: /cocktail|pitcher|spritz/i, category: "cocktail" },
  { test: /\bshots?\b|shooter/i, category: "shot" },
  { test: /whisk(e)?y|bourbon|scotch/i, category: "whisky" },
  { test: /\bgin\b/i, category: "gin" },
  { test: /vodka/i, category: "vodka" },
  { test: /\brum\b/i, category: "rum" },
  { test: /wine|prosecco|champagne|sparkling/i, category: "wine" },
  { test: /beer|lager|ale|cider|stout|draught|pint|craft/i, category: "beer" },
  { test: /coffee|hot drink/i, category: "coffee" },
  {
    test: /alcohol.?free|non-alcoholic|no & low|no and low|0\.0/i,
    category: "alcohol-free",
  },
  { test: /soft drink/i, category: "soft-drink" },
  { test: /\bother\b/i, category: "other" },
];

// Map a Wetherspoons section label to our DrinkCategory, or null if unmappable
// (caller DROPS the row — an unmappable section is never guessed at).
export function mapSectionToCategory(section: string): DrinkCategory | null {
  if (typeof section !== "string" || section.trim() === "") return null;
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(section)) return rule.category;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Payload → candidate rows
// ---------------------------------------------------------------------------

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// Turn a parsed menu payload into candidate rows. An item is DROPPED (with no
// guessing) when: its section maps to no category, its price is absent/invalid,
// or its name is empty. Returns rows carrying the pub identity for matching.
export function candidateRowsFromPayload(
  payload: WetherspoonsMenuPayload,
): WetherspoonsCandidateRow[] {
  const rows: WetherspoonsCandidateRow[] = [];
  for (const item of payload.items) {
    if (typeof item.name !== "string" || item.name.trim() === "") continue;
    if (!isFinitePositive(item.priceGbp)) continue;
    const category = mapSectionToCategory(item.section);
    if (!category || !isDrinkCategory(category)) continue;
    rows.push({
      drinkName: item.name.trim(),
      category,
      priceGbp: item.priceGbp,
      producer: item.producer,
      abv: item.abv,
      servingSize: item.servingSize,
      identity: payload.identity,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Venue matching against OUR dataset (pure)
// ---------------------------------------------------------------------------

// The subset of our dataset a match needs. `venueKey` is the canonical grouping
// key (lib/venues.ts venueGroupingKey) the price-update layer targets. `name`
// and `address` come straight from the dataset row; the matcher normalises both.
export type DatasetVenue = {
  venueKey: string;
  name: string;
  address: string;
};

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|jd|j d|wetherspoon(s)?|pub|bar)\b/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalise(value).split(" ").filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export type VenueMatch = {
  venueKey: string;
  score: number;
  matchedName: string;
};

// Match a Wetherspoons pub identity to exactly one dataset venue, or null. Rule
// (deliberately conservative — an unmatched row is DROPPED, never guessed):
//   1. require a strong normalised-name token overlap (Jaccard ≥ 0.6), AND
//   2. among candidates that pass, require the locality to appear in the
//      candidate's address (or an empty locality, which just relaxes to name).
//   3. break ties by the highest name score; refuse ambiguous ties (two equally
//      top candidates with different keys) by returning null.
export function matchVenue(
  identity: WetherspoonsPubIdentity,
  dataset: DatasetVenue[],
  minScore = 0.6,
): VenueMatch | null {
  const nameTokens = tokens(identity.name);
  if (nameTokens.size === 0) return null;
  const loc = normalise(identity.locality);

  const scored: VenueMatch[] = [];
  for (const venue of dataset) {
    const score = jaccard(nameTokens, tokens(venue.name));
    if (score < minScore) continue;
    if (loc) {
      const addr = normalise(venue.address);
      const locOk = loc.split(" ").some((part) => part.length > 2 && addr.includes(part));
      if (!locOk) continue;
    }
    scored.push({ venueKey: venue.venueKey, score, matchedName: venue.name });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tie = scored[1];
  if (tie && tie.score === top.score && tie.venueKey !== top.venueKey) {
    return null; // ambiguous — refuse to guess
  }
  return top;
}
