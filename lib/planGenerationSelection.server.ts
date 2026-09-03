import "server-only";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { NightSignalClaim } from "@/lib/nightSignalClaims";
import { canAffectRoute } from "@/lib/nightSignalClaims";
import type { NightContext } from "@/lib/nightPlanning";
import {
  PLAN_ACCESSIBILITY_NEEDS,
  type PlanAccessibilityNeed,
} from "@/lib/planIntake";
import type { ParsedPlanGenerationIntake } from "@/lib/planGenerationIntake";
import { normalizePlanStopCount } from "@/lib/planStopCount";
import {
  planAccessEvidenceForVenue,
  planOpeningSchedulesForVenues,
  planPriceEvidenceForVenues,
} from "@/lib/planRouteEvidence.server";
import {
  selectAnchoredGroundedPlanRoute,
  selectGroundedPlanRoute,
  type AnchoredGroundedPlanRouteSelection,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
  type GroundedPlanRouteSelection,
  type SelectedGroundedPlanStop,
} from "@/lib/planRouteOptimizer";

export type ScoredPlanCandidate = {
  venue: ConciergeVenue;
  score: number;
  signalClaims: NightSignalClaim[];
};

export type PlanGenerationSelection<T extends ScoredPlanCandidate> =
  | { ok: true; legacy: true; chosen: T[] }
  | {
      ok: true;
      legacy: false;
      chosen: T[];
      selection: Extract<GroundedPlanRouteSelection<T>, { ok: true }>;
      accessibilityEnforced: boolean;
    }
  | {
      ok: false;
      selection: Extract<GroundedPlanRouteSelection<T>, { ok: false }>;
    };

export type AnchoredPlanGenerationSelection<T extends ScoredPlanCandidate> =
  | {
      ok: true;
      outcome: "route";
      chosen: T[];
      selection: Extract<AnchoredGroundedPlanRouteSelection<T>, { outcome: "route" }>;
      accessibilityEnforced: boolean;
    }
  | {
      ok: true;
      outcome: "anchor-only";
      anchor: SelectedGroundedPlanStop<T>;
      anchorValue: T;
      accessibilityEnforced: boolean;
    }
  | { ok: false; reason: "ANCHOR_MISSING" };

/** Join canonical price, access, and opening evidence onto scored candidates. */
async function groundedRouteCandidates<T extends ScoredPlanCandidate>(
  candidates: readonly T[],
  now: number,
): Promise<GroundedPlanRouteCandidate<T>[]> {
  const venues = candidates.map(({ venue }) => venue);
  const [priceEvidence, openingSchedules] = await Promise.all([
    planPriceEvidenceForVenues(venues, now),
    planOpeningSchedulesForVenues(venues),
  ]);
  return candidates.map((candidate) => ({
    value: candidate,
    venueId: candidate.venue.id,
    venueName: candidate.venue.name,
    score: candidate.score,
    lat: candidate.venue.lat,
    lng: candidate.venue.lng,
    price: priceEvidence.get(candidate.venue.id)
      ?? { pence: null, source: null, confidenceState: "unknown" as const },
    promoted: candidate.venue.promoted === true,
    avoidedByReviewedSignal: candidate.signalClaims.some((claim) =>
      canAffectRoute(claim) && claim.routeEffect === "avoid"),
    access: planAccessEvidenceForVenue(candidate.venue),
    openingSchedule: openingSchedules.get(candidate.venue.id) ?? null,
  }));
}

function requiredAccessibilityNeeds(
  context: NightContext,
  intake: ParsedPlanGenerationIntake | null,
): PlanAccessibilityNeed[] {
  if (intake && !intake.handoff.skipped.includes("accessibility")) {
    return [...intake.handoff.accessibilityNeeds];
  }
  const contextNeeds = new Set(context.accessibility);
  return PLAN_ACCESSIBILITY_NEEDS.flatMap(({ id }) => contextNeeds.has(id) ? [id] : []);
}

function groundedConstraints(
  context: NightContext,
  intake: ParsedPlanGenerationIntake | null,
  accessibilityNeeds: readonly PlanAccessibilityNeed[],
  now: number,
): GroundedPlanRouteConstraints {
  return {
    exactArea: intake?.exactNightArea ?? null,
    accessibilityNeeds,
    budgetLimitPence: context.budgetLimitPence,
    budgetTier: context.budget,
    groupSize: context.groupSize,
    stopCount: normalizePlanStopCount(context.stopCount),
    transportConstraints: context.transportConstraints,
    routeWindow: intake?.routeWindow ?? null,
    now,
  };
}

/** Join canonical evidence and run the hard-constraint optimizer. */
export async function selectPlanGenerationCandidates<T extends ScoredPlanCandidate>(
  candidates: readonly T[],
  context: NightContext,
  intake: ParsedPlanGenerationIntake | null,
  now: number,
): Promise<PlanGenerationSelection<T>> {
  const accessibilityNeeds = requiredAccessibilityNeeds(context, intake);
  const hasContextHardConstraint = accessibilityNeeds.length > 0
    || context.budgetLimitPence !== null
    || context.transportConstraints.length > 0
    || normalizePlanStopCount(context.stopCount) !== 3;
  if (!intake && !hasContextHardConstraint) {
    return { ok: true, legacy: true, chosen: candidates.slice(0, normalizePlanStopCount(context.stopCount)) };
  }
  const selection = selectGroundedPlanRoute(
    await groundedRouteCandidates(candidates, now),
    groundedConstraints(context, intake, accessibilityNeeds, now),
  );
  return selection.ok
    ? {
        ok: true,
        legacy: false,
        chosen: selection.stops.map((stop) => stop.value),
        selection,
        accessibilityEnforced: accessibilityNeeds.length > 0,
      }
    : { ok: false, selection };
}

/**
 * Run the anchor-pinned optimizer. Unlike the unanchored path this always joins
 * canonical evidence (the accepted Venue is grounded even without full intake)
 * and returns an honest route or one-Stop anchor-only outcome.
 */
export async function selectAnchoredPlanGenerationCandidates<T extends ScoredPlanCandidate>(
  candidates: readonly T[],
  context: NightContext,
  intake: ParsedPlanGenerationIntake | null,
  now: number,
  anchorVenueId: string,
): Promise<AnchoredPlanGenerationSelection<T>> {
  const accessibilityNeeds = requiredAccessibilityNeeds(context, intake);
  const selection = selectAnchoredGroundedPlanRoute(
    await groundedRouteCandidates(candidates, now),
    groundedConstraints(context, intake, accessibilityNeeds, now),
    anchorVenueId,
  );
  if (!selection.ok) return { ok: false, reason: "ANCHOR_MISSING" };
  const accessibilityEnforced = accessibilityNeeds.length > 0;
  return selection.outcome === "anchor-only"
    ? {
        ok: true,
        outcome: "anchor-only",
        anchor: selection.anchor,
        anchorValue: selection.anchor.value,
        accessibilityEnforced,
      }
    : {
        ok: true,
        outcome: "route",
        chosen: selection.stops.map((stop) => stop.value),
        selection,
        accessibilityEnforced,
      };
}
