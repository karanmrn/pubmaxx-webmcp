import { cleanEndingSelection, isPlanId, type CrawlEnding, type EndingSelection, type PlanCompletionDTO } from "@/lib/plan";

export const PENDING_PLAN_RECAP_VERSION = 1 as const;
const KEY_PREFIX = "pubmaxx.pending-plan-recap.v1:";
const RESOLUTION_PREFIX = "pubmaxx.pending-plan-recap-resolution.v1:";
const CHANGE_EVENT = "pubmaxx:pending-plan-recap";

export type PendingPlanRecapStop = {
  venueId: string;
  venueName: string;
  position: number;
  caption: string;
};

/**
 * A local, private recap draft. It intentionally contains route references and
 * user-written captions only: no coordinates, voice input, media bytes, member
 * capabilities, or precise location history are persisted.
 */
export type PendingPlanRecap = {
  version: typeof PENDING_PLAN_RECAP_VERSION;
  planId: string;
  completionId: string;
  title: string;
  ending: CrawlEnding;
  endingSelection?: EndingSelection | null;
  completedAt: string;
  routeRevision: number;
  stops: PendingPlanRecapStop[];
  savedAt: string;
};

export type PendingPlanRecapResolution = {
  version: typeof PENDING_PLAN_RECAP_VERSION;
  completionId: string;
  status: "discarded" | "saved";
  resolvedAt: string;
};

function localStorageSafe(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

function key(planId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(planId)}`;
}

function resolutionKey(planId: string, completionId: string): string {
  return `${RESOLUTION_PREFIX}${encodeURIComponent(planId)}:${encodeURIComponent(completionId)}`;
}

function boundedText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

export function validatePendingPlanRecap(value: unknown): PendingPlanRecap | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PendingPlanRecap>;
  if (row.version !== PENDING_PLAN_RECAP_VERSION || !isPlanId(row.planId)) return null;
  if (typeof row.completionId !== "string" || row.completionId.length > 80 || !row.completionId) return null;
  if (row.ending !== "food" && row.ending !== "get_home" && row.ending !== "keep_going") return null;
  const endingSelection = cleanEndingSelection(row.endingSelection, row.ending);
  if (row.endingSelection !== undefined && row.endingSelection !== null && !endingSelection) return null;
  if (typeof row.routeRevision !== "number" || !Number.isInteger(row.routeRevision) || row.routeRevision < 1) return null;
  if (typeof row.completedAt !== "string" || !Number.isFinite(Date.parse(row.completedAt))) return null;
  if (typeof row.savedAt !== "string" || !Number.isFinite(Date.parse(row.savedAt))) return null;
  const title = boundedText(row.title, 120);
  if (!title || !Array.isArray(row.stops) || row.stops.length < 1 || row.stops.length > 8) return null;
  const stops = row.stops.map((stop, index) => {
    if (!stop || typeof stop !== "object") return null;
    const item = stop as Partial<PendingPlanRecapStop>;
    const venueId = boundedText(item.venueId, 80);
    const venueName = boundedText(item.venueName, 120);
    const caption = boundedText(item.caption, 500);
    if (!venueId || !venueName || caption === null || item.position !== index) return null;
    return { venueId, venueName, position: index, caption };
  });
  if (stops.some((stop) => stop === null)) return null;
  if (new Set(stops.map((stop) => stop!.venueId)).size !== stops.length) return null;
  return {
    version: PENDING_PLAN_RECAP_VERSION,
    planId: row.planId,
    completionId: row.completionId,
    title,
    ending: row.ending,
    endingSelection,
    completedAt: new Date(row.completedAt).toISOString(),
    routeRevision: row.routeRevision,
    stops: stops as PendingPlanRecapStop[],
    savedAt: new Date(row.savedAt).toISOString(),
  };
}

export function pendingPlanRecapFromCompletion(
  completion: PlanCompletionDTO,
  title: string,
  now: string = new Date().toISOString(),
): PendingPlanRecap {
  return {
    version: PENDING_PLAN_RECAP_VERSION,
    planId: completion.planId,
    completionId: completion.id,
    title: title.trim().slice(0, 120) || "Tonight's Memory",
    ending: completion.ending,
    endingSelection: completion.endingSelection ?? null,
    completedAt: completion.completedAt,
    routeRevision: completion.routeRevision,
    stops: completion.routeSnapshot
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((stop, position) => ({
        venueId: stop.venueId,
        venueName: stop.venueName,
        position,
        caption: "",
      })),
    savedAt: now,
  };
}

export function isPendingPlanRecapResolved(planId: string, completionId: string): boolean {
  if (!isPlanId(planId) || !completionId) return false;
  try {
    const raw = JSON.parse(localStorageSafe()?.getItem(resolutionKey(planId, completionId)) ?? "null") as Partial<PendingPlanRecapResolution> | null;
    return raw?.version === PENDING_PLAN_RECAP_VERSION
      && raw.completionId === completionId
      && (raw.status === "discarded" || raw.status === "saved")
      && typeof raw.resolvedAt === "string"
      && Number.isFinite(Date.parse(raw.resolvedAt));
  } catch {
    return false;
  }
}

export function ensurePendingPlanRecap(completion: PlanCompletionDTO, title: string): PendingPlanRecap | null {
  const existing = readPendingPlanRecap(completion.planId);
  if (existing?.completionId === completion.id) return existing;
  if (isPendingPlanRecapResolved(completion.planId, completion.id)) return null;
  const seeded = pendingPlanRecapFromCompletion(completion, title);
  writePendingPlanRecap(seeded);
  return seeded;
}

export function readPendingPlanRecap(planId: string): PendingPlanRecap | null {
  if (!isPlanId(planId)) return null;
  try {
    return validatePendingPlanRecap(JSON.parse(localStorageSafe()?.getItem(key(planId)) ?? "null"));
  } catch {
    return null;
  }
}

export function writePendingPlanRecap(recap: PendingPlanRecap): void {
  const safe = validatePendingPlanRecap({ ...recap, savedAt: new Date().toISOString() });
  const storage = localStorageSafe();
  if (!safe || !storage) return;
  try {
    storage.setItem(key(safe.planId), JSON.stringify(safe));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { planId: safe.planId } }));
  } catch {
    // Private browsing or quota limits keep this best-effort.
  }
}

export function discardPendingPlanRecap(planId: string): void {
  if (!isPlanId(planId)) return;
  try {
    localStorageSafe()?.removeItem(key(planId));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { planId } }));
  } catch {
    // Best effort only.
  }
}

export function resolvePendingPlanRecap(recap: PendingPlanRecap, status: "discarded" | "saved"): void {
  const safe = validatePendingPlanRecap(recap);
  const storage = localStorageSafe();
  if (!safe || !storage) return;
  try {
    storage.setItem(resolutionKey(safe.planId, safe.completionId), JSON.stringify({
      version: PENDING_PLAN_RECAP_VERSION,
      completionId: safe.completionId,
      status,
      resolvedAt: new Date().toISOString(),
    } satisfies PendingPlanRecapResolution));
    storage.removeItem(key(safe.planId));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { planId: safe.planId } }));
  } catch {
    // Best effort only.
  }
}

export function subscribePendingPlanRecap(planId: string, listener: () => void): () => void {
  if (typeof window === "undefined" || !isPlanId(planId)) return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && event.key === key(planId)) listener();
  };
  const onChange = (event: Event) => {
    if ((event as CustomEvent<{ planId?: string }>).detail?.planId === planId) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * Every pending Plan recap still on this device. Scans only the versioned key
 * prefix so unrelated storage never becomes a draft.
 */
export function listPendingPlanRecaps(storage = localStorageSafe()): PendingPlanRecap[] {
  if (!storage) return [];
  const found: PendingPlanRecap[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const itemKey = storage.key(index);
      if (!itemKey || !itemKey.startsWith(KEY_PREFIX)) continue;
      try {
        const recap = validatePendingPlanRecap(JSON.parse(storage.getItem(itemKey) ?? "null"));
        if (recap) found.push(recap);
      } catch {
        // Skip malformed rows; never invent a draft from garbage.
      }
    }
  } catch {
    return [];
  }
  return found.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export function subscribeAnyPendingPlanRecap(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (
      event.storageArea === window.localStorage
      && typeof event.key === "string"
      && event.key.startsWith(KEY_PREFIX)
    ) {
      listener();
    }
  };
  const onChange = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
