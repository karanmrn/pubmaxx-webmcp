import "server-only";

// Server side of the Culture Crawl waypoint: the ambient POI layer, read once
// on the plan generation path.
//
// The layer is imported STATICALLY, the way this route already imports its
// weather and night-signal snapshots, so Next traces the file into the deployed
// function. Never build this path at request time: a route that assembles a
// data path is only in the lambda when it is declared (lib/venueIndexTracing),
// and a plan that silently lost its POI file would answer "nothing near this
// route" for every outing in London.

import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import {
  buildCultureOpener,
  type CultureOpenerDTO,
} from "@/lib/cultureCrawl";
import { normalizePois, type Poi } from "@/lib/pois";
import londonPoiData from "@/public/data/london_pois.json";

let londonPois: Poi[] | null = null;

/**
 * The POI layer for a city. Only London ships one, so every other city gets an
 * empty layer and therefore no waypoint, rather than a London dot on a plan
 * two hundred miles away.
 */
export function cultureWaypointPois(cityId: CityId): readonly Poi[] {
  if (cityId !== DEFAULT_CITY_ID) return [];
  londonPois ??= normalizePois(londonPoiData);
  return londonPois;
}

/**
 * The opener fields for one generated route. It returns the whole response
 * fragment rather than a nullable value so an ordinary plan keeps a response
 * with no `cultureOpener` key at all, not one holding an empty answer.
 */
export function planCultureOpenerFields(input: {
  query: unknown;
  cityId: CityId;
  stops: readonly { lat: number; lng: number }[];
}): { cultureOpener?: CultureOpenerDTO } {
  const opener = buildCultureOpener({
    query: input.query,
    pois: cultureWaypointPois(input.cityId),
    origin: input.stops[0] ?? null,
  });
  return opener ? { cultureOpener: opener } : {};
}
