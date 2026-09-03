import type { MasteryEventKind } from "../lib/pubPal";

export const MASTERY_POINTS: Readonly<Record<MasteryEventKind, number>> = {
  plan_completed: 25,
  venue_discovered: 5,
  pint_drop_verified: 15,
  heritage_read: 3,
  crew_coordinated: 12,
  night_captured: 20,
};

export function masteryPointsFor(kind: MasteryEventKind): number {
  return MASTERY_POINTS[kind];
}

export function boundedControl(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Control must be a finite number");
  return Math.max(0, Math.min(100, value));
}

export function requiredText(value: string, maxLength: number): string {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) throw new Error("Invalid text");
  return cleaned;
}
