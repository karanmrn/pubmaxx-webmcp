import { describe, expect, it } from "vitest";

import { createCameraIntentCoordinator } from "@/lib/cameraIntent";

describe("camera intent coordinator", () => {
  it("coalesces competing intents so only the newest camera move runs", () => {
    const frames = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    const calls: string[] = [];
    let nextFrame = 1;
    const coordinator = createCameraIntentCoordinator({
      requestFrame: (callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      },
      cancelFrame: (id) => {
        cancelled.push(id);
        frames.delete(id);
      },
      now: () => 100,
    });

    coordinator.schedule("route", "route:a>b>c", () => calls.push("route"));
    coordinator.schedule("venue", "venue:d", () => calls.push("venue"));

    expect(cancelled).toEqual([1]);
    expect(frames.size).toBe(1);
    frames.get(2)?.(100);
    expect(calls).toEqual(["venue"]);
  });

  it("does not restart an equivalent settled animation inside the dedupe window", () => {
    let now = 100;
    let callback: FrameRequestCallback | null = null;
    const calls: string[] = [];
    const coordinator = createCameraIntentCoordinator({
      requestFrame: (next) => {
        callback = next;
        return 1;
      },
      cancelFrame: () => undefined,
      now: () => now,
      dedupeMs: 800,
    });

    coordinator.schedule("nearby", "nearby:51.50,-0.12", () => calls.push("first"));
    (callback as FrameRequestCallback | null)?.(now);
    coordinator.schedule("nearby", "nearby:51.50,-0.12", () => calls.push("duplicate"));
    expect(calls).toEqual(["first"]);

    now = 901;
    coordinator.schedule("nearby", "nearby:51.50,-0.12", () => calls.push("later"));
    (callback as FrameRequestCallback | null)?.(now);
    expect(calls).toEqual(["first", "later"]);
  });

  it("does not keep cancelling and rescheduling an equivalent pending intent", () => {
    let callback: FrameRequestCallback | null = null;
    const cancelled: number[] = [];
    const calls: string[] = [];
    const coordinator = createCameraIntentCoordinator({
      requestFrame: (next) => {
        callback = next;
        return 7;
      },
      cancelFrame: (id) => cancelled.push(id),
      now: () => 100,
    });

    expect(coordinator.schedule("route", "route:a>b>c", () => calls.push("first"))).toBe(true);
    expect(coordinator.schedule("route", "route:a>b>c", () => calls.push("duplicate"))).toBe(false);
    expect(cancelled).toEqual([]);
    (callback as FrameRequestCallback | null)?.(100);
    expect(calls).toEqual(["first"]);
  });

  it("disposal invalidates a queued callback even if the platform delivers it late", () => {
    let staleCallback: FrameRequestCallback | null = null;
    const calls: string[] = [];
    const coordinator = createCameraIntentCoordinator({
      requestFrame: (callback) => {
        staleCallback = callback;
        return 11;
      },
      cancelFrame: () => undefined,
      now: () => 100,
    });

    coordinator.schedule("route", "route:a>b>c", () => calls.push("route"));
    coordinator.dispose();
    (staleCallback as FrameRequestCallback | null)?.(100);

    expect(calls).toEqual([]);
  });

  it("reports only the latest competing intent with a monotonic sequence", () => {
    const frames = new Map<number, FrameRequestCallback>();
    const runs: Array<{ kind: string; sequence: number }> = [];
    let nextFrame = 1;
    const coordinator = createCameraIntentCoordinator({
      requestFrame: (callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      },
      cancelFrame: (id) => frames.delete(id),
      now: () => 100,
      onRun: (kind, sequence) => runs.push({ kind, sequence }),
    });

    coordinator.schedule("city", "city:london", () => undefined);
    coordinator.schedule("route", "route:a>b>c", () => undefined);
    frames.get(2)?.(100);
    coordinator.schedule("venue", "venue:d", () => undefined);
    frames.get(3)?.(100);

    expect(runs).toEqual([
      { kind: "route", sequence: 1 },
      { kind: "venue", sequence: 2 },
    ]);
  });

  it("ignores a superseded callback even if cancellation races with delivery", () => {
    const callbacks: FrameRequestCallback[] = [];
    const calls: string[] = [];
    const coordinator = createCameraIntentCoordinator({
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelFrame: () => undefined,
      now: () => 100,
    });

    coordinator.schedule("route", "route:a>b>c", () => calls.push("route"));
    coordinator.schedule("venue", "venue:d", () => calls.push("venue"));
    callbacks[0]?.(100);
    callbacks[1]?.(100);

    expect(calls).toEqual(["venue"]);
  });
});
