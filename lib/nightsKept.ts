// Personal "nights kept" habit — device-local, mapping/planning framed.
// Never a drinker streak, never Social DAU, never a points economy.

import { londonDayKey } from "@/lib/pintContributions";

export const NIGHTS_KEPT_STORAGE_KEY = "pubmax:nights-kept:v1";
export const NIGHTS_KEPT_VERSION = 1 as const;

export type NightsKeptRecord = {
  version: typeof NIGHTS_KEPT_VERSION;
  /** Distinct London calendar days a completed night was kept / recapped. */
  days: string[];
  /** Most recent plan id recorded (opaque; never sent as analytics). */
  lastPlanId: string | null;
};

export type NightsKeptStorage = Pick<Storage, "getItem" | "setItem">;

function emptyRecord(): NightsKeptRecord {
  return { version: NIGHTS_KEPT_VERSION, days: [], lastPlanId: null };
}

export function parseNightsKept(raw: string | null): NightsKeptRecord {
  if (!raw) return emptyRecord();
  try {
    const parsed = JSON.parse(raw) as Partial<NightsKeptRecord>;
    if (parsed?.version !== NIGHTS_KEPT_VERSION || !Array.isArray(parsed.days)) {
      return emptyRecord();
    }
    const days = Array.from(
      new Set(
        parsed.days.filter((day): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)),
      ),
    ).sort();
    return {
      version: NIGHTS_KEPT_VERSION,
      days,
      lastPlanId: typeof parsed.lastPlanId === "string" ? parsed.lastPlanId : null,
    };
  } catch {
    return emptyRecord();
  }
}

export function readNightsKept(storage: NightsKeptStorage | null): NightsKeptRecord {
  if (!storage) return emptyRecord();
  try {
    return parseNightsKept(storage.getItem(NIGHTS_KEPT_STORAGE_KEY));
  } catch {
    return emptyRecord();
  }
}

/**
 * Record that a completed night was kept (morning card or recap open).
 * Idempotent per London day + plan id pair for lastPlanId; days stay a set.
 */
export function recordNightKept(
  planId: string,
  storage: NightsKeptStorage | null,
  now: Date = new Date(),
): NightsKeptRecord {
  if (!storage || !planId) return emptyRecord();
  const current = readNightsKept(storage);
  const day = londonDayKey(now);
  if (!day) return current;
  const days = current.days.includes(day) ? current.days : [...current.days, day].sort();
  const next: NightsKeptRecord = {
    version: NIGHTS_KEPT_VERSION,
    days,
    lastPlanId: planId,
  };
  try {
    storage.setItem(NIGHTS_KEPT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return current;
  }
  return next;
}

/** Consecutive London days ending today or yesterday with a kept night. */
export function nightsKeptStreak(record: NightsKeptRecord, now: Date = new Date()): number {
  const today = londonDayKey(now);
  if (!today || record.days.length === 0) return 0;
  const set = new Set(record.days);
  let cursor = today;
  if (!set.has(cursor)) {
    const [yy, mm, dd] = today.split("-").map(Number);
    const yesterday = new Date(Date.UTC(yy!, mm! - 1, dd! - 1));
    cursor = londonDayKey(yesterday);
    if (!set.has(cursor)) return 0;
  }
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    const [yy, mm, dd] = cursor.split("-").map(Number);
    const prev = new Date(Date.UTC(yy!, mm! - 1, dd! - 1));
    cursor = londonDayKey(prev);
  }
  return streak;
}

export function nightsKeptLabel(record: NightsKeptRecord, now: Date = new Date()): string {
  const total = record.days.length;
  const streak = nightsKeptStreak(record, now);
  if (total === 0) {
    return "Complete a night and open the morning card to start keeping them.";
  }
  if (streak <= 1) {
    return total === 1
      ? "1 night kept on this device."
      : `${total} nights kept on this device.`;
  }
  return `${total} nights kept · ${streak}-day run.`;
}
