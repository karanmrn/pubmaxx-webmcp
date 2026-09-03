import {
  PLAN_ACCESSIBILITY_NEEDS,
  PLAN_BUDGET_OPTIONS,
  PLAN_INTAKE_STEPS,
  PLAN_INTAKE_VERSION,
  PLAN_TIME_WINDOWS,
  londonDateTimeInputFromIso,
  londonDateTimeInputToIso,
  nightAreaForPlanIntakePatch,
  type PlanAccessibilityNeed,
  type PlanIntakeHandoff,
  type PlanIntakeStep,
  type PlanTimeWindowId,
} from "@/lib/planIntake";
import { NIGHT_PATCHES, type NightPatchId } from "@/lib/nightPatches";
import type { Budget, NightAreaSlug } from "@/lib/nightPlanning";
import { isPlanStopCount, normalizePlanStopCount } from "@/lib/planStopCount";
import { DAY_MS } from "@/lib/dayMs";

export const PLAN_GENERATION_HORIZON_DAYS = 14;
export const PLAN_GENERATION_HORIZON_MS = PLAN_GENERATION_HORIZON_DAYS * DAY_MS;

const INTAKE_KEYS = [
  "version",
  "area",
  "timeWindow",
  "groupSize",
  "stopCount",
  "budget",
  "accessibilityNeeds",
  "skipped",
] as const;
const LEGACY_INTAKE_KEYS = INTAKE_KEYS.filter((key) => key !== "stopCount");
const AREA_KEYS = ["kind", "id"] as const;
const TIME_KEYS = ["id", "start", "end", "exactStartIso"] as const;
const BUDGET_KEYS = ["tier", "limitPence"] as const;

export type PlanIntakeParseFailure = {
  ok: false;
  code:
    | "INTAKE_VERSION_UNSUPPORTED"
    | "PLAN_INTAKE_MALFORMED"
    | "INTAKE_START_NOT_FUTURE"
    | "INTAKE_START_OUT_OF_RANGE";
  message: string;
};

export type ParsedPlanGenerationIntake = {
  handoff: PlanIntakeHandoff;
  exactNightArea: NightAreaSlug | null;
  unsupportedPatch: NightPatchId | null;
  routeWindow: { startsAt: string; endsAt: string } | null;
};

export type PlanIntakeParseResult =
  | { ok: true; value: ParsedPlanGenerationIntake }
  | PlanIntakeParseFailure;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function hasIntakeKeys(record: Record<string, unknown>): boolean {
  return hasExactKeys(record, INTAKE_KEYS) || hasExactKeys(record, LEGACY_INTAKE_KEYS);
}

function isNightPatchId(value: unknown): value is NightPatchId {
  return typeof value === "string" && NIGHT_PATCHES.some((patch) => patch.id === value);
}

function isStep(value: unknown): value is PlanIntakeStep {
  return typeof value === "string" && (PLAN_INTAKE_STEPS as readonly string[]).includes(value);
}

function isNeed(value: unknown): value is PlanAccessibilityNeed {
  return typeof value === "string" && PLAN_ACCESSIBILITY_NEEDS.some((need) => need.id === value);
}

function londonClockMinutes(iso: string): number | null {
  const input = londonDateTimeInputFromIso(iso);
  const match = input ? /T(\d{2}):(\d{2})$/.exec(input) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function presetContainsStart(windowId: PlanTimeWindowId, iso: string): boolean {
  const option = PLAN_TIME_WINDOWS.find((candidate) => candidate.id === windowId);
  const minute = londonClockMinutes(iso);
  if (!option || minute === null) return false;
  const [startHour, startMinute] = option.start.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  if (option.end === null) return minute >= start || minute < 4 * 60;
  const [endHour, endMinute] = option.end.split(":").map(Number);
  return minute >= start && minute < endHour * 60 + endMinute;
}

function windowEndIso(windowId: PlanTimeWindowId, exactStartIso: string): string | null {
  const option = PLAN_TIME_WINDOWS.find((candidate) => candidate.id === windowId);
  const local = londonDateTimeInputFromIso(exactStartIso);
  if (!option || !local) return null;
  if (option.end === null) {
    return new Date(Date.parse(exactStartIso) + 6 * 60 * 60 * 1000).toISOString();
  }
  return londonDateTimeInputToIso(
    `${local.slice(0, 10)}T${option.end}`,
    new Date(Date.parse(exactStartIso) - 1),
  );
}

function parseArea(value: unknown): PlanIntakeHandoff["area"] | undefined {
  if (value === null) return null;
  if (!isPlainRecord(value) || !hasExactKeys(value, AREA_KEYS)) return undefined;
  return value.kind === "night-patch" && isNightPatchId(value.id)
    ? { kind: "night-patch", id: value.id }
    : undefined;
}

function parseTimeWindow(
  value: unknown,
  now: Date,
): { ok: true; value: PlanIntakeHandoff["timeWindow"]; routeWindow: ParsedPlanGenerationIntake["routeWindow"] } | PlanIntakeParseFailure {
  if (value === null) return { ok: true, value: null, routeWindow: null };
  if (!isPlainRecord(value) || !hasExactKeys(value, TIME_KEYS)) {
    return malformed("Plan intake time window is invalid.");
  }
  const option = PLAN_TIME_WINDOWS.find((candidate) => candidate.id === value.id);
  const timestamp = typeof value.exactStartIso === "string" ? Date.parse(value.exactStartIso) : Number.NaN;
  if (
    !option
    || value.start !== option.start
    || value.end !== option.end
    || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString() !== value.exactStartIso
    || !presetContainsStart(option.id, value.exactStartIso as string)
  ) return malformed("Plan intake time window is invalid.");
  if (timestamp <= now.getTime()) {
    return { ok: false, code: "INTAKE_START_NOT_FUTURE", message: "Choose a future start time." };
  }
  if (timestamp - now.getTime() > PLAN_GENERATION_HORIZON_MS) {
    return {
      ok: false,
      code: "INTAKE_START_OUT_OF_RANGE",
      message: `Choose a start within the next ${PLAN_GENERATION_HORIZON_DAYS} days.`,
    };
  }
  const endsAt = windowEndIso(option.id, value.exactStartIso as string);
  if (!endsAt || Date.parse(endsAt) <= timestamp) return malformed("Plan intake time window is invalid.");
  return {
    ok: true,
    value: {
      id: option.id,
      start: option.start,
      end: option.end,
      exactStartIso: new Date(timestamp).toISOString(),
    },
    routeWindow: { startsAt: new Date(timestamp).toISOString(), endsAt },
  };
}

function parseBudget(value: unknown): PlanIntakeHandoff["budget"] | undefined {
  if (value === null) return null;
  if (!isPlainRecord(value) || !hasExactKeys(value, BUDGET_KEYS)) return undefined;
  if (!PLAN_BUDGET_OPTIONS.some((option) => option.budget === value.tier)) return undefined;
  const limitPence = value.limitPence === null
    ? null
    : typeof value.limitPence === "number"
      && Number.isSafeInteger(value.limitPence)
      && value.limitPence >= 500
      && value.limitPence <= 50_000
        ? value.limitPence
        : undefined;
  return limitPence === undefined
    ? undefined
    : { tier: value.tier as Budget, limitPence };
}

function skippedAnswerIsClear(handoff: PlanIntakeHandoff, step: PlanIntakeStep): boolean {
  switch (step) {
    case "area": return handoff.area === null;
    case "time-window": return handoff.timeWindow === null;
    case "group-size": return handoff.groupSize === null;
    case "budget": return handoff.budget === null;
    case "accessibility": return handoff.accessibilityNeeds.length === 0;
  }
}

function missingAnswerWasSkipped(handoff: PlanIntakeHandoff): boolean {
  const skipped = new Set(handoff.skipped);
  return (handoff.area !== null || skipped.has("area"))
    && (handoff.timeWindow !== null || skipped.has("time-window"))
    && (handoff.groupSize !== null || skipped.has("group-size"))
    && (handoff.budget !== null || skipped.has("budget"));
}

function malformed(message: string): PlanIntakeParseFailure {
  return { ok: false, code: "PLAN_INTAKE_MALFORMED", message };
}

/** Strict v1 handoff parser. Unknown keys and incoherent skipped answers fail closed. */
export function parsePlanGenerationIntake(raw: unknown, now = new Date()): PlanIntakeParseResult {
  if (!isPlainRecord(raw) || !hasIntakeKeys(raw)) return malformed("Plan intake is malformed.");
  if (raw.version !== PLAN_INTAKE_VERSION) {
    return { ok: false, code: "INTAKE_VERSION_UNSUPPORTED", message: "This Plan intake version is not supported." };
  }
  const area = parseArea(raw.area);
  if (area === undefined) return malformed("Plan intake area is invalid.");
  const parsedTime = parseTimeWindow(raw.timeWindow, now);
  if (!parsedTime.ok) return parsedTime;
  const groupSize = raw.groupSize === null
    ? null
    : typeof raw.groupSize === "number"
      && Number.isSafeInteger(raw.groupSize)
      && raw.groupSize >= 1
      && raw.groupSize <= 30
        ? raw.groupSize
        : undefined;
  if (groupSize === undefined) return malformed("Plan intake group size is invalid.");
  if (raw.stopCount !== undefined && !isPlanStopCount(raw.stopCount)) {
    return malformed("Plan intake stop count is invalid.");
  }
  const budget = parseBudget(raw.budget);
  if (budget === undefined) return malformed("Plan intake budget is invalid.");
  if (
    !Array.isArray(raw.accessibilityNeeds)
    || raw.accessibilityNeeds.length > PLAN_ACCESSIBILITY_NEEDS.length
    || !raw.accessibilityNeeds.every(isNeed)
    || new Set(raw.accessibilityNeeds).size !== raw.accessibilityNeeds.length
  ) return malformed("Plan intake accessibility needs are invalid.");
  if (
    !Array.isArray(raw.skipped)
    || raw.skipped.length > PLAN_INTAKE_STEPS.length
    || !raw.skipped.every(isStep)
    || new Set(raw.skipped).size !== raw.skipped.length
  ) return malformed("Plan intake skipped steps are invalid.");

  const handoff: PlanIntakeHandoff = {
    version: PLAN_INTAKE_VERSION,
    area,
    timeWindow: parsedTime.value,
    groupSize,
    ...(raw.stopCount !== undefined ? { stopCount: normalizePlanStopCount(raw.stopCount) } : {}),
    budget,
    accessibilityNeeds: [...raw.accessibilityNeeds],
    skipped: [...raw.skipped],
  };
  if (!handoff.skipped.every((step) => skippedAnswerIsClear(handoff, step)) || !missingAnswerWasSkipped(handoff)) {
    return malformed("Plan intake skipped steps conflict with supplied answers.");
  }
  const exactNightArea = area ? nightAreaForPlanIntakePatch(area.id) : null;
  return {
    ok: true,
    value: {
      handoff,
      exactNightArea,
      unsupportedPatch: area && !exactNightArea ? area.id : null,
      routeWindow: parsedTime.routeWindow,
    },
  };
}
