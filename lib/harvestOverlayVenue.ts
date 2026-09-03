import "server-only";

import { canonicalOsmId } from "@/lib/harvestFold";
import { type VenueRef, venueOsmIds } from "@/lib/venueIndex";
import { lookupCanonicalVenueWithOsm } from "@/lib/venueIndexOsm";

export type HarvestOverlayVenueResolution =
  | { status: "resolved"; venueId: string; venueIds: string[]; venue?: VenueRef }
  | { status: "unknown" }
  | { status: "unavailable" };

export async function resolveHarvestOverlayVenue(
  venueId: string,
): Promise<HarvestOverlayVenueResolution> {
  const osmId = canonicalOsmId(venueId);
  if (osmId) return { status: "resolved", venueId: osmId, venueIds: [osmId] };

  const lookup = await lookupCanonicalVenueWithOsm(venueId);
  if (lookup.status === "unavailable") return { status: "unavailable" };
  if (lookup.status === "unknown") return { status: "unknown" };
  const venueIds = venueOsmIds(lookup.venue);
  if (venueIds.length === 0) return { status: "unknown" };
  return { status: "resolved", venueId: venueIds[0], venueIds, venue: lookup.venue };
}
