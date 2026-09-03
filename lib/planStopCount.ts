export const PLAN_STOP_COUNTS = [3, 4, 5, 6] as const;
export type PlanStopCount = (typeof PLAN_STOP_COUNTS)[number];
export const MIN_PLAN_STOP_COUNT = PLAN_STOP_COUNTS[0];
export const MAX_PLAN_STOP_COUNT = PLAN_STOP_COUNTS[PLAN_STOP_COUNTS.length - 1];
export const DEFAULT_PLAN_STOP_COUNT = MIN_PLAN_STOP_COUNT;

export function isPlanStopCount(value: unknown): value is PlanStopCount {
  return typeof value === "number"
    && Number.isInteger(value)
    && (PLAN_STOP_COUNTS as readonly number[]).includes(value);
}

export function normalizePlanStopCount(value: unknown): PlanStopCount {
  return isPlanStopCount(value) ? value : DEFAULT_PLAN_STOP_COUNT;
}

export function inferPlanStopCount(query: string, numberWords: Readonly<Record<string, number>>): PlanStopCount {
  const explicitNumeric = query.match(/\b([3-6])\s*(?:pubs?|stops?|venues?)\b/i);
  if (explicitNumeric) return Number(explicitNumeric[1]) as PlanStopCount;
  for (const [word, value] of Object.entries(numberWords)) {
    if (value < MIN_PLAN_STOP_COUNT || value > MAX_PLAN_STOP_COUNT) continue;
    if (new RegExp(`\\b${word}\\s+(?:pubs?|stops?|venues?)\\b`, "i").test(query)) {
      return value as PlanStopCount;
    }
  }
  return /\bbig\s+crawl\b/i.test(query) ? MAX_PLAN_STOP_COUNT : DEFAULT_PLAN_STOP_COUNT;
}
