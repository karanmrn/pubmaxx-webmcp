import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { DRINK_BRANDS } from "@/lib/drinkBrands";
import { drinkBrandCandidateForVenue } from "@/lib/drinkBrandLanding";
import { NIGHT_AREAS, type NightArea, type NightAreaSlug } from "@/lib/nightAreas";
import {
  PRICED_LANDING_PUBLICATION_FLOORS,
  assignVenueToNightArea,
  nightAreaPublishesPrices,
  publishablePricedRows,
  type PricedLandingCandidate,
  type PricedLandingRow,
} from "@/lib/pricedLanding";
import type { Venue } from "@/lib/venues";

export const DRINK_BRAND_AREA_PUBLICATION_FLOOR =
  PRICED_LANDING_PUBLICATION_FLOORS["drink-brand-area"];

export type DrinkBrandAreaLanding = {
  areaSlug: NightAreaSlug;
  areaName: string;
  brandSlug: string;
  brandLabel: string;
  collectedAt: string;
  totalPricedVenues: number;
  rows: [PricedLandingRow, ...PricedLandingRow[]];
};

function areaBrandCandidates(
  area: NightArea,
  brand: (typeof DRINK_BRANDS.beer)[number],
  venues: readonly Venue[],
  areas: readonly NightArea[],
): PricedLandingCandidate[] {
  return venues.flatMap((venue) => {
    if (assignVenueToNightArea(venue, areas)?.slug !== area.slug) return [];
    const candidate = drinkBrandCandidateForVenue(venue, brand);
    return candidate ? [candidate] : [];
  });
}

export function buildDrinkBrandAreaLanding(
  areaSlug: string,
  brandSlug: string,
  venues: readonly Venue[],
  areas: readonly NightArea[] = NIGHT_AREAS,
): DrinkBrandAreaLanding | null {
  const area = areas.find((candidate) => candidate.slug === areaSlug);
  const brand = DRINK_BRANDS.beer.find((candidate) => candidate.id === brandSlug);
  if (!area || !brand || !nightAreaPublishesPrices(area)) return null;

  const published = publishablePricedRows(
    "drink-brand-area",
    areaBrandCandidates(area, brand, venues, areas),
  );
  if (!published) return null;

  return {
    areaSlug: area.slug,
    areaName: area.name,
    brandSlug: brand.id,
    brandLabel: brand.label,
    collectedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
    totalPricedVenues: published.totalPricedVenues,
    rows: published.rows,
  };
}

function areaBrandLanding(
  area: NightArea,
  brandSlug: string,
  venues: readonly Venue[],
  areas: readonly NightArea[],
): DrinkBrandAreaLanding[] {
  const landing = buildDrinkBrandAreaLanding(area.slug, brandSlug, venues, areas);
  return landing ? [landing] : [];
}

/**
 * The publishing pairs for ONE brand, in area order.
 *
 * The brand page lists its own sibling areas, and building every brand's pairs
 * to discard all but one sweeps the whole priced-venue list once per brand on
 * every request to a dynamic route.
 */
export function listDrinkBrandAreaLandingsForBrand(
  brandSlug: string,
  venues: readonly Venue[],
  areas: readonly NightArea[] = NIGHT_AREAS,
): DrinkBrandAreaLanding[] {
  return areas.flatMap((area) => areaBrandLanding(area, brandSlug, venues, areas));
}

export function listDrinkBrandAreaLandings(
  venues: readonly Venue[],
  areas: readonly NightArea[] = NIGHT_AREAS,
): DrinkBrandAreaLanding[] {
  return areas.flatMap((area) =>
    DRINK_BRANDS.beer.flatMap((brand) =>
      areaBrandLanding(area, brand.id, venues, areas),
    ),
  );
}
