// Contextual push-permission prompt gate — decides WHEN to show the small
// pre-permission explainer for registerNativePush() (lib/nativePush.ts).
//
// iOS' native permission dialog is one-shot: call
// PushNotifications.requestPermissions() cold and a "Don't Allow" tap can
// only be undone from Settings, never re-asked in-app. So we never fire it
// at boot. Instead we wait for the user's first meaningful plan action
// inside the native shell — joining a plan, starting a plan/round, or
// confirming a route proposal — and show a small in-app explainer FIRST
// ("Get a ping when a fresh London night signal goes live") with Turn on /
// Not now. Native tokens have no account or Plan identity, so the explainer
// must not promise the dormant crew-scoped push seam.
// Only "Turn on" calls registerNativePush(), so the OS dialog only appears
// once the user has already opted in once, in-app.
//
// "Not now" persists and is re-offered only after the NEXT qualifying plan
// action, not immediately — otherwise every subsequent join/vote in the same
// session would re-show the sheet. We track that with a monotonic action
// sequence number (bumped once per recordPlanHighIntentAction call), remember
// which sequence number was current when the user last dismissed, and keep an
// in-memory arm for the document where the action happened. That final guard
// is what makes this contextual: persisted action history can never resurrect
// the sheet on a later cold boot.
//
// Storage mirrors the lib/firstRunTour.ts / lib/cityPreference.ts idiom:
// localStorage-backed, SSR-safe, same-tab CHANGE_EVENT for
// useSyncExternalStore, no-ops when storage is unavailable. Never shows on
// web - every write/read path that can trigger the UI is gated on
// nativePushRegistrationSupported() (lib/nativePush.ts). Stored platform keeps
// Android FCM delivery separate from iOS APNs delivery.

import { nativePushRegistrationSupported } from "@/lib/nativePush";
import { recordWebPushHighIntentAction } from "@/lib/webPushPrompt";
import { safeLocalStorage } from "@/lib/safeStorage";

const ENABLED_KEY = "pubmax:nativePush:enabled:v1";
const DISMISSED_SEQ_KEY = "pubmax:nativePush:dismissedSeq:v1";
const SEQ_KEY = "pubmax:nativePush:actionSeq:v1";
/** Same-tab notify so useSyncExternalStore clients (the prompt UI) re-read after a write. */
export const NATIVE_PUSH_PROMPT_EVENT = "pubmax:native-push-prompt";
export const NATIVE_PUSH_PROMPT_COPY = {
  title: "Know when tonight changes",
  body: "Get a ping when a fresh London night signal goes live.",
  later: "Not now",
  enable: "Turn on",
} as const;

function hasStorage(): boolean {
  return safeLocalStorage() !== null;
}

function readInt(key: string): number {
  if (!hasStorage()) return 0;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function readOptionalInt(key: string): number | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function readBool(key: string): boolean {
  if (!hasStorage()) return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function notify(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(NATIVE_PUSH_PROMPT_EVENT));
  } catch {
    // Older environments without an Event ctor still keep the storage write.
  }
}

export type PushPromptGateState = {
  /** Native shell only — always false (never show) on web/SSR. */
  isNative: boolean;
  /** User already tapped Enable in a previous session (or is registered). */
  alreadyEnabled: boolean;
  /** Action sequence number that was current when the user last tapped Later, or null if never dismissed. */
  dismissedAtSeq: number | null;
  /** Action sequence number as of the current check. */
  currentSeq: number;
  /** A qualifying action fired in this live document, rather than a past boot. */
  triggeredThisDocument: boolean;
};

/** Sequence armed by a qualifying action in this JS document; resets on boot. */
let documentTriggeredSeq: number | null = null;

/**
 * Pure gate function — exported for unit testing. No storage/DOM access.
 * Never true unless isNative, never true once enabled, and after a "Later"
 * dismissal stays false until a strictly later qualifying action bumps the
 * sequence past the one that was showing when the user dismissed it.
 */
export function shouldOfferPushPrompt(state: PushPromptGateState): boolean {
  if (!state.isNative) return false;
  if (state.alreadyEnabled) return false;
  if (!state.triggeredThisDocument) return false;
  if (state.currentSeq <= 0) return false;
  if (state.dismissedAtSeq !== null && state.currentSeq <= state.dismissedAtSeq) return false;
  return true;
}

/** Whether the user has already enabled native push via this prompt. */
export function hasEnabledNativePush(): boolean {
  return readBool(ENABLED_KEY);
}

function currentActionSeq(): number {
  return readInt(SEQ_KEY);
}

function dismissedAtSeq(): number | null {
  return readOptionalInt(DISMISSED_SEQ_KEY);
}

/**
 * Call from a plan success path (join / start a plan or round / confirm a
 * route proposal). Bumps the action sequence and notifies subscribers so a
 * mounted <NativePushPrompt/> can re-evaluate the gate. No-op on web/SSR —
 * the sequence never advances there, so the prompt can never fire.
 */
export function recordPlanHighIntentAction(): void {
  if (!nativePushRegistrationSupported()) {
    recordWebPushHighIntentAction();
    return;
  }
  if (!hasStorage()) return;
  const nextSeq = currentActionSeq() + 1;
  try {
    window.localStorage.setItem(SEQ_KEY, String(nextSeq));
  } catch {
    return;
  }
  documentTriggeredSeq = nextSeq;
  notify();
}

/** Client snapshot for useSyncExternalStore: should the prompt be visible right now? */
export function getPushPromptVisibleSnapshot(): boolean {
  return shouldOfferPushPrompt({
    isNative: nativePushRegistrationSupported(),
    alreadyEnabled: hasEnabledNativePush(),
    dismissedAtSeq: dismissedAtSeq(),
    currentSeq: currentActionSeq(),
    triggeredThisDocument: documentTriggeredSeq === currentActionSeq(),
  });
}

/** Server snapshot — always hidden so nothing renders during SSR. */
export function getPushPromptServerSnapshot(): boolean {
  return false;
}

/** Subscribe to prompt-visibility changes (same-tab writes + cross-tab `storage`). */
export function subscribePushPrompt(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener(NATIVE_PUSH_PROMPT_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(NATIVE_PUSH_PROMPT_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** User tapped Enable — persist and stop offering forever. No-op on SSR/storage failure. */
export function markPushPromptEnabled(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(ENABLED_KEY, "1");
    documentTriggeredSeq = null;
    notify();
  } catch {
    // Storage full / disabled / private mode — degrade silently.
  }
}

/** User tapped Later — remember the sequence so we wait for the next qualifying action. */
export function markPushPromptDismissed(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(DISMISSED_SEQ_KEY, String(currentActionSeq()));
    documentTriggeredSeq = null;
    notify();
  } catch {
    // ignore
  }
}

/** Clear all prompt state — handy for local testing. */
export function resetPushPrompt(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(ENABLED_KEY);
    window.localStorage.removeItem(DISMISSED_SEQ_KEY);
    window.localStorage.removeItem(SEQ_KEY);
    documentTriggeredSeq = null;
    notify();
  } catch {
    // ignore
  }
}
