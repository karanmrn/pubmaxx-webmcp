import type { Page, Request } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { aggregatePerfMetric, waitForQuietNetwork } from "../e2e/helpers/perfMeasurement";

type RequestEvent = "request" | "requestfinished" | "requestfailed";

function fakePage() {
  const listeners = new Map<RequestEvent, Array<(request: Request) => void>>();
  const page = {
    on(event: RequestEvent, listener: (request: Request) => void) {
      const registered = listeners.get(event) ?? [];
      registered.push(listener);
      listeners.set(event, registered);
      return page;
    },
  };
  return {
    page: page as unknown as Page,
    emit(event: RequestEvent, request = {} as Request) {
      for (const listener of listeners.get(event) ?? []) listener(request);
    },
  };
}

describe("waitForQuietNetwork", () => {
  afterEach(() => vi.useRealTimers());

  it("returns after a fully idle quiet window", async () => {
    vi.useFakeTimers();
    const harness = fakePage();
    const waiting = waitForQuietNetwork(harness.page);

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(waiting).resolves.toBeUndefined();
  });

  it("fails when a request remains in flight through the ceiling", async () => {
    vi.useFakeTimers();
    const harness = fakePage();
    const waiting = waitForQuietNetwork(harness.page);
    const rejection = expect(waiting).rejects.toThrow(
      "Network did not drain within 20000ms (1 request(s) still active).",
    );
    harness.emit("request");

    await vi.advanceTimersByTimeAsync(20_200);

    await rejection;
  });

  it("allows the final quiet window when a request drains just before the ceiling", async () => {
    vi.useFakeTimers();
    const harness = fakePage();
    const request = {} as Request;
    const waiting = waitForQuietNetwork(harness.page);
    harness.emit("request", request);

    await vi.advanceTimersByTimeAsync(19_000);
    harness.emit("requestfinished", request);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(waiting).resolves.toBeUndefined();
  });
});

describe("performance measurement aggregation", () => {
  it("keeps an absent metric unmeasured instead of treating it as zero", () => {
    expect(Number.isNaN(aggregatePerfMetric([Number.NaN, 700, 710]))).toBe(true);
  });
});
