/**
 * Paint watchdog — pure recovery decision for a parked WebGL map canvas.
 *
 * Background: after #544 the map kicks a repaint on discrete events
 * (style.load scene build, pin-reveal, moveend). Those are all event-driven.
 * A failure mode dodges every one of them: a "Plan an outing" sheet opening
 * resizes the map container, and if that resize is missed (or the RAF present
 * is throttled — iOS Low Power Mode — or the tab was backgrounded and resumed)
 * the renderer parks on its pre-tile black backbuffer with no further event to
 * dirty the scene. DOM overlays stay alive; the canvas is solid black.
 *
 * This module is ONLY the decision: given the last render timestamp, the clock,
 * whether the document is visible, whether the canvas is really on-screen with a
 * non-zero size, and how many recoveries we've already spent this mount, should
 * we fire ONE recovery (map.resize() + map.triggerRepaint())? It performs no I/O
 * and touches no map — the caller owns the side effects and the retry counter,
 * so this stays hermetically testable. It is a recovery NET, not a render driver.
 */

/** How often the watchdog interval samples paint liveness (ms). */
export const PAINT_WATCHDOG_INTERVAL_MS = 2000;
/**
 * A render gap longer than this means the frame loop has parked. Kept above the
 * interval so a single skipped tick can't trip it, and well above a normal idle
 * (MapLibre renders on demand, but a healthy just-resized/just-arrived map
 * presents within a frame or two).
 */
export const PAINT_STALL_THRESHOLD_MS = 2500;
/**
 * Hard cap on recoveries per mount. Once spent, the caller logs one structured
 * warning and stops sampling, so a genuinely dead canvas can never loop hot.
 */
export const PAINT_WATCHDOG_MAX_RETRIES = 5;

export type PaintWatchdogInput = {
  /** Monotonic clock reading for this sample (e.g. performance.now()). */
  now: number;
  /**
   * Timestamp of the most recent MapLibre "render" event, or null if none has
   * fired yet. A null here is the FIRST-frame case, owned by the separate
   * first-frame watchdog — this recovery net deliberately stays out of it.
   */
  lastRenderAt: number | null;
  /** document.visibilityState === "visible". Hidden tabs throttle rAF to ~0. */
  documentVisible: boolean;
  /** Map exists AND its style is loaded (map.isStyleLoaded()). */
  mapLoaded: boolean;
  /** Canvas is displayed (not display:none / visibility:hidden / detached). */
  canvasVisible: boolean;
  /** Canvas backing width in px. */
  canvasWidth: number;
  /** Canvas backing height in px. */
  canvasHeight: number;
  /** Recoveries already spent this mount. */
  retries: number;
  /** Override for tests; defaults to PAINT_WATCHDOG_MAX_RETRIES. */
  maxRetries?: number;
  /** Override for tests; defaults to PAINT_STALL_THRESHOLD_MS. */
  stallThresholdMs?: number;
};

/**
 * True iff the caller should fire exactly one recovery now. Every guard must
 * hold: the tab is visible, the map+style are ready, the canvas is really
 * on-screen with a non-zero size, at least one frame has rendered (so this is a
 * PARKED renderer, not a never-started one), that render is now stale past the
 * threshold, and we still have recovery budget left.
 */
export function shouldRecoverPaint(input: PaintWatchdogInput): boolean {
  const {
    now,
    lastRenderAt,
    documentVisible,
    mapLoaded,
    canvasVisible,
    canvasWidth,
    canvasHeight,
    retries,
    maxRetries = PAINT_WATCHDOG_MAX_RETRIES,
    stallThresholdMs = PAINT_STALL_THRESHOLD_MS,
  } = input;

  if (!documentVisible) return false;
  if (!mapLoaded) return false;
  if (!canvasVisible) return false;
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) return false;
  // Never rendered yet → first-frame watchdog's job, not ours.
  if (lastRenderAt === null) return false;
  if (retries >= maxRetries) return false;
  return now - lastRenderAt > stallThresholdMs;
}
