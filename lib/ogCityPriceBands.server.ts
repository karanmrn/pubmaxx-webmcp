import "server-only";

// Server-only reader for the /map OG share card's wave composition. Turns one
// city's real, map-authoritative pint prices into cheap/middle/dear band
// counts — never a decorative distribution. A pub's band starts from its
// curated cheapestPrice (the same priceBucket() the pin itself uses); a
// corroborated, in-window community beer report overrides it, exactly like the
// pin colour does. Non-pub anchors (bars, food, restaurants) never count as
// pint bands, and a pub with no priced figure at all is left out entirely
// rather than guessed into a band.
//
// Reads the same per-city slim venue files as lib/cityRivalry.ts, so it rides
// on the "venue-index" pack declared in lib/venueIndexTracing.mjs rather than
// needing a pack of its own.

import { readFile } from "node:fs/promises";

import { getCity, type CityId } from "@/lib/cities";
import { slimVenuesDiskPath } from "@/lib/cityRivalry";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import {
  drivesMap,
  mapCandidateOf,
  priceBucket,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { readCommunityPriceCategoryIndex } from "@/lib/communityPriceStore";
import type { PriceBandCounts } from "@/lib/ogPriceWaves";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";

/** The slim-venue fields this reader needs — deliberately narrower than SlimVenue. */
export type OgCityPriceBandVenue = {
  id: string;
  kind?: VenueKind;
  cheapestPrice: number | null;
};

function isOgCityPriceBandVenue(value: unknown): value is OgCityPriceBandVenue {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string") return false;
  if (row.cheapestPrice !== null && typeof row.cheapestPrice !== "number")
    return false;
  return true;
}

/**
 * Pure band count over one city's pub venues plus current community beer
 * reports. Exported so tests can prove the three authority rules without a
 * filesystem: pub baseline uses the shared priceBucket, a corroborated
 * in-window beer row overrides its venue, and a stale or uncorroborated row
 * cannot move a count.
 */
export function countOgCityPriceBands(
  venues: readonly OgCityPriceBandVenue[],
  communityRows: readonly CommunityPrice[],
  now: number = Date.now(),
): PriceBandCounts {
  const overrideBandByVenue = new Map<string, number>();
  for (const row of communityRows) {
    if (row.drinkCategory !== "beer") continue;
    const candidate = mapCandidateOf(row);
    if (!drivesMap(candidate, now)) continue;
    overrideBandByVenue.set(row.venueId, priceBucket(candidate.priceGbp));
  }

  const counts: [number, number, number] = [0, 0, 0];
  for (const venue of venues) {
    if (!isPubVenueKind(venue.kind)) continue;
    const band = overrideBandByVenue.get(venue.id) ?? priceBucket(venue.cheapestPrice);
    if (band === 0 || band === 1 || band === 2) counts[band] += 1;
  }
  return counts;
}

/**
 * Map-authoritative band counts for one city, read fresh on every OG card
 * request. Never throws: a missing or malformed slim pack, or a degraded
 * community read, both fall back to an honest empty count rather than an
 * invented one.
 */
export async function readOgCityPriceBandCounts(
  cityId: CityId,
  now: number = Date.now(),
): Promise<PriceBandCounts> {
  const city = getCity(cityId);
  let venues: OgCityPriceBandVenue[] = [];
  try {
    const file = slimVenuesDiskPath(city.slimVenuesPath);
    const raw = await readFile(/* turbopackIgnore: true */ file, "utf8");
    const rows = rowsFromSlimPayload(JSON.parse(raw));
    if (rows) {
      venues = rows.filter(isOgCityPriceBandVenue);
    }
  } catch {
    venues = [];
  }
  if (venues.length === 0) return [0, 0, 0];

  let communityRows: CommunityPrice[] = [];
  try {
    const index = await readCommunityPriceCategoryIndex(["beer"], now);
    communityRows = index.prices;
  } catch {
    communityRows = [];
  }

  return countOgCityPriceBands(venues, communityRows, now);
}
