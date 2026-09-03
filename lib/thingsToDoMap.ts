// Client-safe helpers for CityMCP `things_to_do` map pins / deep-links.
// Keep this free of Node-only imports so browser components can use it.

import { cityAwareMapPath } from "@/lib/cityMapHref";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";

const LONDON_CITY_ID = "london";

/** Humanise a kind slug (`food_drink` → `Food drink`). */
export function labelForKind(kind?: string): string | null {
  if (!kind) return null;
  const normalised = kind.replace(/[_-]+/g, " ").trim();
  if (!normalised) return null;
  return normalised.charAt(0).toUpperCase() + normalised.slice(1);
}

/**
 * Deep-link to the London map centred on the opportunity venue.
 * Returns null when lat/lng are missing or non-finite.
 */
export function opportunityMapHref(op: ThingsToDoOpportunity): string | null {
  const loc = op.place?.location;
  if (
    !loc ||
    typeof loc.lat !== "number" ||
    typeof loc.lng !== "number" ||
    !Number.isFinite(loc.lat) ||
    !Number.isFinite(loc.lng)
  ) {
    return null;
  }
  const params = new URLSearchParams({
    lat: loc.lat.toFixed(5),
    lng: loc.lng.toFixed(5),
    zoom: "15",
  });
  if (op.place?.name) params.set("q", op.place.name);
  return cityAwareMapPath(LONDON_CITY_ID, params);
}

function hasFiniteLocation(
  loc: { lat: number; lng: number } | undefined,
): loc is { lat: number; lng: number } {
  return (
    !!loc &&
    typeof loc.lat === "number" &&
    typeof loc.lng === "number" &&
    Number.isFinite(loc.lat) &&
    Number.isFinite(loc.lng)
  );
}

/** Point FeatureCollection for opportunities that already have coordinates. */
export function opportunitiesToGeoJSON(
  ops: ThingsToDoOpportunity[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const op of ops) {
    const loc = op.place?.location;
    if (!hasFiniteLocation(loc)) continue;
    features.push({
      type: "Feature",
      properties: {
        title: op.title,
        kind: op.kind ?? null,
        kindLabel: labelForKind(op.kind),
        price: op.price ?? null,
        placeId: op.place?.id ?? null,
        placeName: op.place?.name ?? null,
        area: op.place?.area ?? op.areas?.[0] ?? null,
        sourceUrl: op.source?.url ?? null,
        sourceLabel: op.source?.label ?? null,
      },
      geometry: {
        type: "Point",
        coordinates: [loc.lng, loc.lat],
      },
    });
  }
  return { type: "FeatureCollection", features };
}
