import { describe, expect, it } from "vitest";
import {
  createIdleOrbit,
  orbitBearingStep,
  shouldPublishOrbitViewport,
} from "@/lib/mapOrbit";

const FIRST_MS = 6_000;
const INTERACTION_MS = 20_000;
const FRAME_MS = 250;

function harness({ reduced = false }: { reduced?: boolean } = {}) {
  let nextId = 1;
  const timers = new Map<number, { callback: () => void; ms: number }>();
  const calls: string[] = [];
  const armedDelays: number[] = [];
  let isReduced = reduced;

  const orbit = createIdleOrbit({
    firstDelayMs: FIRST_MS,
    interactionDelayMs: INTERACTION_MS,
    frameIntervalMs: FRAME_MS,
    isReduced: () => isReduced,
    startStep: () => calls.push("start"),
    stop: () => calls.push("stop"),
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { callback, ms });
      armedDelays.push(ms);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });

  return {
    orbit,
    calls,
    timers,
    armedDelays,
    setReduced(value: boolean) {
      isReduced = value;
    },
    fireTimer() {
      const entry = timers.entries().next().value as
        | [number, { callback: () => void; ms: number }]
        | undefined;
      if (!entry) throw new Error("no timer armed");
      timers.delete(entry[0]);
      entry[1].callback();
      return entry[1].ms;
    },
  };
}

describe("idle orbit state machine", () => {
  it("waits for first idle, then advances at capped frame intervals", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    expect(h.orbit.state()).toBe("waiting");
    expect(h.fireTimer()).toBe(FIRST_MS);
    expect(h.orbit.state()).toBe("orbiting");
    expect(h.calls).toEqual(["start"]);

    expect(h.fireTimer()).toBe(FRAME_MS);
    expect(h.calls).toEqual(["start", "start"]);
    expect([...h.timers.values()].map(({ ms }) => ms)).toEqual([FRAME_MS]);
  });

  it("stops instantly on interaction and replaces active frame with idle timer", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    h.fireTimer();
    expect([...h.timers.values()].map(({ ms }) => ms)).toEqual([FRAME_MS]);

    h.orbit.noteInteraction();
    expect(h.calls).toEqual(["start", "stop"]);
    expect(h.orbit.state()).toBe("waiting");
    expect([...h.timers.values()].map(({ ms }) => ms)).toEqual([INTERACTION_MS]);
  });

  it("interaction while waiting resets delay without a stop call", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    h.orbit.noteInteraction();
    expect(h.calls).toEqual([]);
    expect([...h.timers.values()].map(({ ms }) => ms)).toEqual([INTERACTION_MS]);
  });

  it("never orbits for reduced-motion users, including a live change", () => {
    const reduced = harness({ reduced: true });
    reduced.orbit.setEnabled(true);
    expect(reduced.orbit.state()).toBe("off");
    expect(reduced.timers.size).toBe(0);

    const live = harness();
    live.orbit.setEnabled(true);
    live.fireTimer();
    live.setReduced(true);
    live.orbit.refreshGate();
    expect(live.orbit.state()).toBe("off");
    expect(live.calls).toEqual(["start", "stop"]);
    expect(live.timers.size).toBe(0);
  });

  it("suspends for hidden or off-screen canvas and resumes with correct delay", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    h.fireTimer();
    h.orbit.setSuspended(true);
    expect(h.calls).toEqual(["start", "stop"]);
    expect(h.orbit.state()).toBe("suspended");
    expect(h.timers.size).toBe(0);

    h.orbit.setSuspended(false);
    expect(h.orbit.state()).toBe("waiting");
    expect([...h.timers.values()].map(({ ms }) => ms)).toEqual([FIRST_MS]);
  });

  it("uses the longer delay after any interaction, including suspend resume", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    h.fireTimer();
    h.orbit.noteInteraction();
    h.orbit.setSuspended(true);
    h.orbit.setSuspended(false);
    expect(h.armedDelays).toEqual([
      FIRST_MS,
      FRAME_MS,
      INTERACTION_MS,
      INTERACTION_MS,
    ]);
  });

  it("disable stops active orbit and dispose is terminal", () => {
    const h = harness();
    h.orbit.setEnabled(true);
    h.fireTimer();
    h.orbit.setEnabled(false);
    expect(h.calls).toEqual(["start", "stop"]);
    expect(h.orbit.state()).toBe("off");
    expect(h.timers.size).toBe(0);

    h.orbit.dispose();
    h.orbit.setEnabled(true);
    expect(h.timers.size).toBe(0);
  });
});

describe("orbit bearing step", () => {
  it("converts speed and frame interval into a bearing delta", () => {
    expect(orbitBearingStep(0.6, 250, 0.2)).toBeCloseTo(0.15);
  });

  it("caps an oversized bearing delta", () => {
    expect(orbitBearingStep(4, 250, 0.2)).toBe(0.2);
  });
});

describe("orbit viewport publishing", () => {
  it("publishes every non-orbit camera move", () => {
    expect(shouldPublishOrbitViewport(false, 1_000, 1_001, 1_000)).toBe(true);
  });

  it("debounces orbit moves until publish interval passes", () => {
    expect(shouldPublishOrbitViewport(true, 1_000, 1_999, 1_000)).toBe(false);
    expect(shouldPublishOrbitViewport(true, 1_000, 2_000, 1_000)).toBe(true);
  });
});
