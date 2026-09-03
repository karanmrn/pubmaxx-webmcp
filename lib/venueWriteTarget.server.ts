import "server-only";

// The ONE resolver every community write runs its venue id through before a
// row is stored.
//
// A write keyed on an id nobody resolved is a row no surface can ever read
// back: an alias splits one pub's contributions across two keys, and an id the
// index does not hold seeds a venue that does not exist. So a caller's id is
// canonicalised first, and an unknown one is refused with the house error.
//
// The UK base layer is admitted by its own id index, because those pubs are
// streamed per viewport and are absent from the curated venue index.
//
// `pubsOnly` is the narrower question a PRICE lane asks: a figure printed as a
// pint price may only come from a pub kind. A crowd occupancy reading is about
// seats, and the venue sheet offers it on every kind, so that lane does not
// narrow.

import { getUkBaseIdIndex } from "@/lib/ukBaseIndex";
import { isUkBaseId } from "@/lib/ukBasePubs";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export type VenueWriteTarget =
  | { ok: true; venueId: string }
  | { ok: false; status: 400 | 503; error: string };

const UNKNOWN_VENUE = "Pick a venue from the map.";
const VENUES_UNAVAILABLE =
  "Venue list is unavailable right now, try again shortly.";

export async function resolveWritableVenueId(
  venueId: string,
  opts?: { pubsOnly?: boolean },
): Promise<VenueWriteTarget> {
  if (isUkBaseId(venueId)) {
    const ukBaseIndex = await getUkBaseIdIndex();
    if (ukBaseIndex.status === "unavailable") {
      return { ok: false, status: 503, error: VENUES_UNAVAILABLE };
    }
    return ukBaseIndex.ids.has(venueId)
      ? { ok: true, venueId }
      : { ok: false, status: 400, error: UNKNOWN_VENUE };
  }

  const venueLookup = await lookupCanonicalVenue(venueId);
  if (venueLookup.status === "unavailable") {
    return { ok: false, status: 503, error: VENUES_UNAVAILABLE };
  }
  if (venueLookup.status !== "found") {
    return { ok: false, status: 400, error: UNKNOWN_VENUE };
  }
  if (opts?.pubsOnly && !isPubVenueKind(venueLookup.venue.kind)) {
    return { ok: false, status: 400, error: UNKNOWN_VENUE };
  }
  return { ok: true, venueId: venueLookup.canonicalId };
}
