import { describe, expect, it } from "vitest";

import {
  invalidateUkBaseStreamToken,
  nextUkBaseStreamToken,
  parseUkBaseRestoreResponse,
  ukBaseStreamModeIsCurrent,
  visibleUkBaseStreamState,
} from "@/components/map/pubmap/useUkBaseStreaming";

describe("nextUkBaseStreamToken", () => {
  it("invalidates an in-flight request before declining a below-gate stream", () => {
    const generation = { current: 4 };
    const inFlightToken = generation.current;

    expect(nextUkBaseStreamToken(generation, 10, 13)).toBeNull();
    expect(generation.current).toBe(5);
    expect(inFlightToken).not.toBe(generation.current);
  });

  it("invalidates an active viewport read as soon as another camera settle is queued", () => {
    const generation = { current: 0 };
    const activeToken = nextUkBaseStreamToken(generation, 12, 12);

    invalidateUkBaseStreamToken(generation);

    expect(activeToken).toBe(1);
    expect(generation.current).toBe(2);
    expect(activeToken).not.toBe(generation.current);
  });
});

describe("visibleUkBaseStreamState", () => {
  const published = {
    scopeKey: "london",
    status: "ready" as const,
    count: 2,
    pubs: [],
  };

  it("reports loading with no old rows while a new city scope takes over", () => {
    expect(visibleUkBaseStreamState(published, "manchester", false)).toEqual({
      status: "loading",
      count: 0,
      pubs: [],
    });
  });

  it("returns one stable empty state while a drink lens suspends base pubs", () => {
    const first = visibleUkBaseStreamState(published, "london", true);
    const second = visibleUkBaseStreamState(published, "london", true);

    expect(first).toBe(second);
    expect(first).toEqual({ status: "suspended", count: 0, pubs: [] });
  });
});

describe("ukBaseStreamModeIsCurrent", () => {
  it("drops a deferred read after scope or suspension changes", async () => {
    const current = { scopeKey: "london", suspended: false };
    const requested = { ...current };
    let settle: (() => void) | undefined;
    const deferred = new Promise<void>((resolve) => {
      settle = resolve;
    }).then(() => ukBaseStreamModeIsCurrent(current, requested));

    current.scopeKey = "manchester";
    settle?.();
    await expect(deferred).resolves.toBe(false);

    current.scopeKey = "london";
    current.suspended = true;
    expect(ukBaseStreamModeIsCurrent(current, requested)).toBe(false);
  });
});

describe("parseUkBaseRestoreResponse (streaming module export)", () => {
  it("is exported for cold-restore wiring tests", () => {
    expect(
      parseUkBaseRestoreResponse(
        {
          pub: {
            id: "venue-uk-n9",
            name: "The Test",
            address: "",
            lat: 51.5,
            lng: -0.1,
            curatedVenueId: "",
          },
        },
        "venue-uk-n9",
      )?.name,
    ).toBe("The Test");
  });
});
