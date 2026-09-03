import { haversineKm } from "@/lib/haversine";
import type { Venue } from "@/lib/venues";

// The n venue ids closest to (lat, lng), nearest first. Deterministic, pure,
// safe on empty input; n is clamped to [0, venues.length].
export function nearestVenueIds(
  lat: number,
  lng: number,
  venues: Venue[],
  n: number,
): string[] {
  const take = Math.max(0, Math.min(Math.floor(n), venues.length));
  if (take === 0) return [];
  return venues
    .map((venue) => ({
      id: venue.id,
      km: haversineKm([lng, lat], [venue.longitude, venue.latitude]),
    }))
    .sort((a, b) => a.km - b.km)
    .slice(0, take)
    .map((entry) => entry.id);
}

/**
 * Pubs worth framing around a granted user location.
 *
 * Prefer every pub inside the local radius, capped so a dense city centre does
 * not turn back into an unreadable all-city cloud. Sparse areas are topped up
 * with the nearest pubs so the camera always has something useful to show.
 */
export function nearbyVenuesForMap(
  lat: number,
  lng: number,
  venues: Venue[],
  options: { radiusKm?: number; minCount?: number; maxCount?: number } = {},
): Venue[] {
  const radiusKm = Math.max(0.25, options.radiusKm ?? 3);
  const minCount = Math.max(1, Math.floor(options.minCount ?? 6));
  const maxCount = Math.max(minCount, Math.floor(options.maxCount ?? 40));
  const ranked = venues
    .map((venue) => ({
      venue,
      km: haversineKm([lng, lat], [venue.longitude, venue.latitude]),
    }))
    .sort((a, b) => a.km - b.km);
  const withinRadius = ranked.filter((entry) => entry.km <= radiusKm);
  const count = Math.min(maxCount, Math.max(minCount, withinRadius.length));
  return ranked.slice(0, count).map((entry) => entry.venue);
}
