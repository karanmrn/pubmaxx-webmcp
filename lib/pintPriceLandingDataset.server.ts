import "server-only";

import { getPricedVenues } from "@/lib/venuePriceIndex";
import type { Venue } from "@/lib/venues";

// The governed landing pages read the SAME per-instance grouped index every
// other priced surface reads (#1049 moved /pubs onto it for this reason). A
// second loader over `public/data/pint_prices_app_dataset.json` would re-parse
// 6.7 MB on every page render, metadata read, OG card and sitemap request.

/** Degrades to an empty list, so a page says "no rows" rather than 500ing. */
export async function loadPintPriceLandingVenues(): Promise<Venue[]> {
  return getPricedVenues();
}

/**
 * The sitemap's read, which FAILS LOUD. A silently shrunken sitemap is a
 * deindexing hazard: a 200 that dropped every URL reads to a crawler as pages
 * removed, while a 500 leaves the last-known-good sitemap in place.
 */
export async function loadPintPriceLandingVenuesOrThrow(): Promise<Venue[]> {
  const venues = await loadPintPriceLandingVenues();
  if (venues.length === 0) {
    throw new Error(
      "sitemap: grouped venue set is empty - refusing to publish a truncated sitemap",
    );
  }
  return venues;
}
