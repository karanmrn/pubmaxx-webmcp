import { PLANNING_INTENT_SOURCES, type PlanningIntentSource } from "@/lib/planningIntent";
import {
  writePlanRouteDraftEnvelope,
  type ParsedPlanRouteDraft,
  type PlanRouteDraftOrigin,
  type PlanRouteDraftStorage,
} from "@/lib/planRouteDraft";

/**
 * L12 Map-to-Plan transfer seam. Maps a /api/plans/generate response into a
 * PlanRouteDraft V2 (origin "map-generated") so the Plan composer hydrates the
 * exact same Route — same Stops, order, anchor, and proof — without issuing a
 * second generation request. It only ever writes storage; it never fetches.
 * A malformed or incomplete Route maps to null and nothing is written, so the
 * caller falls back to the existing navigate-and-regenerate path.
 */

type RawStop = {
  venueId?: unknown;
  venueName?: unknown;
  reason?: unknown;
  alternatives?: Array<{ venueId?: unknown; venueName?: unknown }>;
};

export type MapGeneratedRouteResponse = {
  outcome?: unknown;
  anchored?: unknown;
  anchorVenueId?: unknown;
  anchorSource?: unknown;
  groundingProof?: unknown;
  operationKey?: unknown;
  routeRevision?: unknown;
  stops?: RawStop[];
  inferredContext?: unknown;
  routeTotals?: unknown;
  planningConfidence?: unknown;
};

type RouteDraftValue = ParsedPlanRouteDraft["value"];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanAlternatives(raw: RawStop["alternatives"]): { venueId: string; venueName: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((alt) => {
      const venueId = text(alt?.venueId);
      const venueName = text(alt?.venueName);
      return venueId && venueName ? { venueId, venueName } : null;
    })
    .filter((alt): alt is { venueId: string; venueName: string } => alt !== null);
}

/**
 * Build the route-draft value from a generation response, or null when the
 * Stops are missing or malformed. Downstream `writePlanRouteDraftEnvelope`
 * re-validates every field, so partial or inconsistent data still fails closed.
 */
export function mapGeneratedRouteDraftValue(
  body: MapGeneratedRouteResponse | null | undefined,
): RouteDraftValue | null {
  if (!body || typeof body !== "object" || !Array.isArray(body.stops) || body.stops.length < 1) return null;

  const stops = body.stops.map((raw, index) => {
    const venueId = text(raw?.venueId);
    const venueName = text(raw?.venueName);
    if (!venueId || !venueName) return null;
    const reason = text(raw?.reason);
    return {
      key: index + 1,
      venueId,
      venueName,
      ...(reason ? { reason } : {}),
      alternatives: cleanAlternatives(raw?.alternatives),
    };
  });
  if (stops.some((stop) => stop === null)) return null;

  const anchoredOutcome = body.outcome === "route" || body.outcome === "anchor-only";
  const outcome = anchoredOutcome ? (body.outcome as "route" | "anchor-only") : "unanchored";
  const anchorVenueId = anchoredOutcome ? text(body.anchorVenueId) : null;
  const anchorSource = anchoredOutcome
    && typeof body.anchorSource === "string"
    && (PLANNING_INTENT_SOURCES as readonly string[]).includes(body.anchorSource)
    ? (body.anchorSource as PlanningIntentSource)
    : null;

  const confidence = body.planningConfidence as { warnings?: unknown } | null | undefined;
  const warnings = Array.isArray(confidence?.warnings)
    ? confidence.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const routeTotals = body.routeTotals as { distanceBasis?: unknown } | null | undefined;
  const transportBasis = routeTotals?.distanceBasis === "routed"
    ? "routed"
    : routeTotals
      ? "straight-line"
      : null;

  return {
    anchorVenueId,
    anchorSource,
    outcome,
    stops: stops as RouteDraftValue["stops"],
    alternatives: [],
    nightContext: (body.inferredContext ?? null) as RouteDraftValue["nightContext"],
    routeTotals: (body.routeTotals ?? null) as RouteDraftValue["routeTotals"],
    transportBasis,
    planningConfidence: (body.planningConfidence ?? null) as RouteDraftValue["planningConfidence"],
    warnings,
    groundingProof: text(body.groundingProof),
    operationKey: text(body.operationKey),
    routeRevision: typeof body.routeRevision === "number" || typeof body.routeRevision === "string"
      ? body.routeRevision
      : null,
    routeStale: false,
  };
}

/**
 * Transfer a generate response into the Plan route draft. Returns true only
 * when the canonical V2 envelope was written. Storage exceptions and malformed
 * Routes are non-destructive and simply return false.
 */
export function transferGeneratedRouteToDraft(
  body: MapGeneratedRouteResponse | null | undefined,
  storage: PlanRouteDraftStorage | null,
  origin: PlanRouteDraftOrigin = "plan-generated",
  now = Date.now(),
): boolean {
  const value = mapGeneratedRouteDraftValue(body);
  if (!value || !storage) return false;
  return writePlanRouteDraftEnvelope(value, origin, storage, now).v2;
}

/**
 * Transfer a Map-generated Route into the Plan route draft. Returns true only
 * when the canonical V2 envelope was written. Storage exceptions and malformed
 * Routes are non-destructive and simply return false.
 */
export function transferMapRouteToDraft(
  body: MapGeneratedRouteResponse | null | undefined,
  storage: PlanRouteDraftStorage | null,
  now = Date.now(),
): boolean {
  return transferGeneratedRouteToDraft(body, storage, "map-generated", now);
}
