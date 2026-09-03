// Pure helpers behind the return-rate signal (Wave M metrics funnel). A
// "day bucket" is the number of whole days since the Unix epoch in UTC — a
// small, monotonically increasing integer with no timezone, clock, or
// session-length information in it, and nothing derived from the visitor
// (no fingerprinting). It is emitted at most once per calendar day per
// identity (see components/DailyActivityPulse.tsx), so counting distinct
// day buckets per anon/auth id over a trailing window is the return rate.

import { DAY_MS } from "@/lib/dayMs";

/** Milliseconds in one UTC day. Shared owner: lib/dayMs.ts. */
export const MS_PER_DAY = DAY_MS;

/** Whole UTC days since the epoch for the given instant. */
export function dayBucketFromDate(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

/**
 * True the first time this is called for a given day (lastRecordedDayBucket
 * is null) or once the day bucket has advanced since the last recording.
 * Never true twice for the same day, so a page reload or repeat visit within
 * the same UTC day never double-counts.
 */
export function shouldRecordDailyActivity(lastRecordedDayBucket: number | null, now: Date): boolean {
  if (lastRecordedDayBucket === null) return true;
  return dayBucketFromDate(now) !== lastRecordedDayBucket;
}

/** Parse a stored day-bucket value defensively; anything malformed is "never recorded". */
export function parseStoredDayBucket(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}
