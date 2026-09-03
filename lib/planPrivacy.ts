// The canonical Friend privacy projection (DAG L10, §4.10). One pure place that
// decides what a viewer WITHOUT a valid Plan member capability may see. The
// server picks between these two shapes; a signed-out or uninvited viewer only
// ever receives the preview, never the Route.
//
// Pure and isomorphic on purpose: the boundary resolver
// (lib/planPrivacyBoundary.server.ts) and the node-env tests both build these
// shapes without a DOM or a request. The preview MUST NOT carry any venueId,
// venueName, stop order, route geometry, alternatives, full Night Context,
// venue-tied pint evidence, member/invite capability, or the user-entered title.

import { NIGHT_AREAS } from "@/lib/nightAreas";
import { planHasRoute, type PlanState } from "@/lib/plan";
import { vibeChipById } from "@/lib/vibeChips";
import type { VibeTally } from "@/lib/vibeTally";

/**
 * Anonymous, uninvited projection. Exactly the §4.10 five safe signals plus a
 * server-derived routeReady boolean. Names no Venue and never the route.
 */
export type PlanPrivacyPreviewDTO = {
  visibility: "preview";
  /** First crew member's display name; the plan host. */
  hostDisplayName: string;
  /** Broad London area name (e.g. "Shoreditch"), null when the plan has no Night Context. */
  areaName: string | null;
  /** Formatted start time in London time (e.g. "19:00"), or a fallback label. */
  startLabel: string;
  /** Number of stops on the route, without naming any of them. */
  stopCount: number;
  /** Top crew vibe label if the tally has one, null when unavailable. */
  vibeLabel: string | null;
  /** Human-readable accessibility summary from the night context, null when not set. */
  accessibilitySummary: string | null;
  /** Whether the route has reached a usable, non-draft state. */
  routeReady: boolean;
};

/** Full state — only ever returned to a viewer with a valid host/guest capability. */
export type PlanMemberStateDTO = {
  visibility: "member";
  state: PlanState;
};

export type PlanVisibilityProjection = PlanPrivacyPreviewDTO | PlanMemberStateDTO;

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
  return NIGHT_AREAS.find((candidate) => candidate.slug === slug)?.name ?? null;
}

/**
 * Server-derived readiness: the Plan really holds a route and has not been
 * abandoned. An anchor-only draft holds one accepted pub, so it is never
 * ready; an unanchored route is as ready as an anchored one.
 */
export function planRouteReady(state: PlanState): boolean {
  if (state.plan.status === "abandoned") return false;
  return planHasRoute(state.plan, state.stops.length);
}

/**
 * Build the redacted preview. Carries NO venueId/venueName values and never the
 * route; the caller must not expose `state.stops` to an uninvited viewer.
 */
export function buildPlanPrivacyPreview(
  state: PlanState,
  vibeTally?: VibeTally | null,
): PlanPrivacyPreviewDTO {
  const topVibe = vibeTally?.top ?? null;
  return {
    visibility: "preview",
    hostDisplayName: state.crew[0]?.name ?? "Your host",
    areaName: resolveAreaName(state.context?.nightArea),
    startLabel: formatStartLabel(state.plan.startTime),
    stopCount: state.stops.length,
    vibeLabel: topVibe ? (vibeChipById(topVibe)?.label ?? null) : null,
    accessibilitySummary: state.context?.accessibility?.length
      ? state.context.accessibility.join(", ")
      : null,
    routeReady: planRouteReady(state),
  };
}

/** Wrap the full state for a capability-holding member. */
export function memberProjection(state: PlanState): PlanMemberStateDTO {
  return { visibility: "member", state };
}
