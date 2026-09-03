import type { VenueKind } from "@/lib/venues";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export type MapPintDropVenue = {
  id: string;
  kind?: VenueKind;
};

export function filterMapPintDropEntries<T>(
  venues: readonly MapPintDropVenue[],
  entries: Map<string, T>,
): Map<string, T> {
  if (entries.size === 0) return entries;
  const pubIds = new Set(
    venues.filter((venue) => isPubVenueKind(venue.kind)).map((venue) => venue.id),
  );
  const filtered = new Map<string, T>();
  for (const [venueId, value] of entries) {
    if (pubIds.has(venueId)) filtered.set(venueId, value);
  }
  return filtered.size === entries.size ? entries : filtered;
}
