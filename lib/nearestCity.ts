// Resolve the nearest enabled city for a lat/lng (chooser / geolocation).

import {
  listEnabledCities,
  pointInCityBounds,
  type CityId,
} from "@/lib/cities";
import { haversineKm } from "@/lib/haversine";

/** Max distance (km) from a city map center when the point is outside all bounds. */
const NEAREST_CENTER_MAX_KM = 80;

function distanceToCityCenter(lat: number, lng: number, center: [number, number]): number {
  // City mapView.center and haversine both use [lng, lat].
  return haversineKm([lng, lat], center);
}

/**
 * Nearest enabled city for a coordinate.
 * Prefer a city whose bounds contain the point (closest center if several);
 * otherwise the closest city center within ~80km, else null.
 */
export function nearestEnabledCity(lat: number, lng: number): CityId | null {
  const enabled = listEnabledCities();
  if (enabled.length === 0) return null;

  const inBounds = enabled.filter((city) => pointInCityBounds(lat, lng, city));
  const candidates = inBounds.length > 0 ? inBounds : enabled;

  let bestId: CityId | null = null;
  let bestKm = Infinity;

  for (const city of candidates) {
    const km = distanceToCityCenter(lat, lng, city.mapView.center);
    if (km < bestKm) {
      bestKm = km;
      bestId = city.id;
    }
  }

  if (inBounds.length > 0) return bestId;
  if (bestId != null && bestKm <= NEAREST_CENTER_MAX_KM) return bestId;
  return null;
}
