import { describe, expect, it } from "vitest";

import {
  resolveSheetSnap,
  resolveSheetHeightSnap,
  sheetClosedTranslateY,
  sheetSnapCaps,
  sheetTranslateY,
  sheetTranslateYFraction,
  SHEET_SNAP_FRACTIONS,
  SHEET_SNAP_ORDER,
  SHEET_SNAP_TRANSLATE_FRACTIONS,
  mobileSelectCameraOffset,
  sheetEntranceStartHeight,
  SHEET_ENTRANCE_OVERSHOOT_DAMPING,
} from "@/lib/sheetSnap";
import { stepSpring } from "@/lib/springMotion";

const VH = 800; // a plausible phone viewport height in px

describe("SHEET_SNAP_TRANSLATE_FRACTIONS", () => {
  it("is 1 − revealed fraction for every snap (CSS vh source of truth)", () => {
    expect(SHEET_SNAP_TRANSLATE_FRACTIONS.full).toBeCloseTo(0.08);
    expect(SHEET_SNAP_TRANSLATE_FRACTIONS.half).toBeCloseTo(0.45);
    expect(SHEET_SNAP_TRANSLATE_FRACTIONS.peek).toBeCloseTo(0.78);
    for (const snap of SHEET_SNAP_ORDER) {
      expect(SHEET_SNAP_TRANSLATE_FRACTIONS[snap]).toBeCloseTo(
        1 - SHEET_SNAP_FRACTIONS[snap],
      );
      expect(sheetTranslateYFraction(snap)).toBe(SHEET_SNAP_TRANSLATE_FRACTIONS[snap]);
    }
  });
});

describe("sheetTranslateY", () => {
  it("returns a larger translateY (more hidden) for smaller snaps", () => {
    const peekY = sheetTranslateY("peek", VH);
    const halfY = sheetTranslateY("half", VH);
    const fullY = sheetTranslateY("full", VH);
    expect(peekY).toBeGreaterThan(halfY);
    expect(halfY).toBeGreaterThan(fullY);
  });

  it("matches the documented vh fractions", () => {
    expect(sheetTranslateY("full", VH)).toBeCloseTo(VH * SHEET_SNAP_TRANSLATE_FRACTIONS.full);
    expect(sheetTranslateY("half", VH)).toBeCloseTo(VH * SHEET_SNAP_TRANSLATE_FRACTIONS.half);
    expect(sheetTranslateY("peek", VH)).toBeCloseTo(VH * SHEET_SNAP_TRANSLATE_FRACTIONS.peek);
  });
});

describe("sheetClosedTranslateY", () => {
  it("moves a bottom-offset tablet drawer fully below the viewport", () => {
    expect(sheetClosedTranslateY(800, 58)).toBe(858);
  });

  it("ignores invalid and negative bottom clearances", () => {
    expect(sheetClosedTranslateY(800, -20)).toBe(800);
    expect(sheetClosedTranslateY(800, Number.NaN)).toBe(800);
  });
});

describe("sheetEntranceStartHeight", () => {
  it("calibrates phone entrance spring overshoot to 2-3 percent", () => {
    const target = 440;
    const start = sheetEntranceStartHeight(target, true);
    let state = { value: start, velocity: 0 };
    let peak = start;
    for (let frame = 0; frame < 240; frame += 1) {
      state = stepSpring(state, target, 1 / 240, {
        response: 0.34,
        dampingRatio: SHEET_ENTRANCE_OVERSHOOT_DAMPING,
      });
      peak = Math.max(peak, state.value);
    }
    const overshoot = (peak - target) / target;
    expect(overshoot).toBeGreaterThanOrEqual(0.02);
    expect(overshoot).toBeLessThanOrEqual(0.03);
  });
});

describe("mobileSelectCameraOffset", () => {
  it("offsets downward so the pin sits in the visible band above a half sheet", () => {
    const [x, y] = mobileSelectCameraOffset(VH, "half");
    expect(x).toBe(0);
    // Visible mid ≈ (1 - 0.55) / 2 = 0.225 from top → offset ≈ 0.275 * VH
    expect(y).toBe(Math.round((0.5 - (1 - SHEET_SNAP_FRACTIONS.half) / 2) * VH));
    expect(y).toBeGreaterThan(0);
  });

  it("returns [0,0] for invalid heights", () => {
    expect(mobileSelectCameraOffset(0)).toEqual([0, 0]);
    expect(mobileSelectCameraOffset(-10)).toEqual([0, 0]);
  });
});

describe("resolveSheetSnap — no-velocity (nearest neighbour)", () => {
  it("stays at the same snap when there is no drag", () => {
    for (const snap of SHEET_SNAP_ORDER) {
      const result = resolveSheetSnap({
        currentSnap: snap,
        viewportHeight: VH,
        dragDeltaY: 0,
        velocity: 0,
      });
      expect(result).toEqual({ snap, dismissed: false });
    }
  });

  it("resolves to half when dragged from full roughly halfway down", () => {
    const fullY = sheetTranslateY("full", VH);
    const halfY = sheetTranslateY("half", VH);
    const result = resolveSheetSnap({
      currentSnap: "full",
      viewportHeight: VH,
      dragDeltaY: halfY - fullY,
      velocity: 0,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("resolves to full when dragged up from half toward full", () => {
    const fullY = sheetTranslateY("full", VH);
    const halfY = sheetTranslateY("half", VH);
    const result = resolveSheetSnap({
      currentSnap: "half",
      viewportHeight: VH,
      dragDeltaY: fullY - halfY,
      velocity: 0,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("dismisses when dragged well below peek without a flick", () => {
    const result = resolveSheetSnap({
      currentSnap: "peek",
      viewportHeight: VH,
      dragDeltaY: VH, // dragged the sheet fully off-screen, slowly
      velocity: 0,
    });
    expect(result).toEqual({ snap: "peek", dismissed: true });
  });

  it("does not dismiss on a small downward nudge from peek", () => {
    const result = resolveSheetSnap({
      currentSnap: "peek",
      viewportHeight: VH,
      dragDeltaY: 5,
      velocity: 0,
    });
    expect(result).toEqual({ snap: "peek", dismissed: false });
  });
});

describe("resolveSheetSnap — projected momentum", () => {
  it("a fast upward flick from peek can project through half to full", () => {
    const result = resolveSheetSnap({
      currentSnap: "peek",
      viewportHeight: VH,
      dragDeltaY: -10, // barely moved
      velocity: -1.2, // fast upward flick (negative = up)
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast upward flick from half jumps to full", () => {
    const result = resolveSheetSnap({
      currentSnap: "half",
      viewportHeight: VH,
      dragDeltaY: -10,
      velocity: -0.9,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast upward flick from full stays at full (already the max)", () => {
    const result = resolveSheetSnap({
      currentSnap: "full",
      viewportHeight: VH,
      dragDeltaY: -10,
      velocity: -0.8,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast downward flick from full drops to half, not all the way to peek", () => {
    const result = resolveSheetSnap({
      currentSnap: "full",
      viewportHeight: VH,
      dragDeltaY: 10,
      velocity: 0.8,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("a fast downward flick from half lands at peek instead of dismissing", () => {
    const result = resolveSheetSnap({
      currentSnap: "half",
      viewportHeight: VH,
      dragDeltaY: 10,
      velocity: 0.8,
    });
    expect(result).toEqual({ snap: "peek", dismissed: false });
  });

  it("a fast downward flick from peek dismisses the sheet", () => {
    const result = resolveSheetSnap({
      currentSnap: "peek",
      viewportHeight: VH,
      dragDeltaY: 10,
      velocity: 0.8,
    });
    expect(result).toEqual({ snap: "peek", dismissed: true });
  });

  it("a slow release just under the flick threshold uses nearest-neighbour, not the flick rule", () => {
    const fullY = sheetTranslateY("full", VH);
    const halfY = sheetTranslateY("half", VH);
    const result = resolveSheetSnap({
      currentSnap: "full",
      viewportHeight: VH,
      dragDeltaY: halfY - fullY,
      velocity: 0.49, // just below the 0.5 px/ms threshold
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });
});

describe("resolveSheetSnap — edge cases", () => {
  it("returns the current snap unchanged when viewportHeight is not positive", () => {
    const result = resolveSheetSnap({
      currentSnap: "half",
      viewportHeight: 0,
      dragDeltaY: 200,
      velocity: 2,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });
});

// The rebuilt phone portal sheet is bottom-anchored with a content-driven height
// capped by the snap's fraction of the viewport. The void is killed in CSS
// (height:auto; max-height:cap), so the only pure logic left is (a) the per-snap
// cap heights and (b) the height-drag → snap resolver.
describe("sheetSnapCaps — per-snap cap heights (bottom-anchored model)", () => {
  it("is the snap fraction of the viewport minus the bottom dock clearance", () => {
    const caps = sheetSnapCaps(800, 0);
    expect(caps.peek).toBeCloseTo(800 * SHEET_SNAP_FRACTIONS.peek);
    expect(caps.half).toBeCloseTo(800 * SHEET_SNAP_FRACTIONS.half);
    expect(caps.full).toBeCloseTo(800 * SHEET_SNAP_FRACTIONS.full);
    // full > half > peek, mirroring the ordered snaps.
    expect(caps.full).toBeGreaterThan(caps.half);
    expect(caps.half).toBeGreaterThan(caps.peek);
  });

  it("subtracts the dock clearance and never goes negative", () => {
    const caps = sheetSnapCaps(800, 100);
    expect(caps.half).toBeCloseTo(800 * SHEET_SNAP_FRACTIONS.half - 100);
    // A dock taller than the peek fraction clamps peek to 0 rather than negative.
    expect(sheetSnapCaps(800, 100_000).peek).toBe(0);
  });
});

describe("resolveSheetHeightSnap — no-velocity (nearest neighbour on height)", () => {
  const caps = sheetSnapCaps(800, 0); // peek 176, half 440, full 736

  it("stays at the same snap when there is no drag (start height = its cap)", () => {
    for (const snap of SHEET_SNAP_ORDER) {
      const result = resolveSheetHeightSnap({
        startSnap: snap,
        startHeightPx: caps[snap],
        releaseHeightPx: caps[snap],
        velocity: 0,
        caps,
      });
      expect(result).toEqual({ snap, dismissed: false });
    }
  });

  it("keeps a SHORT content-hugged half at half, not peek (start height in peek's band)", () => {
    // A hugged half sheet renders far shorter than half's cap — even shorter than
    // peek's cap. Absolute nearest-cap would mis-snap it to peek; the start-height
    // reference keeps a still finger on half.
    const hugged = 120; // < caps.peek (176)
    const result = resolveSheetHeightSnap({
      startSnap: "half",
      startHeightPx: hugged,
      releaseHeightPx: hugged,
      velocity: 0,
      caps,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("resolves to full when dragged up from half toward the full cap", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "half",
      startHeightPx: caps.half,
      releaseHeightPx: caps.full,
      velocity: 0,
      caps,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("resolves to half when dragged down from full toward the half cap", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "full",
      startHeightPx: caps.full,
      releaseHeightPx: caps.half,
      velocity: 0,
      caps,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("dismisses when collapsed well below peek without a flick", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "peek",
      startHeightPx: caps.peek,
      releaseHeightPx: caps.peek * 0.4, // below the half-a-peek dismiss line
      velocity: 0,
      caps,
    });
    expect(result).toEqual({ snap: "peek", dismissed: true });
  });

  it("does not dismiss on a small downward nudge from peek", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "peek",
      startHeightPx: caps.peek,
      releaseHeightPx: caps.peek - 5,
      velocity: 0,
      caps,
    });
    expect(result).toEqual({ snap: "peek", dismissed: false });
  });
});

describe("resolveSheetHeightSnap — projected momentum", () => {
  const caps = sheetSnapCaps(800, 0);

  it("a fast upward flick from peek can project through half to full", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "peek",
      startHeightPx: caps.peek,
      releaseHeightPx: caps.peek + 10, // barely grew
      velocity: 1.2, // fast growth (positive = up)
      caps,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast upward flick from half jumps to full", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "half",
      startHeightPx: caps.half,
      releaseHeightPx: caps.half + 10,
      velocity: 0.9,
      caps,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast upward flick from full stays at full (already the max)", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "full",
      startHeightPx: caps.full,
      releaseHeightPx: caps.full + 10,
      velocity: 0.8,
      caps,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast downward flick from full drops to half, not all the way to peek", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "full",
      startHeightPx: caps.full,
      releaseHeightPx: caps.full - 10,
      velocity: -0.8, // shrinking fast (negative = down)
      caps,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("a fast downward drag from half lands at peek instead of dismissing", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "half",
      startHeightPx: caps.half,
      releaseHeightPx: caps.half - 260,
      velocity: -0.8,
      caps,
    });
    expect(result).toEqual({ snap: "peek", dismissed: false });
  });

  it("a fast downward flick from peek dismisses the sheet", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "peek",
      startHeightPx: caps.peek,
      releaseHeightPx: caps.peek - 10,
      velocity: -0.8,
      caps,
    });
    expect(result).toEqual({ snap: "peek", dismissed: true });
  });

  it("a slow release just under the flick threshold uses nearest-neighbour, not the flick rule", () => {
    const result = resolveSheetHeightSnap({
      startSnap: "full",
      startHeightPx: caps.full,
      releaseHeightPx: caps.half,
      velocity: -0.49, // just below the 0.5 px/ms threshold
      caps,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });
});
