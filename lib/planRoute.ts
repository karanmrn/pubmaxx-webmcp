import { CITIES, type CityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { cultureWaypointPois } from "@/lib/cultureCrawl.server";
import { classifyOpenMeetingPoint, OPEN_PLAN_PLACE_PREFIX } from "@/lib/openSocialCrew";
import type { PlanStopDTO } from "@/lib/plan";
import { isPlanStopCount } from "@/lib/planStopCount";

export type PlanStopTarget = { venueId: string; venueName: string };

/**
 * The ONE answer to "may a Plan hold this Stop id, and what is it called".
 * Two id shapes resolve, both against server-owned data: a listed venue from
 * the Venue Dataset, and a `place:<poi id>` meeting point from the ambient POI
 * layer. Free text resolves to nothing, so it can never be stored.
 *
 * Creation is city-scoped and route replacement is not (a Plan persists no
 * city), so the caller says which cities may answer; the rule itself is the
 * same either way.
 */
export async function planStopResolver(
  cityId?: CityId,
): Promise<(raw: unknown) => PlanStopTarget | null> {
  const cities = cityId ? [cityId] : (Object.keys(CITIES) as CityId[]);
  const venueLists = await Promise.all(cities.map((city) => loadConciergeVenues(city)));
  const venuesById = new Map(venueLists.flat().map((venue) => [venue.id, venue]));
  const placesById = new Map(
    cities.flatMap((city) =>
      cultureWaypointPois(city).map((poi) => [poi.id, poi] as const),
    ),
  );
  return (raw: unknown): PlanStopTarget | null => {
    const value = raw && typeof raw === "object"
      ? (raw as Record<string, unknown>).venueId
      : raw;
    if (typeof value !== "string") return null;
    const classified = classifyOpenMeetingPoint(value);
    if (classified.kind === "refused") return null;
    if (classified.kind === "place") {
      const poi = placesById.get(classified.placeId);
      return poi
        ? { venueId: `${OPEN_PLAN_PLACE_PREFIX}${poi.id}`, venueName: poi.name }
        : null;
    }
    const venue = venuesById.get(classified.venueId);
    return venue ? { venueId: venue.id, venueName: venue.name } : null;
  };
}

/**
 * Rebuild a proposed route from the server-owned data. A Plan does not persist
 * a city yet, so replacement accepts only ids that occur in a shipped city
 * dataset (or that city's POI layer) and always returns their canonical
 * display names.
 */
export async function canonicalPlanRoute(raw: unknown): Promise<PlanStopDTO[] | null> {
  if (!Array.isArray(raw) || !isPlanStopCount(raw.length)) return null;
  const resolve = await planStopResolver();
  const stops = raw.map((value, position) => {
    const target = resolve(value);
    return target ? { ...target, position } : null;
  });
  if (stops.some((stop) => stop === null)) return null;
  const resolved = stops as PlanStopDTO[];
  const ids = resolved.map((stop) => stop.venueId);
  return new Set(ids).size === ids.length ? resolved : null;
}
