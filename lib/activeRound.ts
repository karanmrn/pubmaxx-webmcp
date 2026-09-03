// Active Round stickiness — one localStorage key shared by the Plan drawer,
// Round board, Pint Drop composer ("My Round"), and the map Active Round chip.
// Codes are stored in the same canonical form as lib/rounds (normalizeRoundCode).

import { isValidRoundCode, normalizeRoundCode } from "@/lib/rounds";
import { safeLocalStorage } from "@/lib/safeStorage";

export const ACTIVE_ROUND_KEY = "pubmax_active_round";

/** Same-tab notify so map chip / composer re-read after a write without a focus hop. */
const CHANGE_EVENT = "pubmax:active-round";

function hasStorage(): boolean {
  return safeLocalStorage() !== null;
}

function notifyActiveRoundChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Older environments without Event ctor still keep the storage write.
  }
}

/** Trim + uppercase alphabet filter via normalizeRoundCode (canonical storage form). */
export function normalizeRoundCodeForStorage(code: string): string {
  return normalizeRoundCode(code);
}

/** Stored active Round code, or "" on SSR / unset / invalid / unreadable. */
export function readActiveRoundCode(): string {
  if (!hasStorage()) return "";
  try {
    const raw = window.localStorage.getItem(ACTIVE_ROUND_KEY) ?? "";
    const code = normalizeRoundCodeForStorage(raw);
    return isValidRoundCode(code) ? code : "";
  } catch {
    return "";
  }
}

/** Persist an active Round code. No-op on SSR / invalid / storage failure. */
export function writeActiveRoundCode(code: string): void {
  if (!hasStorage()) return;
  const normalized = normalizeRoundCodeForStorage(code);
  if (!isValidRoundCode(normalized)) return;
  try {
    if (window.localStorage.getItem(ACTIVE_ROUND_KEY) === normalized) {
      notifyActiveRoundChange();
      return;
    }
    window.localStorage.setItem(ACTIVE_ROUND_KEY, normalized);
    notifyActiveRoundChange();
  } catch {
    // Storage full / disabled / private mode — degrade silently.
  }
}

/**
 * Clear the active Round key. When `onlyIfMatches` is set, only clears if the
 * stored value still equals that code (another tab may have switched Rounds).
 */
export function clearActiveRoundCode(onlyIfMatches?: string): void {
  if (!hasStorage()) return;
  try {
    const current = window.localStorage.getItem(ACTIVE_ROUND_KEY);
    if (current == null) return;
    if (onlyIfMatches != null) {
      const match = normalizeRoundCodeForStorage(onlyIfMatches);
      if (normalizeRoundCodeForStorage(current) !== match) return;
    }
    window.localStorage.removeItem(ACTIVE_ROUND_KEY);
    notifyActiveRoundChange();
  } catch {
    // ignore
  }
}

/**
 * Subscribe to active-Round changes (same-tab writes + cross-tab `storage` + focus).
 * Returns an unsubscribe function.
 */
export function subscribeActiveRound(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  window.addEventListener("focus", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
    window.removeEventListener("focus", handler);
  };
}
