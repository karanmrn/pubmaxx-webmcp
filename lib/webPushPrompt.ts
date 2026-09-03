// Contextual installed-PWA Web Push prompt gate. The browser permission dialog
// is never requested here: this module only decides whether the app may show
// its own explainer after a useful plan action in the current document.

import { isStandaloneDisplay } from "@/lib/entryDecision";
import { isNativeApp } from "@/lib/nativePlatform";
import { safeLocalStorage } from "@/lib/safeStorage";

const ENABLED_KEY = "pubmax:webPush:enabled:v1";
const DISMISSED_SEQ_KEY = "pubmax:webPush:dismissedSeq:v1";
const SEQ_KEY = "pubmax:webPush:actionSeq:v1";
export const WEB_PUSH_PROMPT_EVENT = "pubmax:web-push-prompt";

export type WebPushPromptGateState = {
  eligibleRuntime: boolean;
  alreadyEnabled: boolean;
  dismissedAtSeq: number | null;
  currentSeq: number;
  triggeredThisDocument: boolean;
};

/** Sequence armed by a qualifying action in this JS document; resets on boot. */
let documentTriggeredSeq: number | null = null;

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
    window.dispatchEvent(new Event(WEB_PUSH_PROMPT_EVENT));
  } catch {
    // The storage change remains authoritative in older environments.
  }
}

/** Browser support + product boundary for this prompt. Ordinary tabs and the
 * native Capacitor shell are deliberately excluded. */
export function isWebPushPromptRuntimeEligible(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (isNativeApp() || !isStandaloneDisplay()) return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (!("Notification" in window) || Notification.permission === "denied") return false;
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

/** Pure gate used by tests and the live snapshot. Persisted history alone can
 * never resurrect the prompt on a later boot. */
export function shouldOfferWebPushPrompt(state: WebPushPromptGateState): boolean {
  if (!state.eligibleRuntime || state.alreadyEnabled || !state.triggeredThisDocument) return false;
  if (state.currentSeq <= 0) return false;
  return state.dismissedAtSeq === null || state.currentSeq > state.dismissedAtSeq;
}

function currentActionSeq(): number {
  return readInt(SEQ_KEY);
}

function dismissedAtSeq(): number | null {
  return readOptionalInt(DISMISSED_SEQ_KEY);
}

/** Arm the explainer after a successful, qualifying plan action. */
export function recordWebPushHighIntentAction(): void {
  if (!isWebPushPromptRuntimeEligible() || !hasStorage()) return;
  const nextSeq = currentActionSeq() + 1;
  try {
    window.localStorage.setItem(SEQ_KEY, String(nextSeq));
  } catch {
    return;
  }
  documentTriggeredSeq = nextSeq;
  notify();
}

export function getWebPushPromptVisibleSnapshot(): boolean {
  const currentSeq = currentActionSeq();
  return shouldOfferWebPushPrompt({
    eligibleRuntime: isWebPushPromptRuntimeEligible(),
    alreadyEnabled: readBool(ENABLED_KEY),
    dismissedAtSeq: dismissedAtSeq(),
    currentSeq,
    triggeredThisDocument: documentTriggeredSeq === currentSeq,
  });
}

export function getWebPushPromptServerSnapshot(): boolean {
  return false;
}

export function subscribeWebPushPrompt(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener(WEB_PUSH_PROMPT_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(WEB_PUSH_PROMPT_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function markWebPushPromptEnabled(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(ENABLED_KEY, "1");
    documentTriggeredSeq = null;
    notify();
  } catch {
    // Storage unavailable: registration still succeeded for this browser.
  }
}

export function markWebPushPromptDismissed(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(DISMISSED_SEQ_KEY, String(currentActionSeq()));
    documentTriggeredSeq = null;
    notify();
  } catch {
    // Ignore private-mode/storage failures.
  }
}

export function resetWebPushPrompt(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(ENABLED_KEY);
    window.localStorage.removeItem(DISMISSED_SEQ_KEY);
    window.localStorage.removeItem(SEQ_KEY);
    documentTriggeredSeq = null;
    notify();
  } catch {
    // Ignore private-mode/storage failures.
  }
}
