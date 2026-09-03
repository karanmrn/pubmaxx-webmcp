import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { DRINK_BRANDS, haystackMatchesBrand } from "@/lib/drinkBrands";
import { namedLegacyPintPriceSource } from "@/lib/drinks";
import {
  PRICED_LANDING_PUBLICATION_FLOORS,
  publishablePricedRows,
  type PricedLandingCandidate,
  type PricedLandingRow,
} from "@/lib/pricedLanding";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue, VenuePrice } from "@/lib/venues";

export const DRINK_BRAND_LANDING_PUBLICATION_FLOOR =
  PRICED_LANDING_PUBLICATION_FLOORS["drink-brand"];

export type DrinkBrandLanding = {
  slug: string;
  brandLabel: string;
  collectedAt: string;
  totalPricedVenues: number;
  rows: [PricedLandingRow, ...PricedLandingRow[]];
};

function comparePriceRows(left: VenuePrice, right: VenuePrice): number {
  return (
    (typeof left.price_gbp === "number" ? left.price_gbp : Number.POSITIVE_INFINITY) -
      (typeof right.price_gbp === "number" ? right.price_gbp : Number.POSITIVE_INFINITY) ||
    left.app_price_id.localeCompare(right.app_price_id) ||
    left.pint_name.localeCompare(right.pint_name)
  );
}

function validMatchingPriceRows(venue: Venue, brand: (typeof DRINK_BRANDS.beer)[number]): VenuePrice[] {
  return venue.prices.filter(
    (row) =>
      typeof row.pint_name === "string" &&
      typeof row.price_gbp === "number" &&
      Number.isFinite(row.price_gbp) &&
      row.price_gbp > 0 &&
      haystackMatchesBrand(row.pint_name, brand),
  );
}

/** Select the one exact, cheapest matching beer-brand row owned by a venue. */
export function selectDrinkBrandPriceForVenue(
  venue: Venue,
  brand: (typeof DRINK_BRANDS.beer)[number],
): VenuePrice | null {
  return validMatchingPriceRows(venue, brand).sort(comparePriceRows)[0] ?? null;
}

/** One venue's candidate row for a brand, or nothing when it has no such price. */
export function drinkBrandCandidateForVenue(
  venue: Venue,
  brand: (typeof DRINK_BRANDS.beer)[number],
): PricedLandingCandidate | null {
  if (!isPubVenueKind(venue.kind)) return null;
  const selected = selectDrinkBrandPriceForVenue(venue, brand);
  if (!selected || typeof selected.price_gbp !== "number") return null;
  return {
    venueId: venue.id,
    venueName: venue.name,
    borough: venue.primaryBorough,
    pintName: selected.pint_name,
    priceGbp: selected.price_gbp,
    publisher: namedLegacyPintPriceSource(selected),
  };
}

export function buildDrinkBrandLanding(
  slug: string,
  venues: readonly Venue[],
): DrinkBrandLanding | null {
  const brand = DRINK_BRANDS.beer.find((candidate) => candidate.id === slug);
  if (!brand) return null;

  const candidates = venues.flatMap((venue) => {
    const candidate = drinkBrandCandidateForVenue(venue, brand);
    return candidate ? [candidate] : [];
  });

  const published = publishablePricedRows("drink-brand", candidates);
  if (!published) return null;

  return {
    slug: brand.id,
    brandLabel: brand.label,
    collectedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
    totalPricedVenues: published.totalPricedVenues,
    rows: published.rows,
  };
}

export function listDrinkBrandLandings(venues: readonly Venue[]): DrinkBrandLanding[] {
  return DRINK_BRANDS.beer.flatMap((brand) => {
    const landing = buildDrinkBrandLanding(brand.id, venues);
    return landing ? [landing] : [];
  });
}
