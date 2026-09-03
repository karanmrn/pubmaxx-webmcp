import "server-only";

import { createNightMemoryFromPlanRecap } from "@/lib/nightMemoryStore";
import type { NightMemory, NightMoment } from "@/lib/nightMemory";
import type { PendingPlanRecap } from "@/lib/planRecap";
import { validatePendingPlanRecap } from "@/lib/planRecap";
import {
  planCompletionResult,
  planMemberIdentityResult,
} from "@/lib/planStore";
import { pendingPlanRecapStore } from "@/lib/pendingPlanRecapStore";

export type PromotePlanRecapError =
  | "invalid"
  | "member_forbidden"
  | "member_unavailable"
  | "not_completed"
  | "completion_unavailable"
  | "conflict"
  | "save_failed";

export type PromotePlanRecapResult =
  | { ok: true; memory: NightMemory; moments: NightMoment[] }
  | { ok: false; error: PromotePlanRecapError };

/**
 * Shared Plan → private Night Memory promotion. The Plan recap route and the
 * account claim path both use this so membership, canonical route matching, and
 * completionId idempotency stay one choke. Never publishes a Story.
 */
export async function promotePendingPlanRecapToMemory(
  ownerId: string,
  rawRecap: PendingPlanRecap,
  memberToken: string,
): Promise<PromotePlanRecapResult> {
  const recap = validatePendingPlanRecap(rawRecap);
  if (!ownerId || !recap || !memberToken) return { ok: false, error: "invalid" };

  const identity = await planMemberIdentityResult(recap.planId, memberToken);
  if (!identity.ok) return { ok: false, error: "member_unavailable" };
  if (!identity.identity) return { ok: false, error: "member_forbidden" };

  const completionLookup = await planCompletionResult(recap.planId);
  if (!completionLookup.ok) return { ok: false, error: "completion_unavailable" };
  const completion = completionLookup.completion;
  if (!completion) return { ok: false, error: "not_completed" };

  const canonicalStops = completion.routeSnapshot
    .slice()
    .sort((left, right) => left.position - right.position);
  const matchesCanonical = recap.completionId === completion.id
    && recap.ending === completion.ending
    && JSON.stringify(recap.endingSelection) === JSON.stringify(completion.endingSelection ?? null)
    && recap.routeRevision === completion.routeRevision
    && recap.completedAt === completion.completedAt
    && recap.stops.length === canonicalStops.length
    && recap.stops.every((stop, index) => (
      stop.position === index
      && stop.venueId === canonicalStops[index]?.venueId
      && stop.venueName === canonicalStops[index]?.venueName
    ));
  if (!matchesCanonical) return { ok: false, error: "conflict" };

  const saved = await createNightMemoryFromPlanRecap(ownerId, {
    ...recap,
    ending: completion.ending,
    endingSelection: completion.endingSelection ?? null,
    completedAt: completion.completedAt,
    routeRevision: completion.routeRevision,
    stops: canonicalStops.map((stop, index) => ({
      ...stop,
      position: index,
      caption: recap.stops[index]?.caption ?? "",
    })),
  });
  if (!saved) return { ok: false, error: "save_failed" };

  // Draft is spent once the private Memory exists for this completion.
  await pendingPlanRecapStore().remove(ownerId, recap.completionId);
  return { ok: true, memory: saved.memory, moments: saved.moments };
}
