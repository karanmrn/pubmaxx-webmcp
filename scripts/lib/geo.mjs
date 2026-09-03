const EARTH_RADIUS_M = 6_371_000;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

/** Great-circle distance in metres between two latitude/longitude points. */
export function haversineMeters(aLat, aLng, bLat, bLng) {
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

/** Great-circle distance in kilometres between two latitude/longitude points. */
export function haversineKm(aLat, aLng, bLat, bLng) {
  return haversineMeters(aLat, aLng, bLat, bLng) / 1_000;
}

/** Great-circle distance in kilometres for longitude-first scalar coordinates. */
export function haversineKmLngLat(aLng, aLat, bLng, bLat) {
  return haversineKm(aLat, aLng, bLat, bLng);
}
