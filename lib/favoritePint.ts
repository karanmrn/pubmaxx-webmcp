// Favourite-pint preference — a demo, localStorage-backed single value.
//
// Which pint a user "supports" is a DEMO preference: it lives in the browser's
// localStorage, not a backend, so it survives reloads on one device but nothing
// more. Mirrors lib/savedPubs.ts's SSR-safe boundary — importing/calling on the
// server is safe (reads return null, writes are no-ops).

import { safeLocalStorage } from "@/lib/safeStorage";
const STORAGE_KEY = "pubmax:favoritePint:v1";

function hasStorage(): boolean {
  return safeLocalStorage() !== null;
}

// The stored beer id, or null on the server / when nothing is set / storage is
// unreadable (bad value, private mode). The id is not validated against BEERS
// here — callers resolve it, and an unknown id simply matches no beer.
export function getFavoritePint(): string | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function setFavoritePint(beerId: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, beerId);
  } catch {
    // Storage full / disabled / private mode — the demo degrades silently.
  }
}

export function clearFavoritePint(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No-op on failure — same silent-degrade contract as the writer above.
  }
}
