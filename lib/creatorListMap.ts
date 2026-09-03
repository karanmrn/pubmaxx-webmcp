import { encodeCrawl } from "@/lib/crawlUrl";
import { initialFilters } from "@/lib/venues";

type CreatorListMapVenue = {
  venueId: string;
  venueMapUrl: string;
};

/**
 * Build one Map handoff for a public creator list. Stable de-duplication keeps
 * the creator's first occurrence order. Every list hydrates the existing
 * ordered build contract and selects its first venue.
 */
export function creatorListMapHref(
  venues: readonly CreatorListMapVenue[],
): string | null {
  const unique: CreatorListMapVenue[] = [];
  const seen = new Set<string>();

  for (const venue of venues) {
    const venueId = venue.venueId.trim();
    if (!venueId || seen.has(venueId)) continue;
    seen.add(venueId);
    unique.push({ ...venue, venueId });
  }

  if (unique.length === 0) return null;
  const venueIds = unique.map((venue) => venue.venueId);
  return `/map?${encodeCrawl({
    mode: "build",
    filters: initialFilters,
    builtIds: venueIds,
    selectedVenueId: venueIds[0]!,
  })}`;
}
