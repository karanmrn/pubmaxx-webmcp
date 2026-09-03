// Great-circle (haversine) distance in kilometres between two [lng, lat] points.
//
// One shared implementation for every "nearest" feature on the map — nearest
// story pubs (lib/landmarks), nearest pubs to a point (lib/nearby), and the
// coming "last pint near your station" card. Coordinates follow the app's
// [lng, lat] convention (GeoJSON order), the same order lib/landmarks and
// lib/pois use, so callers pass venue coords as [venue.longitude, venue.latitude].
export function haversineKm(a: [number, number], b: [number, number]): number {
  const earthRadiusKm = 6371;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
