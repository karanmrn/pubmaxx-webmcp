import { NIGHT_PATCHES } from "@/lib/nightPatches";
import { haversineKm } from "@/lib/haversine";
import type { BoroughBoundaryCollection } from "@/lib/londonBoroughClassifier";
import { boroughNameForPoint } from "@/lib/londonBoroughPoint.mjs";
import londonBoroughBoundaries from "@/data/london_boroughs_simplified.json";

// Split out of lib/nightPatches.ts on purpose. Answering "which patch is this
// coordinate in" needs the 70 KB Greater London borough outline; naming the
// eight patches does not. Kept in one module they travelled together, so every
// client that only wanted the patch VOCABULARY (the map shell reaches it
// through lib/planningIntent) shipped and parsed the polygons too. Import this
// module only where a real coordinate has to be classified.

const GREATER_LONDON_BOUNDARIES =
  londonBoroughBoundaries as BoroughBoundaryCollection;

/**
 * Resolve a usable London coordinate to the nearest supported night patch.
 * Invalid and out-of-city coordinates deliberately return null so callers do
 * not silently turn a failed location lookup into a misleading area choice.
 */
export function nearestNightPatch(
  lat: number,
  lng: number,
): (typeof NIGHT_PATCHES)[number] | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!boroughNameForPoint(lat, lng, GREATER_LONDON_BOUNDARIES)) return null;

  let nearest: (typeof NIGHT_PATCHES)[number] | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const patch of NIGHT_PATCHES) {
    const distance = haversineKm([lng, lat], [patch.lng, patch.lat]);
    if (distance < nearestDistance) {
      nearest = patch;
      nearestDistance = distance;
    }
  }
  return nearest;
}
