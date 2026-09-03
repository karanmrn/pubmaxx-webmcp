/**
 * Shared motion physics for the landing/cinema/splash surfaces (PIECE 1 of
 * feat(landing): hero scroll cinema with aperture splash).
 *
 * This is the single place `prefers-reduced-motion` is read for those
 * surfaces. No component under components/landing or the splash script
 * should call `matchMedia("(prefers-reduced-motion: reduce)")` on its own -
 * import prefersReducedMotion()/onReducedMotionChange() from here instead, so
 * a future change to the check (e.g. also honouring Legacy Mode) only needs
 * one edit.
 *
 * app/globals.css already owns --duration- and --ease- tokens for short
 * (<=280ms) UI feedback (button presses, dropdowns, toasts). Those are too
 * short for a full-viewport scroll-scrubbed sequence or a sub-second splash,
 * so this module adds its own constants sized for those two cases. A
 * follow-up task migrates the rest of the app onto this module; this PR only
 * wires the landing/cinema/splash surfaces it touches.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Subscribe to prefers-reduced-motion changes. Returns an unsubscribe fn. */
export function onReducedMotionChange(
  callback: (reduced: boolean) => void,
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  const handler = () => callback(mql.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
