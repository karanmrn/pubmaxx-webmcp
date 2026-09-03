// Active-plan stickiness for Night Mode (Wave E2). One localStorage key names
// the plan whose night is happening RIGHT NOW, so the persistent Night Mode
// bottom card (mounted in the app shell) can appear across every screen while a
// plan is live — not just on /plan/[id].
//
// This is a CLIENT pointer, never a backend change: the id + startTime are
// already known to the browser (the plan screen holds the route param; private
// mutation authority lives in a path-scoped HttpOnly session). We record them here on the plan page
// so the shell can detect "there is a plan on tonight" without a server round
// trip. The card fetches the real plan state (/api/plans/[id]) itself.
//
// Mirrors lib/activeRound.ts's idiom (same-tab custom event + cross-tab storage
// + focus), so the two "what's live right now" pointers behave identically.

import { isPlanId, type CrawlEnding, type PlanMemberRole } from "@/lib/plan";
import { DAY_MS } from "@/lib/dayMs";

export const ACTIVE_PLAN_KEY = "pubmax_active_plan";
export const ACTIVE_PLAN_VERSION = 1 as const;

// The plan is only "on tonight" for a bounded window around its start time, so
// the card never haunts the shell days later off a stale pointer. Generous on
// both sides: crews gather before the first pint and a proper crawl runs long.
export const ACTIVE_PLAN_PRE_MS = 3 * 60 * 60 * 1000; // 3h before the first pint
export const ACTIVE_PLAN_POST_MS = 8 * 60 * 60 * 1000; // 8h after (last-train o'clock)

// After the active window closes, a night can still have an unsaved private
// recap stranded on the device. The Night Mode card is the only surface that
// can save it, so it stays reachable for a bounded grace period past the ending
// — long enough to catch it the morning after, short enough never to haunt the
// shell for days. Measured from the completion instant, not the plan start.
export const RECAP_GRACE_MS = DAY_MS; // 24h after the ending was confirmed

/** Same-tab notify so the shell card re-reads after a write without a focus hop. */
const CHANGE_EVENT = "pubmax:active-plan";
const DISMISS_EVENT = "pubmax:night-mode-dismiss";
const DISMISS_PREFIX = "pubmax:night-mode-dismissed:";

export type ActivePlanRef = {
  version?: typeof ACTIVE_PLAN_VERSION;
  id: string;
  startTime: string;
  /** User-advanced "which stop are we at" cursor — never inferred, only tapped. */
  stopIndex: number;
  /** Safe continuity only; never grants host/guest mutation authority. */
  role?: PlanMemberRole | null;
  /** A preview selection, not a completed ending. Server confirmation remains required. */
  endingPreview?: CrawlEnding | null;
  /** Companion identity only. No conversation, memory, voice, or location data. */
  palContext?: { id: string; name: string } | null;
};

function hasLocal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Property ACCESS itself can throw in storage-restricted browsers, so the
    // read must live inside the guard — not just the later getItem/setItem.
    return !!window.localStorage;
  } catch {
    return false;
  }
}

function hasSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!window.sessionStorage;
  } catch {
    return false;
  }
}

function notify(eventName: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(eventName));
  } catch {
    // Older environments without an Event ctor still keep the storage write.
  }
}

/** Coerce a raw stopIndex into a safe non-negative integer (defaults to 0). */
export function cleanStopIndex(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Keep a cursor inside the real stop list — never point past the last pub. */
export function clampStopIndex(index: number, stopCount: number): number {
  if (!Number.isFinite(stopCount) || stopCount <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), stopCount - 1);
}

/** Parse the stored JSON pointer, or null when missing / malformed / not a plan id. */
export function parseActivePlan(raw: string | null | undefined): ActivePlanRef | null {
  if (typeof raw !== "string" || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  if (row.version !== undefined && row.version !== ACTIVE_PLAN_VERSION) return null;
  if (!isPlanId(row.id)) return null;
  if (typeof row.startTime !== "string" || Number.isNaN(Date.parse(row.startTime))) return null;
  const role = row.role === "host" || row.role === "guest" ? row.role : null;
  const endingPreview = row.endingPreview === "food" || row.endingPreview === "get_home" || row.endingPreview === "keep_going" ? row.endingPreview : null;
  const rawPal = row.palContext && typeof row.palContext === "object" ? row.palContext as Record<string, unknown> : null;
  const palContext = rawPal && typeof rawPal.id === "string" && rawPal.id.length <= 120 && typeof rawPal.name === "string" && rawPal.name.length <= 80
    ? { id: rawPal.id, name: rawPal.name }
    : null;
  return { version: ACTIVE_PLAN_VERSION, id: row.id, startTime: row.startTime, stopIndex: cleanStopIndex(row.stopIndex), role, endingPreview, palContext };
}

export function serializeActivePlan(ref: ActivePlanRef): string {
  return JSON.stringify({
    version: ACTIVE_PLAN_VERSION,
    id: ref.id,
    startTime: ref.startTime,
    stopIndex: cleanStopIndex(ref.stopIndex),
    role: ref.role === "host" || ref.role === "guest" ? ref.role : null,
    endingPreview: ref.endingPreview === "food" || ref.endingPreview === "get_home" || ref.endingPreview === "keep_going" ? ref.endingPreview : null,
    palContext: ref.palContext && ref.palContext.id.length <= 120 && ref.palContext.name.length <= 80 ? ref.palContext : null,
  });
}

/**
 * Is this plan's night happening around `now`? True inside
 * [start − PRE, start + POST]. A pointer with an unparseable start is treated
 * as inactive rather than perpetual — honest degradation, never a stuck card.
 */
export function isPlanActiveNow(ref: ActivePlanRef | null, now: number): boolean {
  if (!ref) return false;
  const start = Date.parse(ref.startTime);
  if (Number.isNaN(start)) return false;
  return now >= start - ACTIVE_PLAN_PRE_MS && now <= start + ACTIVE_PLAN_POST_MS;
}

/**
 * Is `now` inside the recap grace period that follows a confirmed ending? True
 * for [completedAt, completedAt + RECAP_GRACE]. An absent or unparseable
 * timestamp is treated as outside the window — a stranded recap never keeps the
 * card up forever, it just retires with the active window.
 */
export function isWithinRecapGrace(completedAtIso: string | null | undefined, now: number): boolean {
  if (typeof completedAtIso !== "string") return false;
  const completedAt = Date.parse(completedAtIso);
  if (Number.isNaN(completedAt)) return false;
  return now >= completedAt && now <= completedAt + RECAP_GRACE_MS;
}

/** Stored active-plan pointer, or null on SSR / unset / malformed. */
export function readActivePlan(): ActivePlanRef | null {
  if (!hasLocal()) return null;
  try {
    return parseActivePlan(window.localStorage.getItem(ACTIVE_PLAN_KEY));
  } catch {
    return null;
  }
}

/** Persist (or replace) the active-plan pointer. No-op on SSR / invalid / failure. */
export function writeActivePlan(ref: ActivePlanRef): void {
  if (!hasLocal()) return;
  if (!isPlanId(ref.id) || Number.isNaN(Date.parse(ref.startTime))) return;
  try {
    window.localStorage.setItem(ACTIVE_PLAN_KEY, serializeActivePlan(ref));
    notify(CHANGE_EVENT);
  } catch {
    // Storage full / disabled / private mode — degrade silently.
  }
}

/**
 * Record a plan as the one that's on tonight — called from the plan screen.
 * Preserves an existing stopIndex when re-recording the SAME plan (a revisit
 * must not reset how far the crew has walked); resets to 0 for a new plan.
 */
export function markActivePlan(id: string, startTime: string, now: number = Date.now()): void {
  if (!isPlanId(id) || Number.isNaN(Date.parse(startTime))) return;
  const current = readActivePlan();
  // Opening a past/future plan page must not evict the plan that's live RIGHT
  // NOW (which would hide the live Night Mode card). Only replace the pointer
  // when there's no stored plan, it's the same plan, the stored plan is no
  // longer in its active window, or the incoming plan is itself active now.
  const candidate: ActivePlanRef = { version: ACTIVE_PLAN_VERSION, id, startTime, stopIndex: 0, role: null, endingPreview: null, palContext: null };
  if (
    current &&
    current.id !== id &&
    isPlanActiveNow(current, now) &&
    !isPlanActiveNow(candidate, now)
  ) {
    return;
  }
  const continuity = current && current.id === id
    ? { stopIndex: current.stopIndex, role: current.role ?? null, endingPreview: current.endingPreview ?? null, palContext: current.palContext ?? null }
    : { stopIndex: 0, role: null, endingPreview: null, palContext: null };
  writeActivePlan({ version: ACTIVE_PLAN_VERSION, id, startTime, ...continuity });
}

/** Persist a new stop cursor for the active plan (the "here now" tap). */
export function setActivePlanStopIndex(index: number): void {
  const current = readActivePlan();
  if (!current) return;
  writeActivePlan({ ...current, stopIndex: cleanStopIndex(index) });
}

export function setActivePlanRole(planId: string, role: PlanMemberRole | null): void {
  const current = readActivePlan();
  if (!current || current.id !== planId) return;
  writeActivePlan({ ...current, role });
}

export function setActivePlanEndingPreview(planId: string, endingPreview: CrawlEnding | null): void {
  const current = readActivePlan();
  if (!current || current.id !== planId) return;
  writeActivePlan({ ...current, endingPreview });
}

export function setActivePlanPalContext(palContext: ActivePlanRef["palContext"]): void {
  const current = readActivePlan();
  if (!current) return;
  writeActivePlan({ ...current, palContext: palContext ?? null });
}

/**
 * Clear the active-plan pointer. When `onlyIfId` is set, only clears if the
 * stored pointer still names that plan (another tab may have moved on).
 */
export function clearActivePlan(onlyIfId?: string): void {
  if (!hasLocal()) return;
  try {
    const current = parseActivePlan(window.localStorage.getItem(ACTIVE_PLAN_KEY));
    if (!current) return;
    if (onlyIfId != null && current.id !== onlyIfId) return;
    window.localStorage.removeItem(ACTIVE_PLAN_KEY);
    notify(CHANGE_EVENT);
  } catch {
    // ignore
  }
}

/** Subscribe to active-plan changes (same-tab writes + cross-tab storage + focus). */
export function subscribeActivePlan(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onChange();
  const storageHandler = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && event.key === ACTIVE_PLAN_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", storageHandler);
  window.addEventListener("focus", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
    window.removeEventListener("focus", handler);
  };
}

// ── Dismissal (session-scoped) ───────────────────────────────────────────────
// A user who swipes the card away shouldn't see it re-mount every screen change,
// but it should come back next night. sessionStorage is the right lifetime: gone
// on a fresh session, kept while they browse. Keyed per plan id so dismissing
// tonight's card never suppresses a different plan later.

export function nightModeDismissKey(id: string): string {
  return `${DISMISS_PREFIX}${id}`;
}

export function isNightModeDismissed(id: string): boolean {
  if (!hasSession() || !isPlanId(id)) return false;
  try {
    return window.sessionStorage.getItem(nightModeDismissKey(id)) === "1";
  } catch {
    return false;
  }
}

export function dismissNightMode(id: string): void {
  if (!hasSession() || !isPlanId(id)) return;
  try {
    window.sessionStorage.setItem(nightModeDismissKey(id), "1");
    notify(DISMISS_EVENT);
  } catch {
    // ignore
  }
}

export function restoreNightMode(id: string): void {
  if (!hasSession() || !isPlanId(id)) return;
  try {
    window.sessionStorage.removeItem(nightModeDismissKey(id));
    notify(DISMISS_EVENT);
  } catch {
    // ignore
  }
}

// ── night_mode_active dedupe (session-scoped, per plan) ──────────────────────
// The night_mode_active metric should fire once per plan per browser session —
// not once per sheet mount. A ref resets on dismiss/reopen and only remembers a
// single id, so an A → B → A plan switch refires A. Persist a per-plan marker in
// sessionStorage (survives remounts, gone next session) with an in-memory
// fallback for storage-restricted browsers.

const NIGHT_ACTIVE_PREFIX = "pubmax:night-mode-active-fired:";
const nightActiveMemory = new Set<string>();

/**
 * Mark night_mode_active as fired for `id`, returning true only the FIRST time
 * this session (so the caller fires the event exactly once per plan). Falls back
 * to an in-memory set when sessionStorage is unavailable or throws.
 */
export function markNightModeActiveFired(id: string): boolean {
  if (!isPlanId(id)) return false;
  const key = `${NIGHT_ACTIVE_PREFIX}${id}`;
  if (hasSession()) {
    try {
      if (window.sessionStorage.getItem(key) === "1") return false;
      window.sessionStorage.setItem(key, "1");
      // Always sync to in-memory fallback on successful write; if storage fails
      // later (or fails next time due to becoming restricted), the fallback will
      // have the entry and prevent refiring the same event.
      nightActiveMemory.add(id);
      return true;
    } catch {
      // fall through to in-memory dedupe
    }
  }
  if (nightActiveMemory.has(id)) return false;
  nightActiveMemory.add(id);
  return true;
}

/** Subscribe to dismiss/restore toggles (same-tab custom event + cross-tab storage). */
export function subscribeNightModeDismiss(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onChange();
  window.addEventListener(DISMISS_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(DISMISS_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
