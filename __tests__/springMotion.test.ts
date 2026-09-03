import { describe, expect, it } from "vitest";

import {
  isSpringSettled,
  projectMomentum,
  stepSpring,
} from "@/lib/springMotion";

describe("stepSpring", () => {
  it("converges without overshoot when critically damped", () => {
    let state = { value: 0, velocity: 0 };
    const values: number[] = [];

    for (let frame = 0; frame < 120; frame += 1) {
      state = stepSpring(state, 100, 1 / 60, {
        response: 0.34,
        dampingRatio: 1,
      });
      values.push(state.value);
    }

    expect(values.every((value) => value >= 0 && value <= 100.01)).toBe(true);
    expect(isSpringSettled(state, 100)).toBe(true);
  });

  it("hands release velocity into the first spring frame", () => {
    const moving = stepSpring(
      { value: 200, velocity: 700 },
      600,
      1 / 60,
      { response: 0.34, dampingRatio: 0.8 },
    );
    const still = stepSpring(
      { value: 200, velocity: 0 },
      600,
      1 / 60,
      { response: 0.34, dampingRatio: 0.8 },
    );

    expect(moving.value).toBeGreaterThan(still.value);
  });

  it("bounds long frames so a resumed tab remains finite", () => {
    const state = stepSpring(
      { value: 0, velocity: 1200 },
      100,
      5,
      { response: 0.34, dampingRatio: 1 },
    );

    expect(Number.isFinite(state.value)).toBe(true);
    expect(Number.isFinite(state.velocity)).toBe(true);
    expect(state.value).toBeGreaterThanOrEqual(0);
    expect(state.value).toBeLessThanOrEqual(100);
  });

  it("finishes a critically damped transition after a long delayed frame", () => {
    const state = stepSpring(
      { value: 600, velocity: 0 },
      0,
      5,
      { response: 0.34, dampingRatio: 1 },
    );

    expect(isSpringSettled(state, 0)).toBe(true);
  });
});

describe("projectMomentum", () => {
  it("projects release velocity into a farther endpoint", () => {
    expect(projectMomentum(200, 0.8, 0.998)).toBeGreaterThan(500);
    expect(projectMomentum(200, -0.8, 0.998)).toBeLessThan(0);
  });

  it("keeps a still release at its current position", () => {
    expect(projectMomentum(312, 0, 0.998)).toBe(312);
  });
});
