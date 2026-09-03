import type { PendingPlanRecap } from "@/lib/planRecap";
import { validatePendingPlanRecap } from "@/lib/planRecap";

/**
 * Detection-only helpers for bringing device Plan recaps onto an account.
 * Importing a device draft is a consequential Memory write and always needs an
 * explicit UI choice (same bar as Night Profile merge).
 */

export type PlanRecapClaimMergeState =
  | { kind: "none" }
  | { kind: "device-only"; recaps: PendingPlanRecap[] };

export type PlanRecapClaimChoice = "bring-device" | "keep-device";

/** Recaps on this device that are not already represented by an account Memory. */
export function planRecapClaimMergeState(
  deviceRecaps: PendingPlanRecap[],
  accountCompletionIds: ReadonlySet<string> | readonly string[],
): PlanRecapClaimMergeState {
  const owned = accountCompletionIds instanceof Set
    ? accountCompletionIds
    : new Set(accountCompletionIds);
  const pending = deviceRecaps.filter((recap) => {
    const safe = validatePendingPlanRecap(recap);
    return Boolean(safe && !owned.has(safe.completionId));
  });
  return pending.length === 0
    ? { kind: "none" }
    : { kind: "device-only", recaps: pending };
}

export function confirmedPlanRecapClaim(
  state: Exclude<PlanRecapClaimMergeState, { kind: "none" }>,
  choice: PlanRecapClaimChoice,
): { writesAccount: boolean; recaps: PendingPlanRecap[] } {
  if (choice === "keep-device") {
    return { writesAccount: false, recaps: state.recaps };
  }
  return { writesAccount: true, recaps: state.recaps };
}

/** Body shape for POST /api/me/pending-plan-recaps claim. */
export type PlanRecapClaimItem = {
  recap: PendingPlanRecap;
  memberToken: string;
};

export function cleanPlanRecapClaimItems(raw: unknown): PlanRecapClaimItem[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) return null;
  const items: PlanRecapClaimItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    const recap = validatePendingPlanRecap(row.recap);
    const memberToken = typeof row.memberToken === "string" ? row.memberToken.trim() : "";
    if (!recap || !memberToken || memberToken.length > 200) return null;
    if (seen.has(recap.completionId)) continue;
    seen.add(recap.completionId);
    items.push({ recap, memberToken });
  }
  return items.length > 0 ? items : null;
}
