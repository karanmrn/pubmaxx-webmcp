// Nearest locality from the UK place index — locate fallback outside curated cities.

import { haversineKm } from "@/lib/haversine";
import type { UkPlace } from "@/lib/ukPlaceSearch";

/** Cap how far a "near me" place may be before we refuse (honest scarcity). */
export const NEAREST_UK_PLACE_MAX_KM = 120;

/**
 * Closest place in the index within maxKm, or null.
 * Pure: places must already be loaded (chooser / map search own the fetch).
 */
export function nearestUkPlace(
  lat: number,
  lng: number,
  places: readonly UkPlace[],
  maxKm: number = NEAREST_UK_PLACE_MAX_KM,
): UkPlace | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || places.length === 0) {
    return null;
  }
  let best: UkPlace | null = null;
  let bestKm = Infinity;
  for (const place of places) {
    const km = haversineKm([lng, lat], [place.lng, place.lat]);
    if (km < bestKm) {
      bestKm = km;
      best = place;
    }
  }
  if (!best || bestKm > maxKm) return null;
  return best;
}
