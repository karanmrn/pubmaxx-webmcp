import "server-only";

// Server helper: seed-borough corroborated beer counts for Pint Index status.
// Never invents a zero when the community-price read failed.

import { canonicalBorough, slugifyBorough } from "@/lib/boroughs";
import { drivesMap } from "@/lib/communityPrice";
import { readCommunityPriceCategoryIndex } from "@/lib/communityPriceStore";
import {
  SEED_BOROUGH_CAMPAIGN,
  SEED_BOROUGH_MONTHLY_TARGET,
  type BoroughCoverageInput,
} from "@/lib/boroughCoverageStatus";
import type { Venue } from "@/lib/venues";

/**
 * Build seed-borough coverage rows from the beer category index + venue
 * borough map. Degraded reads keep status="degraded" with count 0 so copy
 * never claims the borough is empty.
 */
export async function loadSeedBoroughCoverage(
  venues: readonly Venue[],
  now: number = Date.now(),
): Promise<BoroughCoverageInput[]> {
  const venueBorough = new Map<string, string>();
  for (const venue of venues) {
    if (!venue.id) continue;
    const name = canonicalBorough(venue);
    if (!name) continue;
    venueBorough.set(venue.id, slugifyBorough(name));
  }

  let index;
  try {
    index = await readCommunityPriceCategoryIndex(["beer"], now);
  } catch {
    return SEED_BOROUGH_CAMPAIGN.map((seed) => ({
      slug: seed.slug,
      name: seed.name,
      mapQuery: seed.mapQuery,
      corroboratedPintCount: 0,
      target: SEED_BOROUGH_MONTHLY_TARGET,
      status: "degraded" as const,
    }));
  }

  const counts = new Map<string, number>();
  for (const price of index.prices) {
    if (price.drinkCategory !== "beer") continue;
    if (!drivesMap(price, now)) continue;
    const slug = venueBorough.get(price.venueId);
    if (!slug) continue;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }

  const status = index.degraded
    ? ("degraded" as const)
    : index.truncated
      ? ("partial" as const)
      : ("ready" as const);

  return SEED_BOROUGH_CAMPAIGN.map((seed) => ({
    slug: seed.slug,
    name: seed.name,
    mapQuery: seed.mapQuery,
    corroboratedPintCount: index.degraded ? 0 : (counts.get(seed.slug) ?? 0),
    target: SEED_BOROUGH_MONTHLY_TARGET,
    status,
  }));
}
