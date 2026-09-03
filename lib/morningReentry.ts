// Morning re-entry marker for Night Mode (U22). When a plan's night has been
// completed, the NEXT time the app opens we want to say a quiet "last night,
// sorted" and point at the recap that wrote itself overnight. This module is the
// client-only bookkeeping behind that one-time card.
//
// Three storage facts, all local to the device (no backend, no account needed):
//   • pending   (localStorage)  — the most-recent completed night to celebrate,
//                                  { planId, title, completedAt }.
//   • shown     (localStorage)  — a per-plan "already celebrated" marker, so the
//                                  card is strictly ONE-TIME across app opens.
//   • suppress  (sessionStorage)— set only in the session where completion
//                                  actually happened, so the card does not pop up
//                                  the same night (or on a same-session refresh);
//                                  gone next session, which is exactly "next time
//                                  the app opens".
//
// TTL: the card is only eligible for ~36h after completion, so it greets the
// morning after and never a week later. Past the TTL the pending marker is inert
// (and cheap to leave; it is overwritten by the next completed night).
//
// The gate is a pure function (shouldShowMorningCard) exported for unit testing;
// the storage wrappers mirror lib/identityNudge.ts (window-backed, SSR-safe,
// same-tab change event), and a fake window is installed in tests.

import { isPlanId } from "@/lib/plan";

export const MORNING_REENTRY_VERSION = 1 as const;

/** Eligibility window after completion — long enough for the morning after. */
export const MORNING_REENTRY_TTL_MS = 36 * 60 * 60 * 1000;

const PENDING_KEY = "pubmax:morning-reentry:pending:v1";
const SHOWN_PREFIX = "pubmax:morning-reentry:shown:v1:";
const SUPPRESS_PREFIX = "pubmax:morning-reentry:suppress:v1:";

/** Same-tab notify so a mounted card can re-read after a write (cross-tab: storage). */
export const MORNING_REENTRY_EVENT = "pubmax:morning-reentry";

const TITLE_MAX = 120;

export type CompletedNight = {
  version: typeof MORNING_REENTRY_VERSION;
  planId: string;
  title: string;
  /** ISO instant the ending was confirmed — the TTL anchor. */
  completedAt: string;
};

function hasLocal(): boolean {
  if (typeof window === "undefined") return false;
  try {
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

function notify(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(MORNING_REENTRY_EVENT));
  } catch {
    // Older environments without an Event ctor still keep the storage write.
  }
}

function shownKey(planId: string): string {
  return `${SHOWN_PREFIX}${planId}`;
}

function suppressKey(planId: string): string {
  return `${SUPPRESS_PREFIX}${planId}`;
}

/** Parse a stored pending marker, or null when missing / malformed / not a plan. */
export function parseCompletedNight(raw: string | null | undefined): CompletedNight | null {
  if (typeof raw !== "string" || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  if (row.version !== MORNING_REENTRY_VERSION) return null;
  if (!isPlanId(row.planId)) return null;
  if (typeof row.completedAt !== "string" || Number.isNaN(Date.parse(row.completedAt))) return null;
  const title = typeof row.title === "string" ? row.title.slice(0, TITLE_MAX) : "";
  return { version: MORNING_REENTRY_VERSION, planId: row.planId, title, completedAt: row.completedAt };
}

export function serializeCompletedNight(night: CompletedNight): string {
  return JSON.stringify({
    version: MORNING_REENTRY_VERSION,
    planId: night.planId,
    title: typeof night.title === "string" ? night.title.slice(0, TITLE_MAX) : "",
    completedAt: night.completedAt,
  });
}

export type MorningReentryGateState = {
  /** The stored pending night, or null. */
  night: CompletedNight | null;
  /** Current epoch ms. */
  now: number;
  /** Eligibility window in ms. */
  ttlMs: number;
  /** This plan's card was already shown once — never show it again. */
  alreadyShown: boolean;
  /** Completion happened in THIS session — hold the card until the next open. */
  suppressedThisSession: boolean;
};

/**
 * Pure gate — no storage / DOM. Returns the night to celebrate, or null. Shows
 * only when a pending night exists, it has not been shown before, completion was
 * not this same session, and `now` sits inside [completedAt, completedAt + TTL].
 */
export function shouldShowMorningCard(state: MorningReentryGateState): CompletedNight | null {
  const { night } = state;
  if (!night) return null;
  if (state.alreadyShown) return null;
  if (state.suppressedThisSession) return null;
  const completedAt = Date.parse(night.completedAt);
  if (Number.isNaN(completedAt)) return null;
  if (state.now < completedAt) return null;
  if (state.now > completedAt + state.ttlMs) return null;
  return night;
}

/** Read the raw pending marker (no gating). Null on SSR / unset / malformed. */
export function readPendingCompletedNight(): CompletedNight | null {
  if (!hasLocal()) return null;
  try {
    return parseCompletedNight(window.localStorage.getItem(PENDING_KEY));
  } catch {
    return null;
  }
}

/** Has this plan's morning card already been shown once? */
export function isMorningCardShown(planId: string): boolean {
  if (!hasLocal() || !isPlanId(planId)) return false;
  try {
    return window.localStorage.getItem(shownKey(planId)) === "1";
  } catch {
    return false;
  }
}

/** Is this plan's completion from the current session (so the card waits)? */
export function isMorningCardSuppressedThisSession(planId: string): boolean {
  if (!hasSession() || !isPlanId(planId)) return false;
  try {
    return window.sessionStorage.getItem(suppressKey(planId)) === "1";
  } catch {
    return false;
  }
}

/**
 * Record a completed night for the morning-after card. No-op once the plan's
 * card has already been shown (never resurrect a dismissed one) and never
 * downgrades a newer pending night to an older one.
 *
 * `suppressThisSession` is set true ONLY by the path that actually completes the
 * night this session (so the card does not fire the same evening); the re-entry
 * seed path passes false so a genuinely fresh open can show it.
 */
export function recordCompletedNight(
  night: CompletedNight,
  options?: { suppressThisSession?: boolean },
): void {
  if (!hasLocal() || !isPlanId(night.planId)) return;
  if (Number.isNaN(Date.parse(night.completedAt))) return;
  if (isMorningCardShown(night.planId)) return;
  try {
    const existing = readPendingCompletedNight();
    // Keep the newest completed night; ignore an out-of-order older record.
    if (existing && Date.parse(existing.completedAt) > Date.parse(night.completedAt)) {
      // Still allow the suppress flag for this plan to be set below.
    } else {
      window.localStorage.setItem(PENDING_KEY, serializeCompletedNight(night));
    }
    if (options?.suppressThisSession && hasSession()) {
      window.sessionStorage.setItem(suppressKey(night.planId), "1");
    }
    notify();
  } catch {
    // Storage full / disabled / private mode — degrade silently.
  }
}

/**
 * Mark this plan's morning card as shown (one-time) and clear the pending
 * marker so it never re-appears on a later open.
 */
export function markMorningCardShown(planId: string): void {
  if (!hasLocal() || !isPlanId(planId)) return;
  try {
    window.localStorage.setItem(shownKey(planId), "1");
    const pending = readPendingCompletedNight();
    if (pending && pending.planId === planId) window.localStorage.removeItem(PENDING_KEY);
    notify();
  } catch {
    // ignore
  }
}

/**
 * The night to celebrate right now, or null. Folds pending + shown + suppress +
 * TTL through the pure gate. Consumed by the card on mount.
 */
export function readShowableMorningNight(now: number = Date.now()): CompletedNight | null {
  const night = readPendingCompletedNight();
  return shouldShowMorningCard({
    night,
    now,
    ttlMs: MORNING_REENTRY_TTL_MS,
    alreadyShown: night ? isMorningCardShown(night.planId) : false,
    suppressedThisSession: night ? isMorningCardSuppressedThisSession(night.planId) : false,
  });
}

/** Subscribe to marker changes (same-tab custom event + cross-tab storage). */
export function subscribeMorningReentry(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onChange();
  window.addEventListener(MORNING_REENTRY_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(MORNING_REENTRY_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Clear all morning-reentry state — handy for local testing. */
export function resetMorningReentry(planId?: string): void {
  if (!hasLocal()) return;
  try {
    window.localStorage.removeItem(PENDING_KEY);
    if (planId) {
      window.localStorage.removeItem(shownKey(planId));
      if (hasSession()) window.sessionStorage.removeItem(suppressKey(planId));
    }
    notify();
  } catch {
    // ignore
  }
}
