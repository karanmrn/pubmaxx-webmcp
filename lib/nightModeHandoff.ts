import { useCallback, useEffect, useState } from "react";

import { nightCrawlHandoffTarget, stopDisposition } from "@/lib/nightCrawl";
import type { PlanState } from "@/lib/plan";
import type { PlanMutationFlushResult } from "@/lib/planMutationOutbox";

export const NIGHT_MODE_ENDING_HANDOFF_EVENT = "pubmaxx:night-mode-ending-handoff";
const HANDOFF_KEY_PREFIX = "pubmaxx:night-mode-ending-ready:";

function handoffKey(planId: string): string {
  return `${HANDOFF_KEY_PREFIX}${planId}`;
}

/** Persist first, then wake any mounted ending owner for this Plan. */
export function requestNightModeEndingHandoff(planId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(handoffKey(planId), "1");
  } catch {
    // The live event still hands off when storage is restricted.
  }
  try {
    window.dispatchEvent(
      new CustomEvent<{ planId: string }>(NIGHT_MODE_ENDING_HANDOFF_EVENT, {
        detail: { planId },
      }),
    );
  } catch {
    // A stored handoff remains for the next mount.
  }
}

/** One-shot read used when the global Night Mode owner mounts after a replay. */
export function consumeNightModeEndingHandoff(planId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(handoffKey(planId)) !== "1") return false;
    window.sessionStorage.removeItem(handoffKey(planId));
    return true;
  } catch {
    return false;
  }
}

export function subscribeNightModeEndingHandoff(
  planId: string,
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onHandoff = (event: Event) => {
    const detail = (event as CustomEvent<{ planId?: string }>).detail;
    if (detail?.planId !== planId) return;
    consumeNightModeEndingHandoff(planId);
    listener();
  };
  window.addEventListener(NIGHT_MODE_ENDING_HANDOFF_EVENT, onHandoff);
  return () => window.removeEventListener(NIGHT_MODE_ENDING_HANDOFF_EVENT, onHandoff);
}

/** Preserve final-stop completion intent when the site-wide outbox confirms. */
export function requestNightModeEndingFromFlush(
  result: PlanMutationFlushResult,
): boolean {
  if (
    !result.plan ||
    nightCrawlHandoffTarget({
      stops: result.plan.stops,
      actions: result.plan.actions,
      stopPosition: result.stopPosition,
      outcome: result.outcome === "conflict" ? "rejected" : result.outcome,
    }) !== "ending"
  ) {
    return false;
  }
  requestNightModeEndingHandoff(result.planId);
  return true;
}

/** Recover a missed replay handoff from the canonical Plan action log. */
export function requestNightModeEndingFromPlan(plan: PlanState): boolean {
  if (
    plan.ending ||
    plan.plan.status === "completed" ||
    plan.plan.status === "abandoned"
  ) {
    return false;
  }
  const finalStop = [...plan.stops]
    .sort((left, right) => left.position - right.position)
    .at(-1);
  if (
    !finalStop ||
    !stopDisposition(plan.actions, finalStop.position) ||
    nightCrawlHandoffTarget({
      stops: plan.stops,
      actions: plan.actions,
      stopPosition: finalStop.position,
      outcome: "confirmed",
    }) !== "ending"
  ) {
    return false;
  }
  requestNightModeEndingHandoff(plan.plan.id);
  return true;
}

/** One state owner for the global Tonight pill and its ending sheet. */
export function useNightModeEndingOwner(planId: string): {
  expanded: boolean;
  open: () => void;
  collapse: () => void;
} {
  const [expanded, setExpanded] = useState(() =>
    consumeNightModeEndingHandoff(planId),
  );
  const open = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => setExpanded(false), []);

  useEffect(
    () => subscribeNightModeEndingHandoff(planId, open),
    [open, planId],
  );

  return { expanded, open, collapse };
}
