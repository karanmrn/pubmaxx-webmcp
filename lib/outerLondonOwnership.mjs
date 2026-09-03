import {
  haversineMeters,
  namesLikelySamePub,
  normalizeVenueIdentityName,
  stableVenueIdFromKey,
  venueGroupingKey,
} from "../scripts/lib/venueCanonicalization.mjs";

const CURATED_MATCH_RADIUS_M = 150;

export function outerLondonOwnerForPub(pub, curatedVenues) {
  const curatedIds = new Set(curatedVenues.map((venue) => venue.id));
  const exactId = stableVenueIdFromKey(
    venueGroupingKey({
      pub_name: String(pub?.name ?? ""),
      address: String(pub?.address ?? ""),
      latitude: Number(pub?.lat),
      longitude: Number(pub?.lng),
    }),
  );
  if (curatedIds.has(exactId)) return exactId;

  const normalizedName = normalizeVenueIdentityName(pub?.name);
  let bestId = null;
  let bestDistance = Infinity;
  for (const venue of curatedVenues) {
    const distance = haversineMeters(pub.lat, pub.lng, venue.lat, venue.lng);
    if (distance > CURATED_MATCH_RADIUS_M || distance >= bestDistance) continue;
    if (!namesLikelySamePub(normalizedName, normalizeVenueIdentityName(venue.name))) {
      continue;
    }
    bestId = venue.id;
    bestDistance = distance;
  }
  return bestId;
}
