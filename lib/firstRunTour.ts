// First-run onboarding tour gate — localStorage-backed, SSR-safe.
//
// A one-time welcome overlay orients a first-timer to the three core moves
// (the map, DROP, Discover). Once dismissed — by Skip, close, backdrop, Esc,
// or finishing — it is marked done and never shows again. Mirrors the
// storage idiom in lib/cityPreference.ts (hasStorage guard, try/catch, a
// same-tab CHANGE_EVENT so useSyncExternalStore clients re-read after a write).
//
// The tour also participates in the shared one-interruptive-prompt-per-session
// budget (lib/promptBudget): before it interrupts it checks the budget, and at
// the moment it shows it claims it — so a returning-day session that is also
// A2HS/identity/push eligible only ever sees one of them. See
// docs/PROMPT_ORCHESTRATION.md for the contract.

import {
  claimPromptBudget,
  hasPromptBudgetFor,
  releasePromptBudget,
  type PromptSurface,
} from "@/lib/promptBudget";
import { PAL_ONBOARDING_SPECIES } from "@/lib/pubPal";
import { safeLocalStorage } from "@/lib/safeStorage";

/** Bump the `vN` suffix if the tour content changes enough to re-show it. */
const STORAGE_KEY = "pubmax-tour-v2-done";
/** Legacy key from the four-step welcome; still counts as seen so e2e seeds and
 * returning devices that finished the old tour are not interrupted again. */
const LEGACY_STORAGE_KEY = "pubmax-tour-v1-done";
/** Device-level choice that seeds the later, account-owned Pub Pal setup. */
const COMPANION_KEY = "pubmax:first-run-companion:v1";
/** Same-tab notify so useSyncExternalStore clients re-read after a write. */
const CHANGE_EVENT = "pubmax:first-run-tour";

function hasStorage(): boolean {
  return safeLocalStorage() !== null;
}

function notifyTourChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Older environments without the Event ctor still keep the storage write.
  }
}

/**
 * Whether the viewer has already seen (and dismissed) the first-run tour.
 * Returns `true` on SSR and on any storage failure so the overlay never
 * flashes for returning users or when storage is unavailable/private.
 * Accepts the legacy v1 key so existing e2e seeds keep dismissing the tour.
 */
export function hasSeenTour(): boolean {
  if (!hasStorage()) return true;
  try {
    const store = window.localStorage;
    return (
      store.getItem(STORAGE_KEY) === "1" ||
      store.getItem(LEGACY_STORAGE_KEY) === "1"
    );
  } catch {
    return true;
  }
}

/** Persist that the tour is done. No-op on SSR / storage failure. */
export function markTourSeen(): void {
  if (!hasStorage()) return;
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === "1") return;
    window.localStorage.setItem(STORAGE_KEY, "1");
    notifyTourChange();
  } catch {
    // Storage full / disabled / private mode — degrade silently.
  }
}

/** Clear the flag so the tour shows again — handy for local testing. */
export function resetTour(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    notifyTourChange();
  } catch {
    // ignore
  }
}

/**
 * Subscribe to tour-seen changes (same-tab writes + cross-tab `storage`).
 * For `useSyncExternalStore` in the FirstRunTour client.
 */
export function subscribeTour(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Client snapshot for useSyncExternalStore. */
export function getTourSeenSnapshot(): boolean {
  return hasSeenTour();
}

/**
 * This tour's id in the shared one-interruptive-prompt-per-session budget.
 * The tour is map-scoped, so it rarely co-renders with the plan-tap surfaces,
 * but it still claims like the rest so a returning-day session that is also
 * A2HS/identity/push eligible only ever sees one prompt. See
 * docs/PROMPT_ORCHESTRATION.md.
 */
export const TOUR_PROMPT_SURFACE: PromptSurface = "first-run-tour";

export type FirstRunCompanion = (typeof PAL_ONBOARDING_SPECIES)[number];

/** The launch cast and its plain-language role in a first Plan. */
export const FIRST_RUN_COMPANIONS: readonly {
  id: FirstRunCompanion;
  label: string;
  note: string;
}[] = [
  { id: "robin", label: "Circuit Robin", note: "Bright and grounded" },
  { id: "greyhound", label: "Greyhound", note: "Loyal and perceptive" },
  { id: "cat", label: "Black Cat", note: "Calm and mischievous" },
  { id: "fox", label: "Fox", note: "Curious and quick" },
  { id: "pigeon", label: "Pigeon", note: "Streetwise and social" },
  { id: "badger", label: "Badger", note: "Steady and protective" },
  { id: "corgi", label: "Corgi", note: "Bright and encouraging" },
];

/** Runtime guard for persisted or URL-derived companion values. */
export function isFirstRunCompanion(value: unknown): value is FirstRunCompanion {
  return typeof value === "string" && PAL_ONBOARDING_SPECIES.includes(value as FirstRunCompanion);
}

/** Read the remembered first-run companion. Invalid values fail closed. */
export function readFirstRunCompanion(storage?: Storage | null): FirstRunCompanion | null {
  const store = storage ?? safeLocalStorage();
  if (!store) return null;
  try {
    const value = store.getItem(COMPANION_KEY);
    return isFirstRunCompanion(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persist the chosen companion once so later Pal setup starts from it. */
export function writeFirstRunCompanion(
  companion: FirstRunCompanion,
  storage?: Storage | null,
): void {
  if (!isFirstRunCompanion(companion)) return;
  const store = storage ?? safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(COMPANION_KEY, companion);
  } catch {
    // Storage full / disabled / private mode. Planning remains available.
  }
}

/** Clear the companion choice for local testing. */
export function resetFirstRunCompanion(storage?: Storage | null): void {
  const store = storage ?? safeLocalStorage();
  if (!store) return;
  try {
    store.removeItem(COMPANION_KEY);
  } catch {
    // ignore
  }
}

/**
 * Whether the tour may interrupt this session — true when the shared prompt
 * budget is free or already held by the tour. Mirrors A2HS's pre-show check.
 */
export function tourHasPromptBudget(
  storage?: Storage | null,
  consentStorage?: Storage | null,
): boolean {
  return hasPromptBudgetFor(TOUR_PROMPT_SURFACE, storage, consentStorage);
}

/**
 * Claim the one-prompt-per-session budget for the tour at the moment it shows.
 * Returns false when a sibling surface already claimed it this session (the
 * tour should then stay hidden). Idempotent for the tour's own re-render.
 */
export function claimTourPromptBudget(
  storage?: Storage | null,
  consentStorage?: Storage | null,
): boolean {
  return claimPromptBudget(TOUR_PROMPT_SURFACE, storage, consentStorage);
}

/**
 * Release onboarding's hold immediately before its explicit Plan handoff.
 * The page and the later push explainer never overlap: onboarding unmounts
 * first, then push may claim the same budget only after route generation.
 */
export function releaseTourPromptBudget(storage?: Storage | null): void {
  releasePromptBudget(TOUR_PROMPT_SURFACE, storage);
}

/** Server snapshot — always "seen" so nothing renders during SSR. */
export function getTourSeenServerSnapshot(): boolean {
  return true;
}

/**
 * Whether `pathname` is a map surface (/map, /map/[city]) — the only place
 * the tour is allowed to render. It spotlights the map + mobile tab bar, so
 * it's meaningless everywhere else, and landing/tonight/feed/pint-index/etc.
 * must render clean on first paint for SEO, press, and first-tap.
 */
export function isTourEligiblePathname(pathname: string): boolean {
  return pathname === "/map" || pathname.startsWith("/map/");
}

/**
 * Pub Pal and You have their own focused onboarding. Stacking the generic
 * tour over either surface obscures consent, identity controls, and the
 * mobile tab bar.
 */
export function hasDedicatedOnboarding(pathname: string): boolean {
  return pathname === "/pal" || pathname.startsWith("/u/");
}

/** Full gate: whether the first-run tour overlay should render. */
export function shouldShowFirstRunTour(params: {
  mounted: boolean;
  seen: boolean;
  pathname: string;
  /**
   * Trusted-handoff §4.7: an explicit/restored Map arrival suppresses the tour
   * for THIS arrival so it never stacks over a deep-linked Venue or planner.
   * Suppression is per-arrival only — it never marks the tour seen, so a later
   * clean Map open stays eligible.
   */
  explicitIntent?: boolean;
}): boolean {
  const { mounted, seen, pathname, explicitIntent = false } = params;
  return (
    mounted &&
    !seen &&
    !explicitIntent &&
    isTourEligiblePathname(pathname) &&
    !hasDedicatedOnboarding(pathname)
  );
}
