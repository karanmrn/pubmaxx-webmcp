import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeNightModeEndingHandoff,
  requestNightModeEndingFromFlush,
  requestNightModeEndingFromPlan,
  requestNightModeEndingHandoff,
  subscribeNightModeEndingHandoff,
} from "@/lib/nightModeHandoff";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

function memoryStorage(): Storage {
  const rows = new Map<string, string>();
  return {
    get length() {
      return rows.size;
    },
    clear: () => rows.clear(),
    getItem: (key) => rows.get(key) ?? null,
    key: (index) => [...rows.keys()][index] ?? null,
    removeItem: (key) => {
      rows.delete(key);
    },
    setItem: (key, value) => {
      rows.set(key, value);
    },
  };
}

describe("Night Mode ending handoff", () => {
  beforeEach(() => {
    const target = new EventTarget();
    vi.stubGlobal("window", Object.assign(target, { sessionStorage: memoryStorage() }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens the matching ending owner and consumes the durable handoff", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNightModeEndingHandoff(PLAN_ID, listener);

    requestNightModeEndingHandoff(PLAN_ID);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeNightModeEndingHandoff(PLAN_ID)).toBe(false);
    unsubscribe();
  });

  it("keeps a handoff until the ending owner mounts", () => {
    requestNightModeEndingHandoff(PLAN_ID);

    expect(consumeNightModeEndingHandoff(PLAN_ID)).toBe(true);
    expect(consumeNightModeEndingHandoff(PLAN_ID)).toBe(false);
  });

  it("does not wake a different Plan", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNightModeEndingHandoff(PLAN_ID, listener);

    requestNightModeEndingHandoff("22222222-2222-4222-8222-222222222222");

    expect(listener).not.toHaveBeenCalled();
    expect(consumeNightModeEndingHandoff(PLAN_ID)).toBe(false);
    unsubscribe();
  });

  it("persists a delayed final-stop confirmation from the site-wide outbox", () => {
    expect(
      requestNightModeEndingFromFlush({
        planId: PLAN_ID,
        entryId: "final-arrival",
        outcome: "confirmed",
        plan: {
          plan: {
            id: PLAN_ID,
            title: "Test crawl",
            startTime: "2026-08-30T20:00:00.000Z",
            createdAt: "2026-08-30T18:00:00.000Z",
          },
          stops: [
            { venueId: "venue-1", venueName: "First Arms", position: 0 },
            { venueId: "venue-2", venueName: "Last Arms", position: 1 },
          ],
          crew: [],
          actions: [
            {
              id: "final-arrival",
              type: "arrived",
              stopPosition: 1,
              ending: null,
              createdAt: "2026-08-30T22:00:00.000Z",
            },
          ],
        },
        type: "arrived",
        stopPosition: 1,
        previousCursor: 1,
        optimisticCursor: 1,
        venueName: "Last Arms",
      }),
    ).toBe(true);
    expect(consumeNightModeEndingHandoff(PLAN_ID)).toBe(true);
  });

  it("ignores non-final and unconfirmed outbox results", () => {
    const base = {
      planId: PLAN_ID,
      entryId: "arrival",
      plan: {
        plan: {
          id: PLAN_ID,
          title: "Test crawl",
          startTime: "2026-08-30T20:00:00.000Z",
          createdAt: "2026-08-30T18:00:00.000Z",
        },
        stops: [
          { venueId: "venue-1", venueName: "First Arms", position: 0 },
          { venueId: "venue-2", venueName: "Last Arms", position: 1 },
        ],
        crew: [],
        actions: [],
      },
      type: "arrived" as const,
      previousCursor: 0,
      optimisticCursor: 1,
      venueName: "First Arms",
    };

    expect(
      requestNightModeEndingFromFlush({
        ...base,
        outcome: "confirmed",
        stopPosition: 0,
      }),
    ).toBe(false);
    expect(
      requestNightModeEndingFromFlush({
        ...base,
        outcome: "offline",
        stopPosition: 1,
      }),
    ).toBe(false);
    expect(consumeNightModeEndingHandoff(PLAN_ID)).toBe(false);
  });

  it("recovers the ending handoff from fresh canonical Plan actions", () => {
    const plan = {
      plan: {
        id: PLAN_ID,
        title: "Test crawl",
        startTime: "2026-08-30T20:00:00.000Z",
        createdAt: "2026-08-30T18:00:00.000Z",
        status: "active" as const,
      },
      stops: [
        { venueId: "venue-1", venueName: "First Arms", position: 0 },
        { venueId: "venue-2", venueName: "Last Arms", position: 1 },
      ],
      crew: [],
      actions: [
        {
          id: "final-arrival",
          type: "arrived" as const,
          stopPosition: 1,
          ending: null,
          createdAt: "2026-08-30T22:00:00.000Z",
        },
      ],
    };

    expect(requestNightModeEndingFromPlan(plan)).toBe(true);
    expect(consumeNightModeEndingHandoff(PLAN_ID)).toBe(true);
    expect(
      requestNightModeEndingFromPlan({
        ...plan,
        plan: { ...plan.plan, status: "completed" as const },
      }),
    ).toBe(false);
  });

  it("does not recover an ending when every Crawl Stop was skipped", () => {
    const plan = {
      plan: {
        id: PLAN_ID,
        title: "Test crawl",
        startTime: "2026-08-30T20:00:00.000Z",
        createdAt: "2026-08-30T18:00:00.000Z",
        status: "active" as const,
      },
      stops: [{ venueId: "venue-1", venueName: "Only Arms", position: 0 }],
      crew: [],
      actions: [
        {
          id: "final-skip",
          type: "skipped" as const,
          stopPosition: 0,
          ending: null,
          createdAt: "2026-08-30T22:00:00.000Z",
        },
      ],
    };

    expect(requestNightModeEndingFromPlan(plan)).toBe(false);
    expect(consumeNightModeEndingHandoff(PLAN_ID)).toBe(false);
  });
});
