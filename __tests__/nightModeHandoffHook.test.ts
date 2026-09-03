import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  stateValues: [] as unknown[],
  cleanups: [] as Array<() => void>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect();
      if (cleanup) harness.cleanups.push(cleanup);
    },
    useState: <T,>(initial: T | (() => T)) => {
      const index = 0;
      if (!(index in harness.stateValues)) {
        harness.stateValues[index] = typeof initial === "function"
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
  };
});

import {
  requestNightModeEndingHandoff,
  useNightModeEndingOwner,
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

function useOwnerHarness() {
  return useNightModeEndingOwner(PLAN_ID);
}

describe("useNightModeEndingOwner", () => {
  beforeEach(() => {
    harness.stateValues.length = 0;
    harness.cleanups.length = 0;
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { sessionStorage: memoryStorage() }),
    );
  });

  afterEach(() => {
    for (const cleanup of harness.cleanups.splice(0)) cleanup();
    vi.unstubAllGlobals();
  });

  it("opens immediately when a delayed final-stop handoff is waiting", () => {
    requestNightModeEndingHandoff(PLAN_ID);

    expect(useOwnerHarness().expanded).toBe(true);
  });

  it("opens the mounted ending owner on a live handoff", () => {
    expect(useOwnerHarness().expanded).toBe(false);

    requestNightModeEndingHandoff(PLAN_ID);

    expect(useOwnerHarness().expanded).toBe(true);
  });
});
