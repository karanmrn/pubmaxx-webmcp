import type { PlanStopDTO } from "@/lib/plan";

/** Prefix that marks an ambient POI meeting point, never free text. */
export const OPEN_PLAN_PLACE_PREFIX = "place:";

export const OPEN_PLAN_PLACE_REFUSED_LINE =
  "Open plans need a listed pub or a named public place.";

export const OPEN_PLAN_LIST_LIMIT = 50;

export type OpenPlanPlaceKind = "venue" | "place";

export type OpenMeetingPointClassification =
  | { kind: "venue"; venueId: string }
  | { kind: "place"; placeId: string }
  | { kind: "refused" };

/**
 * Stop 1 is the meeting point. Plan rows number from position 0, so the
 * lowest position is Stop 1.
 */
export function firstPlanStop(
  stops: readonly PlanStopDTO[] | null | undefined,
): PlanStopDTO | null {
  if (!stops || stops.length === 0) return null;
  return [...stops].sort((left, right) => left.position - right.position)[0] ?? null;
}

export function parseOpenPlaceId(value: string): string | null {
  if (!value.startsWith(OPEN_PLAN_PLACE_PREFIX)) return null;
  const placeId = value.slice(OPEN_PLAN_PLACE_PREFIX.length).trim();
  return placeId.length > 0 ? placeId : null;
}

/**
 * Classify a typed meeting-point id. Resolution against the slim index or
 * the POI layer is a later question; this only separates the two id shapes
 * from free text.
 */
export function classifyOpenMeetingPoint(
  venueId: string | null | undefined,
): OpenMeetingPointClassification {
  const id = venueId?.trim() ?? "";
  if (!id) return { kind: "refused" };
  if (id.startsWith(OPEN_PLAN_PLACE_PREFIX)) {
    const placeId = parseOpenPlaceId(id);
    if (!placeId) return { kind: "refused" };
    return { kind: "place", placeId };
  }
  if (id.includes(" ") || id.length > 120) return { kind: "refused" };
  return { kind: "venue", venueId: id };
}
