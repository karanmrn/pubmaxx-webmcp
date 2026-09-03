import { describe, expect, it } from "vitest";

// Pure gate logic for the native-shell first-run redirect to onboarding
// (lib/nativeFirstRun.ts). Must never route on the web, must never route
// twice, and must never override a viewer who already has a preferred-city
// choice persisted (has state).
import {
  NATIVE_FIRST_RUN_HANDOFF_MAX_AGE_MS,
  clearNativeFirstRunHandoff,
  consumeNativeFirstRunHandoff,
  issueNativeFirstRunHandoff,
  shouldRouteNativeFirstRun,
} from "@/lib/nativeFirstRun";

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("shouldRouteNativeFirstRun", () => {
  it("never routes on the web", () => {
    expect(
      shouldRouteNativeFirstRun({
        isNative: false,
        alreadyRouted: false,
        hasCityPreference: false,
      }),
    ).toBe(false);
  });

  it("routes on a genuine first native launch with no city preference", () => {
    expect(
      shouldRouteNativeFirstRun({
        isNative: true,
        alreadyRouted: false,
        hasCityPreference: false,
      }),
    ).toBe(true);
  });

  it("does not route again once it has already fired", () => {
    expect(
      shouldRouteNativeFirstRun({
        isNative: true,
        alreadyRouted: true,
        hasCityPreference: false,
      }),
    ).toBe(false);
  });

  it("does not route when the viewer already has a preferred city (has state)", () => {
    expect(
      shouldRouteNativeFirstRun({
        isNative: true,
        alreadyRouted: false,
        hasCityPreference: true,
      }),
    ).toBe(false);
  });

  it("does not route when both already-routed and city-preference state exist", () => {
    expect(
      shouldRouteNativeFirstRun({
        isNative: true,
        alreadyRouted: true,
        hasCityPreference: true,
      }),
    ).toBe(false);
  });
});

describe("native first-run eligibility handoff", () => {
  it("is native-only, one-time and fresh", () => {
    const storage = makeMemoryStorage();
    issueNativeFirstRunHandoff(storage, 1_000);
    expect(consumeNativeFirstRunHandoff(false, storage, 1_001)).toBe(false);
    expect(storage.length).toBe(0);

    issueNativeFirstRunHandoff(storage, 2_000);
    expect(consumeNativeFirstRunHandoff(true, storage, 2_001)).toBe(true);
    expect(consumeNativeFirstRunHandoff(true, storage, 2_002)).toBe(false);
  });

  it("rejects expired, future and cleared handoffs", () => {
    const storage = makeMemoryStorage();
    issueNativeFirstRunHandoff(storage, 1_000);
    expect(
      consumeNativeFirstRunHandoff(
        true,
        storage,
        1_000 + NATIVE_FIRST_RUN_HANDOFF_MAX_AGE_MS + 1,
      ),
    ).toBe(false);

    issueNativeFirstRunHandoff(storage, 5_000);
    expect(consumeNativeFirstRunHandoff(true, storage, 4_999)).toBe(false);

    issueNativeFirstRunHandoff(storage, 7_000);
    clearNativeFirstRunHandoff(storage);
    expect(consumeNativeFirstRunHandoff(true, storage, 7_001)).toBe(false);
  });
});
