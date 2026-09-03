import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

const harness = vi.hoisted(() => ({
  stateCursor: 0,
  stateValues: [] as unknown[],
  stateOverrides: { 4: true, 5: true, 6: true } as Record<number, unknown>,
  activeCursor: 0,
  setActiveCursor: vi.fn(),
  mutationKey: vi.fn(),
  clearMutationKey: vi.fn(),
  enqueue: vi.fn(),
  flush: vi.fn(),
  hasPending: vi.fn(),
  handoff: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useEffect: () => undefined,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: <T,>(initial: T | (() => T)) => {
      const index = harness.stateCursor;
      harness.stateCursor += 1;
      if (!(index in harness.stateValues)) {
        harness.stateValues[index] = index in harness.stateOverrides
          ? harness.stateOverrides[index]
          : typeof initial === "function"
            ? (initial as () => T)()
            : initial;
      }
      const setState = (next: T | ((previous: T) => T)) => {
        const previous = harness.stateValues[index] as T;
        harness.stateValues[index] = typeof next === "function"
          ? (next as (value: T) => T)(previous)
          : next;
      };
      return [harness.stateValues[index] as T, setState];
    },
    useSyncExternalStore: (
      _subscribe: (listener: () => void) => () => void,
      getSnapshot: () => unknown,
    ) => getSnapshot(),
  };
});

vi.mock("@/lib/activePlan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/activePlan")>();
  return {
    ...actual,
    readActivePlan: () => ({
      id: PLAN_ID,
      startTime: "2026-08-05T20:00:00.000Z",
      stopIndex: harness.activeCursor,
    }),
    setActivePlanStopIndex: harness.setActiveCursor,
    subscribeActivePlan: () => () => undefined,
  };
});

vi.mock("@/lib/planMutationKey", () => ({
  persistentPlanMutationKey: harness.mutationKey,
  clearPersistentPlanMutationKey: harness.clearMutationKey,
}));

vi.mock("@/lib/nightModeHandoff", () => ({
  requestNightModeEndingHandoff: harness.handoff,
}));

vi.mock("@/lib/planMutationOutbox", () => ({
  enqueueNightCrawlAction: harness.enqueue,
  flushPlanMutationOutbox: harness.flush,
  hasPendingPlanMutation: harness.hasPending,
  subscribePlanMutationOutbox: () => () => undefined,
}));

vi.mock("@/lib/planSessionCapability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planSessionCapability")>();
  return {
    ...actual,
    parsePlanCapabilitySnapshot: () => ({
      token: "member-token",
      collaborationAuthorized: true,
      role: "host",
    }),
    planCapabilityEvent: () => "plan-capability",
    readPlanCapabilitySnapshot: () => "member-token|1|host",
    restorePlanCapability: vi.fn(),
  };
});

import NightCrawlMode from "@/components/plan/NightCrawlMode";
import type { PlanState } from "@/lib/plan";

const PLAN: PlanState = {
  plan: {
    id: PLAN_ID,
    title: "Test crawl",
    startTime: "2026-08-05T20:00:00.000Z",
    createdAt: "2026-08-05T18:00:00.000Z",
  },
  stops: [
    { venueId: "venue-0", venueName: "First Arms", position: 0 },
    { venueId: "venue-1", venueName: "Second Arms", position: 1 },
  ],
  crew: [],
  actions: [],
};

function renderMode(): ReactElement | null {
  harness.stateCursor = 0;
  return NightCrawlMode({ planId: PLAN_ID, initialState: PLAN });
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!isValidElement(node)) return "";
  return textOf((node.props as { children?: ReactNode }).children);
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean,
): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;
  return findElement((node.props as { children?: ReactNode }).children, predicate);
}

beforeEach(() => {
  harness.stateCursor = 0;
  harness.stateValues.length = 0;
  harness.activeCursor = 0;
  harness.setActiveCursor.mockReset();
  harness.setActiveCursor.mockImplementation((index: number) => {
    harness.activeCursor = index;
  });
  harness.mutationKey.mockReset();
  harness.mutationKey.mockResolvedValue("retry-key");
  harness.clearMutationKey.mockReset();
  harness.enqueue.mockReset();
  harness.enqueue.mockResolvedValue({ id: `night-crawl-action:${PLAN_ID}:arrived:0` });
  harness.flush.mockReset();
  harness.hasPending.mockReset();
  harness.hasPending.mockReturnValue(false);
  harness.handoff.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NightCrawlMode failed action reconciliation", () => {
  it("keeps the advance when offline and the outbox queued the mutation", async () => {
    harness.flush.mockResolvedValue([
      { planId: PLAN_ID, entryId: `night-crawl-action:${PLAN_ID}:arrived:0`, outcome: "offline" },
    ]);
    harness.hasPending.mockReturnValue(true);

    const firstRender = renderMode();
    const arrive = findElement(
      firstRender,
      (element) => element.type === "button" && textOf(element).includes("We are here"),
    );

    expect(arrive).not.toBeNull();
    await (arrive?.props as { onClick: () => Promise<void> }).onClick();

    await vi.waitFor(() => {
      expect(harness.setActiveCursor.mock.calls.at(-1)).toEqual([1]);
      expect(harness.enqueue).toHaveBeenCalled();
      expect(harness.flush).toHaveBeenCalledWith({ planId: PLAN_ID });
    });
    expect(harness.clearMutationKey).not.toHaveBeenCalled();
    // note state slot (useState index 3) holds the pending copy
    expect(harness.stateValues[3]).toEqual({
      text: "Held on this phone. We will try again when you have signal.",
      tone: "pending",
    });
    expect(String((harness.stateValues[3] as { text: string }).text)).not.toMatch(/will sync/i);
  });

  it("restores cursor after a conflict response", async () => {
    harness.flush.mockResolvedValue([
      { planId: PLAN_ID, entryId: `night-crawl-action:${PLAN_ID}:arrived:0`, outcome: "conflict" },
    ]);

    const firstRender = renderMode();
    const arrive = findElement(
      firstRender,
      (element) => element.type === "button" && textOf(element).includes("We are here"),
    );

    expect(arrive).not.toBeNull();
    await (arrive?.props as { onClick: () => Promise<void> }).onClick();

    await vi.waitFor(() => {
      expect(harness.setActiveCursor).toHaveBeenCalledWith(1);
      expect(harness.setActiveCursor).toHaveBeenCalledWith(0);
      expect(harness.activeCursor).toBe(0);
    });
    expect(harness.clearMutationKey).toHaveBeenCalled();

    const settledRender = renderMode();
    expect(textOf(settledRender)).toContain("Stop 1 of 2");
    expect(textOf(settledRender)).toContain("First Arms");
    const status = findElement(
      settledRender,
      (element) => (element.props as { role?: string }).role === "status",
    );
    expect(textOf(status)).toBe("That did not save. Try again when you have signal.");
  });
});

describe("NightCrawlMode final-stop handoff", () => {
  it("opens the existing ending owner after the final Stop action confirms", async () => {
    harness.activeCursor = 1;
    harness.enqueue.mockResolvedValue({
      id: `night-crawl-action:${PLAN_ID}:arrived:1`,
    });
    harness.flush.mockResolvedValue([
      {
        planId: PLAN_ID,
        entryId: `night-crawl-action:${PLAN_ID}:arrived:1`,
        outcome: "confirmed",
        plan: {
          ...PLAN,
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
      },
    ]);

    const firstRender = renderMode();
    const arrive = findElement(
      firstRender,
      (element) => element.type === "button" && textOf(element).includes("We are here"),
    );

    expect(arrive).not.toBeNull();
    await (arrive?.props as { onClick: () => Promise<void> }).onClick();

    await vi.waitFor(() => {
      expect(harness.handoff).toHaveBeenCalledWith(PLAN_ID);
    });
  });

  it("keeps an all-skipped Crawl open and tells the crew to check in once", async () => {
    harness.activeCursor = 1;
    harness.enqueue.mockResolvedValue({
      id: `night-crawl-action:${PLAN_ID}:skipped:1`,
    });
    harness.flush.mockResolvedValue([
      {
        planId: PLAN_ID,
        entryId: `night-crawl-action:${PLAN_ID}:skipped:1`,
        outcome: "confirmed",
        plan: {
          ...PLAN,
          actions: [
            {
              id: "final-skip",
              type: "skipped",
              stopPosition: 1,
              ending: null,
              createdAt: "2026-08-30T22:00:00.000Z",
            },
          ],
        },
        type: "skipped",
        stopPosition: 1,
      },
    ]);

    const firstRender = renderMode();
    const skip = findElement(
      firstRender,
      (element) => element.type === "button" && textOf(element).includes("Skip it"),
    );

    expect(skip).not.toBeNull();
    await (skip?.props as { onClick: () => Promise<void> }).onClick();

    await vi.waitFor(() => {
      expect(harness.handoff).not.toHaveBeenCalled();
      expect(harness.stateValues[3]).toEqual({
        text: "Check in at one stop before finishing the night.",
        tone: "guidance",
      });
    });
  });
});
