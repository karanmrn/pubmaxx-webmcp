// Add-to-Home-Screen (A2HS) install-prompt gate — pure logic behind the
// Cycle-4 Wave-C install UX. Locked product decision: never beg on first
// touch. Only offer the home-screen install AFTER PROVEN VALUE — the visitor
// has come back on a second distinct day, or has completed their first night
// (a walked crawl). Installed PWAs are the reachability play: an installed iOS
// PWA (iOS 16.4+) gains web push, so an install today is a notifiable user
// tomorrow.
//
// This module is DOM-free and storage-injectable so it unit-tests in the node
// vitest env: platform detection takes a plain snapshot of navigator/matchMedia
// values, and every gate is a pure function of explicit inputs. The thin
// localStorage-backed wrappers at the bottom (used only by the client
// component) mirror the storage idiom in lib/firstRunTour.ts and
// lib/crawlCompletion.ts.
//
// The "day bucket" idiom is copied (pattern, not code) from the unmerged
// metrics-funnel lib/dailyActivity.ts: whole UTC days since the epoch, a small
// monotonic integer carrying no timezone/clock/fingerprint signal, so counting
// distinct buckets tells us "came back on another day" with nothing private in
// it.

import { DAY_MS } from "@/lib/dayMs";
import { isNativeApp } from "@/lib/nativePlatform";

/** Milliseconds in one UTC day. Shared owner: lib/dayMs.ts. */
export const MS_PER_DAY = DAY_MS;

/** How long a decline suppresses the prompt before it may re-offer. */
export const A2HS_DECLINE_COOLDOWN_DAYS = 14;

/** localStorage slot for the persisted A2HS state. */
const STORAGE_KEY = "pubmax:a2hs:v1";
/** Same-tab notify so useSyncExternalStore clients re-read after a write. */
const CHANGE_EVENT = "pubmax:a2hs";

/**
 * Which install path applies to the current device.
 * - `android`   — a Chromium engine that can fire `beforeinstallprompt`; we
 *                 drive the native mini-infobar via the captured event.
 * - `ios-safari`— iOS/iPadOS Safari, which has NO install API; we can only
 *                 show the manual Share → Add to Home Screen instructions.
 * - `standalone`— already launched as an installed PWA; never prompt.
 * - `unsupported`— desktop, in-app webviews, non-Safari iOS browsers (which
 *                 cannot install to the home screen), etc.
 */
export type A2hsPlatform = "android" | "ios-safari" | "standalone" | "unsupported";

/** Terminal user choices we persist so we stop asking. */
export type A2hsOutcome = "none" | "installed" | "dismissed-forever";

export type A2hsState = {
  /** First day bucket we ever recorded a visit for. */
  firstDayBucket: number | null;
  /** First day bucket distinct from the first — i.e. the second-visit-day. */
  secondDayBucket: number | null;
  /** Day bucket of the most recent decline (drives the cooldown). */
  declinedDayBucket: number | null;
  /** Terminal outcome; once set to installed / dismissed-forever we never ask. */
  outcome: A2hsOutcome;
};

export const EMPTY_A2HS_STATE: A2hsState = {
  firstDayBucket: null,
  secondDayBucket: null,
  declinedDayBucket: null,
  outcome: "none",
};

// ---------------------------------------------------------------------------
// Day buckets (pattern copied from lib/dailyActivity.ts)
// ---------------------------------------------------------------------------

/** Whole UTC days since the epoch for the given instant. */
export function dayBucketFromDate(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Platform detection (pure — takes a snapshot, reads no globals)
// ---------------------------------------------------------------------------

export type PlatformSnapshot = {
  /** navigator.userAgent. */
  userAgent: string;
  /** navigator.standalone === true (iOS home-screen launch). */
  navigatorStandalone?: boolean;
  /** matchMedia('(display-mode: standalone)').matches. */
  displayModeStandalone?: boolean;
  /** navigator.maxTouchPoints (distinguishes iPadOS-as-desktop-UA). */
  maxTouchPoints?: number;
  /**
   * Running inside the native Capacitor shell (the PR #313→#324 iOS wrap). The
   * WKWebView is NOT display-mode standalone, navigator.standalone is false,
   * and its UA misses every suppression regex below — so without this flag the
   * installed app would beg the user to "Add to Home Screen". The caller
   * (readPlatform in the component) reads the canonical native seam SSR-safely.
   *
   * The caller feeds the canonical lib/nativePlatform.ts bridge result here.
   */
  isNativeApp?: boolean;
};

/**
 * Backwards-compatible name used by the A2HS component. The actual bridge
 * probe remains centralised in lib/nativePlatform.ts, preserving the native
 * seam contract and its SSR-safe behaviour.
 */
export function isNativeAppShell(): boolean {
  return isNativeApp();
}

// In-app browsers (webviews) can't install to the home screen; treat as
// unsupported so we never show steps the user cannot follow.
const IN_APP_WEBVIEW = /\b(FBAN|FBAV|Instagram|Line|MicroMessenger|Snapchat|Twitter|Pinterest|GSA)\b/i;
// Non-Safari iOS engines: Apple wraps them, none can Add to Home Screen.
const IOS_NON_SAFARI = /\b(CriOS|FxiOS|EdgiOS|OPiOS|mercury|DuckDuckGo)\b/i;

/**
 * Classify the device into an install path from a navigator/matchMedia
 * snapshot. Pure and total — never throws, always returns one of the four
 * platforms. Standalone (already installed) wins over everything.
 */
export function detectA2hsPlatform(env: PlatformSnapshot): A2hsPlatform {
  // FIRST, before anything else: the native Capacitor shell already IS the app.
  // It isn't display-mode standalone and its UA slips past every regex below,
  // so it must be classified terminal here or the installed app would show the
  // "Add to Home Screen" prompt. Treated as standalone → the gate never fires.
  if (env.isNativeApp) return "standalone";
  if (env.displayModeStandalone || env.navigatorStandalone) return "standalone";

  const ua = env.userAgent || "";
  // iPadOS 13+ reports a desktop "Macintosh" UA but has a touch screen.
  const isIpadOs = /Macintosh/i.test(ua) && (env.maxTouchPoints ?? 0) > 1;
  const isIos = /iPhone|iPad|iPod/i.test(ua) || isIpadOs;

  if (isIos) {
    if (IN_APP_WEBVIEW.test(ua) || IOS_NON_SAFARI.test(ua)) return "unsupported";
    return "ios-safari";
  }

  if (/Android/i.test(ua)) {
    // Android in-app webviews never fire beforeinstallprompt, so even if we
    // returned "android" the event gate below suppresses the prompt; but be
    // honest about it up front.
    if (IN_APP_WEBVIEW.test(ua)) return "unsupported";
    return "android";
  }

  return "unsupported";
}

// ---------------------------------------------------------------------------
// State transitions (pure)
// ---------------------------------------------------------------------------

/** Defensive parse of the persisted state; anything malformed → empty state. */
export function parseA2hsState(raw: string | null): A2hsState {
  if (!raw || raw.trim() === "") return { ...EMPTY_A2HS_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<A2hsState>;
    const bucket = (v: unknown): number | null =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
    const outcome: A2hsOutcome =
      parsed.outcome === "installed" || parsed.outcome === "dismissed-forever"
        ? parsed.outcome
        : "none";
    return {
      firstDayBucket: bucket(parsed.firstDayBucket),
      secondDayBucket: bucket(parsed.secondDayBucket),
      declinedDayBucket: bucket(parsed.declinedDayBucket),
      outcome,
    };
  } catch {
    return { ...EMPTY_A2HS_STATE };
  }
}

/**
 * Fold today's visit into the state. The first call ever stamps
 * `firstDayBucket`; the first later call on a DIFFERENT day stamps
 * `secondDayBucket` (the proven-return signal). Same-day reloads and any visit
 * after the second day are no-ops. Returns a new object only when something
 * changed, else the same reference (so callers can skip a write).
 */
export function recordVisitDay(state: A2hsState, todayBucket: number): A2hsState {
  if (state.firstDayBucket === null) {
    return { ...state, firstDayBucket: todayBucket };
  }
  if (state.secondDayBucket === null && todayBucket !== state.firstDayBucket) {
    return { ...state, secondDayBucket: todayBucket };
  }
  return state;
}

/** Proven value = returned on a second distinct day OR completed a first night. */
export function hasProvenValue(state: A2hsState, planCompleted: boolean): boolean {
  return state.secondDayBucket !== null || planCompleted;
}

/** May we (re-)offer today given the decline cooldown? */
export function canReoffer(
  state: A2hsState,
  todayBucket: number,
  cooldownDays: number = A2HS_DECLINE_COOLDOWN_DAYS,
): boolean {
  if (state.declinedDayBucket === null) return true;
  return todayBucket - state.declinedDayBucket >= cooldownDays;
}

export function registerDecline(state: A2hsState, todayBucket: number): A2hsState {
  return { ...state, declinedDayBucket: todayBucket };
}

export function registerInstalled(state: A2hsState): A2hsState {
  return { ...state, outcome: "installed" };
}

export function registerDismissedForever(state: A2hsState): A2hsState {
  return { ...state, outcome: "dismissed-forever" };
}

// ---------------------------------------------------------------------------
// The gate (pure decision)
// ---------------------------------------------------------------------------

export type A2hsSurface = "android" | "ios";

export type A2hsDecision = {
  show: boolean;
  surface: A2hsSurface | null;
  /** Machine-readable why, for tests and (post-#301) analytics. */
  reason:
    | "eligible"
    | "already-installed"
    | "dismissed-forever"
    | "standalone"
    | "unsupported-platform"
    | "unproven-value"
    | "decline-cooldown"
    | "android-prompt-unavailable";
};

export type A2hsEvaluateInput = {
  platform: A2hsPlatform;
  state: A2hsState;
  todayBucket: number;
  /** Has the visitor completed at least one night (walked crawl)? */
  planCompleted: boolean;
  /** Did we capture a usable `beforeinstallprompt` event (Android path)? */
  androidPromptReady: boolean;
  cooldownDays?: number;
};

/**
 * The single decision function. Order matters: terminal outcomes and platform
 * first (cheap, absolute), then the proven-value earn, then the decline
 * cooldown, then the Android-only requirement that we actually hold a native
 * prompt to fire. Everything the component needs to decide whether — and which
 * — sheet to show comes out of here, so the whole policy is unit-testable
 * without a DOM.
 */
export function evaluateA2hs(input: A2hsEvaluateInput): A2hsDecision {
  const { platform, state, todayBucket, planCompleted, androidPromptReady } = input;

  if (state.outcome === "installed") return { show: false, surface: null, reason: "already-installed" };
  if (state.outcome === "dismissed-forever") return { show: false, surface: null, reason: "dismissed-forever" };
  if (platform === "standalone") return { show: false, surface: null, reason: "standalone" };
  if (platform === "unsupported") return { show: false, surface: null, reason: "unsupported-platform" };

  if (!hasProvenValue(state, planCompleted)) return { show: false, surface: null, reason: "unproven-value" };
  if (!canReoffer(state, todayBucket, input.cooldownDays)) {
    return { show: false, surface: null, reason: "decline-cooldown" };
  }

  if (platform === "android") {
    if (!androidPromptReady) return { show: false, surface: null, reason: "android-prompt-unavailable" };
    return { show: true, surface: "android", reason: "eligible" };
  }

  // ios-safari
  return { show: true, surface: "ios", reason: "eligible" };
}

// ---------------------------------------------------------------------------
// localStorage-backed wrappers (client only; storage injectable for tests)
// ---------------------------------------------------------------------------

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function notifyChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* Event ctor missing — the storage write still lands. */
  }
}

/** Read + parse the persisted state. Empty state on SSR / storage failure. */
export function readA2hsState(storage?: Storage | null): A2hsState {
  const store = resolveStorage(storage);
  if (!store) return { ...EMPTY_A2HS_STATE };
  try {
    return parseA2hsState(store.getItem(STORAGE_KEY));
  } catch {
    return { ...EMPTY_A2HS_STATE };
  }
}

/** Persist state and notify same-tab subscribers. No-op on SSR / failure. */
export function writeA2hsState(state: A2hsState, storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    notifyChange();
  } catch {
    /* full / disabled / private mode — degrade silently. */
  }
}

/**
 * Record today's visit against the persisted state, writing only when the fold
 * actually changed something. Returns the resulting state.
 */
export function recordA2hsVisit(now: Date, storage?: Storage | null): A2hsState {
  const current = readA2hsState(storage);
  const next = recordVisitDay(current, dayBucketFromDate(now));
  if (next !== current) writeA2hsState(next, storage);
  return next;
}

/** Subscribe to state changes (same-tab writes + cross-tab `storage`). */
export function subscribeA2hs(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
