// Wayfinder 4.2 — invite links expire at plan end (not only by TTL).
// Plan end mirrors the Night Mode active window: startTime + ACTIVE_PLAN_POST_MS.

import { ACTIVE_PLAN_POST_MS } from "@/lib/activePlan";

/** Scheduled end of a Planned Night, or null when startTime is unparseable. */
export function planScheduledEndMs(startTime: string): number | null {
  const start = Date.parse(startTime);
  if (!Number.isFinite(start)) return null;
  return start + ACTIVE_PLAN_POST_MS;
}

/**
 * Clamp an invite TTL against the plan's scheduled end.
 * Returns null when the plan has already ended (or startTime is invalid) —
 * callers should refuse to mint a new invite.
 */
export function inviteExpiresAtIso(input: {
  startTime: string;
  expiresInMinutes: number;
  now?: Date;
}): string | null {
  const now = input.now ?? new Date();
  const planEnd = planScheduledEndMs(input.startTime);
  if (planEnd === null || planEnd <= now.getTime()) return null;
  const ttlEnd = now.getTime() + input.expiresInMinutes * 60_000;
  return new Date(Math.min(ttlEnd, planEnd)).toISOString();
}

/** True when `now` is at or past the plan's scheduled end. */
export function isPastPlanScheduledEnd(startTime: string, now: Date = new Date()): boolean {
  const planEnd = planScheduledEndMs(startTime);
  if (planEnd === null) return true;
  return planEnd <= now.getTime();
}
