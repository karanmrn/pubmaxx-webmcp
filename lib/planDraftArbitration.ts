import {
  NIGHT_PATCHES,
  type NightPatchId,
  type RememberedArea,
} from "@/lib/nightPatches";
import type { ParsedPlanDraft, StoredPlanDraft } from "@/lib/planDraft";
import type { ParsedPlanIntakeDraft } from "@/lib/planIntake";
import type { ParsedPlanRouteDraft } from "@/lib/planRouteDraft";
import type { PlanningIntentArea, PlanningIntentV1 } from "@/lib/planningIntent";

export type DraftSurface = "map" | "plan" | "route";

export type DraftArbitrationProvenance =
  | "explicit-url"
  | "plan-v2"
  | "plan-legacy"
  | "intake-v1"
  | "route-v2"
  | "route-legacy"
  | "planning-intent"
  | "remembered-area"
  | "default"
  | "none";

export type DraftArbitrationConflictCode =
  | "draft-overlap"
  | "intent-preserved-existing"
  | "inspection-not-anchor"
  | "anchor-replaced"
  | "route-anchor-conflict"
  | "route-proof-stale"
  | "operation-replay";

export type DraftArbitrationRecoveryAction =
  | "review-plan-details"
  | "review-existing-plan"
  | "make-it-stop-1"
  | "restore-accepted-stop"
  | "regenerate-route"
  | "none";

export type DraftArbitrationConflict = {
  code: DraftArbitrationConflictCode;
  message: string;
  recoveryAction: DraftArbitrationRecoveryAction;
};

export type DraftField<T> = {
  value: T;
  source: DraftArbitrationProvenance;
};

export type DraftArbitrationDefaults = {
  surface?: DraftSurface;
  area?: PlanningIntentArea;
  startsAt?: string | null;
  acceptedVenueId?: string | null;
  title?: string;
  creatorName?: string;
  conciergeQuery?: string;
};

export type DraftArbitrationUrl = {
  surface: DraftSurface | null;
  selectedVenueId: string | null;
  replaceAnchor: boolean;
};

export type PlanDraftArbitrationInput = {
  url?: Partial<DraftArbitrationUrl> | null;
  planDraft?: ParsedPlanDraft | null;
  routeDraft?: ParsedPlanRouteDraft | null;
  intakeDraft?: ParsedPlanIntakeDraft | null;
  planningIntent?: PlanningIntentV1 | null;
  rememberedArea?: RememberedArea | null;
  defaults?: DraftArbitrationDefaults;
  lastAppliedOperationKey?: string | null;
};

export type PlanDraftArbitrationResult = {
  surface: DraftField<DraftSurface>;
  inspectionVenueId: DraftField<string | null>;
  acceptedVenueId: DraftField<string | null>;
  area: DraftField<PlanningIntentArea>;
  startsAt: DraftField<string | null>;
  title: DraftField<string>;
  creatorName: DraftField<string>;
  conciergeQuery: DraftField<string>;
  routePreview: ParsedPlanRouteDraft | null;
  routeProofPresent: boolean;
  conflicts: DraftArbitrationConflict[];
  hydration: {
    status: "complete";
    defaultsMayWrite: true;
  };
};

function populated(value: string | null | undefined): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function sourceForPlan(plan: ParsedPlanDraft): DraftArbitrationProvenance {
  return plan.legacy ? "plan-legacy" : "plan-v2";
}

function sourceForRoute(route: ParsedPlanRouteDraft): DraftArbitrationProvenance {
  return route.legacy ? "route-legacy" : "route-v2";
}

function normalizeRememberedArea(value: RememberedArea | null | undefined): PlanningIntentArea {
  if (!value) return null;
  if (value.kind === "borough") return { kind: "borough", name: value.name };
  return NIGHT_PATCHES.some((patch) => patch.id === value.id)
    ? { kind: "night-patch", id: value.id as NightPatchId }
    : null;
}

function sameArea(left: PlanningIntentArea, right: PlanningIntentArea): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  return left.kind === "night-patch" && right.kind === "night-patch"
    ? left.id === right.id
    : left.kind === "borough" && right.kind === "borough" && left.name === right.name;
}

function firstPlanVenue(plan: ParsedPlanDraft | null | undefined): string | null {
  const venueId = plan?.draft.stops.find((stop) => populated(stop.venueId))?.venueId;
  return populated(venueId) ? venueId.trim() : null;
}

function planText(
  plan: ParsedPlanDraft | null | undefined,
  key: keyof Pick<StoredPlanDraft, "title" | "creatorName" | "conciergeQuery">,
  fallback: string | undefined,
): DraftField<string> {
  const value = plan?.draft[key];
  if (plan && populated(value)) return { value, source: sourceForPlan(plan) };
  return fallback !== undefined
    ? { value: fallback, source: "default" }
    : { value: "", source: "none" };
}

function startsAtField(
  plan: ParsedPlanDraft | null | undefined,
  intake: ParsedPlanIntakeDraft | null | undefined,
  intent: PlanningIntentV1 | null,
  fallback: string | null | undefined,
  conflicts: DraftArbitrationConflict[],
): DraftField<string | null> {
  const planValue = populated(plan?.draft.startTime) ? plan.draft.startTime : null;
  const intakeValue = populated(intake?.draft.answers.exactStartIso)
    ? intake.draft.answers.exactStartIso
    : null;

  if (planValue && intakeValue) {
    if (plan?.legacy) {
      if (planValue !== intakeValue) conflicts.push({
        code: "draft-overlap",
        message: "Kept an existing Plan time because its legacy age is unknown.",
        recoveryAction: "review-plan-details",
      });
      return { value: planValue, source: "plan-legacy" };
    }
    const planSavedAt = Date.parse(plan?.savedAt ?? "");
    const intakeSavedAt = Date.parse(intake?.savedAt ?? "");
    const intakeWins = Number.isFinite(intakeSavedAt)
      && (!Number.isFinite(planSavedAt) || intakeSavedAt > planSavedAt);
    if (planValue !== intakeValue) conflicts.push({
      code: "draft-overlap",
      message: intakeWins
        ? "Used the newer intake time and preserved the older Plan draft."
        : "Used the newer Plan time and preserved the intake draft.",
      recoveryAction: "review-plan-details",
    });
    return intakeWins
      ? { value: intakeValue, source: "intake-v1" }
      : { value: planValue, source: "plan-v2" };
  }
  if (plan && planValue) return { value: planValue, source: sourceForPlan(plan) };
  if (intakeValue) return { value: intakeValue, source: "intake-v1" };
  if (intent?.startsAt) return { value: intent.startsAt, source: "planning-intent" };
  if (fallback !== undefined) return { value: fallback, source: "default" };
  return { value: null, source: "none" };
}

function areaField(
  intake: ParsedPlanIntakeDraft | null | undefined,
  intent: PlanningIntentV1 | null,
  rememberedArea: RememberedArea | null | undefined,
  fallback: PlanningIntentArea | undefined,
): DraftField<PlanningIntentArea> {
  if (intake?.draft.answers.area) {
    return {
      value: { kind: "night-patch", id: intake.draft.answers.area },
      source: "intake-v1",
    };
  }
  if (intent?.acceptedArea) return { value: intent.acceptedArea, source: "planning-intent" };
  const remembered = normalizeRememberedArea(rememberedArea);
  if (remembered) return { value: remembered, source: "remembered-area" };
  if (fallback !== undefined) return { value: fallback, source: "default" };
  return { value: null, source: "none" };
}

function acceptedVenueField(
  plan: ParsedPlanDraft | null,
  route: ParsedPlanRouteDraft | null,
  intent: PlanningIntentV1 | null,
  selectedVenueId: string | null,
  replaceAnchor: boolean,
  fallback: string | null | undefined,
  conflicts: DraftArbitrationConflict[],
): DraftField<string | null> {
  const planVenueId = firstPlanVenue(plan);
  let accepted: DraftField<string | null> = planVenueId
    ? { value: planVenueId, source: sourceForPlan(plan as ParsedPlanDraft) }
    : route?.value.anchorVenueId
      ? { value: route.value.anchorVenueId, source: sourceForRoute(route) }
      : intent
        ? { value: intent.acceptedVenueId, source: "planning-intent" }
        : fallback !== undefined
          ? { value: fallback, source: "default" }
          : { value: null, source: "none" };

  if (route?.value.anchorVenueId && planVenueId && route.value.anchorVenueId !== planVenueId) {
    conflicts.push({
      code: "route-anchor-conflict",
      message: "The saved Route starts somewhere different from the current Plan.",
      recoveryAction: "restore-accepted-stop",
    });
  }
  if (intent && accepted.source !== "planning-intent" && accepted.value
    && accepted.value !== intent.acceptedVenueId) {
    conflicts.push({
      code: "intent-preserved-existing",
      message: "Kept existing Plan work instead of replacing it with a newer Venue acceptance.",
      recoveryAction: "review-existing-plan",
    });
  }
  if (selectedVenueId && replaceAnchor) {
    if (accepted.value !== selectedVenueId) conflicts.push({
      code: "anchor-replaced",
      message: "Made the inspected Venue Stop 1 by explicit request.",
      recoveryAction: "restore-accepted-stop",
    });
    accepted = { value: selectedVenueId, source: "explicit-url" };
  } else if (selectedVenueId && accepted.value && selectedVenueId !== accepted.value) {
    conflicts.push({
      code: "inspection-not-anchor",
      message: "You're looking at another venue. Your accepted Stop 1 is unchanged.",
      recoveryAction: "make-it-stop-1",
    });
  }
  return accepted;
}

function addIntentPreservationConflicts(
  intent: PlanningIntentV1 | null,
  area: DraftField<PlanningIntentArea>,
  startsAt: DraftField<string | null>,
  conflicts: DraftArbitrationConflict[],
): void {
  if (intent?.acceptedArea && area.source !== "planning-intent" && !sameArea(area.value, intent.acceptedArea)) {
    conflicts.push({
      code: "intent-preserved-existing",
      message: "Kept the existing Plan area instead of replacing it from Venue acceptance.",
      recoveryAction: "review-existing-plan",
    });
  }
  if (intent?.startsAt && startsAt.source !== "planning-intent" && startsAt.value !== intent.startsAt) {
    conflicts.push({
      code: "intent-preserved-existing",
      message: "Kept the existing Plan time instead of replacing it from Venue acceptance.",
      recoveryAction: "review-existing-plan",
    });
  }
}

function routeWithReplayState(
  route: ParsedPlanRouteDraft | null | undefined,
  lastAppliedOperationKey: string | null | undefined,
  conflicts: DraftArbitrationConflict[],
): ParsedPlanRouteDraft | null {
  if (!route?.value.stops.length) return null;
  let routeStale = route.value.routeStale;
  if (routeStale) conflicts.push({
    code: "route-proof-stale",
    message: "The saved Route proof expired or could not be read. Review a refreshed Route before locking it in.",
    recoveryAction: "regenerate-route",
  });
  if (
    populated(lastAppliedOperationKey)
    && route.value.operationKey === lastAppliedOperationKey.trim()
  ) {
    routeStale = true;
    conflicts.push({
      code: "operation-replay",
      message: "This Route operation was already applied in another tab.",
      recoveryAction: "regenerate-route",
    });
  }
  return routeStale === route.value.routeStale
    ? route
    : { ...route, value: { ...route.value, routeStale } };
}

/**
 * Resolve persisted state before any component writes product defaults. The
 * function is pure so duplicate tabs and StrictMode hydration receive the same
 * winner without mutating or clearing rollback data.
 */
export function arbitratePlanDrafts(input: PlanDraftArbitrationInput): PlanDraftArbitrationResult {
  const conflicts: DraftArbitrationConflict[] = [];
  const plan = input.planDraft ?? null;
  const route = routeWithReplayState(
    input.routeDraft,
    input.lastAppliedOperationKey,
    conflicts,
  );
  const intent = input.planningIntent ?? null;
  const selectedVenueId = populated(input.url?.selectedVenueId)
    ? input.url.selectedVenueId.trim()
    : null;

  const acceptedVenueId = acceptedVenueField(
    plan,
    route,
    intent,
    selectedVenueId,
    input.url?.replaceAnchor === true,
    input.defaults?.acceptedVenueId,
    conflicts,
  );
  const area = areaField(
    input.intakeDraft,
    intent,
    input.rememberedArea,
    input.defaults?.area,
  );
  const startsAt = startsAtField(
    plan,
    input.intakeDraft,
    intent,
    input.defaults?.startsAt,
    conflicts,
  );
  addIntentPreservationConflicts(intent, area, startsAt, conflicts);

  const surface = input.url?.surface
    ? { value: input.url.surface, source: "explicit-url" as const }
    : { value: input.defaults?.surface ?? "plan", source: "default" as const };

  return {
    surface,
    inspectionVenueId: selectedVenueId
      ? { value: selectedVenueId, source: "explicit-url" }
      : { value: null, source: "none" },
    acceptedVenueId,
    area,
    startsAt,
    title: planText(plan, "title", input.defaults?.title),
    creatorName: planText(plan, "creatorName", input.defaults?.creatorName),
    conciergeQuery: planText(plan, "conciergeQuery", input.defaults?.conciergeQuery),
    routePreview: route,
    routeProofPresent: Boolean(route?.value.groundingProof && !route.value.routeStale),
    conflicts,
    hydration: {
      status: "complete",
      defaultsMayWrite: true,
    },
  };
}
