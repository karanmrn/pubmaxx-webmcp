// The shared leaf that hands back `localStorage` / `sessionStorage`, or null.
//
// Both are PROPERTY GETTERS on `window`, and a browser with site data blocked
// - "Block all cookies", a sandboxed frame without allow-same-origin - RAISES
// on the read itself. So `!!window.localStorage` is a throwing expression, and
// a helper shaped that way in a render body (a `useSyncExternalStore`
// getSnapshot is one) takes the whole tree down rather than costing a saved
// preference. A blocked browser gets null here and the surface degrades, which
// is what a stored convenience is worth.
//
// Reach storage through these two functions. Many modules still hand-roll the
// same guard inline, and the migration to this leaf is not finished, so treat
// it as the destination rather than a proven tree-wide fact: a new reader takes
// these instead of writing another copy of the try.
//
// This module imports NOTHING, so a bundle that needs one preference never
// pulls anything else in behind it.

export function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function safeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
