import "server-only";

import { DEFAULT_CITY_ID, listEnabledCities, type CityId } from "@/lib/cities";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import { cultureWaypointPois } from "@/lib/cultureCrawl.server";
import { classifyOpenMeetingPoint, firstPlanStop } from "@/lib/openSocialCrew";
import type { OutOpenPlan, OutOpenPlanMeetingPoint } from "@/lib/out";
import type { PlanStopDTO } from "@/lib/plan";
import { planStateResult } from "@/lib/planStore";
import { lookupCanonicalVenue } from "@/lib/venueIndex";

/**
 * A resolved meeting point plus the city it puts the plan in. Plans store no
 * city of their own, so the city is DERIVED here from Stop 1: a listed venue
 * through the slim index, a named public place through the ambient POI layer.
 * A meeting point that cannot be resolved names no city at all rather than
 * falling back to London.
 */
export type OpenMeetingPoint = OutOpenPlanMeetingPoint & { cityId: CityId };

export type OpenMeetingPointResolution =
  | { ok: true; meetingPoint: OpenMeetingPoint }
  | { ok: false; reason: "refused" | "unavailable" };

type CulturePoiRow = {
  name: string;
  lng: number;
  lat: number;
  cityId: CityId;
};

type CulturePoiLookup = ReadonlyMap<string, CulturePoiRow>;

function buildCulturePoiLookup(): CulturePoiLookup {
  const lookup = new Map<string, CulturePoiRow>();
  for (const city of listEnabledCities()) {
    for (const poi of cultureWaypointPois(city.id)) {
      lookup.set(poi.id, {
        name: poi.name,
        lng: poi.coordinates[0],
        lat: poi.coordinates[1],
        cityId: city.id,
      });
    }
  }
  return lookup;
}

/**
 * A read that could NOT run is `unavailable`, never `refused`: a host must not
 * be told a listed pub is not listed because a slim pack failed to load.
 */
export async function resolveOpenMeetingPoint(
  venueId: string | null | undefined,
  poiLookup?: CulturePoiLookup,
): Promise<OpenMeetingPointResolution> {
  const classified = classifyOpenMeetingPoint(venueId);
  if (classified.kind === "refused") return { ok: false, reason: "refused" };
  if (classified.kind === "place") {
    const poi = (poiLookup ?? buildCulturePoiLookup()).get(classified.placeId);
    if (!poi) return { ok: false, reason: "refused" };
    return {
      ok: true,
      meetingPoint: {
        kind: "place",
        name: poi.name,
        lng: poi.lng,
        lat: poi.lat,
        cityId: poi.cityId,
      },
    };
  }
  const lookup = await lookupCanonicalVenue(classified.venueId);
  if (lookup.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (lookup.status === "unknown") return { ok: false, reason: "refused" };
  return {
    ok: true,
    meetingPoint: {
      kind: "venue",
      name: lookup.venue.name,
      lng: lookup.venue.lng,
      lat: lookup.venue.lat,
      cityId: cityIdFromVenueId(lookup.canonicalId) ?? DEFAULT_CITY_ID,
    },
  };
}

export async function resolveOpenMeetingFromStops(
  stops: readonly PlanStopDTO[] | null | undefined,
  poiLookup?: CulturePoiLookup,
): Promise<OpenMeetingPointResolution> {
  return resolveOpenMeetingPoint(firstPlanStop(stops)?.venueId, poiLookup);
}

export async function resolveOpenPlanMeetingPoint(
  planId: string,
): Promise<OpenMeetingPointResolution> {
  const lookup = await planStateResult(planId);
  if (!lookup.ok) return { ok: false, reason: "unavailable" };
  if (!lookup.plan) return { ok: false, reason: "refused" };
  return resolveOpenMeetingFromStops(lookup.plan.stops);
}

export type AttachOpenPlanMeetingPoints = {
  status: "ready" | "degraded";
  plans: OutOpenPlan[];
};

/**
 * Attach the meeting point each Out card renders. City narrowing happens in
 * list_open_social_crews; this lane only resolves Stop 1 for rows the RPC
 * already returned. A row whose read could NOT run degrades the answer.
 */
export async function attachOpenPlanMeetingPoints(
  rows: readonly OutOpenPlan[],
): Promise<AttachOpenPlanMeetingPoints> {
  const poiLookup = buildCulturePoiLookup();
  const plans: OutOpenPlan[] = [];
  let degraded = false;
  for (const row of rows) {
    const resolution = await resolveOpenMeetingPoint(row.stopVenueId, poiLookup);
    if (!resolution.ok) {
      if (resolution.reason === "unavailable") degraded = true;
      continue;
    }
    const { cityId, ...meetingPoint } = resolution.meetingPoint;
    void cityId;
    plans.push({ ...row, meetingPoint });
  }
  return { status: degraded ? "degraded" : "ready", plans };
}
