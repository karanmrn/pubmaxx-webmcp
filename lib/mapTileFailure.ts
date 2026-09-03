/**
 * Tile-failure classifier - pure decision for the second black-canvas class.
 *
 * Background: the paint watchdog (lib/mapPaintWatchdog.ts, #548) catches a
 * PARKED renderer - no frames presenting. It is structurally blind to the
 * opposite failure: the frame loop runs at full rate while the tiles behind it
 * failed to load (network drop, tile CDN outage, sprite/glyph fetch failure),
 * so the canvas presents a healthy stream of black/empty frames. Post-#548 the
 * only remaining silent-black class is this one.
 *
 * This module is ONLY the decision. Given the recent post-style-load error
 * history, whether a critical resource (sprite/glyph or initial basemap
 * metadata) failed, tab visibility, and the shared recovery budget, it
 * answers: ignore the noise, spend ONE bounded retry (a full style reload),
 * or surface the honest error card.
 * It performs no I/O and touches no map - the caller owns side effects,
 * counters, and the error card, so this stays hermetically testable.
 *
 * Classification rules:
 * - A lone tile miss is routine (a pan across a flaky cell) and is ignored.
 * - Tile errors observed while hidden or while the camera is in flight are
 *   ignored: aborts and catch-up misses are expected there. A terminal
 *   map-wide resource error bypasses those guards because it emits once and
 *   MapLibre then marks the failed resource loaded.
 * - Before the initial basemap has painted, a burst is systemic immediately.
 *   Initial viewport requests are concurrent, so a complete outage reports
 *   every failure quickly and may never emit another error.
 * - After a real basemap paint, a burst is systemic only if it remains
 *   unrecovered for TILE_FAILURE_SUSTAIN_MS. A sub-5s self-healing blip never
 *   reaches that boundary.
 * - A critical sprite/glyph failure breaks labels/icons map-wide. An initial
 *   vector/raster source metadata failure leaves no tiles to request, so it
 *   emits only once. Both count as systemic without a sustain requirement.
 * - The first systemic verdict earns one retry IF the shared recovery budget
 *   (paint watchdog cap) still has room.
 * - After that single retry, a fresh systemic verdict surfaces the error
 *   card. Never a second retry loop, never a silent black canvas.
 */

/** Sliding window for counting tile errors toward a burst (ms). */
export const TILE_FAILURE_WINDOW_MS = 10_000;
/**
 * Tile errors inside the window that count as a systemic failure. A healthy
 * viewport pan touches dozens of tiles; four failures in ten seconds is not a
 * flaky cell, it is a failing source.
 */
export const TILE_FAILURE_BURST = 4;
/**
 * A burst must remain unrecovered this long before it counts as systemic.
 * Transient flight/tile-catch-up black frames self-heal faster than this.
 */
export const TILE_FAILURE_SUSTAIN_MS = 5_000;

export type TileFailureDecision = "ignore" | "retry" | "surface";

export type BasemapTileReference = {
  sourceId?: unknown;
  sourceType?: unknown;
  tileKey?: unknown;
};

type BasemapTileReadinessMap = {
  getStyle: () =>
    | { sources?: Record<string, { type?: unknown }> }
    | null
    | undefined;
  areTilesLoaded: () => boolean;
  isSourceLoaded: (id: string) => boolean;
};

/**
 * Whether every tiled basemap source has settled for the current style.
 *
 * MapLibre briefly returns no style while `setStyle` swaps themes. That frame
 * is pending, not exceptional, and must never escape as a console crash.
 */
export function areBasemapTilesLoaded(map: BasemapTileReadinessMap): boolean {
  const sources = map.getStyle()?.sources;
  if (!sources) return false;
  const sourceIds = Object.entries(sources)
    .filter(([, source]) => (
      source.type === "vector" ||
      source.type === "raster" ||
      source.type === "raster-dem"
    ))
    .map(([id]) => id);
  if (sourceIds.length === 0 || !map.areTilesLoaded()) return false;
  try {
    return sourceIds.every((id) => map.isSourceLoaded(id));
  } catch {
    return false;
  }
}

function basemapTileReferenceKey({
  sourceId,
  sourceType,
  tileKey,
}: BasemapTileReference): string | null {
  if (
    sourceType !== "vector" &&
    sourceType !== "raster" &&
    sourceType !== "raster-dem"
  ) {
    return null;
  }
  if (typeof sourceId !== "string" || typeof tileKey !== "string") return null;
  return `${sourceId}:${tileKey}`;
}

export function createBasemapTileFailureTracker() {
  const failed = new Set<string>();
  return {
    reset() {
      failed.clear();
    },
    recordFailure(reference: BasemapTileReference) {
      const key = basemapTileReferenceKey(reference);
      if (key) failed.add(key);
    },
    recordSuccess(reference: BasemapTileReference): boolean {
      const key = basemapTileReferenceKey(reference);
      if (!key || !failed.delete(key)) return false;
      return failed.size === 0;
    },
    hasFailures() {
      return failed.size > 0;
    },
  };
}

export type CriticalBasemapFailureInput = {
  message: string;
  initialBasemapPending: boolean;
  sourceType?: unknown;
  tilePresent: boolean;
};

/**
 * MapLibre emits one source-level error when TileJSON metadata fails, then
 * marks that source loaded so it will be ignored. Do not make that terminal
 * error satisfy a tile-burst threshold it can never reach.
 */
export function isCriticalBasemapFailure({
  message,
  initialBasemapPending,
  sourceType,
  tilePresent,
}: CriticalBasemapFailureInput): boolean {
  if (/sprite|glyph/i.test(message)) return true;
  return (
    initialBasemapPending &&
    !tilePresent &&
    (sourceType === "vector" ||
      sourceType === "raster" ||
      sourceType === "raster-dem")
  );
}

export type TileFailureInput = {
  /** Monotonic clock reading for this sample (e.g. performance.now()). */
  now: number;
  /**
   * Timestamps of post-style-load map error events, already pruned or not -
   * the classifier only counts the ones inside the window.
   */
  errorTimestamps: readonly number[];
  /** A map-wide resource failed and counts as a burst on its own. */
  criticalFailure: boolean;
  /** document.visibilityState === "visible". Hidden tabs fail fetches benignly. */
  documentVisible: boolean;
  /**
   * The camera is mid-flight (map.isMoving()). Tile misses during a flight
   * are expected catch-up, not failure; never act on them.
   */
  cameraInFlight: boolean;
  /** The one bounded tile retry has already been spent this mount. */
  retrySpent: boolean;
  /**
   * Remaining shared recovery budget (paint watchdog cap minus recoveries
   * already spent by EITHER net). At zero, retries are over for the mount.
   */
  recoveryBudgetLeft: number;
  /**
   * No real basemap tile frame has painted for the current style generation.
   * Initial tile requests fail concurrently, so burst count alone is enough.
   */
  initialBasemapPending?: boolean;
  /** Override for tests; defaults to TILE_FAILURE_BURST. */
  burstThreshold?: number;
  /** Override for tests; defaults to TILE_FAILURE_WINDOW_MS. */
  windowMs?: number;
  /** Override for tests; defaults to TILE_FAILURE_SUSTAIN_MS. */
  sustainMs?: number;
};

/** Drop error stamps that have aged out of the sliding window. */
export function pruneTileFailures(
  timestamps: readonly number[],
  now: number,
  windowMs: number = TILE_FAILURE_WINDOW_MS,
): number[] {
  return timestamps.filter((t) => now - t <= windowMs);
}

export function tileFailureRecheckDelay(
  timestamps: readonly number[],
  now: number,
  burstThreshold: number = TILE_FAILURE_BURST,
  windowMs: number = TILE_FAILURE_WINDOW_MS,
  sustainMs: number = TILE_FAILURE_SUSTAIN_MS,
): number | null {
  const recent = pruneTileFailures(timestamps, now, windowMs);
  if (recent.length < burstThreshold) return null;
  return Math.max(0, sustainMs - (now - Math.min(...recent)));
}

/**
 * Classify the current post-style-load error state. See module doc for the
 * rules; the caller acts on the verdict exactly once per sample.
 */
export function classifyTileFailure(input: TileFailureInput): TileFailureDecision {
  const {
    now,
    errorTimestamps,
    criticalFailure,
    documentVisible,
    cameraInFlight,
    retrySpent,
    recoveryBudgetLeft,
    initialBasemapPending = false,
    burstThreshold = TILE_FAILURE_BURST,
    windowMs = TILE_FAILURE_WINDOW_MS,
    sustainMs = TILE_FAILURE_SUSTAIN_MS,
  } = input;

  // A terminal source/style resource emits one error, then MapLibre marks it
  // loaded. Act now even if the tab is hidden or the camera is moving because
  // there may be no post-flight or foreground event to replay.
  if (criticalFailure) {
    if (!retrySpent && recoveryBudgetLeft > 0) return "retry";
    return "surface";
  }

  // A hidden tab aborts ordinary tile fetches as a matter of course.
  if (!documentVisible) return "ignore";
  // Mid-flight misses are the tile stream catching up to the camera, not a
  // failure. Stamps keep accumulating in the caller, so a genuine outage
  // escalates on the first post-flight error.
  if (cameraInFlight) return "ignore";

  const recent = pruneTileFailures(errorTimestamps, now, windowMs);
  const burstAge =
    recent.length > 0 ? now - Math.min(...recent) : 0;
  const sustainedBurst = recent.length >= burstThreshold && burstAge >= sustainMs;
  const initialBurst = initialBasemapPending && recent.length >= burstThreshold;
  const systemic = initialBurst || sustainedBurst;
  if (!systemic) return "ignore";

  if (!retrySpent && recoveryBudgetLeft > 0) return "retry";
  return "surface";
}

export type TileFailureSpendState = {
  retryQueued: boolean;
  retrySpent: boolean;
  surfaced: boolean;
};

export const INITIAL_TILE_FAILURE_SPEND: TileFailureSpendState = {
  retryQueued: false,
  retrySpent: false,
  surfaced: false,
};

export type TileFailureSpendEffect = "none" | "reload-style" | "surface";

/**
 * Caller-side spend of `classifyTileFailure`. One style reload, then the
 * honest surface. Never a second retry loop — even if a later sample still
 * says retry after the first reload was queued or spent.
 */
export function spendTileFailureDecision(
  state: TileFailureSpendState,
  decision: TileFailureDecision,
): { state: TileFailureSpendState; effect: TileFailureSpendEffect } {
  if (state.surfaced || decision === "ignore") {
    return { state, effect: "none" };
  }
  if (decision === "retry") {
    if (state.retryQueued || state.retrySpent) {
      return { state, effect: "none" };
    }
    return {
      state: { ...state, retryQueued: true },
      effect: "reload-style",
    };
  }
  return { state, effect: "surface" };
}

export function markTileRetrySpent(
  state: TileFailureSpendState,
): TileFailureSpendState {
  return { ...state, retryQueued: false, retrySpent: true };
}

export function markTileFailureSurfaced(
  state: TileFailureSpendState,
): TileFailureSpendState {
  return { ...state, surfaced: true };
}

/**
 * After the one bounded style reload is spent, which surface the caller
 * shows. A MapLibre `render` event is not a loaded style: empty frames fire
 * while both style URLs refuse. Toast is only honest when a style actually
 * loaded and later lost tiles. Otherwise the tiles card.
 */
export function basemapFailureSurface(
  styleLoaded: boolean,
): "toast" | "card" {
  return styleLoaded ? "toast" : "card";
}
