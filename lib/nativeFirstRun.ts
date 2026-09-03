// Native-shell first-run routing gate — decides whether the Capacitor app's
// very first launch should skip the web landing page and open the dedicated
// onboarding route. Every later root launch is owned by lib/entryDecision.ts
// and lands on /tonight.
//
// The remote-URL wrap (capacitor.config.ts) always loads the site root, so a
// first-time native user would otherwise land on the marketing page built
// for organic web traffic. We only want that ONE redirect, ONE time, and
// only for a genuinely first-time viewer: if the viewer already has a
// preferred-city choice persisted (lib/cityPreference.ts) they have state —
// either they picked a city on web before installing, or a previous native
// session already ran this redirect and they since chose a city — so we must
// not clobber it or bounce them again.
//
// Storage mirrors the lib/firstRunTour.ts idiom: localStorage-backed,
// SSR-safe, no-op when storage is unavailable. Never routes on the web — the
// isNative flag threaded through shouldRouteNativeFirstRun is sourced from
// isNativeApp() (lib/nativePlatform.ts), the only Capacitor-detection seam.

import { isNativeApp } from "@/lib/nativePlatform";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";

const STORAGE_KEY = "pubmax:nativeFirstRun:routed:v1";
const HANDOFF_KEY = "pubmax:nativeFirstRun:handoff:v1";
/** Long enough for a slow client transition, short enough to never become a bookmark. */
export const NATIVE_FIRST_RUN_HANDOFF_MAX_AGE_MS = 5 * 60 * 1000;

function hasStorage(): boolean {
  return safeLocalStorage() !== null;
}

function resolveSessionStorage(storage?: Storage | null): Storage | null {
  return storage ?? safeSessionStorage();
}

export type NativeFirstRunState = {
  /** Native shell only — always false (never route) on web/SSR. */
  isNative: boolean;
  /** This redirect has already run once (this device/install). */
  alreadyRouted: boolean;
  /** Viewer already has a preferred-city choice persisted — has state. */
  hasCityPreference: boolean;
};

/**
 * Pure gate function — exported for unit testing. No storage/DOM access.
 * Routes to onboarding only on a genuinely first native launch with no
 * existing city-preference state, and only once ever.
 */
export function shouldRouteNativeFirstRun(state: NativeFirstRunState): boolean {
  if (!state.isNative) return false;
  if (state.alreadyRouted) return false;
  if (state.hasCityPreference) return false;
  return true;
}

/** Whether the native first-run redirect has already fired on this device. */
export function hasRoutedNativeFirstRun(): boolean {
  if (!hasStorage()) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

/** Persist that the native first-run redirect has fired. No-op on SSR/storage failure. */
export function markNativeFirstRunRouted(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage full / disabled / private mode — degrade silently; worst case
    // is a second no-op check next launch, never a loop (isNativeApp() +
    // hasCityPreference still gate it, and the redirect target is idempotent).
  }
}

/**
 * Issue the one-time eligibility handoff immediately before the root entry
 * decision replaces `/` with `/onboarding`. Session scope prevents a URL from
 * carrying eligibility, and the timestamp bounds abandoned transitions.
 */
export function issueNativeFirstRunHandoff(
  storage?: Storage | null,
  now: number = Date.now(),
): void {
  const store = resolveSessionStorage(storage);
  if (!store) return;
  try {
    store.setItem(HANDOFF_KEY, String(now));
  } catch {
    // Storage unavailable. The guarded route will fail closed to /tonight.
  }
}

/** Remove an abandoned or inapplicable first-run handoff. */
export function clearNativeFirstRunHandoff(storage?: Storage | null): void {
  const store = resolveSessionStorage(storage);
  if (!store) return;
  try {
    store.removeItem(HANDOFF_KEY);
  } catch {
    // ignore
  }
}

/**
 * Consume a fresh handoff once. Eligibility is native-only and always removed
 * before returning so refreshes, direct links and returning visits fail closed.
 */
export function consumeNativeFirstRunHandoff(
  isNative: boolean = isNativeApp(),
  storage?: Storage | null,
  now: number = Date.now(),
): boolean {
  const store = resolveSessionStorage(storage);
  if (!store) return false;
  let issuedAt: number | null = null;
  try {
    const raw = store.getItem(HANDOFF_KEY);
    store.removeItem(HANDOFF_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      issuedAt = Number.isFinite(parsed) ? parsed : null;
    }
  } catch {
    return false;
  }
  if (!isNative || issuedAt === null) return false;
  const age = now - issuedAt;
  return age >= 0 && age <= NATIVE_FIRST_RUN_HANDOFF_MAX_AGE_MS;
}

/** Clear the flag so the redirect fires again — handy for local testing. */
export function resetNativeFirstRunRouted(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Convenience: read live isNativeApp() alongside the persisted state. */
export function getNativeFirstRunSnapshot(hasCityPreference: boolean): NativeFirstRunState {
  return {
    isNative: isNativeApp(),
    alreadyRouted: hasRoutedNativeFirstRun(),
    hasCityPreference,
  };
}
