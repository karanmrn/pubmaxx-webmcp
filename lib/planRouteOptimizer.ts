import { haversineKm } from "@/lib/haversine";
import { WALK_KMH } from "@/lib/routeLegs";
import { DAY_MS } from "@/lib/dayMs";
import {
  MAX_PLAN_STOP_COUNT,
  MIN_PLAN_STOP_COUNT,
  normalizePlanStopCount,
} from "@/lib/planStopCount";
import type { PlanAccessibilityNeed } from "@/lib/planIntake";
import type { Budget, NightAreaSlug } from "@/lib/nightPlanning";
import type {
  PlanConstraintReport,
  PlanStopConstraintFlag,
} from "@/lib/planGenerationDto";
import {
  OPENING_EVIDENCE_FRESH_DAYS,
  accessNeedSatisfied,
  assessOpeningSchedule,
  priceEvidenceUsableForCeiling,
  type OpeningAssessment,
  type PlanAccessEvidence,
  type PlanOpeningSchedule,
  type PlanPriceEvidence,
} from "@/lib/planRouteEvidence";

export {
  DEFAULT_PLAN_STOP_COUNT,
  MAX_PLAN_STOP_COUNT,
  MIN_PLAN_STOP_COUNT,
} from "@/lib/planStopCount";
export const PLAN_STOP_MINUTES = 50;
export const PLAN_WALKING_KMH = WALK_KMH;
export const PLAN_TRANSFER_UNCERTAINTY_MINUTES = 5;
export const MAX_PLAN_ROUTE_SEGMENT_KM = 1.6;
export const MAX_PLAN_ROUTE_WALKING_KM = 3;
const MAX_ROUTE_SEARCH_CANDIDATES = 14;
const ROUTE_BEAM_WIDTH = 1_500;

export type PlanVisitWindow = { startsAt: string; endsAt: string };
export type PlanRouteTiming = {
  visitWindows: readonly PlanVisitWindow[];
  straightLineWalkingKm: number;
  walkingMinutes: number;
  transferUncertaintyMinutes: number;
  scheduledRouteMinutes: number;
};

export function planStopCount(value: unknown): number {
  return normalizePlanStopCount(value);
}

export type { PlanConstraintReport, PlanStopConstraintFlag } from "@/lib/planGenerationDto";

export type GroundedPlanRouteCandidate<T> = {
  value: T;
  venueId: string;
  venueName: string;
  score: number;
  lat: number;
  lng: number;
  price: PlanPriceEvidence;
  promoted: boolean;
  avoidedByReviewedSignal: boolean;
  access: PlanAccessEvidence;
  openingSchedule: PlanOpeningSchedule | null;
};

export type GroundedPlanRouteConstraints = {
  exactArea: NightAreaSlug | null;
  accessibilityNeeds: readonly PlanAccessibilityNeed[];
  budgetLimitPence: number | null;
  budgetTier: Budget | null;
  groupSize: number | null;
  transportConstraints: readonly string[];
  routeWindow: { startsAt: string; endsAt: string } | null;
  now: number;
  /** Requested number of pub stops. Missing means the original 3-stop default. */
  stopCount?: number;
};

export type SelectedGroundedPlanStop<T> = GroundedPlanRouteCandidate<T> & {
  position: number;
  visitWindow: PlanVisitWindow | null;
  opening: OpeningAssessment;
  constraintFlags: PlanStopConstraintFlag[];
};

export type GroundedPlanRouteSelection<T> =
  | {
      ok: true;
      stops: readonly SelectedGroundedPlanStop<T>[];
      alternatives: readonly (readonly SelectedGroundedPlanStop<T>[])[];
      timing: PlanRouteTiming;
      constraintReport: PlanConstraintReport;
    }
  | {
      ok: false;
      eligibleCandidateCount: number;
      rejected: { safety: number; exclusions: number; accessibility: number; budgetEvidence: number; budgetCeiling: number };
    };

function distanceKm<T>(left: GroundedPlanRouteCandidate<T>, right: GroundedPlanRouteCandidate<T>): number {
  return haversineKm([left.lng, left.lat], [right.lng, right.lat]);
}

function legWalkingMinutes(km: number): number {
  return Math.ceil((km / PLAN_WALKING_KMH) * 60);
}

export function routeTiming<T>(
  route: readonly GroundedPlanRouteCandidate<T>[],
  routeWindow: GroundedPlanRouteConstraints["routeWindow"],
): PlanRouteTiming | null {
  if (route.length < MIN_PLAN_STOP_COUNT || route.length > MAX_PLAN_STOP_COUNT) return null;
  const legs = route.slice(1).map((candidate, index) => distanceKm(route[index]!, candidate));
  const distance = legs.reduce((total, km) => total + km, 0);
  if (legs.some((km) => km > MAX_PLAN_ROUTE_SEGMENT_KM) || distance > MAX_PLAN_ROUTE_WALKING_KM) return null;
  const walkingMinutes = legs.reduce((total, km) => total + legWalkingMinutes(km), 0);
  const uncertainty = PLAN_TRANSFER_UNCERTAINTY_MINUTES * legs.length;
  const scheduledRouteMinutes = PLAN_STOP_MINUTES * route.length + walkingMinutes + uncertainty;
  if (!routeWindow) {
    return {
      visitWindows: [],
      straightLineWalkingKm: distance,
      walkingMinutes,
      transferUncertaintyMinutes: uncertainty,
      scheduledRouteMinutes,
    };
  }

  let cursor = Date.parse(routeWindow.startsAt);
  const deadline = Date.parse(routeWindow.endsAt);
  if (!Number.isFinite(cursor) || !Number.isFinite(deadline)) return null;
  const visits: PlanVisitWindow[] = [];
  for (let position = 0; position < route.length; position += 1) {
    const endsAt = cursor + PLAN_STOP_MINUTES * 60_000;
    visits.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(endsAt).toISOString() });
    if (position < route.length - 1) {
      cursor = endsAt + (legWalkingMinutes(legs[position]!) + PLAN_TRANSFER_UNCERTAINTY_MINUTES) * 60_000;
    }
  }
  if (Date.parse(visits.at(-1)!.endsAt) > deadline) return null;
  return {
    visitWindows: visits,
    straightLineWalkingKm: distance,
    walkingMinutes,
    transferUncertaintyMinutes: uncertainty,
    scheduledRouteMinutes,
  };
}

type EvaluatedRoute<T> = {
  route: readonly GroundedPlanRouteCandidate<T>[];
  timing: PlanRouteTiming;
  opening: readonly OpeningAssessment[];
  score: number;
  key: string;
};

function evaluateRoute<T>(
  route: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): EvaluatedRoute<T> | null {
  if (constraints.budgetLimitPence !== null) {
    if (!route.every((candidate) => priceEvidenceUsableForCeiling(candidate.price))) return null;
    if (route.reduce((total, candidate) => total + candidate.price.pence!, 0) > constraints.budgetLimitPence) return null;
  }
  const timing = routeTiming(route, constraints.routeWindow);
  if (!timing) return null;
  const visits = timing.visitWindows;
  if (!route.every((candidate, position) => constraints.accessibilityNeeds.every((need) =>
    accessNeedSatisfied(candidate.access, need, visits[position]?.startsAt ?? null)))) return null;
  const opening = route.map((candidate, position) => assessOpeningSchedule(
    candidate.openingSchedule,
    visits[position] ?? null,
    constraints.now,
  ));
  if (visits.length > 0 && opening.some((assessment) => assessment.state !== "listed_open")) return null;
  return {
    route,
    timing,
    opening,
    score: route.reduce((total, candidate) => total + candidate.score, 0),
    key: route.map((candidate) => candidate.venueId).join("|"),
  };
}

function flagsFor(opening: OpeningAssessment, hasVisit: boolean): PlanStopConstraintFlag[] {
  if (!hasVisit) return [];
  if (opening.state === "unknown") {
    return [{ code: "opening_hours_unconfirmed", message: opening.warning ?? "Opening hours are unconfirmed." }];
  }
  return opening.warning
    ? [{ code: "recurring_hours_exception_warning", message: opening.warning }]
    : [];
}

function selectedStops<T>(evaluation: EvaluatedRoute<T>): SelectedGroundedPlanStop<T>[] {
  return evaluation.route.map((candidate, position) => ({
    ...candidate,
    position,
    visitWindow: evaluation.timing.visitWindows[position] ?? null,
    opening: evaluation.opening[position]!,
    constraintFlags: flagsFor(evaluation.opening[position]!, Boolean(evaluation.timing.visitWindows[position])),
  }));
}

function report<T>(evaluation: EvaluatedRoute<T>, constraints: GroundedPlanRouteConstraints): PlanConstraintReport {
  const dated = evaluation.timing.visitWindows.length > 0;
  return {
    version: 1,
    source: "plan-intake-v1",
    hardConstraints: [
      {
        code: "safety",
        status: "satisfied",
        message: constraints.routeWindow
          ? "Stops with a reviewed avoid signal overlapping any part of the route window were conservatively excluded."
          : "Stops with an active reviewed avoid signal were excluded.",
      },
      { code: "exclusions", status: "satisfied", message: "Excluded and promoted venues were not eligible." },
      {
        code: "transport_feasibility",
        status: "satisfied",
        message: `Travel time uses ${PLAN_WALKING_KMH} km/h direct-distance walking plus ${PLAN_TRANSFER_UNCERTAINTY_MINUTES} minutes uncertainty per leg; pavement routing is not claimed.`,
      },
      ...(constraints.exactArea ? [{
        code: "exact_area" as const,
        status: "satisfied" as const,
        message: "Every stop is within the selected patch.",
      }] : []),
      ...(constraints.accessibilityNeeds.length ? [{
        code: "accessibility" as const,
        status: "satisfied" as const,
        message: "Every stop has checked information for each access need at its visit time.",
      }] : []),
      ...(constraints.budgetLimitPence !== null ? [{
        code: "budget_ceiling" as const,
        status: "satisfied" as const,
        message: "The attributable, non-stale recorded one-pint-per-stop total is within the per-person ceiling.",
      }] : []),
      ...(dated ? [{
        code: "opening_hours" as const,
        status: "flagged" as const,
        message: "Recurring weekly schedules list every stop open; holiday and one-off exceptions are not confirmed and must be checked.",
      }] : []),
    ],
    softRelaxations: [
      ...((constraints.groupSize ?? 0) >= 6 ? [{
        code: "group_fit_unverified" as const,
        message: "Group size did not shape the order because we do not have checked capacity details.",
      }] : []),
      ...(constraints.budgetTier === "value"
        && constraints.budgetLimitPence === null
        && evaluation.route.some((candidate) => candidate.price.pence === null) ? [{
          code: "value_price_evidence_incomplete" as const,
          message: "The value preference was applied, but at least one selected stop has no attributable recorded pint price.",
        }] : []),
    ],
  };
}

function better<T>(candidate: EvaluatedRoute<T>, incumbent: EvaluatedRoute<T> | null): boolean {
  if (!incumbent) return true;
  if (candidate.score !== incumbent.score) return candidate.score > incumbent.score;
  if (candidate.timing.straightLineWalkingKm !== incumbent.timing.straightLineWalkingKm) {
    return candidate.timing.straightLineWalkingKm < incumbent.timing.straightLineWalkingKm;
  }
  return candidate.key.localeCompare(incumbent.key, "en-GB") < 0;
}

function permutations(length: number): number[][] {
  const result: number[][] = [];
  const used = new Set<number>();
  const current: number[] = [];
  function visit(): void {
    if (current.length === length) {
      result.push([...current]);
      return;
    }
    for (let index = 0; index < length; index += 1) {
      if (used.has(index)) continue;
      used.add(index);
      current.push(index);
      visit();
      current.pop();
      used.delete(index);
    }
  }
  visit();
  return result;
}

const permutationCache = new Map<number, number[][]>();
function routePermutations(length: number): readonly number[][] {
  const cached = permutationCache.get(length);
  if (cached) return cached;
  const generated = permutations(length);
  permutationCache.set(length, generated);
  return generated;
}

function hasCurrentAttributableOpeningSchedule(
  schedule: PlanOpeningSchedule | null,
  now: number,
): boolean {
  if (!schedule || schedule.venueListedOpen !== true) return false;
  const { source } = schedule;
  if (
    !source
    || typeof source.label !== "string"
    || !source.label.trim()
    || typeof source.url !== "string"
    || !/^https?:\/\//.test(source.url)
    || typeof source.observedAt !== "string"
  ) return false;
  const observedAt = Date.parse(source.observedAt);
  if (!Number.isFinite(observedAt)) return false;
  const ageDays = (now - observedAt) / DAY_MS;
  return ageDays >= 0 && ageDays <= OPENING_EVIDENCE_FRESH_DAYS;
}

function bestRouteFromCombination<T>(
  combination: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
  incumbent: EvaluatedRoute<T> | null,
  prefix: readonly GroundedPlanRouteCandidate<T>[] = [],
): EvaluatedRoute<T> | null {
  let best = incumbent;
  for (const permutation of routePermutations(combination.length)) {
    const route = [...prefix, ...permutation.map((index) => combination[index]!)];
    const evaluated = evaluateRoute(route, constraints);
    if (evaluated && better(evaluated, best)) best = evaluated;
  }
  return best;
}

function searchBestRouteCombinations<T>(
  ranked: readonly GroundedPlanRouteCandidate<T>[],
  targetCount: number,
  prefix: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): EvaluatedRoute<T> | null {
  const combination: GroundedPlanRouteCandidate<T>[] = [];
  const prefixScore = prefix.reduce((total, candidate) => total + candidate.score, 0);
  let best: EvaluatedRoute<T> | null = null;

  const visit = (start: number, partialScore: number): void => {
    const remaining = targetCount - combination.length;
    if (remaining === 0) {
      best = bestRouteFromCombination(combination, constraints, best, prefix);
      return;
    }

    for (let index = start; index <= ranked.length - remaining; index += 1) {
      let upperScore = prefixScore + partialScore + ranked[index]!.score;
      for (let offset = 1; offset < remaining; offset += 1) {
        upperScore += ranked[index + offset]!.score;
      }
      if (best && upperScore < best.score) break;
      combination.push(ranked[index]!);
      visit(index + 1, partialScore + ranked[index]!.score);
      combination.pop();
    }
  };

  visit(0, 0);
  return best;
}

function partialRouteAllowed<T>(
  route: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): boolean {
  if (constraints.budgetLimitPence !== null) {
    if (!route.every((candidate) => priceEvidenceUsableForCeiling(candidate.price))) return false;
    if (route.reduce((total, candidate) => total + candidate.price.pence!, 0) > constraints.budgetLimitPence) return false;
  }
  let distance = 0;
  for (let index = 1; index < route.length; index += 1) {
    const leg = distanceKm(route[index - 1]!, route[index]!);
    if (leg > MAX_PLAN_ROUTE_SEGMENT_KM) return false;
    distance += leg;
  }
  return distance <= MAX_PLAN_ROUTE_WALKING_KM;
}

function beamBestRoute<T>(
  seeds: readonly (readonly GroundedPlanRouteCandidate<T>[])[],
  additions: readonly GroundedPlanRouteCandidate<T>[],
  target: number,
  constraints: GroundedPlanRouteConstraints,
): EvaluatedRoute<T> | null {
  let beam = seeds.map((route) => ({ route: [...route], score: route.reduce((total, candidate) => total + candidate.score, 0) }));
  while (beam[0] && beam[0].route.length < target) {
    const next: { route: GroundedPlanRouteCandidate<T>[]; score: number; key: string; distance: number }[] = [];
    for (const partial of beam) {
      const used = new Set(partial.route.map((candidate) => candidate.venueId));
      for (const candidate of additions) {
        if (used.has(candidate.venueId)) continue;
        const route = [...partial.route, candidate];
        if (!partialRouteAllowed(route, constraints)) continue;
        let distance = 0;
        for (let index = 1; index < route.length; index += 1) {
          distance += distanceKm(route[index - 1]!, route[index]!);
        }
        next.push({
          route,
          score: partial.score + candidate.score,
          key: route.map((entry) => entry.venueId).join("|"),
          distance,
        });
      }
    }
    next.sort((left, right) => right.score - left.score
      || left.distance - right.distance
      || left.key.localeCompare(right.key, "en-GB"));
    beam = next.slice(0, ROUTE_BEAM_WIDTH).map(({ route, score }) => ({ route, score }));
  }
  let best: EvaluatedRoute<T> | null = null;
  for (const partial of beam) {
    const evaluated = evaluateRoute(partial.route, constraints);
    if (evaluated && better(evaluated, best)) best = evaluated;
  }
  return best;
}

/** Visit unordered combinations in descending score-bound order, then check every ordering. */
function findBestRoute<T>(
  eligible: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): EvaluatedRoute<T> | null {
  const target = planStopCount(constraints.stopCount);
  // Six-stop route ordering grows factorially. Search the strongest fourteen
  // grounded candidates, while keeping the complete eligible set for honest
  // scarcity and per-stop alternatives.
  const ranked = [...eligible].sort((left, right) => right.score - left.score
    || left.venueId.localeCompare(right.venueId, "en-GB")).slice(0, MAX_ROUTE_SEARCH_CANDIDATES);
  if (target > 3) {
    return beamBestRoute(
      ranked.map((candidate) => [candidate]),
      ranked,
      target,
      constraints,
    );
  }
  return searchBestRouteCombinations(ranked, target, [], constraints);
}

type RouteRejectionCounts = { safety: number; exclusions: number; accessibility: number; budgetEvidence: number; budgetCeiling: number };

/** Apply hard per-candidate eligibility and keep one candidate per venue id. */
function routeEligibleCandidates<T>(
  candidates: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
  rejected: RouteRejectionCounts,
): GroundedPlanRouteCandidate<T>[] {
  const unique = new Map<string, GroundedPlanRouteCandidate<T>>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.venueId)) unique.set(candidate.venueId, candidate);
  }
  const eligible = [...unique.values()]
    .sort((left, right) => left.venueId.localeCompare(right.venueId, "en-GB"))
    .filter((candidate) => {
      if (candidate.promoted) { rejected.exclusions += 1; return false; }
      if (candidate.avoidedByReviewedSignal) { rejected.safety += 1; return false; }
      if (constraints.budgetLimitPence !== null && !priceEvidenceUsableForCeiling(candidate.price)) {
        rejected.budgetEvidence += 1;
        return false;
      }
      if (constraints.budgetLimitPence !== null && candidate.price.pence! > constraints.budgetLimitPence) {
        rejected.budgetCeiling += 1;
        return false;
      }
      const staticNeeds = constraints.accessibilityNeeds.filter((need) => need !== "low-noise");
      if (!staticNeeds.every((need) => accessNeedSatisfied(candidate.access, need, null))) {
        rejected.accessibility += 1;
        return false;
      }
      if (constraints.accessibilityNeeds.includes("low-noise")
        && (!constraints.routeWindow || !candidate.access.lowNoise)) {
        rejected.accessibility += 1;
        return false;
      }
      return true;
    });

  return constraints.routeWindow
    ? eligible.filter((candidate) => hasCurrentAttributableOpeningSchedule(candidate.openingSchedule, constraints.now))
    : eligible;
}

/** Select the strongest feasible 3-6-stop route with deterministic tie-breaks. */
export function selectGroundedPlanRoute<T>(
  candidates: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): GroundedPlanRouteSelection<T> {
  const target = planStopCount(constraints.stopCount);
  const rejected = { safety: 0, exclusions: 0, accessibility: 0, budgetEvidence: 0, budgetCeiling: 0 };
  if (constraints.transportConstraints.length > 0) {
    return { ok: false, eligibleCandidateCount: 0, rejected };
  }
  const routeEligible = routeEligibleCandidates(candidates, constraints, rejected);
  if (routeEligible.length < target) {
    return { ok: false, eligibleCandidateCount: routeEligible.length, rejected };
  }

  const best = findBestRoute(routeEligible, constraints);
  if (!best) return { ok: false, eligibleCandidateCount: routeEligible.length, rejected };

  const stops = selectedStops(best);
  const selectedIds = new Set(best.route.map((candidate) => candidate.venueId));
  const alternatives = stops.map((_, position) => routeEligible.flatMap((candidate) => {
    if (selectedIds.has(candidate.venueId)) return [];
    const replacement = [...best.route];
    replacement[position] = candidate;
    const evaluated = evaluateRoute(replacement, constraints);
    return evaluated ? [selectedStops(evaluated)[position]!] : [];
  }).sort((left, right) => right.score - left.score
    || left.venueId.localeCompare(right.venueId, "en-GB")));
  return { ok: true, stops, alternatives, timing: best.timing, constraintReport: report(best, constraints) };
}

export type AnchoredGroundedPlanRouteSelection<T> =
  | {
      ok: true;
      outcome: "route";
      stops: readonly SelectedGroundedPlanStop<T>[];
      alternatives: readonly (readonly SelectedGroundedPlanStop<T>[])[];
      timing: PlanRouteTiming;
      constraintReport: PlanConstraintReport;
    }
  | {
      ok: true;
      outcome: "anchor-only";
      anchor: SelectedGroundedPlanStop<T>;
      reason: "ANCHOR_COMPANIONS_INSUFFICIENT";
    }
  | { ok: false; reason: "ANCHOR_MISSING" };

function anchorOnlyStop<T>(
  anchor: GroundedPlanRouteCandidate<T>,
  now: number,
): SelectedGroundedPlanStop<T> {
  const opening = assessOpeningSchedule(anchor.openingSchedule, null, now);
  return { ...anchor, position: 0, visitWindow: null, opening, constraintFlags: flagsFor(opening, false) };
}

function findBestAnchoredRoute<T>(
  anchor: GroundedPlanRouteCandidate<T>,
  companions: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): EvaluatedRoute<T> | null {
  const targetCompanions = planStopCount(constraints.stopCount) - 1;
  const ranked = [...companions].sort((left, right) => right.score - left.score
    || left.venueId.localeCompare(right.venueId, "en-GB")).slice(0, MAX_ROUTE_SEARCH_CANDIDATES);
  if (targetCompanions > 2) {
    return beamBestRoute([[anchor]], ranked, planStopCount(constraints.stopCount), constraints);
  }
  return searchBestRouteCombinations(
    ranked,
    targetCompanions,
    [anchor],
    constraints,
  );
}

/** Keep accepted anchor as Stop 1; return an anchor-only draft when N-1 companions cannot be grounded. */
export function selectAnchoredGroundedPlanRoute<T>(
  candidates: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
  anchorVenueId: string,
): AnchoredGroundedPlanRouteSelection<T> {
  const anchor = candidates.find((candidate) => candidate.venueId === anchorVenueId);
  if (!anchor) return { ok: false, reason: "ANCHOR_MISSING" };

  const anchorStop = anchorOnlyStop(anchor, constraints.now);
  const insufficient: AnchoredGroundedPlanRouteSelection<T> = {
    ok: true,
    outcome: "anchor-only",
    anchor: anchorStop,
    reason: "ANCHOR_COMPANIONS_INSUFFICIENT",
  };
  if (constraints.transportConstraints.length > 0) return insufficient;

  const rejected = { safety: 0, exclusions: 0, accessibility: 0, budgetEvidence: 0, budgetCeiling: 0 };
  const companions = routeEligibleCandidates(candidates, constraints, rejected)
    .filter((candidate) => candidate.venueId !== anchorVenueId);
  if (companions.length < planStopCount(constraints.stopCount) - 1) return insufficient;

  const best = findBestAnchoredRoute(anchor, companions, constraints);
  if (!best) return insufficient;

  const stops = selectedStops(best);
  const selectedIds = new Set(best.route.map((candidate) => candidate.venueId));
  const alternatives = stops.map((_, position) => position === 0
    ? []
    : companions.flatMap((candidate) => {
        if (selectedIds.has(candidate.venueId)) return [];
        const replacement = [...best.route];
        replacement[position] = candidate;
        const evaluated = evaluateRoute(replacement, constraints);
        return evaluated ? [selectedStops(evaluated)[position]!] : [];
      }).sort((left, right) => right.score - left.score
        || left.venueId.localeCompare(right.venueId, "en-GB")));
  return { ok: true, outcome: "route", stops, alternatives, timing: best.timing, constraintReport: report(best, constraints) };
}
