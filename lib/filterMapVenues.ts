// Map pin filtering for PubMap. Slim pins (prices: []) must stay visible through
// filters whose evidence exists only after detail hydrates.

import { filterVenues, type Filters, type Venue } from "@/lib/venues";

/**
 * Split venues into slim (no price rows yet) vs hydrated, and apply the right
 * filter cohort. Slim pins keep filters backed by slim hints or live signals.
 */
export function filterMapVenues(
  venues: readonly Venue[],
  filters: Filters,
  hasPintDrops: (venueId: string) => boolean,
  openNowState: (venueId: string) => boolean | "unknown" = () => "unknown",
): Venue[] {
  const slimPinFilters: Filters = {
    ...filters,
    canonicalOnly: false,
    requireBeerGarden: false,
    requireNonAlcoholic: false,
    requireLiveSports: false,
    requireWater: false,
    requireHeritage: false,
    requireStepFree: false,
    requireAccessibleToilet: false,
    requireSeatedService: false,
    // openNow stays on for slim pins: match uses name+coords, which slim rows have.
  };

  const slim: Venue[] = [];
  const hydrated: Venue[] = [];
  for (const venue of venues) {
    // Slim pins are prices: [] — filterHints are still present on London slim
    // rows, so do NOT require !filterHints (that dead-ended the bypass).
    if (venue.prices.length === 0) slim.push(venue);
    else hydrated.push(venue);
  }

  return [
    ...filterVenues(slim, slimPinFilters, hasPintDrops, openNowState),
    ...filterVenues(hydrated, filters, hasPintDrops, openNowState),
  ];
}

/** Keep a deep-linked / selected venue on the canvas even if filters exclude it. */
export function withForcedVenue(
  filtered: readonly Venue[],
  allById: ReadonlyMap<string, Venue>,
  forcedId: string | null | undefined,
): Venue[] {
  const id = forcedId?.trim();
  if (!id) return [...filtered];
  if (filtered.some((venue) => venue.id === id)) return [...filtered];
  const forced = allById.get(id);
  if (!forced) return [...filtered];
  return [...filtered, forced];
}
