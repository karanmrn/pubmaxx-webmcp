import {
  NIGHT_PATCHES,
  resolveNightPatch,
  type NightPatchId,
  type RememberedArea,
} from "@/lib/nightPatches";
import type {
  Budget,
  Daypart,
  NightContext,
  NightAreaSlug,
} from "@/lib/nightPlanning";
import type { CityId } from "@/lib/cities";
import type { PlanGenerationAnchor as PlanGenerationWireAnchor } from "@/lib/planGenerationRequest";
import { isPlanStopCount, normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";
import { DAY_MS } from "@/lib/dayMs";
import { safeLocalStorage } from "@/lib/safeStorage";

export const PLAN_INTAKE_VERSION = 1 as const;
export const PLAN_INTAKE_STORAGE_KEY = "pubmax:plan-intake:v1";
export const PLAN_INTAKE_DRAFT_TTL_MS = DAY_MS;
export const PLAN_INTAKE_MAX_RAW_BYTES = 12 * 1024;
const LONDON_TIME_ZONE = "Europe/London";

export const PLAN_INTAKE_STEPS = [
  "area",
  "time-window",
  "group-size",
  "budget",
  "accessibility",
] as const;
export type PlanIntakeStep = (typeof PLAN_INTAKE_STEPS)[number];

export const PLAN_TIME_WINDOWS = [
  { id: "after-work", label: "After work", note: "5:30 to 8:30", start: "17:30", end: "20:30", daypart: "after_work" },
  { id: "evening", label: "Evening", note: "7:00 to 11:00", start: "19:00", end: "23:00", daypart: "evening" },
  { id: "late", label: "Late", note: "10:00 onwards", start: "22:00", end: null, daypart: "late_night" },
] as const satisfies readonly {
  id: string;
  label: string;
  note: string;
  start: string;
  end: string | null;
  daypart: Daypart;
}[];
export type PlanTimeWindowId = (typeof PLAN_TIME_WINDOWS)[number]["id"];

export const PLAN_BUDGET_OPTIONS = [
  { id: "value", label: "Keep it lean", note: "Value-led stops", budget: "value" },
  { id: "standard", label: "Standard", note: "A balanced night", budget: "standard" },
  { id: "treat", label: "Treat night", note: "Room to spend more", budget: "treat" },
] as const satisfies readonly {
  id: string;
  label: string;
  note: string;
  budget: Budget;
}[];

export const PLAN_ACCESSIBILITY_NEEDS = [
  { id: "step-free", label: "Step-free access" },
  { id: "accessible-toilet", label: "Accessible toilet" },
  { id: "seating", label: "Reliable seating" },
  { id: "low-noise", label: "Quieter spaces" },
] as const;
export type PlanAccessibilityNeed = (typeof PLAN_ACCESSIBILITY_NEEDS)[number]["id"];

export type PlanIntakeAnswers = {
  area: NightPatchId | null;
  timeWindow: PlanTimeWindowId | null;
  exactStartIso: string | null;
  groupSize: number | null;
  stopCount?: PlanStopCount;
  budget: Budget | null;
  budgetLimitPence: number | null;
  accessibilityNeeds: PlanAccessibilityNeed[];
};

export type PlanIntakeDraft = {
  version: typeof PLAN_INTAKE_VERSION;
  currentStep: PlanIntakeStep;
  settledSteps: PlanIntakeStep[];
  skippedSteps: PlanIntakeStep[];
  completed: boolean;
  answers: PlanIntakeAnswers;
};

/** Stable client-to-generator envelope owned by Wave 2.1 and consumed by 2.2. */
export type PlanIntakeHandoff = {
  version: typeof PLAN_INTAKE_VERSION;
  area: { kind: "night-patch"; id: NightPatchId } | null;
  timeWindow: {
    id: PlanTimeWindowId;
    start: string;
    end: string | null;
    exactStartIso: string;
  } | null;
  groupSize: number | null;
  stopCount?: PlanStopCount;
  budget: { tier: Budget; limitPence: number | null } | null;
  accessibilityNeeds: PlanAccessibilityNeed[];
  skipped: PlanIntakeStep[];
};

type StoredPlanIntakeEnvelope = {
  storageVersion: typeof PLAN_INTAKE_VERSION;
  savedAt: string;
  expiresAt: string;
  draft: PlanIntakeDraft;
};

export type ParsedPlanIntakeDraft = {
  storageVersion: typeof PLAN_INTAKE_VERSION;
  savedAt: string;
  expiresAt: string;
  draft: PlanIntakeDraft;
  legacy: false;
};

const PATCH_TO_NIGHT_AREA: Partial<Record<NightPatchId, NightAreaSlug>> = {
  soho: "piccadilly-soho",
  shoreditch: "shoreditch",
  camden: "camden",
  "london-bridge": "bermondsey-london-bridge",
  brixton: "brixton",
  clapham: "clapham",
  islington: "islington",
};

/**
 * Exact generator coverage for a user-facing Night Patch. `null` is a real
 * unsupported result: notably, Hackney must never be silently widened or
 * coerced to Shoreditch just because that is the nearest generation area.
 */
export function nightAreaForPlanIntakePatch(patchId: NightPatchId): NightAreaSlug | null {
  return PATCH_TO_NIGHT_AREA[patchId] ?? null;
}

function isStep(value: unknown): value is PlanIntakeStep {
  return typeof value === "string" && (PLAN_INTAKE_STEPS as readonly string[]).includes(value);
}

function isPatchId(value: unknown): value is NightPatchId {
  return typeof value === "string" && NIGHT_PATCHES.some((patch) => patch.id === value);
}

function isTimeWindow(value: unknown): value is PlanTimeWindowId {
  return typeof value === "string" && PLAN_TIME_WINDOWS.some((option) => option.id === value);
}

function isBudget(value: unknown): value is Budget {
  return PLAN_BUDGET_OPTIONS.some((option) => option.budget === value);
}

function isAccessibilityNeed(value: unknown): value is PlanAccessibilityNeed {
  return typeof value === "string" && PLAN_ACCESSIBILITY_NEEDS.some((option) => option.id === value);
}

type LondonDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const londonFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function londonParts(date: Date): LondonDateTimeParts & { second: number } {
  const values = Object.fromEntries(
    londonFormatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function parseLondonInput(value: string): LondonDateTimeParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const calendarCheck = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    calendarCheck.getUTCFullYear() !== parts.year
    || calendarCheck.getUTCMonth() !== parts.month - 1
    || calendarCheck.getUTCDate() !== parts.day
    || parts.hour > 23
    || parts.minute > 59
  ) return null;
  return parts;
}

function londonOffsetMs(instantMs: number): number {
  const parts = londonParts(new Date(instantMs));
  const renderedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return renderedAsUtc - Math.floor(instantMs / 1000) * 1000;
}

function londonCandidates(value: string): number[] {
  const parts = parseLondonInput(value);
  if (!parts) return [];
  const wallTimeAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  const sampleOffsets = new Set(
    [-48, -24, 0, 24, 48].map((hours) => londonOffsetMs(wallTimeAsUtc + hours * 60 * 60 * 1000)),
  );
  return [...sampleOffsets]
    .map((offset) => wallTimeAsUtc - offset)
    .filter((candidate) => {
      const rendered = londonParts(new Date(candidate));
      return rendered.year === parts.year
        && rendered.month === parts.month
        && rendered.day === parts.day
        && rendered.hour === parts.hour
        && rendered.minute === parts.minute;
    })
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .sort((left, right) => left - right);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function londonInput(parts: LondonDateTimeParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** Convert a London wall-clock input to an exact instant, rejecting DST gaps. */
export function londonDateTimeInputToIso(value: string, after?: Date): string | null {
  const candidates = londonCandidates(value);
  const preferred = after ? candidates.find((candidate) => candidate > after.getTime()) : candidates[0];
  const chosen = preferred;
  return chosen === undefined ? null : new Date(chosen).toISOString();
}

/** Render an exact instant as the value expected by a London datetime-local input. */
export function londonDateTimeInputFromIso(value: string): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return londonInput(londonParts(new Date(timestamp)));
}

/** Resolve the displayed London wall time without letting a stale exact handoff bypass the future check. */
export function resolveFutureLondonStartIso(
  value: string,
  exactStartIso: string | null,
  now = new Date(),
): string | null {
  if (!exactStartIso) return londonDateTimeInputToIso(value, now);
  const timestamp = Date.parse(exactStartIso);
  return Number.isFinite(timestamp)
    && timestamp > now.getTime()
    && londonDateTimeInputFromIso(exactStartIso) === value
    ? new Date(timestamp).toISOString()
    : null;
}

/** Next future occurrence of a preset's London wall time, including DST rollover. */
export function nextLondonOccurrenceIso(windowId: PlanTimeWindowId, now = new Date()): string {
  const option = PLAN_TIME_WINDOWS.find((candidate) => candidate.id === windowId);
  if (!option) return now.toISOString();
  const today = londonParts(now);
  const [hour, minute] = option.start.split(":").map(Number);
  const todayInput = londonInput({ ...today, hour: hour ?? 0, minute: minute ?? 0 });
  const todayCandidate = londonDateTimeInputToIso(todayInput, now);
  if (todayCandidate) return todayCandidate;

  const nextDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const tomorrowInput = londonInput({
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
    hour: hour ?? 0,
    minute: minute ?? 0,
  });
  return londonDateTimeInputToIso(tomorrowInput) ?? now.toISOString();
}

function parseStepList(value: unknown): PlanIntakeStep[] | null {
  if (!Array.isArray(value) || !value.every(isStep)) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value];
}

function cleanAnswers(value: unknown, now: number): PlanIntakeAnswers | null {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!row) return null;
  if (row.stopCount !== undefined && !isPlanStopCount(row.stopCount)) return null;
  const groupSize = typeof row.groupSize === "number" && Number.isInteger(row.groupSize)
    && row.groupSize >= 1 && row.groupSize <= 30 ? row.groupSize : null;
  const budget = isBudget(row.budget) ? row.budget : null;
  const budgetLimitPence = budget && typeof row.budgetLimitPence === "number"
    && Number.isInteger(row.budgetLimitPence)
    && row.budgetLimitPence >= 500
    && row.budgetLimitPence <= 50_000 ? row.budgetLimitPence : null;
  const accessibilityNeeds = Array.isArray(row.accessibilityNeeds)
    && row.accessibilityNeeds.every(isAccessibilityNeed)
    && new Set(row.accessibilityNeeds).size === row.accessibilityNeeds.length
    ? [...row.accessibilityNeeds]
    : [];
  const timeWindow = isTimeWindow(row.timeWindow) ? row.timeWindow : null;
  const exactTimestamp = typeof row.exactStartIso === "string" ? Date.parse(row.exactStartIso) : Number.NaN;
  const exactStartIso = timeWindow && Number.isFinite(exactTimestamp)
    ? exactTimestamp > now
      ? new Date(exactTimestamp).toISOString()
      : nextLondonOccurrenceIso(timeWindow, new Date(now))
    : null;
  return {
    area: isPatchId(row.area) ? row.area : null,
    timeWindow,
    exactStartIso,
    groupSize,
    ...(row.stopCount !== undefined ? { stopCount: normalizePlanStopCount(row.stopCount) } : {}),
    budget,
    budgetLimitPence,
    accessibilityNeeds,
  };
}

export function planIntakeStepHasAnswer(
  draft: PlanIntakeDraft,
  step: PlanIntakeStep = draft.currentStep,
): boolean {
  switch (step) {
    case "area": return draft.answers.area !== null;
    case "time-window": return draft.answers.timeWindow !== null && draft.answers.exactStartIso !== null;
    case "group-size": return draft.answers.groupSize !== null;
    case "budget": return draft.answers.budget !== null;
    case "accessibility": return draft.answers.accessibilityNeeds.length > 0;
  }
}

function rememberedPatchId(remembered: RememberedArea | null): NightPatchId | null {
  if (!remembered) return null;
  if (remembered.kind === "patch") return isPatchId(remembered.id) ? remembered.id : null;
  const normalized = remembered.name.trim().toLocaleLowerCase();
  return NIGHT_PATCHES.find((patch) => patch.label.toLocaleLowerCase() === normalized)?.id ?? null;
}

export function resolvePlanIntakeAreaSeed(
  livePatchId: string | null | undefined,
  remembered: RememberedArea | null,
): RememberedArea | null {
  return isPatchId(livePatchId) ? { kind: "patch", id: livePatchId } : remembered;
}

export function canSeedPlanIntakeArea(draft: PlanIntakeDraft): boolean {
  return draft.currentStep === "area"
    && draft.settledSteps.length === 0
    && draft.skippedSteps.length === 0
    && !draft.completed
    && draft.answers.area === null
    && draft.answers.timeWindow === null
    && draft.answers.exactStartIso === null
    && draft.answers.groupSize === null
    && draft.answers.budget === null
    && draft.answers.budgetLimitPence === null
    && draft.answers.accessibilityNeeds.length === 0;
}

export function createPlanIntakeDraft(remembered: RememberedArea | null = null): PlanIntakeDraft {
  const area = rememberedPatchId(remembered);
  return {
    version: PLAN_INTAKE_VERSION,
    currentStep: area ? "time-window" : "area",
    settledSteps: area ? ["area"] : [],
    skippedSteps: [],
    completed: false,
    answers: {
      area,
      timeWindow: null,
      exactStartIso: null,
      groupSize: null,
      budget: null,
      budgetLimitPence: null,
      accessibilityNeeds: [],
    },
  };
}

function planIntakeRawBytes(raw: string): number {
  return new TextEncoder().encode(raw).byteLength;
}

export function parsePlanIntakeDraftWithMetadata(
  raw: string | null,
  now = Date.now(),
): ParsedPlanIntakeDraft | null {
  if (!raw || planIntakeRawBytes(raw) > PLAN_INTAKE_MAX_RAW_BYTES) return null;
  try {
    const envelope = JSON.parse(raw) as Partial<StoredPlanIntakeEnvelope>;
    const savedAt = Date.parse(typeof envelope.savedAt === "string" ? envelope.savedAt : "");
    const expiresAt = Date.parse(typeof envelope.expiresAt === "string" ? envelope.expiresAt : "");
    if (
      !envelope
      || envelope.storageVersion !== PLAN_INTAKE_VERSION
      || !Number.isFinite(savedAt)
      || !Number.isFinite(expiresAt)
      || new Date(savedAt).toISOString() !== envelope.savedAt
      || new Date(expiresAt).toISOString() !== envelope.expiresAt
      || savedAt > now + 5 * 60 * 1000
      || expiresAt <= now
      || expiresAt <= savedAt
      || expiresAt - savedAt > PLAN_INTAKE_DRAFT_TTL_MS
      || !envelope.draft
      || typeof envelope.draft !== "object"
    ) return null;
    const value = envelope.draft as unknown as Record<string, unknown>;
    if (value.version !== PLAN_INTAKE_VERSION || !isStep(value.currentStep)) return null;
    const settledSteps = parseStepList(value.settledSteps);
    const skippedSteps = parseStepList(value.skippedSteps);
    const answers = cleanAnswers(value.answers, now);
    if (!settledSteps || !skippedSteps || !answers) return null;
    if (!skippedSteps.every((step) => settledSteps.includes(step))) return null;

    const canonicalAnswers = skippedSteps.reduce(clearAnswerForStep, answers);
    if (settledSteps.some((step) => !skippedSteps.includes(step)
      && !planIntakeStepHasAnswer({
        version: PLAN_INTAKE_VERSION,
        currentStep: step,
        settledSteps,
        skippedSteps,
        completed: false,
        answers: canonicalAnswers,
      }, step))) return null;

    const firstUnsettled = PLAN_INTAKE_STEPS.find((step) => !settledSteps.includes(step));
    const terminal = firstUnsettled === undefined;
    if (value.completed !== terminal) return null;
    return {
      storageVersion: PLAN_INTAKE_VERSION,
      savedAt: envelope.savedAt,
      expiresAt: envelope.expiresAt,
      draft: {
        version: PLAN_INTAKE_VERSION,
        currentStep: firstUnsettled ?? PLAN_INTAKE_STEPS[PLAN_INTAKE_STEPS.length - 1],
        settledSteps,
        skippedSteps,
        completed: terminal,
        answers: canonicalAnswers,
      },
      legacy: false,
    };
  } catch {
    return null;
  }
}

export function parsePlanIntakeDraft(raw: string | null, now = Date.now()): PlanIntakeDraft | null {
  return parsePlanIntakeDraftWithMetadata(raw, now)?.draft ?? null;
}

function resolveStorage(storage?: Storage | null): Storage | null {
  return storage ?? safeLocalStorage();
}

export function readPlanIntakeDraftWithMetadata(
  storage?: Storage | null,
  now = Date.now(),
): ParsedPlanIntakeDraft | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(PLAN_INTAKE_STORAGE_KEY);
    const parsed = parsePlanIntakeDraftWithMetadata(raw, now);
    if (raw && !parsed) store.removeItem(PLAN_INTAKE_STORAGE_KEY);
    return parsed;
  } catch {
    return null;
  }
}

export function readPlanIntakeDraft(storage?: Storage | null, now = Date.now()): PlanIntakeDraft | null {
  return readPlanIntakeDraftWithMetadata(storage, now)?.draft ?? null;
}

export function writePlanIntakeDraft(
  draft: PlanIntakeDraft,
  storage?: Storage | null,
  now = Date.now(),
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    const next = JSON.stringify({
      storageVersion: PLAN_INTAKE_VERSION,
      savedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PLAN_INTAKE_DRAFT_TTL_MS).toISOString(),
      draft,
    } satisfies StoredPlanIntakeEnvelope);
    if (planIntakeRawBytes(next) > PLAN_INTAKE_MAX_RAW_BYTES) return;
    if (store.getItem(PLAN_INTAKE_STORAGE_KEY) !== next) {
      store.setItem(PLAN_INTAKE_STORAGE_KEY, next);
    }
  } catch {
    // Planning remains available in memory when storage is blocked or full.
  }
}

export function clearPlanIntakeDraft(storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(PLAN_INTAKE_STORAGE_KEY);
  } catch {
    // Best effort after successful Plan creation or invalid draft recovery.
  }
}

function clearAnswerForStep(answers: PlanIntakeAnswers, step: PlanIntakeStep): PlanIntakeAnswers {
  switch (step) {
    case "area": return { ...answers, area: null };
    case "time-window": return { ...answers, timeWindow: null, exactStartIso: null };
    case "group-size": return { ...answers, groupSize: null };
    case "budget": return { ...answers, budget: null, budgetLimitPence: null };
    case "accessibility": return { ...answers, accessibilityNeeds: [] };
  }
}

export function settlePlanIntakeStep(
  draft: PlanIntakeDraft,
  options: { skip?: boolean } = {},
): PlanIntakeDraft {
  const step = draft.currentStep;
  if (!options.skip && !planIntakeStepHasAnswer(draft, step)) return draft;
  const settledSteps = [...new Set([...draft.settledSteps, step])];
  const skippedSteps = options.skip
    ? [...new Set([...draft.skippedSteps, step])]
    : draft.skippedSteps.filter((candidate) => candidate !== step);
  const answers = options.skip ? clearAnswerForStep(draft.answers, step) : draft.answers;
  const nextStep = PLAN_INTAKE_STEPS.find((candidate) => !settledSteps.includes(candidate));
  return {
    ...draft,
    answers,
    settledSteps,
    skippedSteps,
    currentStep: nextStep ?? step,
    completed: nextStep === undefined,
  };
}

export function reopenPlanIntakeStep(draft: PlanIntakeDraft, step: PlanIntakeStep): PlanIntakeDraft {
  return {
    ...draft,
    currentStep: step,
    settledSteps: draft.settledSteps.filter((candidate) => candidate !== step),
    skippedSteps: draft.skippedSteps.filter((candidate) => candidate !== step),
    completed: false,
  };
}

export function skipRemainingPlanIntake(draft: PlanIntakeDraft): PlanIntakeDraft {
  const unsettled = PLAN_INTAKE_STEPS.filter((step) => !draft.settledSteps.includes(step));
  const unanswered = unsettled.filter((step) => !planIntakeStepHasAnswer(draft, step));
  return {
    ...draft,
    answers: unanswered.reduce(clearAnswerForStep, draft.answers),
    settledSteps: [...PLAN_INTAKE_STEPS],
    skippedSteps: [
      ...new Set([
        ...draft.skippedSteps.filter((step) => !unsettled.includes(step)),
        ...unanswered,
      ]),
    ],
    completed: true,
  };
}

export function planIntakeHandoff(draft: PlanIntakeDraft): PlanIntakeHandoff {
  const timeWindow = PLAN_TIME_WINDOWS.find((option) => option.id === draft.answers.timeWindow);
  const stopCount = normalizePlanStopCount(draft.answers.stopCount);
  return {
    version: PLAN_INTAKE_VERSION,
    area: draft.answers.area ? { kind: "night-patch", id: draft.answers.area } : null,
    timeWindow: timeWindow
      && draft.answers.exactStartIso
      ? {
          id: timeWindow.id,
          start: timeWindow.start,
          end: timeWindow.end,
          exactStartIso: draft.answers.exactStartIso,
        }
      : null,
    groupSize: draft.answers.groupSize,
    ...(stopCount !== 3 ? { stopCount } : {}),
    budget: draft.answers.budget
      ? { tier: draft.answers.budget, limitPence: draft.answers.budgetLimitPence }
      : null,
    accessibilityNeeds: [...draft.answers.accessibilityNeeds],
    // A held acceptance seeds the area behind the wizard, so the step can be
    // both skipped and answered. The generator refuses that pair outright
    // (PLAN_INTAKE_MALFORMED), so the answer wins and the skip goes.
    skipped: draft.skippedSteps.filter((step) => !(step === "area" && draft.answers.area)),
  };
}

/** Compatibility adapter for the current generator. Wave 2.2 consumes the full handoff. */
export function planIntakeNightContextPatch(draft: PlanIntakeDraft): Partial<NightContext> {
  const timeWindow = PLAN_TIME_WINDOWS.find((option) => option.id === draft.answers.timeWindow);
  const nightArea = draft.answers.area ? nightAreaForPlanIntakePatch(draft.answers.area) : null;
  return {
    ...(nightArea ? { nightArea } : {}),
    ...(timeWindow ? { daypart: timeWindow.daypart } : {}),
    ...(draft.answers.groupSize !== null ? { groupSize: draft.answers.groupSize } : {}),
    ...(normalizePlanStopCount(draft.answers.stopCount) !== 3
      ? { stopCount: normalizePlanStopCount(draft.answers.stopCount) }
      : {}),
    ...(draft.answers.budget ? { budget: draft.answers.budget } : {}),
    ...(draft.answers.budgetLimitPence !== null
      ? { budgetLimitPence: draft.answers.budgetLimitPence }
      : {}),
    ...(draft.answers.accessibilityNeeds.length > 0
      ? { accessibility: [...draft.answers.accessibilityNeeds] }
      : {}),
  };
}

export type PlanGenerationIntakeBody = {
  query?: string;
  context?: Partial<NightContext>;
  cityId?: CityId;
  intake: PlanIntakeHandoff;
  anchor?: PlanGenerationWireAnchor;
};

export type PlanGenerationAnchorInput = PlanGenerationWireAnchor & {
  cityId?: CityId | null;
};

/** Remove values inherited from an earlier intake before applying its current answers. */
export function stripPlanIntakeOwnedContext(
  context: NightContext | null,
): Partial<NightContext> {
  if (!context) return {};
  const unowned: Partial<NightContext> = { ...context };
  delete unowned.nightArea;
  delete unowned.daypart;
  delete unowned.groupSize;
  delete unowned.stopCount;
  delete unowned.budget;
  delete unowned.budgetLimitPence;
  delete unowned.accessibility;
  return unowned;
}

/**
 * One request seam for the Plan composer. The compatibility context keeps the
 * current generator useful; Wave 2.2 reads `intake` as the exact constraint
 * source and owns enforcement.
 */
export function buildPlanGenerationIntakeBody(
  draft: PlanIntakeDraft,
  query: string,
  currentContext: NightContext | null,
  explicitContext: Partial<NightContext> = {},
  anchor?: PlanGenerationAnchorInput | null,
): PlanGenerationIntakeBody {
  const cleanQuery = query.trim();
  const context = {
    ...stripPlanIntakeOwnedContext(currentContext),
    ...explicitContext,
    ...planIntakeNightContextPatch(draft),
  };
  return {
    ...(cleanQuery ? { query: cleanQuery } : {}),
    ...(Object.keys(context).length > 0 ? { context } : {}),
    ...(anchor?.cityId ? { cityId: anchor.cityId } : {}),
    intake: planIntakeHandoff(draft),
    ...(anchor ? {
      anchor: {
        venueId: anchor.venueId,
        source: anchor.source,
        acceptedArea: anchor.acceptedArea,
        startsAt: anchor.startsAt,
      },
    } : {}),
  };
}

export function planIntakeSummary(draft: PlanIntakeDraft): string[] {
  const patch = resolveNightPatch(draft.answers.area);
  const time = PLAN_TIME_WINDOWS.find((option) => option.id === draft.answers.timeWindow);
  const budget = PLAN_BUDGET_OPTIONS.find((option) => option.budget === draft.answers.budget);
  const accessibilityCount = draft.answers.accessibilityNeeds.length;
  return [
    ...(patch ? [patch.label] : []),
    ...(time ? [time.label] : []),
    ...(draft.answers.groupSize ? [`${draft.answers.groupSize} ${draft.answers.groupSize === 1 ? "person" : "people"}`] : []),
    ...(budget ? [draft.answers.budgetLimitPence
      ? `Up to £${Math.round(draft.answers.budgetLimitPence / 100)} each`
      : budget.label] : []),
    ...(accessibilityCount ? [`${accessibilityCount} access ${accessibilityCount === 1 ? "need" : "needs"}`] : []),
  ];
}
