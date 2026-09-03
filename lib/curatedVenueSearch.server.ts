import "server-only";

// Name search over the CURATED venue index, in one place.
//
// It was written inside `lib/wantedResolve.server.ts` and is now shared, because
// a second surface that wants "which pub did you mean" is a second matcher the
// moment it is copied: a Wanted paste and a pub shared into a message must land
// on the same pub for the same words, or the two surfaces are quietly disagreeing
// about what the index says.
//
// The index reads the slim pack with `fs`, so this is server-only. A browser
// gets these hits through an API response, never by importing this file.

import { normaliseUkPlaceQuery } from "@/lib/ukPlaceSearch";
import { getVenueIndex } from "@/lib/venueIndex";

/** The shortest query worth matching. One letter matches half of London. */
export const CURATED_VENUE_SEARCH_MIN_QUERY = 2;

export type CuratedVenueHit = {
  id: string;
  name: string;
  /** The pub's own borough. Empty when the index does not record one. */
  area: string;
};

/**
 * Three tiers, best first: an exact name, a name (or one of its words) that
 * starts with the query, then a name that merely contains it. Ties break on the
 * name so two runs of the same query cannot order two pubs differently.
 */
function matchTier(hay: string, query: string): number | null {
  if (!hay) return null;
  if (hay === query) return 0;
  if (hay.startsWith(query) || hay.split(" ").some((word) => word.startsWith(query))) {
    return 1;
  }
  if (query.length >= CURATED_VENUE_SEARCH_MIN_QUERY && hay.includes(query)) return 2;
  return null;
}

export async function searchCuratedVenues(
  rawQuery: string,
  limit: number,
): Promise<CuratedVenueHit[]> {
  const query = normaliseUkPlaceQuery(rawQuery);
  if (query.length < CURATED_VENUE_SEARCH_MIN_QUERY || limit <= 0) return [];
  const index = await getVenueIndex();
  const scored: { tier: number; hit: CuratedVenueHit }[] = [];
  for (const [id, venue] of index) {
    const name = typeof venue.name === "string" ? venue.name : "";
    const tier = matchTier(normaliseUkPlaceQuery(name), query);
    if (tier === null) continue;
    scored.push({
      tier,
      hit: { id, name, area: typeof venue.borough === "string" ? venue.borough : "" },
    });
  }
  scored.sort((left, right) => {
    if (left.tier !== right.tier) return left.tier - right.tier;
    return left.hit.name.localeCompare(right.hit.name, "en-GB");
  });
  return scored.slice(0, limit).map((row) => row.hit);
}
