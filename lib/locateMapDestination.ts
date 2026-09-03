// Resolve a locate fix to a map destination: curated city first, else uncovered place.

import { getCity, type CityId } from "@/lib/cities";
import { cityMapShareUrl } from "@/lib/cityShare";
import { coarsenViewerPoint } from "@/lib/geo";
import { nearestEnabledCity } from "@/lib/nearestCity";
import { nearestUkPlace } from "@/lib/nearestUkPlace";
import {
  ukPlaceMapUrl,
  type UkPlace,
  type UkPlaceMapArrival,
} from "@/lib/ukPlaceSearch";

export type LocateMapDestination =
  | {
      kind: "city";
      cityId: CityId;
      href: string;
      label: string;
    }
  | {
      kind: "place";
      arrival: UkPlaceMapArrival;
      href: string;
    }
  | { kind: "none" };

/**
 * Prefer an enabled city within the usual near-city window; otherwise the
 * nearest places.json locality (camera on the reader's fix, name from the
 * index). Returns none when both miss — the caller keeps an honest dead-end.
 */
export function resolveLocateMapDestination(
  lat: number,
  lng: number,
  places: readonly UkPlace[] = [],
): LocateMapDestination {
  const cityId = nearestEnabledCity(lat, lng);
  if (cityId) {
    const city = getCity(cityId);
    return {
      kind: "city",
      cityId,
      href: cityMapShareUrl(cityId),
      label: city.displayName,
    };
  }
  const place = nearestUkPlace(lat, lng, places);
  if (!place) return { kind: "none" };
  // Centre near the reader, name the nearest known place — same arrival shape
  // as choose-city search, so UkPlaceArrivalBanner / server resolve stay
  // shared. The arrival lands in a URL (server logs, history, shareable), so
  // the reader's fix MUST cross the one viewer-coordinate egress seam
  // (lib/geo.ts) first — a raw building-level fix never leaves the browser.
  const coarse = coarsenViewerPoint({ lat, lng });
  const arrival: UkPlaceMapArrival = {
    name: place.name,
    lat: coarse.lat,
    lng: coarse.lng,
  };
  return {
    kind: "place",
    arrival,
    href: ukPlaceMapUrl(arrival),
  };
}
