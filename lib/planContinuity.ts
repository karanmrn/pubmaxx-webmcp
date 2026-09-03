import { isPlanId } from "@/lib/plan";

export const PLAN_COLLABORATION_MARKER_VERSION = 1 as const;
const PREFIX = "pubmaxx.plan-collaboration-change.v1:";
const EVENT = "pubmaxx:plan-collaboration-change";

export type PlanCollaborationChangeKind = "invite" | "constraint" | "proposal" | "vote" | "decision";
export type PlanCollaborationChangeV1 = {
  version: typeof PLAN_COLLABORATION_MARKER_VERSION;
  planId: string;
  kind: PlanCollaborationChangeKind;
  changedAt: string;
};

function key(planId: string): string { return `${PREFIX}${encodeURIComponent(planId)}`; }

export function validatePlanCollaborationChange(value: unknown): PlanCollaborationChangeV1 | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PlanCollaborationChangeV1>;
  if (row.version !== PLAN_COLLABORATION_MARKER_VERSION || !isPlanId(row.planId)) return null;
  if (!row.kind || !["invite", "constraint", "proposal", "vote", "decision"].includes(row.kind)) return null;
  if (typeof row.changedAt !== "string" || !Number.isFinite(Date.parse(row.changedAt))) return null;
  return { version: PLAN_COLLABORATION_MARKER_VERSION, planId: row.planId, kind: row.kind, changedAt: new Date(row.changedAt).toISOString() };
}

/** Cross-tab invalidation only: no member token, constraint text, vote, or route is copied. */
export function publishPlanCollaborationChange(planId: string, kind: PlanCollaborationChangeKind): void {
  if (typeof window === "undefined" || !isPlanId(planId)) return;
  const marker: PlanCollaborationChangeV1 = { version: PLAN_COLLABORATION_MARKER_VERSION, planId, kind, changedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(key(planId), JSON.stringify(marker));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: marker }));
  } catch {
    // The current tab still refreshes directly when storage is unavailable.
  }
}

export function subscribePlanCollaborationChange(planId: string, listener: () => void): () => void {
  if (typeof window === "undefined" || !isPlanId(planId)) return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && event.key === key(planId)) listener();
  };
  const onLocal = (event: Event) => {
    const marker = validatePlanCollaborationChange((event as CustomEvent).detail);
    if (marker?.planId === planId) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onLocal);
  };
}
