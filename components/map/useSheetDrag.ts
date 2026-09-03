"use client";

import { useCallback, useRef, useState } from "react";

import {
  SHEET_SNAP_FRACTIONS,
  SHEET_SNAP_ORDER,
  sheetTranslateY,
  type SheetSnap,
} from "@/lib/sheetSnap";

// Mobile bottom-sheet drag gesture (GH #17), lifted out of PubMap so its
// branch-heavy pointer handlers live off PubMap's ESLint complexity budget.
// Reusable for both drawers: venue detail (right) and crawl planner (left).
// Call once per sheet — each instance owns its own snap + mid-drag offset.
// The gesture is active only in the 641-768px legacy inline-sheet band. The
// ≤640px portal sheet owns its own height drag; above 768px this is a side
// drawer and every handler bails out immediately.
//
// PubMap owns WHICH snap is default on open (it resets to "half" there);
// this hook owns the live drag → snap resolution and the mid-drag px offset.
// Mid-drag translateY px use `sheetTranslateY` from lib/sheetSnap.ts (same
// fractions as CSS `.sheet-*` and resolveSheetSnap) — do not reintroduce a
// local VH map.
//
// PHYSICS (Apple "Designing Fluid Interfaces" model):
//  • 1:1 tracking — the sheet stays glued to the finger. On grab we read the
//    sheet's LIVE on-screen transform and start from there (the presentation
//    value), so a re-grab mid-settle is seamless and any vh↔innerHeight drift
//    never shows as a start-of-drag jump.
//  • Momentum projection — on release we project a resting point from the
//    release velocity (exponential scroll-deceleration, decel 0.998) and snap
//    to whichever of peek/half/full is nearest that PROJECTION, so a flick
//    throws the sheet forward instead of settling where the finger stopped.
//  • Rubber-banding — dragging up past the "full" bound resists progressively
//    (resist(x) = x·dim·0.55 / (dim + 0.55·|x|)) rather than hard-stopping.
//  • Interruptible — SpringDrawer consumes the live drag offset and release
//    velocity. A re-grab reads its presented transform and cancels from that
//    exact value, with no brick-wall reversal.

const SHEET_GESTURE_MIN_WIDTH = 641;
const SHEET_GESTURE_MAX_WIDTH = 768;

// Apple scroll-deceleration constant. projectedDisplacement =
// (v_px_per_s / 1000) · decel / (1 − decel). With v tracked in px/ms this is
// just v_px_per_ms · [decel / (1 − decel)].
const DECELERATION = 0.998;
const PROJECTION_FACTOR = DECELERATION / (1 - DECELERATION); // = 499

// iOS-style progressive boundary resistance (Apple "rubberband").
const RUBBERBAND_CONSTANT = 0.55;

// A release preceded by a still finger should NOT fling — if the pointer hasn't
// moved for longer than this, treat the release velocity as zero.
const RELEASE_PAUSE_MS = 66; // ~4 frames

// Low-pass on the per-move velocity so a single jittery sample can't spike the
// projection; still weights the most recent motion enough for a crisp flick.
const VELOCITY_SMOOTHING = 0.55; // weight on the newest instantaneous sample

export interface SheetDrag {
  /** Current resting snap point. */
  sheetSnap: SheetSnap;
  /** Reset to a resting snap (PubMap calls this "half" on a fresh venue pick). */
  setSheetSnap: (snap: SheetSnap) => void;
  /** Live px offset while a drag is in progress; null when not dragging. */
  sheetDragY: number | null;
  /** Clear the live offset (SpringDrawer owns the resting transform). */
  setSheetDragY: (value: number | null) => void;
  /** Last vertical release velocity in px/s, handed to SpringDrawer. */
  sheetReleaseVelocity: number;
  onSheetDragStart: (event: React.PointerEvent<HTMLElement>) => void;
  onSheetDragMove: (event: React.PointerEvent<HTMLElement>) => void;
  onSheetDragEnd: (event: React.PointerEvent<HTMLElement>) => void;
}

/** Progressive resistance past a boundary (Apple rubber-band). */
function rubberband(overshoot: number, dimension: number): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * RUBBERBAND_CONSTANT) / (dimension + RUBBERBAND_CONSTANT * overshoot);
}

/** The sheet's live on-screen translateY in px, read off the .mapDrawer host. */
function readLiveTranslateY(host: HTMLElement | null): number | null {
  if (!host || typeof window === "undefined") return null;
  const drawer = host.closest<HTMLElement>(".mapDrawer");
  if (!drawer) return null;
  const transform = window.getComputedStyle(drawer).transform;
  if (!transform || transform === "none") return null;
  try {
    // getComputedStyle resolves vh → px and, mid-transition, returns the
    // interpolated matrix — exactly the presentation value we want to grab from.
    return new DOMMatrixReadOnly(transform).m42;
  } catch {
    return null;
  }
}

/**
 * Bottom-sheet drag state + pointer handlers. `onDismiss` fires when a drag
 * flings the sheet past its dismiss threshold (PubMap clears the selected venue
 * / closes the planner there). Pointer Events (not touch/mouse-specific) so a
 * mouse-drag on a narrow browser window works too — which keeps this testable
 * without a real touch device.
 *
 * This is the LEGACY translateY drag for the 641–768px inline drawer PubMap
 * renders above the phone breakpoint. The ≤640px phone portal sheet uses the
 * rebuilt bottom-anchored height drag (components/mobile/useSheetHeightDrag.ts).
 */
export function useSheetDrag(onDismiss: () => void): SheetDrag {
  // "half" is the default resting snap whenever a sheet opens — PubMap
  // re-asserts that on each open; we just seed it here.
  const [sheetSnap, setRestingSnap] = useState<SheetSnap>("half");
  const [sheetDragY, setSheetDragY] = useState<number | null>(null);
  const [sheetReleaseVelocity, setSheetReleaseVelocity] = useState(0);
  const dragRef = useRef<{
    startY: number;
    // Offset (px) between the sheet's live position at grab and its resting
    // transform for `snap` — lets the drag start from the presentation value so
    // a re-grab mid-settle (or any vh↔innerHeight drift) never jumps.
    originOffset: number;
    // Resting translateY (px) of the snap the drag started from, at grab time.
    baseY: number;
    // Viewport height captured at grab (px) — the dimension for rubber-banding.
    viewportHeight: number;
    // The snap the drag started from (px targets resolved against `viewportHeight`).
    startSnap: SheetSnap;
    lastY: number;
    lastTime: number;
    velocity: number; // px/ms, low-passed
    active: boolean;
  } | null>(null);

  const gestureEnabled = useCallback(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth >= SHEET_GESTURE_MIN_WIDTH &&
      window.innerWidth <= SHEET_GESTURE_MAX_WIDTH,
    [],
  );

  const setSheetSnap = useCallback((snap: SheetSnap) => {
    setSheetReleaseVelocity(0);
    setRestingSnap(snap);
  }, []);

  const onSheetDragStart = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!gestureEnabled()) return;
      setSheetReleaseVelocity(0);
      // Ignore drags that start on an interactive control inside the header
      // (e.g. the close button) — only the grab handle / header chrome itself
      // initiates the gesture, so tab/button clicks are unaffected.
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, textarea, select")) return;
      const now = performance.now();
      const viewportHeight = window.innerHeight;
      const baseY = sheetTranslateY(sheetSnap, viewportHeight);
      // Start from the presentation value: read where the sheet actually is on
      // screen right now (mid-settle or at rest) and offset our tracking so the
      // sheet stays exactly under the finger from the first frame.
      const liveY = readLiveTranslateY(event.currentTarget as HTMLElement);
      const originOffset = liveY === null ? 0 : liveY - baseY;
      dragRef.current = {
        startY: event.clientY,
        originOffset,
        baseY,
        viewportHeight,
        startSnap: sheetSnap,
        lastY: event.clientY,
        lastTime: now,
        velocity: 0,
        active: true,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      // Only pre-seed the live offset when we're interrupting a settle (or need
      // to correct real drift). A plain grab-at-rest leaves sheetDragY null and
      // defers to the first move — identical to the prior behaviour, so a tap on
      // the handle never flickers the sheet.
      if (Math.abs(originOffset) >= 1) {
        setSheetDragY(originOffset);
      }
    },
    [gestureEnabled, sheetSnap],
  );

  const onSheetDragMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || !drag.active) return;
    // Dragging the sheet must never also pan/zoom the map underneath.
    event.preventDefault();
    event.stopPropagation();
    const now = performance.now();
    const dt = now - drag.lastTime;
    if (dt > 0) {
      const instant = (event.clientY - drag.lastY) / dt;
      drag.velocity = drag.velocity * (1 - VELOCITY_SMOOTHING) + instant * VELOCITY_SMOOTHING;
    }
    drag.lastY = event.clientY;
    drag.lastTime = now;

    // Un-resisted offset from the starting snap's resting position, tracking the
    // finger 1:1 (plus the grab-time origin correction).
    const rawOffset = drag.originOffset + (event.clientY - drag.startY);
    const proposedY = drag.baseY + rawOffset;

    // Rubber-band past the top ("full") bound: the sheet can't reveal more than
    // the full snap, so resist progressively instead of hard-stopping.
    const fullY = sheetTranslateY("full", drag.viewportHeight);
    let presentedY = proposedY;
    if (proposedY < fullY) {
      const overshoot = fullY - proposedY;
      presentedY = fullY - rubberband(overshoot, drag.viewportHeight);
    }
    setSheetDragY(presentedY - drag.baseY);
  }, []);

  const onSheetDragEnd = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || !drag.active) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setSheetDragY(null);

      const viewportHeight = drag.viewportHeight;
      if (viewportHeight <= 0) {
        setSheetReleaseVelocity(0);
        setRestingSnap(drag.startSnap);
        return;
      }

      // Where the finger actually released, in the sheet's translateY space.
      const releaseY = drag.baseY + drag.originOffset + (event.clientY - drag.startY);

      // A finger that paused before lifting is a deliberate place, not a fling.
      const paused = performance.now() - drag.lastTime > RELEASE_PAUSE_MS;
      const releaseVelocity = paused ? 0 : drag.velocity; // px/ms
      setSheetReleaseVelocity(releaseVelocity * 1000);

      // Apple momentum projection: throw the resting point forward by the
      // decaying momentum, then snap to whichever bound is nearest the PROJECTION
      // (not nearest the release point) — this is what makes a flick feel thrown.
      const projectedY = releaseY + releaseVelocity * PROJECTION_FACTOR;

      // Dismiss when the projection lands well past peek — a flick or slow drag
      // off the bottom. Threshold mirrors resolveSheetSnap: half of peek's own
      // revealed height below peek's resting position.
      const peekY = sheetTranslateY("peek", viewportHeight);
      const dismissThreshold = peekY + viewportHeight * SHEET_SNAP_FRACTIONS.peek * 0.5;
      if (projectedY > dismissThreshold) {
        setRestingSnap("half");
        onDismiss();
        return;
      }

      let nearest: SheetSnap = SHEET_SNAP_ORDER[0];
      let nearestDist = Infinity;
      for (const snap of SHEET_SNAP_ORDER) {
        const dist = Math.abs(sheetTranslateY(snap, viewportHeight) - projectedY);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = snap;
        }
      }
      setRestingSnap(nearest);
    },
    [onDismiss],
  );

  return {
    sheetSnap,
    setSheetSnap,
    sheetDragY,
    setSheetDragY,
    sheetReleaseVelocity,
    onSheetDragStart,
    onSheetDragMove,
    onSheetDragEnd,
  };
}
