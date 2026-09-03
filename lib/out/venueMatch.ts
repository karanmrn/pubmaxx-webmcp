// Request-time venue matching for /api/out.
//
// The build-time refresh matches a provider row to a pub through
// scripts/whatson/resolveVenueId.mjs, and until now that was the ONLY place it
// happened: a live Ticketmaster row reached /out with no venueId, so every one
// of them was dropped from the pub list and the page printed a bare status line
// over nothing. This module runs the SAME matcher at request time, fed an
// index built from the slim venue rows the server already holds, so a live gig
// at The Lexington lands on the same pin the CLI would have put it on.
//
// The matcher is the refresh's own: normalised name PLUS an independent
// confirmation. The slim index carries no address, so the only confirmation
// available here is proximity - a name match whose coordinates sit further than
// OUT_VENUE_MATCH_PROXIMITY_METERS from the pub, or a row with no coordinates
// at all, resolves to nothing. Never invent, never guess on ambiguity.
//
// This module is PURE. The cached loader over the slim index is
// lib/out/venueMatch.server.ts.

import { normalizeVenueIdentityName } from "@/scripts/lib/venueCanonicalization.mjs";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import {
  resolveVenueId,
  VENUE_MATCH_PROXIMITY_METERS,
  type VenueResolverCandidate,
  type VenueResolverIndex,
} from "@/scripts/whatson/resolveVenueId.mjs";
import type { VenueRef } from "@/lib/venueIndex";
import type { WhatsOnRow } from "@/lib/whatsOn";

/**
 * The proximity floor the refresh matcher confirms a name match with. Restated
 * here for the reader and pinned by the test; the number itself is applied by
 * resolveVenueId.
 */
export const OUT_VENUE_MATCH_PROXIMITY_METERS = VENUE_MATCH_PROXIMITY_METERS;

/**
 * Whether the request-time match RAN. A read of the slim index that could not
 * run leaves every live row unmatched, and that is not the same finding as
 * "these places are not listed" - the notice on /out words the two apart.
 */
export type OutVenueMatchStatus = "ready" | "unavailable";

export type OutVenueMatchIndex = VenueResolverIndex & {
  /** Canonical Venue ids accepted by pub-only reads. Built once with the matcher. */
  venueIds: ReadonlySet<string>;
};

/**
 * Build the resolver index from slim venue refs.
 *
 * The exact-key lane stays empty on purpose: that key needs an address, which
 * the slim index does not carry, so every match here is the conservative
 * name-plus-proximity lane.
 */
export function buildOutVenueMatchIndex(venues: Iterable<VenueRef>): OutVenueMatchIndex {
  const byNormalizedName = new Map<string, VenueResolverCandidate[]>();
  const venueIds = new Set<string>();
  for (const venue of venues) {
    const normName = normalizeVenueIdentityName(venue.name);
    if (!normName) continue;
    const candidate: VenueResolverCandidate = {
      venueId: venue.id,
      name: venue.name,
      address: "",
      lat: Number.isFinite(venue.lat) ? venue.lat : null,
      lng: Number.isFinite(venue.lng) ? venue.lng : null,
      postcode: null,
    };
    const held = byNormalizedName.get(normName);
    if (held) held.push(candidate);
    else byNormalizedName.set(normName, [candidate]);
    const venueId = canonicalOutVenueId(venue.id);
    if (venueId) venueIds.add(venueId);
  }
  return { exactByKey: new Map(), byNormalizedName, venueIds };
}

/** The venue one row lands on, or null when the matcher would be guessing. */
export function matchOutRowVenue(row: WhatsOnRow, index: OutVenueMatchIndex): string | null {
  const candidates = index.byNormalizedName.get(normalizeVenueIdentityName(row.placeName));
  if (candidates?.length !== 1) return null;
  return resolveVenueId(
    {
      name: row.placeName,
      lat: typeof row.lat === "number" ? row.lat : null,
      lng: typeof row.lng === "number" ? row.lng : null,
    },
    index,
  );
}

/** Whether an existing venue id belongs to this resolver's accepted index. */
export function isOutVenueId(
  index: OutVenueMatchIndex,
  venueId: string | null | undefined,
): boolean {
  const canonicalId = canonicalOutVenueId(venueId);
  return canonicalId !== null && index.venueIds.has(canonicalId);
}

export type AttachOutVenuesResult = {
  rows: WhatsOnRow[];
  /** Rows that gained a venueId here, at request time. */
  matchedAtRequest: number;
  /** Rows that still carry no venueId after the match. */
  unmatched: number;
};

/**
 * Attach a venue to every row that carries none.
 *
 * A row the refresh already matched is left exactly as it is: the CLI had the
 * address and the postcode to confirm with, so its answer is the stronger one.
 */
export function attachOutVenues(
  rows: readonly WhatsOnRow[],
  index: OutVenueMatchIndex,
  mayMatch: (row: WhatsOnRow) => boolean = () => true,
): AttachOutVenuesResult {
  let matchedAtRequest = 0;
  let unmatched = 0;
  const out = rows.map((row) => {
    if (canonicalOutVenueId(row.venueId)) return row;
    if (!mayMatch(row)) {
      unmatched += 1;
      return row;
    }
    const venueId = matchOutRowVenue(row, index);
    if (!venueId) {
      unmatched += 1;
      return row;
    }
    matchedAtRequest += 1;
    return { ...row, venueId };
  });
  return { rows: out, matchedAtRequest, unmatched };
}
