// Route legs: turn a crawl's stop-to-stop hops into an honest walking (or
// running) time/distance estimate, and surface the ambient POIs that sit near
// each leg — "on the way: Borough Market, …" (user stories 25-26,
// docs/PRD_FOR_FABLE.md).
//
// Every distance BUILT here is haversine (straight-line, see lib/haversine) —
// never a real routed/pavement distance on its own. We say so everywhere this
// surfaces in the UI; honesty is the design, not a placeholder.
//
// Since the road-route work landed (GET /api/walk-route, ORS foot-walking) a
// real router DOES exist. A caller that has routed geometry can upgrade a
// straight-line summary with withRoutedDistances: the upgraded legs carry the
// real routed distance and relabel "walking route", while any leg left unrouted
// keeps its straight-line distance AND its "straight-line" wording verbatim. A
// summary that was never upgraded is unchanged — still straight-line.
//
// Pure, dependency-light (haversine + pois types only) so it's trivially unit
// tested without a map, a network, or React — see __tests__/routeLegs.test.ts.

import { haversineKm } from "@/lib/haversine";
import type { Poi } from "@/lib/pois";
import type { Venue } from "@/lib/venues";

// Average human walking pace. 4.8 km/h is the standard "brisk adult walking
// speed" figure (~3 mph) used by transport planning guidance (e.g. UK DfT
// walking-time assumptions) — a reasonable, defensible default for a straight-
// line estimate that's already generous to the walker (real pavement routes
// are longer than straight-line, so this under-estimates time a little; we
// label it "straight-line" rather than pretend otherwise).
export const WALK_KMH = 4.8;

// Cheap "runner" toggle (story 25 nicety): a steady easy-run pace. One extra
// constant, no new distance math — the same leg distances, a different pace.
export const RUN_KMH = 9;

export type RoutePace = "walk" | "run";

// How a leg's (or a whole route's) distance was measured. Absent is treated as
// "straight-line" everywhere so pre-existing legs, and any summary that was
// never upgraded with routed geometry, keep the honest straight-line wording.
export type RouteDistanceBasis = "straight-line" | "routed";

// The POI categories eligible for "on the way" threading (story 26). Tube/
// rail/bus/river stay off this list on purpose — they're transport, not the
// "pint, a park, a view" texture the crawl is threading for.
const ON_THE_WAY_CATEGORIES: ReadonlySet<Poi["category"]> = new Set([
  "garden",
  "market",
  "historic",
  "viewpoint",
]);

// How close a POI has to sit to a leg to count as "on the way". Tuned to a
// comfortable short detour — close enough to glance at without leaving the
// route, not a "you could sort of see it from here" stretch.
export const ON_THE_WAY_KM = 0.25;

export type RouteLeg = {
  /** Index into the route array of the leg's starting stop. */
  fromIndex: number;
  /** Index into the route array of the leg's ending stop. */
  toIndex: number;
  from: Venue;
  to: Venue;
  /** Distance in km. Straight-line (haversine) unless upgraded via
   *  withRoutedDistances, in which case it is the real routed length. */
  distanceKm: number;
  /** Estimated minutes to cover distanceKm at the given pace, rounded up. */
  minutes: number;
  pace: RoutePace;
  /** How distanceKm was measured. Absent = straight-line (the default). */
  distanceBasis?: RouteDistanceBasis;
};

export type RouteLegsSummary = {
  legs: RouteLeg[];
  totalKm: number;
  totalMinutes: number;
  pace: RoutePace;
  /** How the total was measured. "routed" only when EVERY leg is routed;
   *  absent = straight-line (the default). */
  distanceBasis?: RouteDistanceBasis;
};

function paceKmh(pace: RoutePace): number {
  return pace === "run" ? RUN_KMH : WALK_KMH;
}

// Minutes to cover `km` at `pace`, rounded UP to the next whole minute so a
// leg never reads as "0 min walk" — even a very short hop costs a minute of
// actually getting up and walking it.
export function legMinutes(km: number, pace: RoutePace = "walk"): number {
  if (!(km > 0)) return 0;
  const hours = km / paceKmh(pace);
  return Math.max(1, Math.ceil(hours * 60));
}

// Build the leg-by-leg breakdown for a route (an ordered stop list). Returns
// one entry per adjacent pair — a route of N stops yields N-1 legs. An empty
// or single-stop route yields no legs and a zeroed summary, never throws.
export function buildRouteLegs(route: Venue[], pace: RoutePace = "walk"): RouteLegsSummary {
  const legs: RouteLeg[] = [];
  for (let i = 0; i < route.length - 1; i += 1) {
    const from = route[i];
    const to = route[i + 1];
    const distanceKm = haversineKm([from.longitude, from.latitude], [to.longitude, to.latitude]);
    legs.push({
      fromIndex: i,
      toIndex: i + 1,
      from,
      to,
      distanceKm,
      minutes: legMinutes(distanceKm, pace),
      pace,
    });
  }
  const totalKm = legs.reduce((sum, leg) => sum + leg.distanceKm, 0);
  const totalMinutes = legs.reduce((sum, leg) => sum + leg.minutes, 0);
  return { legs, totalKm, totalMinutes, pace };
}

/** The distance-basis label suffix: "walking route" for routed, else the honest
 *  "straight-line" verbatim (absent basis included). */
function basisLabel(basis: RouteDistanceBasis | undefined): string {
  return basis === "routed" ? "walking route" : "straight-line";
}

// Format a leg for display: "12 min walk · 0.9 km, straight-line", or
// "12 min walk · 1.1 km, walking route" once the leg carries routed geometry.
// Kept a pure formatter (not JSX) so it's unit-testable and reusable outside
// RoutePanel if another surface ever wants the same label.
export function formatLeg(leg: RouteLeg): string {
  const verb = leg.pace === "run" ? "run" : "walk";
  return `${leg.minutes} min ${verb} · ${leg.distanceKm.toFixed(1)} km, ${basisLabel(leg.distanceBasis)}`;
}

export function formatRouteTotal(summary: RouteLegsSummary): string {
  const verb = summary.pace === "run" ? "run" : "walk";
  return `${summary.totalMinutes} min ${verb} total · ${summary.totalKm.toFixed(
    1,
  )} km, ${basisLabel(summary.distanceBasis)}`;
}

// Upgrade a straight-line summary with real routed leg distances, keyed by each
// leg's fromIndex (e.g. from GET /api/walk-route's per-leg distances, where a
// leg with source "ors" contributes its routed length). A leg that gets a
// positive routed distance is relabelled "routed" and its minutes recomputed
// from the longer real distance; a leg with no routed entry keeps its straight-
// line distance and "straight-line" wording verbatim. The TOTAL reads "routed"
// only when every leg is routed — a mixed route keeps the honest straight-line
// total rather than dress a partly-approximate walk as fully routed. Pure: it
// returns a new summary and never mutates the input.
export function withRoutedDistances(
  summary: RouteLegsSummary,
  routedKmByFromIndex: ReadonlyMap<number, number>,
): RouteLegsSummary {
  const legs = summary.legs.map((leg): RouteLeg => {
    const routedKm = routedKmByFromIndex.get(leg.fromIndex);
    if (routedKm === undefined || !(routedKm > 0)) return leg;
    return {
      ...leg,
      distanceKm: routedKm,
      minutes: legMinutes(routedKm, leg.pace),
      distanceBasis: "routed",
    };
  });
  const totalKm = legs.reduce((sum, leg) => sum + leg.distanceKm, 0);
  const totalMinutes = legs.reduce((sum, leg) => sum + leg.minutes, 0);
  const allRouted = legs.length > 0 && legs.every((leg) => leg.distanceBasis === "routed");
  return {
    legs,
    totalKm,
    totalMinutes,
    pace: summary.pace,
    distanceBasis: allRouted ? "routed" : "straight-line",
  };
}

// --- "On the way" POI threading (story 26) ----------------------------------

export type OnTheWayPoi = {
  poi: Poi;
  /** Straight-line distance in km from the POI to its nearest leg endpoint. */
  km: number;
};

// Nearest-anchor distance from a POI to a leg: the smaller of its distance to
// the leg's two endpoints. This is a deliberate simplification over a true
// point-to-segment distance — for the short legs a crawl actually has (a few
// hundred metres between pubs), "close to either end" already captures "on
// the way" without the extra geometry, and it keeps the matcher trivial to
// read and test. See module comment for the honesty note this implies.
function poiDistanceToLeg(poi: Poi, leg: RouteLeg): number {
  const toFrom = haversineKm(poi.coordinates, [leg.from.longitude, leg.from.latitude]);
  const toTo = haversineKm(poi.coordinates, [leg.to.longitude, leg.to.latitude]);
  return Math.min(toFrom, toTo);
}

// The garden/market/historic/viewpoint POIs within `withinKm` of a single leg,
// nearest-first. Pure — pass the already-loaded POI list (lib/pois.loadPois
// output) and this never touches the network itself.
export function poisOnLeg(
  leg: RouteLeg,
  pois: Poi[],
  withinKm: number = ON_THE_WAY_KM,
): OnTheWayPoi[] {
  const matches: OnTheWayPoi[] = [];
  for (const poi of pois) {
    if (!ON_THE_WAY_CATEGORIES.has(poi.category)) continue;
    const km = poiDistanceToLeg(poi, leg);
    if (km <= withinKm) matches.push({ poi, km });
  }
  return matches.sort((a, b) => a.km - b.km);
}

// Same, but for every leg in a route at once — a Map keyed by the leg's
// fromIndex so a caller can render "on the way" under each leg it belongs to.
export function poisOnRoute(
  legs: RouteLeg[],
  pois: Poi[],
  withinKm: number = ON_THE_WAY_KM,
): Map<number, OnTheWayPoi[]> {
  const out = new Map<number, OnTheWayPoi[]>();
  for (const leg of legs) {
    const matches = poisOnLeg(leg, pois, withinKm);
    if (matches.length) out.set(leg.fromIndex, matches);
  }
  return out;
}
