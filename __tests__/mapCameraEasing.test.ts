import { describe, expect, it } from "vitest";

import {
  easeOutCubic,
  PUB_SELECT_PITCH,
  PUB_SELECT_DURATION_MS,
  LONG_JUMP_CURVE,
} from "@/components/map/canvas/easing";

describe("easeOutCubic", () => {
  it("maps the endpoints exactly", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("clamps out-of-range input", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("front-loads progress (ease-out: fast start, gentle settle)", () => {
    // At t=0.5 an ease-out cubic should already be well past the midpoint —
    // that's the "lean-in" feel: quick initial motion, soft arrival.
    const midway = easeOutCubic(0.5);
    expect(midway).toBeGreaterThan(0.5);
    expect(midway).toBeLessThan(1);
  });

  it("is monotonically non-decreasing", () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      const value = easeOutCubic(t);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });
});

describe("M3 camera choreography constants", () => {
  it("keeps the pub-select pitch within the PRD's 35-45deg lean-in", () => {
    expect(PUB_SELECT_PITCH).toBeGreaterThanOrEqual(35);
    expect(PUB_SELECT_PITCH).toBeLessThanOrEqual(45);
  });

  it("keeps the pub-select duration within the PRD's 600-800ms window", () => {
    expect(PUB_SELECT_DURATION_MS).toBeGreaterThanOrEqual(600);
    expect(PUB_SELECT_DURATION_MS).toBeLessThanOrEqual(800);
  });

  it("uses the PRD's 1.42 curve for long jumps", () => {
    expect(LONG_JUMP_CURVE).toBeCloseTo(1.42);
  });
});
