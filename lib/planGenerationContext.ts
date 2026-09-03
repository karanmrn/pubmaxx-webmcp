import {
  inferNightContext,
  type ContextReason,
  type NightContext,
} from "@/lib/nightPlanning";
import { PLAN_TIME_WINDOWS } from "@/lib/planIntake";
import type { ParsedPlanGenerationIntake } from "@/lib/planGenerationIntake";

export type PlanContextSource = "query" | "context" | "intake" | "default";
export type ReconciledPlanContext = {
  context: NightContext;
  confidence: number;
  reasons: ContextReason[];
  fieldSources: Partial<Record<keyof NightContext, PlanContextSource>>;
};

function intakePatch(intake: ParsedPlanGenerationIntake): Partial<NightContext> {
  const skipped = new Set(intake.handoff.skipped);
  const time = intake.handoff.timeWindow
    ? PLAN_TIME_WINDOWS.find((option) => option.id === intake.handoff.timeWindow?.id)
    : null;
  return {
    ...(!skipped.has("area") && intake.exactNightArea ? { nightArea: intake.exactNightArea } : {}),
    ...(!skipped.has("time-window") && time ? { daypart: time.daypart } : {}),
    ...(!skipped.has("group-size") && intake.handoff.groupSize !== null
      ? { groupSize: intake.handoff.groupSize }
      : {}),
    ...(intake.handoff.stopCount !== undefined ? { stopCount: intake.handoff.stopCount } : {}),
    ...(!skipped.has("budget") && intake.handoff.budget ? {
      budget: intake.handoff.budget.tier,
      budgetLimitPence: intake.handoff.budget.limitPence,
    } : {}),
    ...(!skipped.has("accessibility")
      ? { accessibility: [...intake.handoff.accessibilityNeeds] }
      : {}),
  };
}

function intakeReason(field: keyof NightContext, intake: ParsedPlanGenerationIntake): ContextReason {
  const evidence = field === "nightArea"
    ? intake.handoff.area?.id ?? "selected patch"
    : field === "daypart"
      ? intake.handoff.timeWindow?.id ?? "selected time"
      : field === "groupSize"
        ? String(intake.handoff.groupSize)
        : field === "stopCount"
          ? String(intake.handoff.stopCount ?? 3)
          : field === "budgetLimitPence"
          ? intake.handoff.budget?.limitPence === null
            ? "no explicit ceiling"
            : `£${((intake.handoff.budget?.limitPence ?? 0) / 100).toFixed(2)}`
          : field === "budget"
            ? intake.handoff.budget?.tier ?? "selected budget"
            : intake.handoff.accessibilityNeeds.join(", ") || "no access needs";
  return { field, evidence, explanation: "Applied from the completed Plan intake." };
}

/** Reconcile fields by authority and preserve an auditable source per field. */
export function reconcilePlanContext(
  query: string,
  explicit: Partial<NightContext> | null,
  intake: ParsedPlanGenerationIntake | null,
  now: Date,
): ReconciledPlanContext {
  const inferred = inferNightContext(query, now);
  const contextPatch = explicit ?? {};
  const authoritative = intake ? intakePatch(intake) : {};
  const context: NightContext = { ...inferred.context, ...contextPatch, ...authoritative };
  const fieldSources: ReconciledPlanContext["fieldSources"] = {};
  for (const field of Object.keys(context) as (keyof NightContext)[]) {
    fieldSources[field] = Object.hasOwn(authoritative, field)
      ? "intake"
      : Object.hasOwn(contextPatch, field)
        ? "context"
        : inferred.reasons.some((reason) => reason.field === field)
          ? "query"
          : "default";
  }
  const reasons = inferred.reasons.filter((reason) => fieldSources[reason.field] === "query");
  for (const field of Object.keys(contextPatch) as (keyof NightContext)[]) {
    if (fieldSources[field] === "context") {
      reasons.push({ field, evidence: "explicit context", explanation: "Applied from the explicit Night Context correction." });
    }
  }
  for (const field of Object.keys(authoritative) as (keyof NightContext)[]) {
    reasons.push(intakeReason(field, intake!));
  }
  const confidence = Object.keys(authoritative).length > 0
    ? Math.max(inferred.confidence, 0.9)
    : Object.keys(contextPatch).length > 0
      ? Math.max(inferred.confidence, 0.82)
      : inferred.confidence;
  return { context, confidence, reasons, fieldSources };
}
