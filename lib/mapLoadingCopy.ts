/** Visible line once map loading runs longer than the honest slow threshold. */
export const MAP_LOADING_SLOW_LINE = "Still loading pubs…";

/** How long the held frame waits before it admits the load is taking a while. */
export const MAP_LOADING_SLOW_AFTER_MS = 8_000;

/** City-aware primary line for the map held loading frame. */
export function mapLoadingPrimaryLine(cityDisplayName: string): string {
  const trimmed = cityDisplayName.trim();
  if (!trimmed) return "Loading pubs…";
  return `Loading ${trimmed} pubs…`;
}

/**
 * What the held frame has actually reached. Pin reveal is the only complete
 * answer: a painted basemap or a loaded slim index is progress towards tappable
 * pins, never the arrival.
 */
export type MapLoadingStage = {
  pinsRevealed: boolean;
  canvasReady: boolean;
  slimLoaded: boolean;
  slimPinCount: number;
};

/**
 * Whether the held frame stays up. Pin reveal is necessary and not sufficient:
 * above the phone breakpoint the canvas reveals on painted basemap tiles alone,
 * so a reveal that lands while the slim index is still in flight would lift the
 * frame onto a pub-free map. The index has to have answered as well.
 */
export function mapLoadingHeld(stage: MapLoadingStage): boolean {
  if (!stage.pinsRevealed) return true;
  return !stage.slimLoaded && stage.slimPinCount === 0;
}

/** Monotonic progress ladder for the held frame's bar, 0-100. */
export function mapLoadingProgressPercent(stage: MapLoadingStage): number {
  if (!mapLoadingHeld(stage)) return 100;
  if (stage.pinsRevealed || stage.canvasReady) return 85;
  if (stage.slimLoaded && stage.slimPinCount > 0) return 55;
  if (stage.slimLoaded) return 35;
  return 12;
}
