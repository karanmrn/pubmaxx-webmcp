import { inferNightContext, type NightContext } from "@/lib/nightPlanning";
import { NIGHT_AREAS, type NightAreaSlug } from "@/lib/nightAreas";
import { applyTemplate } from "@/lib/planComposerHandoff";
import {
  nightAreaForPlanIntakePatch,
  type PlanIntakeDraft,
  type PlanIntakeStep,
} from "@/lib/planIntake";
import { NIGHT_PATCHES, type NightPatchId } from "@/lib/nightPatches";
import { normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";
import type { PlanTemplate } from "@/lib/planTemplates";

/** Keep non-empty user text; only empty fields accept a chip or template suggestion. */
export function fillEmptyText(current: string, suggestion: string): string {
  return current.trim() ? current : suggestion;
}

export function resolveDescribeChipSubmit(input: {
  query: string;
  stopCountTouched: boolean;
  stopCount: PlanStopCount;
  chipText: string;
  chipInferredStopCount: PlanStopCount;
}): { query: string; stopCount: PlanStopCount } {
  const userQuery = input.query.trim();
  const query = userQuery || input.chipText;
  const typedStopCount = userQuery
    ? normalizePlanStopCount(inferNightContext(userQuery).context.stopCount)
    : input.chipInferredStopCount;
  const stopCount = input.stopCountTouched ? input.stopCount : typedStopCount;
  return { query, stopCount };
}

export function nightPatchIdForNightArea(slug: NightAreaSlug): NightPatchId | null {
  for (const patch of NIGHT_PATCHES) {
    if (nightAreaForPlanIntakePatch(patch.id) === slug) return patch.id;
  }
  return null;
}

export type PlanQueryAreaAuthority =
  | { kind: "none" }
  | { kind: "supported"; slug: NightAreaSlug; patchId: NightPatchId }
  | { kind: "unmapped"; slug: NightAreaSlug }
  | { kind: "unsupported-patch"; patchId: NightPatchId };

export function nightAreaFromPlanQuery(query: string): PlanQueryAreaAuthority {
  const slug = inferNightContext(query).context.nightArea;
  if (slug) {
    const patchId = nightPatchIdForNightArea(slug);
    return patchId ? { kind: "supported", slug, patchId } : { kind: "unmapped", slug };
  }
  const lower = query.toLocaleLowerCase();
  const patch = NIGHT_PATCHES.find(({ label }) => lower.includes(label.toLocaleLowerCase()));
  return patch ? { kind: "unsupported-patch", patchId: patch.id } : { kind: "none" };
}

/** A submitted describe-first query owns intake area over a geo or remembered seed. */
export function syncPlanIntakeAreaFromQuery(draft: PlanIntakeDraft, query: string): PlanIntakeDraft {
  const queryArea = nightAreaFromPlanQuery(query);
  if (queryArea.kind === "none") return draft;
  const patchId = queryArea.kind === "supported" ? queryArea.patchId : null;
  if (!patchId) {
    if (draft.answers.area === null) return draft;
    const skippedSteps: PlanIntakeStep[] = draft.settledSteps.includes("area")
      ? [...new Set<PlanIntakeStep>([...draft.skippedSteps, "area"])]
      : draft.skippedSteps;
    return {
      ...draft,
      answers: { ...draft.answers, area: null },
      skippedSteps,
    };
  }
  if (draft.answers.area === patchId) {
    if (!draft.skippedSteps.includes("area")) return draft;
    return {
      ...draft,
      skippedSteps: draft.skippedSteps.filter((step) => step !== "area"),
    };
  }
  const settledSteps = draft.settledSteps.includes("area")
    ? draft.settledSteps
    : [...new Set<PlanIntakeStep>([...draft.settledSteps, "area"])];
  return {
    ...draft,
    answers: { ...draft.answers, area: patchId },
    currentStep: draft.currentStep === "area" ? "time-window" : draft.currentStep,
    settledSteps,
    skippedSteps: draft.skippedSteps.filter((step) => step !== "area"),
  };
}

export function composerGeolocationMaySeedIntake(input: {
  showsDescribeFirst: boolean;
  hasQueryText: boolean;
}): boolean {
  return !input.showsDescribeFirst && !input.hasQueryText;
}

export function mergeInferredNightContext(
  inferred: NightContext,
  explicit: Partial<NightContext>,
): NightContext {
  return { ...inferred, ...explicit };
}

export function mergeSubmittedNightContext(
  explicit: Partial<NightContext>,
  intake: Partial<NightContext>,
  queryArea: PlanQueryAreaAuthority = { kind: "none" },
): Partial<NightContext> {
  return {
    ...explicit,
    ...(intake.nightArea ? { nightArea: intake.nightArea } : {}),
    ...(queryArea.kind === "supported" || queryArea.kind === "unmapped"
      ? { nightArea: queryArea.slug }
      : queryArea.kind === "unsupported-patch" ? { nightArea: null } : {}),
    ...(intake.stopCount !== undefined ? { stopCount: intake.stopCount } : {}),
  };
}

function escapeQueryTerm(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTemplateGeography(query: string): string {
  const labels = [
    ...NIGHT_AREAS.flatMap((area) => [area.name, ...area.aliases]),
    ...NIGHT_PATCHES.map((patch) => patch.label),
  ]
    .sort((left, right) => right.length - left.length)
    .map(escapeQueryTerm)
    .join("|");
  if (!labels) return query;
  const areaPattern = `(?:${labels})`;
  return query
    .replace(new RegExp(`\\s+(?:in|near|around|from|by)\\s+${areaPattern}\\b`, "gi"), "")
    .replace(new RegExp(`\\b${areaPattern}\\b`, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Align stop count with the generated route so Lock it in can enable. */
export function reconcileGeneratedNightContext(
  inferred: NightContext,
  explicit: Partial<NightContext>,
  generatedStopCount: number,
): NightContext {
  const merged = mergeInferredNightContext(inferred, explicit);
  return {
    ...merged,
    stopCount: explicit.stopCount ?? normalizePlanStopCount(generatedStopCount),
  };
}

export function mergePlanTemplateFields(input: {
  title: string;
  conciergeQuery: string;
  conciergeNote: string;
  template: PlanTemplate;
  hasAcceptedGeography: boolean;
}): { title: string; conciergeQuery: string; conciergeNote: string } {
  const applied = applyTemplate(input.template, input.hasAcceptedGeography);
  const templateQuery = applied.geographyLocked
    ? stripTemplateGeography(applied.conciergeQuery)
    : applied.conciergeQuery;
  return {
    title: fillEmptyText(input.title, applied.title),
    conciergeQuery: fillEmptyText(input.conciergeQuery, templateQuery),
    conciergeNote: fillEmptyText(input.conciergeNote, input.template.blurb),
  };
}
