import {
  activeNightSignalClaims,
  type NightSignalClaim,
} from "@/lib/nightSignalClaims";
import type { NightAreaSlug } from "@/lib/nightPlanning";
import {
  planningWeatherForArea,
  type PlanningWeather,
} from "@/lib/weatherSnapshots";
import {
  filterTonight,
  rowEffectiveEnd,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export type PlanEvidenceWindow = {
  startsAt: string;
  endsAt: string;
};

export type PlanTemporalEvidence = {
  weather: PlanningWeather | null;
  whatsOn: WhatsOnRow[];
  signalClaims: NightSignalClaim[];
};

function overlapsWindow(
  startsAt: number,
  endsAt: number,
  window: PlanEvidenceWindow,
): boolean {
  const windowStart = Date.parse(window.startsAt);
  const windowEnd = Date.parse(window.endsAt);
  return startsAt < windowEnd && endsAt > windowStart;
}

function coversWindow(
  startsAt: number,
  endsAt: number,
  window: PlanEvidenceWindow,
): boolean {
  const windowStart = Date.parse(window.startsAt);
  const windowEnd = Date.parse(window.endsAt);
  return startsAt <= windowStart && endsAt >= windowEnd;
}

function whatsOnForWindow(
  rows: WhatsOnRow[],
  requestNow: number,
  routeWindow: PlanEvidenceWindow | null,
): WhatsOnRow[] {
  if (!routeWindow) return filterTonight(rows, requestNow);
  return rows.filter((row) => {
    if (!row.startsAt) return false;
    const observedAt = Date.parse(row.observedAt);
    return observedAt <= requestNow
      && coversWindow(Date.parse(row.startsAt), rowEffectiveEnd(row), routeWindow);
  });
}

function signalClaimsForWindow(
  snapshot: unknown,
  requestNow: number,
  routeWindow: PlanEvidenceWindow | null,
): NightSignalClaim[] {
  const availableClaims = activeNightSignalClaims(snapshot, requestNow);
  if (!routeWindow) return availableClaims;
  return availableClaims.filter((claim) => {
    const observedAt = Date.parse(claim.observedAt);
    const expiresAt = Date.parse(claim.expiresAt);
    // Stop times do not exist until after ranking. Positive/neutral evidence
    // may therefore shape preselection only when it is valid for every
    // possible visit in the route. Avoid claims deliberately remain an
    // any-overlap safety fence: over-exclusion is safer than routing through a
    // reviewed hazard that may be active during part of the night.
    return claim.routeEffect === "avoid"
      ? overlapsWindow(observedAt, expiresAt, routeWindow)
      : coversWindow(observedAt, expiresAt, routeWindow);
  });
}

/**
 * Separates evidence availability at request time from applicability to the
 * planned visit. Before stop times are assigned, positive What's-On and signal
 * evidence must cover the whole route; reviewed avoid claims use conservative
 * any-overlap exclusion. The weather snapshot is a current
 * observation whose expiry is a cache-freshness bound, not a forecast window;
 * it is therefore omitted for every explicitly future route.
 *
 * A request without an intake keeps the legacy request-time behaviour exactly.
 */
export function planTemporalEvidence(input: {
  weatherSnapshot: unknown;
  nightSignalSnapshot: unknown;
  whatsOnRows: WhatsOnRow[];
  nightArea: NightAreaSlug;
  requestNow: number;
  routeWindow?: PlanEvidenceWindow | null;
}): PlanTemporalEvidence {
  const routeWindow = input.routeWindow ?? null;
  return {
    weather: routeWindow
      ? null
      : planningWeatherForArea(input.weatherSnapshot, input.nightArea, input.requestNow),
    whatsOn: whatsOnForWindow(input.whatsOnRows, input.requestNow, routeWindow),
    signalClaims: signalClaimsForWindow(
      input.nightSignalSnapshot,
      input.requestNow,
      routeWindow,
    ),
  };
}
