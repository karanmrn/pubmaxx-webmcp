import {
  agreesWithinTolerance,
  COMMUNITY_PRICE_CORROBORATION_THRESHOLD,
  isWithinMaxAge,
} from "@/lib/communityPrice";
import { getVenueCuration, type Provenance, type VenueCuration } from "@/lib/curation";
import { formatGbp } from "@/lib/formatGbp";
import { haversineKm } from "@/lib/haversine";
import { firstHttp } from "@/lib/httpUrl";
import {
  findBrand,
  haystackMatchesBrand,
  haystackMatchesCategory,
  parseDrinkCategoryParam,
} from "@/lib/drinkBrands";
import {
  haystackIsTopShelf,
  haystackMatchesSubtype,
  haystackMatchesSubtypeBrand,
  parseDrinkSubtypeParam,
} from "@/lib/drinkSubtypes";
import type { FoodCategory } from "@/lib/food";
import { hasNonAlcoholic } from "@/lib/nonAlcoholicDrinks";
import { getVenueAccessibility } from "@/lib/venueAccessibilitySeeds";
import {
  matchesAccessibilityFilters,
  type VenueAccessibility,
} from "@/lib/venueAccessibility";
import type { VenueMenuCategoryTile } from "@/lib/venueMenuEnrichment";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { parseZoneParam, venueMatchesZone } from "@/lib/zones";
import type { MapLensPrice } from "@/lib/mapExperienceLens";

export type CrawlStyle =
  | "balanced"
  | "cheapest"
  | "heritage"
  | "writerTrail"
  | "beerGarden"
  | "sports"
  | "dateNight"
  | "noAlcoholFirst";

export type CrawlMode = "suggest" | "build";

export type VenuePrice = {
  app_price_id: string;
  pub_name: string;
  pint_name: string;
  price_gbp: number | null;
  price_text: string;
  address: string;
  latitude: number;
  longitude: number;
  boroughs_visible: string;
  boroughs_raw_embedded_non_anomaly: string;
  boroughs_raw_embedded_site_anomaly: string;
  primary_borough: string;
  rank_visible_borough: string;
  estimated_average_price_text: string;
  pub_url: string;
  constructed_pub_url: string;
  borough_urls: string;
  phone_number: string;
  email: string;
  website: string;
  booking_link: string;
  image_url: string;
  description: string;
  comment: string;
  food: string;
  cocktails: string;
  beer_garden: string;
  live_sports: string;
  live_music: string;
  pub_quiz: string;
  darts: string;
  pool: string;
  happy_hour: string;
  karaoke: string;
  cool: string;
  source_datasets: string;
  source_row_count: number;
  has_visible_borough_row: boolean;
  has_raw_embedded_map_row: boolean;
  has_individual_pub_page_row: boolean;
  is_clean_canonical_app_row: boolean;
  data_quality_notes: string;
};

/**
 * Every kind of place the venue layers can hold. ONE list, because a second
 * copy of it is a gate that silently drops a row: `buildVenueIndexFromSlim`,
 * `isValidSlimVenue` and the zone index each restated it, so a kind added in
 * one place would have been discarded by the next reader with nothing failing.
 *
 * The first five are the CURATED kinds, which carry prices, pint lanes and
 * every pub surface. The rest arrived with the UK-wide OSM venue pack
 * (`scripts/fetch_uk_osm_venues.mjs`) and are PRESENT-BUT-NEUTRAL: `isPubVenueKind`
 * is false for them, so no price is assumed, no pint lane opens, and no pub
 * surface claims them. Building anything for them is a separate wave.
 */
export const VENUE_KINDS = [
  "pub",
  "bar",
  "club",
  "food",
  "restaurant",
  "cafe",
  "coworking",
  "library",
  "hotel_lounge",
  "other",
] as const;

export type VenueKind = (typeof VENUE_KINDS)[number];

export function isVenueKind(value: unknown): value is VenueKind {
  return typeof value === "string" && (VENUE_KINDS as readonly string[]).includes(value);
}

export type Venue = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  primaryBorough: string;
  visibleBoroughs: string[];
  prices: VenuePrice[];
  cheapestPrice: number | null;
  cheapestPint: string;
  averagePrice: number | null;
  // Derived summary signal for map markers, filters and scoring. Lights from an
  // editorial heritage note OR a contributor Pint Drop, so mergeVenueDrops never
  // has to overwrite curation.heritageNote to make a venue read as a story pub.
  hasStory: boolean;
  // Live community-price layer, populated by mergeVenueDrops from the newest
  // organic (non-demo) price drop. `latestContributorPrice` is the override the
  // UI shows in place of the static baseline; `latestContributorAt` is that
  // drop's ISO timestamp so the UI can render freshness (formatFreshness).
  // Both null when no organic price drop exists — the baseline stands alone.
  latestContributorPrice: number | null;
  latestContributorAt: string | null;
  amenities: {
    food: boolean;
    cocktails: boolean;
    beerGarden: boolean;
    liveSports: boolean;
    liveMusic: boolean;
    pubQuiz: boolean;
    darts: boolean;
    pool: boolean;
    happyHour: boolean;
    karaoke: boolean;
    // Derived (not a dataset flag): the pub pours at least one non-alcoholic /
    // 0.0 option (Lucky Saint, Guinness 0.0, "…Alcohol Free 0.5%"…).
    nonAlcoholic: boolean;
  };
  website: string;
  /** First http(s) booking_link from price rows — table booking CTA. */
  bookingLink: string;
  /** Curated menu page URL (detail enrichment overlay). */
  menuUrl?: string;
  /** Curated food-order URL (detail enrichment overlay; never invented). */
  orderUrl?: string;
  /** Curated allergy info URL (detail enrichment overlay). */
  allergyInfoUrl?: string;
  /** Curated food category tiles for the Menu hub (detail enrichment). */
  categoryTiles?: VenueMenuCategoryTile[];
  imageUrl: string;
  description: string;
  dataQualityNotes: string[];
  sourceDatasets: string[];
  curation: VenueCuration;
  // Nearest-station TfL fare zone (1–6, occasionally 7–9 at the London edge).
  // Stamped onto the slim index at build time (scripts/lib/stationZones.mjs) and
  // carried onto the pin so the zone lens can filter before detail hydrates.
  // Undefined when unknown — honestly absent, never bucketed.
  zone?: number;
  // Compact facts carried by the slim map index so URL/query filters can work
  // before the heavy venue detail rows are hydrated.
  filterHints?: VenueFilterHints;
  /** Famous-venue taxonomy. Absent is a pub for legacy/cache compatibility. */
  kind?: VenueKind;
  /** Type-relative price band computed at build time (cheap/mid/dear). */
  priceBand?: 0 | 1 | 2;
  /** Provenance for non-pub anchor prices and editorial stories. */
  anchorLabel?: string;
  anchorCourse?: FoodCategory;
  anchorObservedAt?: string;
  anchorSourceUrl?: string;
  storySourceUrl?: string;
  // Publicly-documented accessible-venue facts (PRD issue #28). Present ONLY for
  // the small curated seed of pubs whose access is documented (see
  // lib/venueAccessibilitySeeds.ts); for every other venue this is undefined —
  // honestly UNKNOWN, never fabricated. See lib/venueAccessibility.ts for the
  // predicates + filter contract (an unknown field FAILS a positive filter).
  accessibility?: VenueAccessibility;
};

export type VenueFilterHints = {
  searchText: string;
  amenities: {
    food: boolean;
    cocktails: boolean;
    beerGarden: boolean;
    liveSports: boolean;
    nonAlcoholic: boolean;
  };
  curation: {
    nearWater: boolean;
    hasStory: boolean;
  };
  canonical: boolean;
  /**
   * True when the venue came from a London chain/guide scrape (Young's,
   * Nicholson's, Greene King, Eating Europe gazetteer). Used for map halos and
   * drink-accent fallbacks — never invents prices.
   */
  scraped?: boolean;
  /**
   * Soft cuisine / plate tags (roast, thai, pizza, …). Optional — absent on
   * most slim rows; when present they are short lowercase tokens for UI chips
   * and Discover "Hungry?" deep-links, never a hard filter gate.
   */
  cuisineTags?: string[];
  // Optional drink-lens hints from the slim index (Wave C). Populated
  // pragmatically from pint names / amenity flags — not a full menu DB.
  drinkCategories?: string[];
  drinkBrands?: string[];
  /**
   * Normalized drink product names from the slim source rows. Keeps raw
   * evidence available so the canonical subtype matcher remains the one owner
   * of taxonomy classification instead of duplicating it in the build script.
   */
  drinkText?: string;
  /**
   * Second-level drink hints (`rum-dark`, `whisky-japanese`, …) from
   * lib/drinkSubtypes. Optional and usually absent — the subtype lens falls
   * back to the same free-text haystack the category lens uses.
   */
  drinkSubtypes?: string[];
  /** True when the slim index saw a top-shelf / premium pour. */
  topShelf?: boolean;
};

/**
 * The one `maxPrice` that means "no pint-price cap". A cap a reader cannot see
 * is worse than a wrong figure, because nothing tells them there is anything
 * to disbelieve: a default of 8 lit a "1" filter badge reading "≤£8.00" that no
 * control in the app could show or clear. So the OFF value is a single shared
 * number, it is what a fresh visitor starts on, and every price control offers
 * it as "Any". It sits above every priced pub in the curated index, so it caps
 * nothing; non-pub anchors bypass the cap in filterVenues regardless.
 */
export const NO_PINT_PRICE_CAP = 10;

export type Filters = {
  query: string;
  /** Maximum pint price. `NO_PINT_PRICE_CAP` means no cap at all. */
  maxPrice: number;
  crawlStyle: CrawlStyle;
  stopCount: number;
  routeWindow: number;
  requireBeerGarden: boolean;
  requireNonAlcoholic: boolean;
  requireLiveSports: boolean;
  requireFood: boolean;
  requireCocktails: boolean;
  requireWater: boolean;
  requireHeritage: boolean;
  requirePintDrops: boolean;
  canonicalOnly: boolean;
  /**
   * Drop pubs we know are closed right now. Pubs without trusted hours stay
   * visible (honest unknown). Hours currently come from Wetherspoon directory
   * match only — never invented, never CityMCP bulk.
   */
  openNow: boolean;
  // Accessible-venue filters (PRD issue #28). Each, when on, narrows to pubs
  // KNOWN to have that facet — an unknown fact fails the filter (see
  // lib/venueAccessibility.matchesAccessibilityFilters). Off = no-op.
  requireStepFree: boolean;
  requireAccessibleToilet: boolean;
  requireSeatedService: boolean;
  // Drink-lens filters (Wave C / Discover deep-links). Empty string = off.
  // drinkCategory is a DrinkCategory id; drinkBrand is a curated brand id from
  // lib/drinkBrands. Cocktail / low-no still prefer the amenity flags above.
  drinkCategory: string;
  drinkBrand: string;
  // Second-level refinement of drinkCategory (lib/drinkSubtypes): a subtype id
  // like "rum-dark" or "whisky-japanese". "" = off. A subtype NEVER replaces
  // its category — both are set together, so every category-only consumer
  // (glyph lens, persona lens, deep-links) is unaffected. A subtype whose
  // category disagrees with drinkCategory is ignored rather than obeyed.
  drinkSubtype: string;
  // Cross-category "expensive kind of booze" lens. Off = no narrowing; on
  // narrows to venues with a KNOWN top-shelf signal (never guessed).
  topShelfOnly: boolean;
  // Zone lens (nearest-station fare zone). "" or "all" = every zone; "1".."6"
  // narrows to venues whose assigned zone matches. A venue with an unknown zone
  // never matches a concrete zone — honest, not guessed into a bucket.
  zone: string;
};

/**
 * The default Filters state a fresh map/crawl session starts from. Lives here
 * (not in a component) because lib/crawlUrl.ts, a pure, server-safe module
 * (see lib/pubMap.ts's header on why it must stay that way), needs it too;
 * components/map/ControlRail.tsx re-exports it for its existing importers.
 */
export const initialFilters: Filters = {
  query: "",
  // A fresh visitor starts with NO price cap. See NO_PINT_PRICE_CAP.
  maxPrice: NO_PINT_PRICE_CAP,
  crawlStyle: "balanced",
  stopCount: 6,
  routeWindow: 20,
  requireBeerGarden: false,
  requireNonAlcoholic: false,
  requireLiveSports: false,
  requireFood: false,
  requireCocktails: false,
  requireWater: false,
  requireHeritage: false,
  requirePintDrops: false,
  // Default OFF so scraped / gazetteer pubs (Young's, Nicholson's, Eating Europe
  // seeds) appear on first paint. Users can still tighten to verified-only.
  canonicalOnly: false,
  // Off by default. When on, only known-closed pubs drop; unknown hours stay.
  openNow: false,
  requireStepFree: false,
  requireAccessibleToilet: false,
  requireSeatedService: false,
  drinkCategory: "",
  drinkBrand: "",
  // "" = no subtype refinement; set only alongside a drinkCategory.
  drinkSubtype: "",
  topShelfOnly: false,
  // "" = all zones (no narrowing). The zone picker sets "1".."6".
  zone: "",
};

export function truthyFlag(value: string): boolean {
  return ["yes", "true", "y", "1"].includes(String(value).trim().toLowerCase());
}

export function splitList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatPrice(value: number | null): string {
  return typeof value === "number" ? formatGbp(value) : "No price";
}

export { formatGbp };

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Grouping key from bare venue fields — same formula as venueGroupingKey. */
export function venueCoordsGroupingKey(
  name: string,
  address: string,
  lat: number,
  lng: number,
): string {
  return [
    normaliseVenueKeyPart(name),
    normaliseVenueKeyPart(address),
    lat.toFixed(5),
    lng.toFixed(5),
  ].join("|");
}

export function venueGroupingKey(row: VenuePrice): string {
  return venueCoordsGroupingKey(row.pub_name, row.address, row.latitude, row.longitude);
}

export function stableVenueIdFromKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

export function groupVenuePrices(rows: VenuePrice[]): Venue[] {
  const grouped = new Map<string, VenuePrice[]>();
  for (const row of rows) {
    const key = venueGroupingKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return Array.from(grouped.entries()).map(([key, prices]) => {
    const sortedPrices = [...prices].sort((a, b) => {
      const left = a.price_gbp ?? Number.POSITIVE_INFINITY;
      const right = b.price_gbp ?? Number.POSITIVE_INFINITY;
      return left - right;
    });
    const first = sortedPrices[0];
    const numericPrices = sortedPrices
      .map((price) => price.price_gbp)
      .filter((price): price is number => typeof price === "number");
    const sourceDatasets = new Set<string>();
    const dataQualityNotes = new Set<string>();
    for (const price of prices) {
      splitList(price.source_datasets).forEach((source) => sourceDatasets.add(source));
      splitList(price.data_quality_notes).forEach((note) => dataQualityNotes.add(note));
    }

    const curation = getVenueCuration(sortedPrices);
    // Attach documented accessibility facts for the curated seed only; every
    // other venue gets undefined (honestly unknown). Keyed by pub name +
    // borough so a common name doesn't cross-contaminate the wrong pub.
    const accessibility = getVenueAccessibility(first.pub_name, first.primary_borough);

    return {
      id: stableVenueIdFromKey(key),
      name: first.pub_name,
      address: first.address,
      latitude: first.latitude,
      longitude: first.longitude,
      primaryBorough: first.primary_borough,
      visibleBoroughs: splitList(first.boroughs_visible),
      prices: sortedPrices,
      cheapestPrice: numericPrices.length ? Math.min(...numericPrices) : null,
      cheapestPint: first.pint_name,
      averagePrice: numericPrices.length
        ? numericPrices.reduce((sum, price) => sum + price, 0) / numericPrices.length
        : null,
      hasStory: Boolean(curation.heritageNote),
      // No community layer until mergeVenueDrops folds one in.
      latestContributorPrice: null,
      latestContributorAt: null,
      amenities: {
        food: prices.some((price) => truthyFlag(price.food)),
        cocktails: prices.some((price) => truthyFlag(price.cocktails)),
        beerGarden: prices.some((price) => truthyFlag(price.beer_garden)),
        liveSports: prices.some((price) => truthyFlag(price.live_sports)),
        liveMusic: prices.some((price) => truthyFlag(price.live_music)),
        pubQuiz: prices.some((price) => truthyFlag(price.pub_quiz)),
        darts: prices.some((price) => truthyFlag(price.darts)),
        pool: prices.some((price) => truthyFlag(price.pool)),
        happyHour: prices.some((price) => truthyFlag(price.happy_hour)),
        karaoke: prices.some((price) => truthyFlag(price.karaoke)),
        nonAlcoholic: hasNonAlcoholic(prices.map((price) => price.pint_name)),
      },
      website: prices.find((price) => price.website)?.website ?? "",
      bookingLink: firstHttp(...prices.map((price) => price.booking_link)),
      imageUrl: prices.find((price) => price.image_url)?.image_url ?? "",
      description: prices.find((price) => price.description)?.description ?? "",
      dataQualityNotes: Array.from(dataQualityNotes),
      sourceDatasets: Array.from(sourceDatasets),
      curation,
      accessibility,
    };
  });
}

// The minimal drop shape mergeVenueDrops needs — the client DTO satisfies it.
export type SummaryDrop = {
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  provenance: Provenance;
  // ISO timestamp the drop was logged. Carried through so the UI can show how
  // fresh the live community price is ("logged 2h ago") — see formatFreshness.
  createdAt: string;
  // Public handle is presentation only. It is never proof that two reports came
  // from two people because an anonymous caller can invent handles and an owner
  // can rename one.
  handle?: string;
  // Stable, server-derived, per-venue authority key for a verified PUBMAXX User
  // ID. Missing keys are provisional observations: visible on the venue sheet
  // and eligible for the provisional pin mark, but never price authority.
  authorityKey?: string;
};

// Honesty note the venue detail can render alongside a community-updated price,
// so a Pint Drop override never reads as an authoritative live feed. Exported as
// a plain constant (no new UI) — the integrator drops it in next to the price.
export const COMMUNITY_PRICE_NOTE =
  "Prices are community-updated, logged by drinkers, not a live feed.";

// Shared relative-age core for freshness labels. Verb differs by layer:
// community drops say "logged", sourced observations say "observed".
// Returns "" for a missing/invalid ISO so the UI can skip the note. Future /
// clock-skew timestamps collapse to "just now" — never a negative age.
function formatAgeLabel(
  observedAt: string | number | null | undefined,
  verb: "logged" | "observed",
  now: Date,
): string {
  if (
    observedAt === null ||
    observedAt === undefined ||
    (typeof observedAt === "string" && observedAt.length === 0)
  ) {
    return "";
  }
  const then =
    typeof observedAt === "number" ? observedAt : Date.parse(observedAt);
  if (!Number.isFinite(then)) return "";
  const diffMs = now.getTime() - then;
  if (diffMs < 0) return `${verb} just now`;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return `${verb} just now`;
  if (mins < 60) return `${verb} ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${verb} ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${verb} ${days} ${days === 1 ? "day" : "days"} ago`;
}

// Pure formatter for a community observation timestamp → "logged 2h ago".
// Venue records use ISO strings; live map signals use epoch milliseconds.
// Unit-tested at the boundaries.
export function formatFreshness(
  observedAt: string | number | null | undefined,
  now: Date = new Date(),
): string {
  return formatAgeLabel(observedAt, "logged", now);
}

// Pure formatter for a sourced-price observedAt → "observed 2h ago".
// Same boundaries/guards as formatFreshness; only the verb differs so a
// first-party observation never reads as a community log.
export function formatObservedAt(iso: string | null | undefined, now: Date = new Date()): string {
  return formatAgeLabel(iso, "observed", now);
}

// The Pint Drop lane's trust gate — the drop-side twin of the community-price
// gate (lib/communityPrice.ts `drivesMap`), reusing its predicates and
// constants so "corroborated" means ONE thing across both price lanes.
//
// AGENTS.md pin law: "an uncorroborated report cannot reach either lane" (the
// pin's colour band and its printed figure). A lone Pint Drop used to reach
// both through mergeVenueDrops / usePintDrops.venueSignals; this gate closes
// that. What earns the map is the drop lane's best-corroborated in-window
// candidate:
// - only organic (non-demo) drops carrying a real price count;
// - only drops inside the community max-age window count — an aged report is a
//   record of a night, not evidence about tonight;
// - independence is counted on server-derived authority keys (a drinker
//   agreeing with themselves is still one report), with agreement inside the
//   shared tolerance of the candidate figure;
// - the best-backed candidate wins, so a lone fresh disagreement can neither
//   repaint the map nor un-paint an already-corroborated figure — the same
//   rule mapCandidateOf keeps for community submissions.
// Returns null when nothing on offer has earned the map. Ties keep the earlier
// (newest-first) drop, matching the store's ordering.
export function corroboratedPriceDrop<D extends SummaryDrop>(
  drops: readonly D[],
  now: number = Date.now(),
): D | null {
  const inWindow = drops.filter(
    (drop) =>
      drop.provenance !== "demo" &&
      typeof drop.priceGbp === "number" &&
      Number.isFinite(drop.priceGbp) &&
      isWithinMaxAge({ submittedAt: Date.parse(drop.createdAt) }, now),
  );
  if (inWindow.length < COMMUNITY_PRICE_CORROBORATION_THRESHOLD) return null;
  let best: D | null = null;
  let bestBackers = 0;
  for (const candidate of inWindow) {
    if (!candidate.authorityKey?.trim()) continue;
    const backers = new Set<string>();
    for (const other of inWindow) {
      const authorityKey = other.authorityKey?.trim();
      if (!authorityKey) continue;
      if (!agreesWithinTolerance(candidate.priceGbp as number, other.priceGbp as number)) {
        continue;
      }
      backers.add(authorityKey);
    }
    if (backers.size > bestBackers) {
      best = candidate;
      bestBackers = backers.size;
    }
  }
  return bestBackers >= COMMUNITY_PRICE_CORROBORATION_THRESHOLD ? best : null;
}

// The venues whose drop lane holds an in-window pint report that has NOT
// earned the map — the drop-side feeder for the provisional mark
// (provisionalCommunityPriceVenueIds seam). VISIBILITY without AUTHORITY: a
// first drop marks the pin as "someone reported here" while the colour band
// and printed figure wait for a second independent drinker.
export function provisionalPintDropVenueIds<D extends SummaryDrop>(
  dropsByVenueId: ReadonlyMap<string, readonly D[]>,
  now: number = Date.now(),
): Set<string> {
  const pending = new Set<string>();
  for (const [venueId, drops] of dropsByVenueId) {
    const inWindow = drops.some(
      (drop) =>
        drop.provenance !== "demo" &&
        typeof drop.priceGbp === "number" &&
        isWithinMaxAge({ submittedAt: Date.parse(drop.createdAt) }, now),
    );
    if (!inWindow) continue;
    // A corroborated lane is painting the pin already — nothing is pending.
    if (corroboratedPriceDrop(drops, now)) continue;
    pending.add(venueId);
  }
  return pending;
}

// Fold Pint Drops into the venue's DERIVED SUMMARY SIGNALS only — never into
// the editorial curation note. Rules:
// - an organic contributor price can update cheapestPrice/cheapestPint, but
//   ONLY once corroborated (corroboratedPriceDrop above) — a lone drop stays
//   on the venue sheet, dated, and never moves the map's price surfaces;
// - hasStory lights ONLY from a drop carrying a passed-down note — a bare
//   price log is not a story and must not boost heritage scoring;
// - "demo" seeds are display-only: they never move prices or story signals,
//   so seeded liveliness never masquerades as organic.
export function mergeVenueDrops<D extends SummaryDrop>(
  venues: Venue[],
  dropsByVenueId: Map<string, D[]>,
  now: number = Date.now(),
): Venue[] {
  if (dropsByVenueId.size === 0) return venues;
  return venues.map((venue) => {
    const organic = (dropsByVenueId.get(venue.id) ?? []).filter(
      (drop) => drop.provenance !== "demo",
    );
    if (organic.length === 0) return venue;

    const latestPriceDrop = corroboratedPriceDrop(organic, now);
    const contributorPrice = latestPriceDrop?.priceGbp ?? null;
    const cheapestPrice =
      contributorPrice === null
        ? venue.cheapestPrice
        : Math.min(venue.cheapestPrice ?? Number.POSITIVE_INFINITY, contributorPrice);

    return {
      ...venue,
      cheapestPrice,
      cheapestPint: latestPriceDrop?.drink || venue.cheapestPint,
      // Carry the live community price + its logged-at timestamp so the UI can
      // both show the override AND how fresh it is (formatFreshness).
      latestContributorPrice: contributorPrice,
      latestContributorAt: latestPriceDrop?.createdAt ?? null,
      hasStory:
        venue.hasStory || organic.some((drop) => drop.passedDownNote.trim().length > 0),
    };
  });
}

// `hasPintDrops` is a signal derived client-side from live Pint Drops (see
// usePintDrops.venueSignals), so it isn't on the pure Venue. Callers that want
// the requirePintDrops filter pass a lookup; without one it's a no-op predicate.
function hasSlimFlag(venue: Venue, pick: (hints: VenueFilterHints) => boolean): boolean {
  return venue.prices.length === 0 && venue.filterHints ? pick(venue.filterHints) : false;
}

function matchesVenueQuery(venue: Venue, query: string): boolean {
  if (!query) return true;
  const searchableFields = [
    venue.name,
    venue.address,
    venue.cheapestPint,
    venue.primaryBorough,
    ...venue.visibleBoroughs,
    ...venue.prices.map((price) => price.pint_name),
  ];
  if (searchableFields.some((field) => field.toLowerCase().includes(query))) return true;
  return hasSlimFlag(venue, (hints) => hints.searchText.includes(query));
}

function matchesVenueAmenities(venue: Venue, filters: Filters): boolean {
  const checks = [
    [filters.requireBeerGarden, venue.amenities.beerGarden, (hints: VenueFilterHints) => hints.amenities.beerGarden],
    [filters.requireNonAlcoholic, venue.amenities.nonAlcoholic, (hints: VenueFilterHints) => hints.amenities.nonAlcoholic],
    [filters.requireLiveSports, venue.amenities.liveSports, (hints: VenueFilterHints) => hints.amenities.liveSports],
    [filters.requireFood, venue.amenities.food, (hints: VenueFilterHints) => hints.amenities.food],
    [filters.requireCocktails, venue.amenities.cocktails, (hints: VenueFilterHints) => hints.amenities.cocktails],
  ] as const;
  return checks.every(([required, detailedValue, pickHint]) => {
    return !required || detailedValue || hasSlimFlag(venue, pickHint);
  });
}

function matchesVenueCuration(venue: Venue, filters: Filters): boolean {
  const matchesWater =
    !filters.requireWater ||
    Boolean(venue.curation.nearWater) ||
    hasSlimFlag(venue, (hints) => hints.curation.nearWater);
  const matchesHeritage =
    !filters.requireHeritage ||
    venue.hasStory ||
    hasSlimFlag(venue, (hints) => hints.curation.hasStory);
  return matchesWater && matchesHeritage;
}

function matchesCanonicalFilter(venue: Venue, canonicalOnly: boolean): boolean {
  return (
    !canonicalOnly ||
    venue.prices.some((price) => price.is_clean_canonical_app_row) ||
    hasSlimFlag(venue, (hints) => hints.canonical)
  );
}

function venueDrinkHaystack(venue: Venue): string {
  // Intentionally omit venue.name AND filterHints.searchText — the slim index
  // still puts pub_name into searchText for general map query, which would
  // false-positive drink brand matching (e.g. "Gordon" in "The Gordon Arms").
  const parts = [
    venue.cheapestPint,
    venue.description,
    ...venue.prices.map((price) => price.pint_name),
    ...venue.prices.map((price) => price.comment),
    ...venue.prices.map((price) => price.description),
  ];
  return parts.join(" ");
}

function venueDrinkNamesHaystack(venue: Venue): string {
  const slimDrinkText = venue.filterHints?.drinkText?.trim();
  return [
    slimDrinkText ?? "",
    venue.cheapestPint,
    ...venue.prices.map((price) => price.pint_name),
  ].join(" ");
}

function matchesDrinkCategory(venue: Venue, drinkCategory: string): boolean {
  const category = parseDrinkCategoryParam(drinkCategory);
  if (!category) return true;

  const hinted = venue.filterHints?.drinkCategories;
  if (Array.isArray(hinted) && hinted.some((c) => c === category)) return true;

  // Cocktail amenity is a strong positive signal for the cocktail lens.
  if (category === "cocktail") {
    if (venue.amenities.cocktails) return true;
    if (hasSlimFlag(venue, (hints) => hints.amenities.cocktails)) return true;
  }

  // Beer matches like every other category: hints above, else haystack tokens
  // (lager / ale / ipa / …) — never a universal pass on any priced row.
  return haystackMatchesCategory(venueDrinkHaystack(venue), category);
}

function matchesDrinkBrand(venue: Venue, drinkBrand: string): boolean {
  const needle = drinkBrand.trim();
  if (!needle) return true;
  const hit = findBrand(needle);
  // Unknown brand ids must not no-op — treat as no match.
  if (!hit) return false;

  const hinted = venue.filterHints?.drinkBrands;
  if (Array.isArray(hinted) && hinted.includes(hit.brand.id)) return true;

  return haystackMatchesBrand(venueDrinkHaystack(venue), hit.brand);
}

function matchesDrinkSubtype(
  venue: Venue,
  drinkSubtype: string,
  drinkCategory: string,
): boolean {
  const needle = drinkSubtype.trim();
  if (!needle) return true;
  // Unknown subtype ids must not no-op — treat as no match (same as brand).
  const subtype = parseDrinkSubtypeParam(needle);
  if (!subtype) return false;
  // A subtype only refines its own family. When the active category disagrees
  // (a stale chip, a hand-edited URL), the refinement is dropped rather than
  // silently filtering against the wrong parent.
  const category = parseDrinkCategoryParam(drinkCategory);
  if (category && category !== subtype.category) return true;

  const hinted = venue.filterHints?.drinkSubtypes;
  if (Array.isArray(hinted) && hinted.includes(subtype.id)) return true;

  // A subtype describes a drink product, not venue prose. Product names avoid
  // treating copy such as "dark timber" or "Japanese-inspired room" as menu
  // evidence while still covering both slim cheapest-pint and hydrated rows.
  const haystack = venueDrinkNamesHaystack(venue);
  if (haystackMatchesSubtype(haystack, subtype)) return true;
  // Brand knowledge closes the gap the text can't: "GUINNESS" is a stout
  // without ever saying so. Check every stocked brand rather than returning
  // the first recognized one, so a Guinness + Amstel pub matches both stout
  // and lager refinements.
  return haystackMatchesSubtypeBrand(haystack, subtype);
}

function matchesTopShelf(venue: Venue, topShelfOnly: boolean): boolean {
  if (!topShelfOnly) return true;
  if (venue.filterHints?.topShelf === true) return true;
  // "Vintage decor", an "aged building", or a "premium pub" are not premium
  // pours. Restrict text evidence to actual drink names.
  return haystackIsTopShelf(venueDrinkNamesHaystack(venue));
}

export function filterVenues(
  venues: Venue[],
  filters: Filters,
  hasPintDrops: (venueId: string) => boolean = () => false,
  /**
   * Open-now state for a venue id. Defaults to `"unknown"` so an unwired
   * caller never invents closures. Only `false` is dropped when openNow is on.
   */
  openNowState: (venueId: string) => boolean | "unknown" = () => "unknown",
): Venue[] {
  const query = filters.query.trim().toLowerCase();
  const drinkCategory = filters.drinkCategory?.trim() ?? "";
  const drinkBrand = filters.drinkBrand?.trim() ?? "";
  const drinkSubtype = filters.drinkSubtype?.trim() ?? "";
  const topShelfOnly = filters.topShelfOnly === true;
  const selectedCategory = parseDrinkCategoryParam(drinkCategory);
  const selectedSubtype = parseDrinkSubtypeParam(drinkSubtype);
  const subtypeRefinesCategory =
    selectedCategory !== null &&
    selectedSubtype?.category === selectedCategory;
  // "" / "all" → every zone; a concrete zone narrows to that fare zone only.
  const zoneSelection = parseZoneParam(filters.zone);
  return venues.filter((venue) => {
    // maxPrice is explicitly the maximum pint-price control. Cocktail and food
    // anchors use their own type-relative bands and must not be compared with
    // a pub pint's absolute price cap.
    const matchesPrice =
      (venue.kind !== undefined && venue.kind !== "pub") ||
      venue.cheapestPrice === null ||
      venue.cheapestPrice <= filters.maxPrice;

    const matchesPintDrops =
      !filters.requirePintDrops ||
      (isPubVenueKind(venue.kind) && hasPintDrops(venue.id));

    // Open now: known-closed drops; known-open and unknown both stay.
    const matchesOpenNow =
      !filters.openNow || openNowState(venue.id) !== false;

    // Accessible-venue filters: an unknown fact fails a positive filter, so
    // filtering to step-free shows only pubs KNOWN step-free (never guessed).
    const matchesAccessibility = matchesAccessibilityFilters(venue, {
      stepFree: filters.requireStepFree,
      accessibleToilet: filters.requireAccessibleToilet,
      seatedService: filters.requireSeatedService,
    });
    const matchesSubtype = matchesDrinkSubtype(
      venue,
      drinkSubtype,
      drinkCategory,
    );
    // Matching a valid subtype is stronger evidence for its own parent than a
    // broad category keyword. "GUINNESS" can prove stout even though its name
    // contains neither "beer" nor "stout".
    const matchesCategory =
      matchesDrinkCategory(venue, drinkCategory) ||
      (subtypeRefinesCategory && matchesSubtype);

    return (
      matchesVenueQuery(venue, query) &&
      matchesPrice &&
      matchesVenueAmenities(venue, filters) &&
      matchesVenueCuration(venue, filters) &&
      matchesCanonicalFilter(venue, filters.canonicalOnly) &&
      matchesPintDrops &&
      matchesOpenNow &&
      matchesAccessibility &&
      matchesCategory &&
      matchesDrinkBrand(venue, drinkBrand) &&
      matchesSubtype &&
      matchesTopShelf(venue, topShelfOnly) &&
      venueMatchesZone(venue.zone, zoneSelection)
    );
  });
}

export function distanceKm(a: Venue, b: Venue): number {
  // Thin adapter over the canonical great-circle helper (GeoJSON [lng, lat]).
  return haversineKm([a.longitude, a.latitude], [b.longitude, b.latitude]);
}

export function scoreVenue(
  venue: Venue,
  style: CrawlStyle,
  naLensPrices?: ReadonlyMap<string, MapLensPrice>,
): number {
  const price = venue.cheapestPrice ?? 8;
  const cheapness = Math.max(0, 10 - price);
  const amenityScore =
    Number(venue.amenities.beerGarden) * 1.5 +
    Number(venue.amenities.liveSports) +
    Number(venue.amenities.food) +
    Number(venue.amenities.cocktails) +
    Number(venue.amenities.liveMusic) +
    Number(venue.amenities.pubQuiz);
  const hasVenueContext = venue.description.length > 80 ? 1 : 0;
  const hasHeritage = venue.hasStory ? 2.5 : 0;
  const nearWater = venue.curation.nearWater ? 1.5 : 0;
  const writerPick = venue.curation.writerPick ? 5 : 0;
  const sourceTrust = venue.prices.some((priceItem) => priceItem.is_clean_canonical_app_row)
    ? 1
    : 0;

  if (style === "cheapest") return cheapness * 3 + sourceTrust;
  if (style === "beerGarden") return Number(venue.amenities.beerGarden) * 7 + cheapness;
  if (style === "sports") return Number(venue.amenities.liveSports) * 7 + cheapness;
  if (style === "heritage") return hasHeritage * 4 + nearWater * 2 + amenityScore + sourceTrust;
  if (style === "writerTrail") {
    return writerPick * 5 + hasHeritage * 3 + nearWater * 2 + hasVenueContext + cheapness + sourceTrust;
  }
  if (style === "dateNight") {
    return (
      Number(venue.amenities.cocktails) * 2 +
      Number(venue.amenities.food) * 2 +
      Number(venue.amenities.beerGarden) * 2 +
      (hasVenueContext + hasHeritage) * 2 +
      cheapness
    );
  }
  if (style === "noAlcoholFirst") {
    // A corroborated no-alcohol price is the same trust seam as pint pricing
    // (trustedNoAlcoholLensPrices), never a name-only amenity guess. A venue
    // with no corroborated price stays neutral - it never scores below a
    // venue this style has no evidence on either way.
    const naPrice = naLensPrices?.get(venue.id)?.priceGbp;
    const hasCorroboratedNaPrice = naPrice !== undefined;
    // Among NA-priced venues, rank on the NA figure itself - cheaper alcohol-
    // free lemonade beats dearer - and only fall back to pint cheapness as the
    // final tiebreak. The 10000x weight puts one penny of NA-price difference
    // ahead of the tiebreak's entire span (cheapness + sourceTrust tops out
    // near 11), so pint price can never outrank a real NA-price gap.
    const naCheapness = hasCorroboratedNaPrice ? Math.max(0, 10 - naPrice) : 0;
    return (hasCorroboratedNaPrice ? 7 : 0) + naCheapness * 10000 + cheapness + sourceTrust;
  }
  return cheapness * 1.5 + amenityScore + hasVenueContext + hasHeritage + nearWater + sourceTrust;
}

export function buildCrawlRoute(
  venues: Venue[],
  filters: Filters,
  naLensPrices?: ReadonlyMap<string, MapLensPrice>,
): Venue[] {
  if (!venues.length) return [];
  const sorted = [...venues]
    .sort(
      (a, b) =>
        scoreVenue(b, filters.crawlStyle, naLensPrices) -
        scoreVenue(a, filters.crawlStyle, naLensPrices),
    )
    .slice(0, 180);
  const maxLegKm = filters.routeWindow <= 15 ? 1.4 : filters.routeWindow <= 20 ? 1.9 : 2.8;

  const candidates = sorted.slice(0, 60).map((seed) => {
    const route: Venue[] = [seed];

    while (route.length < filters.stopCount) {
      const last = route[route.length - 1];
      const localCandidates = sorted
        .filter((venue) => !route.some((selected) => selected.id === venue.id))
        .map((venue) => {
          const distance = distanceKm(last, venue);
          return {
            venue,
            distance,
            score: scoreVenue(venue, filters.crawlStyle, naLensPrices) - distance * 2.4,
          };
        })
        .filter((candidate) => candidate.distance <= maxLegKm)
        .sort((a, b) => b.score - a.score);

      const next = localCandidates[0]?.venue;
      if (!next) break;
      route.push(next);
    }

    const summary = crawlSummary(route);
    const routeScore =
      route.reduce((sum, venue) => sum + scoreVenue(venue, filters.crawlStyle, naLensPrices), 0) -
      summary.distance * 3 +
      route.length * 4;

    return { route, routeScore };
  });

  return candidates.sort((a, b) => b.routeScore - a.routeScore)[0]?.route ?? [];
}

export function crawlSummary(route: Venue[]): { total: number; average: number; distance: number } {
  const prices = route
    .map((venue) => venue.cheapestPrice)
    .filter((price): price is number => typeof price === "number");
  const total = prices.reduce((sum, price) => sum + price, 0);
  const distance = route.reduce((sum, venue, index) => {
    const next = route[index + 1];
    return next ? sum + distanceKm(venue, next) : sum;
  }, 0);
  return {
    total,
    average: prices.length ? total / prices.length : 0,
    distance,
  };
}
