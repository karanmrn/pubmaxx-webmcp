// Entry-decision seam — the ONE place that decides which surface the app
// starts on when it boots at the site root ("/"). Owner-locked (issue #439):
// the wrapped app COLD-STARTS on /tonight after first-run; a genuine native
// first-run opens the dedicated onboarding.
//
// Owner amendment (2026-07-21, amends #439): the old absolute "the shell never
// sees the landing page" is relaxed to "the shell never COLD-STARTS on the
// landing page". A cold start is unchanged — the shell still lands on /tonight.
// But a deliberate in-app navigation to "/" (e.g. tapping the PUBMAXXING
// wordmark, SiteNav.tsx href="/") must now REACH the landing page — the Home
// Screen that shows how the app works. So the entry decision only fires on the
// session's FIRST arrival at "/" (the cold start); every later arrival stays.
//
// The "already decided this session" signal is a per-session flag persisted in
// sessionStorage through the seam at the bottom (markSessionEntryConsumed /
// hasConsumedSessionEntry), injectable so the pure decision stays hermetically
// testable. Fail-safe: no storage → the flag reads false, so we behave like a
// cold start EVERY time (shell → /tonight). We never fail toward
// landing-on-cold-start.
//
// "App shell" here means either signal, probed through existing seams only:
//   - the Capacitor native wrap (lib/nativePlatform.ts isNativeApp(); the
//     remote-URL wrap in capacitor.config.ts always loads the site root), or
//   - an installed PWA running standalone (display-mode media query or the
//     iOS navigator.standalone flag, same signals lib/a2hsPrompt.ts reads).
//
// Decision precedence (contract-tested in __tests__/entryDecision.test.ts):
//   1. Deep link — any path other than "/" is an explicit destination (share
//      link, push click-through, universal link) and bypasses the decision
//      untouched, shell or not. The decision NEVER rewrites a deep link.
//   2. Native first-run at the root — a genuine native first-run opens the
//      dedicated onboarding (lib/nativeFirstRun.ts gate, native shell only).
//      Precedence UNCHANGED by the 2026-07-21 amendment.
//   3. Session revisit — the cold-start decision already ran this session, so a
//      later arrival at "/" (in-app home tap) stays on the landing page, shell
//      or not. NEW (2026-07-21 amendment).
//   4. Shell cold start — the session's first shell open at the root lands on
//      /tonight.
//   5. Web default — a browser visit keeps the marketing landing page.
//
// The decision is a pure function of an explicit context snapshot so it unit
// tests in the node vitest env; the thin live probes at the bottom are the
// only globals readers, mirroring the lib/a2hsPrompt.ts snapshot idiom.

import { readPreferredCity } from "@/lib/cityPreference";
import {
  getNativeFirstRunSnapshot,
  shouldRouteNativeFirstRun,
} from "@/lib/nativeFirstRun";
import { isNativeApp } from "@/lib/nativePlatform";

/** Where every post-first-run shell open lands (owner-locked, issue #439). */
export const SHELL_START_PATH = "/tonight";
/** The native shell's one-time first-run surface (owner-locked, issue #441). */
export const ONBOARDING_PATH = "/onboarding";

export type EntryContext = {
  /** Pathname at boot (no query/hash) — "/" is the only decided route. */
  path: string;
  /** Inside the Capacitor native shell (lib/nativePlatform.ts seam). */
  isNativeShell: boolean;
  /** Installed-PWA standalone launch (display-mode / navigator.standalone). */
  isStandaloneDisplay: boolean;
  /**
   * Genuine native first-run per the lib/nativeFirstRun.ts gate (native
   * shell, never routed before, no persisted city preference). Always false
   * outside the native shell — the gate enforces it, and decideEntry guards
   * it again so a spurious flag can never send a PWA to onboarding.
   */
  isNativeFirstRun: boolean;
  /**
   * Whether this session's cold-start entry decision has already run (owner
   * amendment, 2026-07-21). Snapshotted from hasConsumedSessionEntry(); false
   * on the session's first arrival at "/" (the cold start), true on every later
   * arrival so an in-app home tap reaches the landing page. Fail-safe: reads
   * false when sessionStorage is absent, so we never mistake a cold start for a
   * revisit.
   */
  sessionEntryConsumed: boolean;
};

export type EntryDecision =
  | { kind: "stay"; reason: "deep-link" | "web-default" | "session-revisit" }
  | { kind: "route"; href: string; reason: "native-first-run" | "shell-cold-start" };

/** Either app-shell signal — the surfaces that must never see the landing page. */
export function isAppShell(ctx: Pick<EntryContext, "isNativeShell" | "isStandaloneDisplay">): boolean {
  return ctx.isNativeShell || ctx.isStandaloneDisplay;
}

/**
 * The single entry decision. Pure and total. `firstRunHref` stays injectable
 * for contract tests, while production always uses ONBOARDING_PATH.
 */
export function decideEntry(ctx: EntryContext, firstRunHref: string = ONBOARDING_PATH): EntryDecision {
  if (ctx.path !== "/") return { kind: "stay", reason: "deep-link" };
  if (ctx.isNativeShell && ctx.isNativeFirstRun) {
    return { kind: "route", href: firstRunHref, reason: "native-first-run" };
  }
  // Owner amendment (2026-07-21): the cold-start decision fires once per
  // session. Once it has run, a later arrival at "/" — the in-app home tap —
  // stays on the landing page, shell or not.
  if (ctx.sessionEntryConsumed) return { kind: "stay", reason: "session-revisit" };
  if (isAppShell(ctx)) {
    return { kind: "route", href: SHELL_START_PATH, reason: "shell-cold-start" };
  }
  return { kind: "stay", reason: "web-default" };
}

// ---------------------------------------------------------------------------
// Live probes (client only; every export above stays DOM-free)
// ---------------------------------------------------------------------------

/**
 * Installed-PWA standalone launch probe. SSR-safe (false on the server).
 * Reads the same two signals lib/a2hsPrompt.ts snapshots: the display-mode
 * media query (Android/desktop installs) and navigator.standalone (iOS
 * home-screen installs, which never match the media query on older WebKit).
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia missing/throwing — fall through to the iOS flag.
  }
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

/**
 * Per-session flag that records the cold-start entry decision has run (owner
 * amendment, 2026-07-21). sessionStorage-backed so it resets on a genuine cold
 * start (a fresh app session) but survives in-app navigation, and injectable so
 * the pure decision above stays hermetically testable. Mirrors the
 * resolveSessionStorage idiom in lib/nativeFirstRun.ts.
 */
const SESSION_ENTRY_KEY = "pubmax:entryDecision:consumed:v1";

function resolveSessionStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Has this session's cold-start entry decision already run? Fail-safe: with no
 * storage (SSR, private mode, disabled) this returns false, so the caller treats
 * every arrival as a cold start (shell → /tonight) — the old behavior — and
 * never mistakes a cold start for a revisit that would land on the landing page.
 */
export function hasConsumedSessionEntry(storage?: Storage | null): boolean {
  const store = resolveSessionStorage(storage);
  if (!store) return false;
  try {
    return store.getItem(SESSION_ENTRY_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Mark this session's cold-start entry decision as run. No-op on SSR / storage
 * failure — worst case the next "/" arrival is treated as another cold start
 * (shell re-lands on /tonight), never as landing-on-cold-start.
 */
export function markSessionEntryConsumed(storage?: Storage | null): void {
  const store = resolveSessionStorage(storage);
  if (!store) return;
  try {
    store.setItem(SESSION_ENTRY_KEY, "1");
  } catch {
    // Storage full / disabled / private mode — degrade silently (see above).
  }
}

/**
 * Deep-link boot stamp (2026-07-22, closes the installed-PWA home-tap hole).
 * The PWA manifest cold-starts the app on start_url (/tonight), so
 * AppEntryRoute — mounted only at "/" — never ran and never stamped the
 * per-session flag. The FIRST in-app wordmark tap to "/" then read as a cold
 * start and bounced straight back to /tonight. A boot on any non-root path IS
 * this session's entry decision (precedence rule 1: deep links bypass), so it
 * must consume the session entry too. Root boots stay entirely with
 * AppEntryRoute — stamping first at "/" would corrupt the cold-start read.
 * Returns whether the flag was stamped (false at "/"), so contract tests can
 * assert both sides.
 */
export function consumeDeepLinkBootEntry(path: string, storage?: Storage | null): boolean {
  if (path === "/") return false;
  markSessionEntryConsumed(storage);
  return true;
}

/** Snapshot the live entry context for the given boot pathname. */
export function readEntryContext(path: string): EntryContext {
  return {
    path,
    isNativeShell: isNativeApp(),
    isStandaloneDisplay: isStandaloneDisplay(),
    isNativeFirstRun: shouldRouteNativeFirstRun(
      getNativeFirstRunSnapshot(readPreferredCity() !== null),
    ),
    sessionEntryConsumed: hasConsumedSessionEntry(),
  };
}

/** Live first-run target — the dedicated native onboarding route. */
export function entryFirstRunHref(): string {
  return ONBOARDING_PATH;
}
