import {
  drivesMap,
  mapCandidateOf,
  NO_ALCOHOL_DRINK_CATEGORIES,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { CATEGORY_META, type DrinkCategory } from "@/lib/drinks";
import { compactVenueAnchor } from "@/lib/venueAnchorPresentation";
import type { Filters, Venue } from "@/lib/venues";

export type MapExperienceLens = "all" | "no-alcohol" | "food";

/** Shareable map query key for {@link parseMapExperienceLensParam}. */
export const MAP_EXPERIENCE_LENS_URL_PARAM = "experience";

export function parseMapExperienceLensParam(
  value: string | null | undefined,
): MapExperienceLens | null {
  const candidate = value?.trim().toLowerCase();
  if (candidate === "food" || candidate === "no-alcohol" || candidate === "all") {
    return candidate;
  }
  return null;
}
export type NoAlcoholDrinkCategory = Extract<
  DrinkCategory,
  "soft-drink" | "alcohol-free"
>;

// The lensable-category list lives with the taxonomy it narrows (lib/drinks.ts)
// so the URL and session guards can share it without importing the map.
export {
  isMapLensDrinkCategory,
  MAP_LENS_DRINK_CATEGORIES,
} from "@/lib/drinks";

export type MapLensPrice = {
  venueId: string;
  category: DrinkCategory | null;
  categoryLabel: string;
  priceGbp: number;
  submittedAt?: number;
  observedAt?: string;
  source: "community" | "sourced-anchor";
  sourceUrl?: string;
};

/** Pint and brand refinements cannot answer a category-price lens. */
export function filtersForDrinkPriceLens(
  filters: Filters,
  category: DrinkCategory | null,
): Filters {
  if (category === null || category === "beer") return filters;
  return {
    ...filters,
    maxPrice: Number.POSITIVE_INFINITY,
    drinkCategory: "",
    drinkBrand: "",
    drinkSubtype: "",
    topShelfOnly: false,
    requireCocktails: false,
  };
}

/**
 * Trusted map price for one selected drink category per venue. The map
 * candidate, corroboration floor and max-age window are the same gates beer
 * already uses. Keeping this outside VenueSignal prevents a whisky figure from
 * ever becoming pint authority.
 */
export function trustedDrinkLensPrices(
  rowsByVenue: ReadonlyMap<string, readonly CommunityPrice[]>,
  category: DrinkCategory,
  now: number = Date.now(),
): Map<string, MapLensPrice> {
  const out = new Map<string, MapLensPrice>();
  for (const [venueId, rows] of rowsByVenue) {
    const row = rows.find((candidate) => candidate.drinkCategory === category);
    if (!row) continue;
    const candidate = mapCandidateOf(row);
    if (!drivesMap(candidate, now)) continue;
    out.set(venueId, {
      venueId,
      category,
      categoryLabel: CATEGORY_META[category].label,
      priceGbp: candidate.priceGbp,
      submittedAt: candidate.submittedAt,
      source: "community",
    });
  }
  return out;
}

/**
 * Pint and drink refinements are invisible while an experience view owns the
 * map, so they must also be inert. Place search and general venue facets remain.
 */
export function filtersForExperienceLens(
  filters: Filters,
  lens: MapExperienceLens,
): Filters {
  if (lens === "all") return filters;
  return {
    ...filters,
    maxPrice: Number.POSITIVE_INFINITY,
    zone: "",
    drinkCategory: "",
    drinkBrand: "",
    drinkSubtype: "",
    topShelfOnly: false,
    requireCocktails: false,
    requirePintDrops: false,
  };
}

function noAlcoholCategory(
  value: DrinkCategory,
): value is NoAlcoholDrinkCategory {
  return (NO_ALCOHOL_DRINK_CATEGORIES as readonly DrinkCategory[]).includes(
    value,
  );
}

/**
 * One name per category, taken from the same table the submit chips read, so a
 * price logged under "Soft drinks" comes back saying "Soft drinks" everywhere.
 */
function noAlcoholLabel(category: NoAlcoholDrinkCategory): string {
  return CATEGORY_META[category].label;
}

/**
 * Best trusted no-alcohol price per venue. Every category has to earn the same
 * corroboration and age gates as beer, but the result stays outside pint
 * VenueSignal state.
 */
export function trustedNoAlcoholLensPrices(
  rowsByVenue: ReadonlyMap<string, readonly CommunityPrice[]>,
  now: number = Date.now(),
): Map<string, MapLensPrice> {
  const out = new Map<string, MapLensPrice>();
  for (const [venueId, rows] of rowsByVenue) {
    let best: MapLensPrice | null = null;
    for (const row of rows) {
      if (!noAlcoholCategory(row.drinkCategory)) continue;
      const candidate = mapCandidateOf(row);
      if (!drivesMap(candidate, now)) continue;
      const next: MapLensPrice = {
        venueId,
        category: row.drinkCategory,
        categoryLabel: noAlcoholLabel(row.drinkCategory),
        priceGbp: candidate.priceGbp,
        submittedAt: candidate.submittedAt,
        source: "community",
      };
      if (
        !best ||
        next.priceGbp < best.priceGbp ||
        (next.priceGbp === best.priceGbp &&
          (next.submittedAt ?? 0) > (best.submittedAt ?? 0))
      ) {
        best = next;
      }
    }
    if (best) out.set(venueId, best);
  }
  return out;
}

function isFoodKind(venue: Venue): boolean {
  return venue.kind === "food" || venue.kind === "restaurant";
}

function hasKnownNoAlcoholService(venue: Venue): boolean {
  return (
    venue.amenities.nonAlcoholic ||
    venue.filterHints?.amenities.nonAlcoholic === true
  );
}

export function filterVenuesForExperienceLens(
  venues: readonly Venue[],
  lens: MapExperienceLens,
  noAlcoholPrices: ReadonlyMap<string, MapLensPrice>,
): Venue[] {
  if (lens === "all") return [...venues];
  if (lens === "food") return venues.filter(isFoodKind);
  return venues.filter(
    (venue) =>
      isFoodKind(venue) ||
      hasKnownNoAlcoholService(venue) ||
      noAlcoholPrices.has(venue.id),
  );
}

function sourcedAnchorPrice(venue: Venue): MapLensPrice | null {
  const anchor = compactVenueAnchor(venue);
  const price = venue.cheapestPrice;
  if (
    !anchor ||
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }
  return {
    venueId: venue.id,
    category: null,
    categoryLabel: anchor.label,
    priceGbp: price,
    observedAt: venue.anchorObservedAt,
    source: "sourced-anchor",
    sourceUrl: anchor.sourceUrl,
  };
}

export function lensPriceForVenue(
  venue: Venue,
  lens: MapExperienceLens,
  noAlcoholPrices: ReadonlyMap<string, MapLensPrice>,
): MapLensPrice | null {
  if (lens === "all") return null;
  if (lens === "no-alcohol") {
    const community = noAlcoholPrices.get(venue.id);
    if (community) return community;
  }
  return isFoodKind(venue) ? sourcedAnchorPrice(venue) : null;
}

export function lensPricesForVenues(
  venues: readonly Venue[],
  lens: MapExperienceLens,
  noAlcoholPrices: ReadonlyMap<string, MapLensPrice>,
): Map<string, MapLensPrice> {
  const prices = new Map<string, MapLensPrice>();
  for (const venue of venues) {
    const price = lensPriceForVenue(venue, lens, noAlcoholPrices);
    if (price) prices.set(venue.id, price);
  }
  return prices;
}

/**
 * "We could not check" and "we checked part of it" are two different findings,
 * and no surface may merge them: a partial read has already painted trusted
 * figures, so borrowing the failure sentence would call the prices on the map
 * unchecked, while a failed read painted nothing and must never read as a
 * complete "none logged here". Every cross-venue category index reports on this
 * one scale, so a second lens cannot invent a quieter one.
 */
export type CategoryPriceIndexStatus =
  | "idle"
  | "loading"
  | "ready"
  | "partial"
  | "degraded";

export type NoAlcoholIndexStatus = CategoryPriceIndexStatus;

/**
 * The same scale for ONE pub's own price read. It cannot be `partial` - a
 * venue's rows arrive whole or not at all - but the other three findings are
 * exactly as separable: a read still in flight, a read that failed, and a read
 * that answered with nothing are three different things to tell a reader, and
 * only the last one is a fact about the pub.
 */
export type VenuePriceReadStatus = Exclude<CategoryPriceIndexStatus, "partial">;

/**
 * The one sentence a selected-drink surface adds when its index did not answer
 * completely. `null` means the index is complete and the figures speak for
 * themselves; anything else must be shown rather than swallowed, because an
 * empty map under a failed read is not evidence of an empty city.
 */
export function drinkLensCoverageNote(
  drinkNoun: string,
  status: CategoryPriceIndexStatus,
): string | null {
  if (status === "idle" || status === "loading") {
    return `Checking ${drinkNoun} prices across the map.`;
  }
  if (status === "degraded") {
    return `We could not read the ${drinkNoun} prices just now, so none are shown yet.`;
  }
  if (status === "partial") {
    return `Read from part of the ${drinkNoun} prices, so some are still missing.`;
  }
  return null;
}

/**
 * What ONE row says when it has no figure. A row is read on its own - in a
 * screen reader it is often read without the note above it - so an index that
 * failed may not leave the row claiming nothing was ever logged here.
 */
export function drinkLensUnknownRowLabel(
  drinkNoun: string,
  status: CategoryPriceIndexStatus,
): string {
  if (status === "degraded") return `${drinkNoun} price could not be read`;
  if (status === "idle" || status === "loading") {
    return `${drinkNoun} price not read yet`;
  }
  if (status === "partial") return `no ${drinkNoun} price in what we read`;
  return `no ${drinkNoun} price logged`;
}

/** The same finding where a sentence starts. One owner for the capital. */
export function drinkLensUnknownSentence(
  drinkNoun: string,
  status: CategoryPriceIndexStatus,
): string {
  const label = drinkLensUnknownRowLabel(drinkNoun, status);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * What the no-alcohol lens is called INSIDE a sentence. Its display label is
 * already a negative ("No-alcohol"), and "no no-alcohol price logged" buries
 * the fact the reader wants: this pub has none on record.
 */
export const NO_ALCOHOL_LENS_PRICE_NOUN = "alcohol-free or soft drink";

/**
 * What a selected-drink map lens is called INSIDE a sentence. Display labels
 * can be plural menu-section names ("Soft drinks", "Cocktails", "Shots"); the
 * empty-state helpers need the drink itself. Coffee falls out of CATEGORY_META
 * as "coffee" with no special case. Never return NO_ALCOHOL_LENS_PRICE_NOUN
 * here: that noun is only for the experience lens that joins two categories.
 */
export function drinkLensPriceNoun(category: DrinkCategory): string {
  switch (category) {
    case "cocktail":
      return "cocktail";
    case "soft-drink":
      return "soft drink";
    case "shot":
      return "shot";
    case "alcohol-free":
      // "no alcohol-free price logged" buries the pub's own fact the same way
      // the experience lens does; name the drink positively.
      return "alcohol-free drink";
    default:
      return CATEGORY_META[category].label.toLowerCase();
  }
}

/**
 * Empty / unread / failed copy for ONE pub under a drink lens. Shares the row
 * helpers' three findings: "none logged here" is only offered after a ready
 * read, and never borrows the no-alcohol experience noun for a coffee lens.
 */
export function drinkLensEmptyVenueNote(
  drinkNoun: string,
  status: VenuePriceReadStatus,
): string {
  if (status === "ready") {
    return `${drinkLensUnknownSentence(drinkNoun, status)} here yet.`;
  }
  if (status === "degraded") {
    return `We could not read this pub's ${drinkNoun} prices just now.`;
  }
  return `Checking ${drinkNoun} prices logged here.`;
}

export function experienceLensSummary(
  lens: MapExperienceLens,
  noAlcoholPriceCount: number,
  sourcedFoodPriceCount: number,
  indexStatus: NoAlcoholIndexStatus,
): string {
  if (lens === "all") return "";
  if (lens === "food") {
    if (sourcedFoodPriceCount === 0) {
      return "Food venues shown. No sourced menu prices in this view yet.";
    }
    return `${sourcedFoodPriceCount} sourced menu price${
      sourcedFoodPriceCount === 1 ? "" : "s"
    } shown.`;
  }
  // Every branch below names the lens with the one shared noun. The lens
  // control sits beside the map while the venue list and its rows are open, so
  // three orderings of the same two drinks read as three different lenses.
  const noun = NO_ALCOHOL_LENS_PRICE_NOUN;
  if (indexStatus === "loading" || indexStatus === "idle") {
    return `Checking ${noun} prices. Food venues are already shown.`;
  }
  if (indexStatus === "degraded") {
    return `Could not check ${noun} prices right now. Food venues still show sourced menu prices.`;
  }
  const plural = noAlcoholPriceCount === 1 ? "" : "s";
  if (indexStatus === "partial") {
    if (noAlcoholPriceCount === 0) {
      return `We read part of the ${noun} prices and none of them are here. Food venues still show sourced menu prices.`;
    }
    return `${noAlcoholPriceCount} ${noun} price${plural} shown, read from part of the list. Food venues also show sourced menu prices.`;
  }
  if (noAlcoholPriceCount === 0) {
    return `No ${noun} prices logged here yet. Food venues still show sourced menu prices.`;
  }
  return `${noAlcoholPriceCount} ${noun} price${plural} shown. Food venues also show sourced menu prices.`;
}
