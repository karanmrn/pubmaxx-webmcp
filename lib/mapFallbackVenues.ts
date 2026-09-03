import type { VenueKind } from "@/lib/venues";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export type MapFallbackVenue = {
  id: string;
  kind?: VenueKind;
  cheapestPrice: number | null;
};

export function selectMapFallbackPubs<T extends MapFallbackVenue>(
  venues: readonly T[],
  limit: number,
): T[] {
  return venues
    .filter((venue) => isPubVenueKind(venue.kind))
    .sort((a, b) => (a.cheapestPrice ?? Infinity) - (b.cheapestPrice ?? Infinity))
    .slice(0, limit);
}
