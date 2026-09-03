// Stable, unauthenticated actor id for the browser. There is no auth (identity
// is a self-asserted handle), so reactions/comments/reports are attributed to a
// random id this device minted once and kept in localStorage. The server hashes
// it (lib/supabase.ts hashActor) before it ever touches a table — the raw id is
// a per-device secret, never persisted server-side.
//
// SSR-safe: every entry point guards `window`, so importing/calling on the
// server is a no-op that returns "". The id is only meaningful in the browser.

import { safeLocalStorage } from "@/lib/safeStorage";
const STORAGE_KEY = "pubmax:anonId:v1";

function hasStorage(): boolean {
  return safeLocalStorage() !== null;
}

// A URL-safe random id. Prefers crypto.randomUUID (all supported browsers), then
// getRandomValues, then a last-resort time+counter string — the id only needs to
// be unique-per-device and unguessable, not cryptographically perfect, because
// the server salts+hashes it anyway.
function mint(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // fall through to the non-crypto path
  }
  return `a${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * The device's stable anon id, minting + persisting one on first use. Returns ""
 * on the server or when storage is unavailable (private mode / disabled) — a
 * caller with "" simply acts anonymously (the server treats it as a shared
 * sentinel), which is the correct demo degradation, never a crash.
 */
export function getAnonId(): string {
  if (!hasStorage()) return "";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = mint();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return "";
  }
}
