import { projectMomentum } from "@/lib/springMotion";

// Pure snap-point resolver for the mobile venue bottom-sheet (GH #17).
//
// The sheet only has three resting states — never a continuous free-float —
// so a drag always resolves to exactly one of them:
//   peek: grabber + title + price visible, everything else tucked below the
//         fold (a small, thumb-friendly sliver of the sheet).
//   half: ~55% of the viewport height — enough to read a tab's content
//         without covering the whole map.
//   full: ~92% of the viewport height — full detail, still leaves a strip of
//         map visible up top so the sheet never feels like a full takeover.
//
// Snap points are expressed as a fraction of the viewport height (vh) so the
// resolver doesn't need to know actual pixel heights of viewport or sheet —
// callers convert to px against their own measured viewport height.
export const SHEET_SNAP_FRACTIONS = {
  peek: 0.22,
  half: 0.55,
  full: 0.92,
} as const;

export type SheetSnap = keyof typeof SHEET_SNAP_FRACTIONS;

// Ordered peek → full so callers can walk "the next snap up/down".
export const SHEET_SNAP_ORDER: SheetSnap[] = ["peek", "half", "full"];

/**
 * MapLibre easeTo `offset` (px) so a selected pub sits in the visible map band
 * above the mobile bottom sheet — not under it. Positive Y moves the camera
 * center down, so the target appears higher on screen.
 *
 * Default assumes the sheet opens at `half` (selectVenue always does).
 */
export function mobileSelectCameraOffset(
  viewportHeight: number,
  snap: SheetSnap = "half",
): [number, number] {
  const h = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  if (h <= 0) return [0, 0];
  // Midpoint of the uncovered band (0 … 1 - sheetFraction).
  const visibleMid = (1 - SHEET_SNAP_FRACTIONS[snap]) / 2;
  const y = Math.round((0.5 - visibleMid) * h);
  return [0, Math.max(0, y)];
}

/**
 * Resting translateY as a fraction of viewport height (DOWN from a full-
 * viewport-tall sheet at translateY(0)). Derived from SHEET_SNAP_FRACTIONS so
 * CSS (`Nv h`), drag px offsets, and resolveSheetSnap all share one source:
 *   translateFraction = 1 - revealedFraction
 *   → full 0.08, half 0.45, peek 0.86
 */
export const SHEET_SNAP_TRANSLATE_FRACTIONS = {
  peek: 1 - SHEET_SNAP_FRACTIONS.peek,
  half: 1 - SHEET_SNAP_FRACTIONS.half,
  full: 1 - SHEET_SNAP_FRACTIONS.full,
} as const;

export const SHEET_ENTRANCE_OVERSHOOT_DAMPING = 0.75;
/** Keep first phone-sheet frame visible while the entrance spring starts. */
export const SHEET_ENTRANCE_START_FRACTION = 0.05;

export const VENUE_REVEAL_STALE_MS = 8_000;
export const VENUE_REVEAL_SHORT_MS = 160;
export const VENUE_REVEAL_CINEMA_MS = 480;
export const VENUE_REVEAL_REDUCED_MOTION_QUERY =
  "(prefers-reduced-motion: reduce)";

export function venueRevealPrefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.(VENUE_REVEAL_REDUCED_MOTION_QUERY).matches === true
  );
}

export type VenueRevealForm = "full" | "short";

export function revealForm(
  now: number,
  lastRevealAt: number | null,
): VenueRevealForm {
  if (lastRevealAt === null || !Number.isFinite(lastRevealAt)) return "full";
  if (now - lastRevealAt >= VENUE_REVEAL_STALE_MS) return "full";
  return "short";
}

export function sheetEntranceStartHeight(
  targetHeight: number,
  overshoot: boolean,
): number {
  if (!overshoot || !Number.isFinite(targetHeight) || targetHeight <= 0) return 0;
  return targetHeight * SHEET_ENTRANCE_START_FRACTION;
}

/** translateY fraction of viewport for a snap (same units as CSS `vh`). */
export function sheetTranslateYFraction(snap: SheetSnap): number {
  return SHEET_SNAP_TRANSLATE_FRACTIONS[snap];
}

// A flick faster than this (px/ms, i.e. px per millisecond) is treated as a
// deliberate gesture that should move at least one snap step beyond the
// nearest-by-distance snap, in the direction of the flick — not just settle
// wherever the finger happened to stop.
const VELOCITY_FLICK_THRESHOLD = 0.5;

export type ResolveSnapInput = {
  /** Current open snap the drag started from. */
  currentSnap: SheetSnap;
  /** Viewport height in px, used to turn the vh fractions into px targets. */
  viewportHeight: number;
  /**
   * Net vertical drag distance in px at release, POSITIVE = dragged down
   * (toward closed), NEGATIVE = dragged up (toward full).
   */
  dragDeltaY: number;
  /**
   * Signed velocity in px/ms at release (same sign convention as dragDeltaY).
   * Pass 0 for a slow/no-velocity release.
   */
  velocity: number;
};

export type ResolveSnapResult = {
  snap: SheetSnap;
  /** True when the resolved result is "closed" — dragged down past peek. */
  dismissed: boolean;
};

function snapToY(snap: SheetSnap, viewportHeight: number): number {
  // Sheet is modeled as viewport-tall; translateY pushes it down so only
  // `SHEET_SNAP_FRACTIONS[snap]` of the viewport stays revealed.
  return viewportHeight * sheetTranslateYFraction(snap);
}

/**
 * Resolve a drag-release into the snap state the sheet should animate to.
 *
 * Algorithm:
 *  1. Compute the sheet's current effective Y (px from the top of viewport)
 *     as currentSnap's resting Y plus the net drag delta.
 *  2. If release velocity exceeds the flick threshold, project its natural
 *     deceleration endpoint. Strong intent can cross more than one detent.
 *  3. Resolve to whichever snap's resting Y is nearest the effective or
 *     projected Y.
 */
export function resolveSheetSnap({
  currentSnap,
  viewportHeight,
  dragDeltaY,
  velocity,
}: ResolveSnapInput): ResolveSnapResult {
  if (viewportHeight <= 0) return { snap: currentSnap, dismissed: false };

  const isFlick = Math.abs(velocity) >= VELOCITY_FLICK_THRESHOLD;

  const effectiveY = snapToY(currentSnap, viewportHeight) + dragDeltaY;
  const releaseY = isFlick
    ? projectMomentum(effectiveY, velocity)
    : effectiveY;

  // Dismiss when dragged down well past peek's resting position (more than
  // half of peek's own revealed height further down). Momentum may dismiss
  // only when the gesture started at peek; a flick from a higher detent first
  // lands at peek instead of skipping the final recovery point.
  const peekY = snapToY("peek", viewportHeight);
  const dismissThreshold = peekY + viewportHeight * SHEET_SNAP_FRACTIONS.peek * 0.5;
  if (
    effectiveY > dismissThreshold ||
    (currentSnap === "peek" && releaseY > dismissThreshold)
  ) {
    return { snap: "peek", dismissed: true };
  }

  let nearest: SheetSnap = "peek";
  let nearestDist = Infinity;
  for (const snap of SHEET_SNAP_ORDER) {
    const dist = Math.abs(snapToY(snap, viewportHeight) - releaseY);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = snap;
    }
  }
  return { snap: nearest, dismissed: false };
}

/** translateY in px for a given snap + viewport height — used by the LEGACY
 *  641–768px inline drawer's drag (components/map/useSheetDrag.ts) and PubMap's
 *  inline drawer transforms. The rebuilt phone portal sheet no longer uses a
 *  translateY snap model — see the height resolver below. */
export function sheetTranslateY(snap: SheetSnap, viewportHeight: number): number {
  return snapToY(snap, viewportHeight);
}

export function sheetClosedTranslateY(
  viewportHeight: number,
  bottomClearance: number,
): number {
  const height =
    Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  const clearance =
    Number.isFinite(bottomClearance) && bottomClearance > 0
      ? bottomClearance
      : 0;
  return height + clearance;
}

// ── Height-driven snap resolver (bottom-anchored content-fit sheet model) ─────
// The rebuilt mobile portal sheet (components/mobile/MobileSharedSheet.tsx) is a
// bottom-anchored flex column whose rendered height is min(content, cap) — CSS
// `height:auto; max-height:<cap>` does the void-killing natively, so there is no
// content-measuring, no reserved-footer var math, no translateY. A drag grows or
// shrinks that height directly, so a release resolves by comparing the released
// HEIGHT to each snap's cap — the height-space mirror of resolveSheetSnap's
// translateY nearest-neighbour.

export type SheetSnapCaps = Record<SheetSnap, number>;

/**
 * Per-snap cap heights (px) for the bottom-anchored sheet: the snap's fraction
 * of the viewport MINUS `dockPx`, the sheet box's bottom offset from the viewport
 * bottom (the rebuilt phone sheet anchors at bottom:0, so the hook passes 0 and
 * the caps are the plain `<fraction>dvh` used in mobileMapShell.css; the param
 * keeps the resolver correct if the anchor ever grows a safe-area/dock offset).
 */
export function sheetSnapCaps(viewportHeight: number, dockPx: number): SheetSnapCaps {
  const cap = (snap: SheetSnap) =>
    Math.max(0, viewportHeight * SHEET_SNAP_FRACTIONS[snap] - dockPx);
  return { peek: cap("peek"), half: cap("half"), full: cap("full") };
}

export type ResolveHeightSnapInput = {
  /** Snap the drag started from. */
  startSnap: SheetSnap;
  /**
   * Rendered box height (px) at grab — the START snap's true resting height
   * (content-hugged when short, cap when tall). Used as the START snap's
   * reference so a short content-hugged half stays half instead of mis-snapping
   * to peek merely because its px height sits in peek's band.
   */
  startHeightPx: number;
  /** Presented box height (px) at release. */
  releaseHeightPx: number;
  /**
   * Signed height velocity (px/ms) at release: + = growing (dragged up), − =
   * shrinking (dragged down). 0 for a still/paused release.
   */
  velocity: number;
  /** Per-snap cap heights (px), from sheetSnapCaps. */
  caps: SheetSnapCaps;
};

/**
 * Resolve a height-drag release to a snap. Mirrors resolveSheetSnap:
 *  • A flick (|velocity| ≥ threshold) projects a deceleration endpoint, so
 *    strong intent may cross more than one detent.
 *  • Otherwise nearest-neighbour on the released height, where the START snap's
 *    reference is its rendered start height and every other snap uses its cap.
 *  • A slow collapse below half of peek's cap dismisses.
 * Pure; exported for tests.
 */
export function resolveSheetHeightSnap({
  startSnap,
  startHeightPx,
  releaseHeightPx,
  velocity,
  caps,
}: ResolveHeightSnapInput): ResolveSnapResult {
  const isFlick = Math.abs(velocity) >= VELOCITY_FLICK_THRESHOLD;
  const projectedHeight = isFlick
    ? projectMomentum(releaseHeightPx, velocity)
    : releaseHeightPx;

  // A physical collapse well below peek dismisses. Projected momentum may
  // dismiss only from peek so a flick from half still has a recoverable stop.
  const dismissThreshold = caps.peek * 0.5;
  if (
    releaseHeightPx < dismissThreshold ||
    (startSnap === "peek" && projectedHeight < dismissThreshold)
  ) {
    return { snap: "peek", dismissed: true };
  }

  const ref = (snap: SheetSnap) => (snap === startSnap ? startHeightPx : caps[snap]);
  let nearest: SheetSnap = SHEET_SNAP_ORDER[0];
  let nearestDist = Infinity;
  for (const snap of SHEET_SNAP_ORDER) {
    const dist = Math.abs(ref(snap) - projectedHeight);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = snap;
    }
  }
  return { snap: nearest, dismissed: false };
}
