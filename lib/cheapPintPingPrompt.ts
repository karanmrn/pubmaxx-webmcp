// Cheap-pint ping opt-in prompt gate. Ask once after the first qualifying
// pint moment; decline is durable on the server.

import { isStandaloneDisplay } from "@/lib/entryDecision";
import { isNativeApp } from "@/lib/nativePlatform";
import { safeLocalStorage } from "@/lib/safeStorage";

export const CHEAP_PINT_PING_PROMPT_SURFACE = "cheap-pint-ping";
export const CHEAP_PINT_PING_PROMPT_EVENT = "pubmax:cheap-pint-ping-prompt";

const QUALIFIED_KEY = "pubmax:cheap-pint-ping:qualified:v1";
const DISMISSED_KEY = "pubmax:cheap-pint-ping:dismissed:v1";
const ENABLED_KEY = "pubmax:cheap-pint-ping:enabled:v1";

function notify(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHEAP_PINT_PING_PROMPT_EVENT));
  } catch {
    // Storage remains authoritative.
  }
}

export function isCheapPintPingPromptRuntimeEligible(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (isNativeApp() || !isStandaloneDisplay()) return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (!("Notification" in window) || Notification.permission === "denied") return false;
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

function readBool(key: string): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeBool(key: string, value: boolean): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    if (value) storage.setItem(key, "1");
    else storage.removeItem(key);
  } catch {
    // Private mode — prompt stays hidden.
  }
}

export function markCheapPintPingQualified(): void {
  writeBool(QUALIFIED_KEY, true);
  notify();
}

export function markCheapPintPingDismissed(): void {
  writeBool(DISMISSED_KEY, true);
  writeBool(QUALIFIED_KEY, false);
  notify();
}

export function markCheapPintPingEnabled(): void {
  writeBool(ENABLED_KEY, true);
  writeBool(QUALIFIED_KEY, false);
  writeBool(DISMISSED_KEY, false);
  notify();
}

export type CheapPintPingPromptServerState = {
  canPrompt?: boolean;
  declined?: boolean;
  enabled?: boolean;
};

/** Align device prompt keys with the account-scoped cheap-pint ping read. */
export function syncCheapPintPingPromptFromServer(
  state: CheapPintPingPromptServerState,
): void {
  if (state.enabled) {
    markCheapPintPingEnabled();
    return;
  }
  if (state.declined) {
    markCheapPintPingDismissed();
    return;
  }
  if (state.canPrompt) {
    markCheapPintPingQualified();
    return;
  }
  writeBool(QUALIFIED_KEY, false);
  notify();
}

export function getCheapPintPingPromptVisibleSnapshot(): boolean {
  if (!isCheapPintPingPromptRuntimeEligible()) return false;
  if (readBool(ENABLED_KEY) || readBool(DISMISSED_KEY)) return false;
  return readBool(QUALIFIED_KEY);
}

export function getCheapPintPingPromptServerSnapshot(): boolean {
  return false;
}

export function subscribeCheapPintPingPrompt(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onStoreChange();
  window.addEventListener(CHEAP_PINT_PING_PROMPT_EVENT, handler);
  return () => window.removeEventListener(CHEAP_PINT_PING_PROMPT_EVENT, handler);
}
