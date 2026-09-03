// What the map may PAINT while a Near me answer is on screen.

/** The venue ids a Near me answer named, or null when none is held. */
export type NearbyMapMembership = { venueIds: readonly string[] } | null;

/**
 * A Near me answer is a MEMBERSHIP, not a highlight: while one is held the map
 * paints those venues and nothing else, so it describes the screen only for as
 * long as the reader is still looking at where they are. The moment they move
 * to another area on purpose the caller drops the membership - the honest end
 * of the claim - rather than this function trying to widen it back, because a
 * set of twenty pins around a point says nothing about anywhere else.
 *
 * With no membership the venues come back unchanged, by reference, so a caller
 * memoising on this answer does not re-derive the whole painted map for it.
 */
export function venuesInNearbyMembership<T extends { id: string }>(
  venues: T[],
  membership: NearbyMapMembership,
): T[] {
  if (!membership) return venues;
  const ids = new Set(membership.venueIds);
  return venues.filter((venue) => ids.has(venue.id));
}
