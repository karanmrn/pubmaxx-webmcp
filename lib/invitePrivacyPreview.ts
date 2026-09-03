// Pure builder for the pre-acceptance plan privacy preview (Wayfinder 4.2).
//
// Contract: this function MUST NOT include any stop venue ids or venue names
// in its output. It redacts the route entirely and exposes only the five safe
// signals: host display name, broad area, time window, vibe (if any), and an
// accessibility expectations summary.
//
// Why pure: the caller is always a client component that already holds
// PlanState from the server render. A pure function keeps the redaction logic
// in one testable place rather than scattered across component render paths.

import type { PlanState } from "@/lib/plan";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import type { VibeTally } from "@/lib/vibeTally";
import { vibeChipById } from "@/lib/vibeChips";

export type InvitePrivacyPreviewDTO = {
  /** First crew member's display name; the plan host. */
  hostName: string;
  /** Broad London area name (e.g. "Shoreditch"), null when the plan has no Night Context. */
  areaName: string | null;
  /** Formatted start time in London time (e.g. "19:00"), or a fallback label. */
  startLabel: string;
  /** Number of stops on the route, without naming any of them. */
  stopCount: number;
  /** Top crew vibe label if the tally has one (e.g. "On a bender"), null when unavailable. */
  vibeLabel: string | null;
  /** Human-readable accessibility summary from the night context, null when not set. */
  accessibilitySummary: string | null;
};

function formatStartLabel(startTime: string): string {
  const parsed = Date.parse(startTime);
  if (!Number.isFinite(parsed)) return "Time to be confirmed";
  return new Date(parsed).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveAreaName(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const area = NIGHT_AREAS.find((candidate) => candidate.slug === slug);
  return area?.name ?? null;
}

function buildAccessibilitySummary(requirements: readonly string[]): string | null {
  if (!requirements.length) return null;
  return requirements.join(", ");
}

/**
 * Build a redacted preview DTO safe to show to pre-acceptance viewers.
 *
 * The returned object carries NO venueId or venueName values; the caller
 * must not expose `state.stops` to the uninvited viewer.
 */
export function buildInvitePrivacyPreview(
  state: PlanState,
  vibeTally?: VibeTally | null,
): InvitePrivacyPreviewDTO {
  const hostName = state.crew[0]?.name ?? "Your host";
  const areaName = resolveAreaName(state.context?.nightArea);
  const startLabel = formatStartLabel(state.plan.startTime);
  const stopCount = state.stops.length;
  const topVibe = vibeTally?.top ?? null;
  const vibeLabel = topVibe ? (vibeChipById(topVibe)?.label ?? null) : null;
  const accessibility = state.context?.accessibility ?? [];
  const accessibilitySummary = buildAccessibilitySummary(accessibility);
  return {
    hostName,
    areaName,
    startLabel,
    stopCount,
    vibeLabel,
    accessibilitySummary,
  };
}
