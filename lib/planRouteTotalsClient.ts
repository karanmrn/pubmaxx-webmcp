// Client-side upgrade path for generated plan walk totals: straight-line first,
// then optional routed distances from GET /api/walk-route. Fail-soft throughout.

import type { PlanRouteTotals } from "@/lib/planIntelligence";
import {
  buildRouteLegs,
  formatRouteTotal,
  withRoutedDistances,
  type RouteLegsSummary,
} from "@/lib/routeLegs";
import { discardBody } from "@/lib/responseBody";
import { stopsParam, type LngLat } from "@/lib/routeMiniMap";
import type { Venue } from "@/lib/venues";
import type { WalkLegDistance } from "@/lib/walkRoute";

export function planRouteTotalsFallbackLabel(totals: PlanRouteTotals): string {
  return `${totals.estimatedWalkingMinutes} min walk total · ${totals.straightLineWalkingKm.toFixed(1)} km, straight-line`;
}

export function venuesForStops(
  stopIds: readonly string[],
  venuesById?: ReadonlyMap<string, Venue>,
): Venue[] | null {
  if (!venuesById || stopIds.length < 2) return null;
  const venues: Venue[] = [];
  for (const id of stopIds) {
    const venue = venuesById.get(id);
    if (
      !venue
      || typeof venue.latitude !== "number"
      || typeof venue.longitude !== "number"
      || !Number.isFinite(venue.latitude)
      || !Number.isFinite(venue.longitude)
    ) {
      return null;
    }
    venues.push(venue);
  }
  return venues;
}

export function routedKmByFromIndex(legs: readonly WalkLegDistance[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const leg of legs) {
    if (leg.source === "ors" && leg.distanceKm > 0) out.set(leg.fromIndex, leg.distanceKm);
  }
  return out;
}

export function upgradeRouteSummary(
  straight: RouteLegsSummary,
  legs: readonly WalkLegDistance[],
): RouteLegsSummary {
  const routed = routedKmByFromIndex(legs);
  if (routed.size === 0) return straight;
  return withRoutedDistances(straight, routed);
}

export async function fetchRoutedRouteSummary(
  venues: readonly Venue[],
  signal?: AbortSignal,
): Promise<RouteLegsSummary> {
  const straight = buildRouteLegs([...venues], "walk");
  if (venues.length < 2) return straight;
  const coords: LngLat[] = venues.map((venue) => [venue.longitude, venue.latitude]);
  try {
    const response = await fetch(
      `/api/walk-route?stops=${encodeURIComponent(stopsParam(coords))}`,
      { signal, headers: { accept: "application/json" } },
    );
    if (!response.ok) {
      discardBody(response);
      return straight;
    }
    const body = (await response.json()) as { legs?: WalkLegDistance[] };
    return upgradeRouteSummary(straight, body.legs ?? []);
  } catch {
    return straight;
  }
}

export function routeSummaryLabel(summary: RouteLegsSummary): string {
  return formatRouteTotal(summary);
}

export async function resolvePlanRouteTotalLabel(
  stopIds: readonly string[],
  apiTotals: PlanRouteTotals,
  venuesById?: ReadonlyMap<string, Venue>,
  signal?: AbortSignal,
): Promise<string> {
  const venues = venuesForStops(stopIds, venuesById);
  if (!venues) return planRouteTotalsFallbackLabel(apiTotals);
  const summary = await fetchRoutedRouteSummary(venues, signal);
  return routeSummaryLabel(summary);
}
