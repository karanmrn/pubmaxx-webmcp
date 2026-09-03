"use client";

import { useEffect, useState } from "react";

/**
 * A horizontal strip's right-edge fade, drawn only while it is telling the
 * truth.
 *
 * The venue sheet's tab strip scrolls, so its overflowing edge fades rather
 * than clipping a label mid-word (design judgement 2026-08-01, finding 2.16).
 * A STATIC mask says something else. At 390px the strip overflows by about
 * 5px while the mask eats 28px, so the last tab sat half-faded at every scroll
 * position, including the end of the scroll. Half-opacity is how this product
 * draws a control a reader may not use, so "Last train" read as disabled.
 *
 * A fade is a promise that something is off the edge. Two cases break that
 * promise, and this hook withholds the mask for both:
 *
 *  - The reader has scrolled to the end. Nothing is hidden, so nothing fades.
 *  - The whole overflow is narrower than the fade. Then the fade can only ever
 *    dim content the reader can already see, whatever the scroll position.
 *
 * The width below must stay in step with the mask in
 * components/map/venueSheet.css; __tests__/venueTabsEdgeFade.test.ts reads the
 * shipped CSS and fails when they drift.
 */
export const TRAILING_EDGE_FADE_PX = 28;

export type ScrollMetrics = {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
};

/**
 * Whether a right-edge fade is honest for these metrics.
 *
 * Sub-pixel layout makes an exact comparison unreliable, so the end of the
 * scroll is anything within a pixel of it.
 */
export function shouldFadeTrailingEdge(
  { scrollLeft, scrollWidth, clientWidth }: ScrollMetrics,
  fadePx: number = TRAILING_EDGE_FADE_PX,
): boolean {
  const overflow = scrollWidth - clientWidth;
  if (overflow <= fadePx) return false;
  return scrollLeft < overflow - 1;
}

/**
 * Attach the returned ref to the scrolling strip. `faded` is true only while a
 * fade would name real hidden content; the caller gates its mask on it.
 */
export function useTrailingEdgeFade<T extends HTMLElement>(): {
  ref: React.Dispatch<React.SetStateAction<T | null>>;
  faded: boolean;
} {
  // The element itself is state, not a ref, so attaching it re-runs the effect
  // below. A ref would leave the listeners unbound on the first render, which
  // is the render a deep link opens the sheet on.
  const [strip, setStrip] = useState<T | null>(null);
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    if (!strip) return;
    const measure = () => setFaded(shouldFadeTrailingEdge(strip));
    // The first measurement waits a frame rather than running inside the
    // effect, so no state is set synchronously during commit. No mask is the
    // safe state to hold for that frame: it shows a tab the reader can use,
    // where the wrong direction dims one they can.
    const frame = requestAnimationFrame(measure);
    // Both the content and the strip's own width move the answer: a tab label
    // changes with the viewport band, and the sheet resizes on rotation and on
    // a snap change. The observer catches those; the listener catches the
    // reader's thumb.
    strip.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(strip);
    for (const child of Array.from(strip.children)) observer?.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      strip.removeEventListener("scroll", measure);
      observer?.disconnect();
      setFaded(false);
    };
  }, [strip]);

  return { ref: setStrip, faded };
}
