import { describe, expect, it } from "vitest";
import {
  PAINT_STALL_THRESHOLD_MS,
  PAINT_WATCHDOG_MAX_RETRIES,
  shouldRecoverPaint,
  type PaintWatchdogInput,
} from "@/lib/mapPaintWatchdog";

// A healthy, parked-past-threshold baseline the individual cases mutate. Every
// guard passes here, so each test flips exactly one field to prove that guard.
const parked: PaintWatchdogInput = {
  now: 10_000,
  lastRenderAt: 10_000 - (PAINT_STALL_THRESHOLD_MS + 500),
  documentVisible: true,
  mapLoaded: true,
  canvasVisible: true,
  canvasWidth: 390,
  canvasHeight: 720,
  retries: 0,
};

describe("shouldRecoverPaint", () => {
  it("recovers a parked renderer once every guard holds", () => {
    expect(shouldRecoverPaint(parked)).toBe(true);
  });

  it("stays quiet while the render is still fresh", () => {
    expect(
      shouldRecoverPaint({ ...parked, lastRenderAt: parked.now - 100 }),
    ).toBe(false);
  });

  it("treats exactly the threshold as not-yet-stale (strictly greater)", () => {
    expect(
      shouldRecoverPaint({
        ...parked,
        lastRenderAt: parked.now - PAINT_STALL_THRESHOLD_MS,
      }),
    ).toBe(false);
    expect(
      shouldRecoverPaint({
        ...parked,
        lastRenderAt: parked.now - PAINT_STALL_THRESHOLD_MS - 1,
      }),
    ).toBe(true);
  });

  it("never fires while the document is hidden (rAF is throttled there)", () => {
    expect(shouldRecoverPaint({ ...parked, documentVisible: false })).toBe(false);
  });

  it("waits for the map + style to be loaded", () => {
    expect(shouldRecoverPaint({ ...parked, mapLoaded: false })).toBe(false);
  });

  it("does nothing for a hidden or zero-size canvas", () => {
    expect(shouldRecoverPaint({ ...parked, canvasVisible: false })).toBe(false);
    expect(shouldRecoverPaint({ ...parked, canvasWidth: 0 })).toBe(false);
    expect(shouldRecoverPaint({ ...parked, canvasHeight: 0 })).toBe(false);
  });

  it("leaves the first-frame case to the first-frame watchdog", () => {
    // Never rendered: lastRenderAt null must not trigger recovery here.
    expect(shouldRecoverPaint({ ...parked, lastRenderAt: null })).toBe(false);
  });

  it("stops once the retry budget is spent, so it can't loop hot", () => {
    expect(
      shouldRecoverPaint({ ...parked, retries: PAINT_WATCHDOG_MAX_RETRIES - 1 }),
    ).toBe(true);
    expect(
      shouldRecoverPaint({ ...parked, retries: PAINT_WATCHDOG_MAX_RETRIES }),
    ).toBe(false);
    expect(
      shouldRecoverPaint({ ...parked, retries: PAINT_WATCHDOG_MAX_RETRIES + 3 }),
    ).toBe(false);
  });

  it("honours overridden threshold and cap (hermetic knobs)", () => {
    expect(
      shouldRecoverPaint({
        ...parked,
        lastRenderAt: parked.now - 1_000,
        stallThresholdMs: 500,
      }),
    ).toBe(true);
    expect(
      shouldRecoverPaint({ ...parked, retries: 2, maxRetries: 2 }),
    ).toBe(false);
  });
});
