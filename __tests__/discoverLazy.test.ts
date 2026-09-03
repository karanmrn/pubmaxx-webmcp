import { describe, expect, it, vi } from "vitest";

import {
  runDiscoverAnalysisLoad,
  scheduleDiscoverAnalysisLoad,
  type DiscoverLazyWindow,
} from "@/lib/discoverLazy";

describe("scheduleDiscoverAnalysisLoad", () => {
  it("observes the analysis target without starting immediately", () => {
    const start = vi.fn();
    const target = {} as Element;
    const observe = vi.fn();
    const disconnect = vi.fn();
    let callback: IntersectionObserverCallback | undefined;

    class MockIntersectionObserver {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }

      observe = observe;
      disconnect = disconnect;
    }

    const win: DiscoverLazyWindow = {
      IntersectionObserver:
        MockIntersectionObserver as unknown as typeof IntersectionObserver,
    };

    const cleanup = scheduleDiscoverAnalysisLoad({ start, target, win });

    expect(start).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith(target);

    callback?.(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(start).not.toHaveBeenCalled();

    callback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);

    cleanup();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("keeps an idle fallback armed even while observing the target", () => {
    const start = vi.fn();
    const target = {} as Element;
    let observerCallback: IntersectionObserverCallback | undefined;
    let idleCallback: IdleRequestCallback | undefined;
    const disconnect = vi.fn();
    const cancelIdleCallback = vi.fn();

    class MockIntersectionObserver {
      constructor(cb: IntersectionObserverCallback) {
        observerCallback = cb;
      }

      observe = vi.fn();
      disconnect = disconnect;
    }

    const win: DiscoverLazyWindow = {
      IntersectionObserver:
        MockIntersectionObserver as unknown as typeof IntersectionObserver,
      requestIdleCallback: vi.fn((cb: IdleRequestCallback) => {
        idleCallback = cb;
        return 7;
      }),
      cancelIdleCallback,
    };

    scheduleDiscoverAnalysisLoad({ start, target, win });

    expect(win.requestIdleCallback).toHaveBeenCalledTimes(1);

    observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    expect(start).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);

    idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("falls back to requestIdleCallback when no target can be observed", () => {
    const start = vi.fn();
    let idleCallback: IdleRequestCallback | undefined;

    const win: DiscoverLazyWindow = {
      requestIdleCallback: vi.fn((cb: IdleRequestCallback) => {
        idleCallback = cb;
        return 4;
      }),
      cancelIdleCallback: vi.fn(),
    };

    scheduleDiscoverAnalysisLoad({ start, target: null, win });

    expect(start).not.toHaveBeenCalled();
    idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending fallback timeout on cleanup", () => {
    const start = vi.fn();
    const win: DiscoverLazyWindow = {
      setTimeout: vi.fn(() => 9),
      clearTimeout: vi.fn(),
    };

    const cleanup = scheduleDiscoverAnalysisLoad({ start, target: null, win });
    cleanup();

    expect(start).not.toHaveBeenCalled();
    expect(win.clearTimeout).toHaveBeenCalledWith(9);
  });

  it("uses a timeout fallback while observing when requestIdleCallback is unavailable", () => {
    const start = vi.fn();
    const target = {} as Element;
    let observerCallback: IntersectionObserverCallback | undefined;
    let timeoutCallback: (() => void) | undefined;

    class MockIntersectionObserver {
      constructor(cb: IntersectionObserverCallback) {
        observerCallback = cb;
      }

      observe = vi.fn();
      disconnect = vi.fn();
    }

    const win: DiscoverLazyWindow = {
      IntersectionObserver:
        MockIntersectionObserver as unknown as typeof IntersectionObserver,
      setTimeout: vi.fn((cb: () => void) => {
        timeoutCallback = cb;
        return 11;
      }),
      clearTimeout: vi.fn(),
    };

    scheduleDiscoverAnalysisLoad({ start, target, win });

    expect(win.setTimeout).toHaveBeenCalledTimes(1);

    timeoutCallback?.();
    expect(start).toHaveBeenCalledTimes(1);

    observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not start after cleanup even if an observer callback arrives late", () => {
    const start = vi.fn();
    const target = {} as Element;
    let callback: IntersectionObserverCallback | undefined;

    class MockIntersectionObserver {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }

      observe = vi.fn();
      disconnect = vi.fn();
    }

    const win: DiscoverLazyWindow = {
      IntersectionObserver:
        MockIntersectionObserver as unknown as typeof IntersectionObserver,
    };

    const cleanup = scheduleDiscoverAnalysisLoad({ start, target, win });
    cleanup();

    callback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    expect(start).not.toHaveBeenCalled();
  });
});

describe("runDiscoverAnalysisLoad", () => {
  it("stays loading until the drops request resolves, then marks ready", async () => {
    const statuses: string[] = [];
    const events: string[] = [];
    let resolveDrops: ((value: string[]) => void) | undefined;

    const runPromise = runDiscoverAnalysisLoad({
      signal: new AbortController().signal,
      setStatus: (status) => statuses.push(status),
      loadDataset: async () => ["venues"],
      applyDataset: (dataset) => events.push(`dataset:${dataset[0]}`),
      loadDrops: () =>
        new Promise<string[]>((resolve) => {
          resolveDrops = resolve;
        }),
      applyDrops: (dataset, drops) => {
        events.push(`drops:${dataset[0]}:${drops[0]}`);
      },
    });

    await Promise.resolve();

    expect(statuses).toEqual(["loading"]);
    expect(events).toEqual(["dataset:venues"]);

    resolveDrops?.(["cheap"]);
    await runPromise;

    expect(events).toEqual(["dataset:venues", "drops:venues:cheap"]);
    expect(statuses).toEqual(["loading", "ready"]);
  });

  it("does not mark ready or error after abort during the drops request", async () => {
    const controller = new AbortController();
    const statuses: string[] = [];
    let rejectDrops: ((reason?: unknown) => void) | undefined;

    const runPromise = runDiscoverAnalysisLoad({
      signal: controller.signal,
      setStatus: (status) => statuses.push(status),
      loadDataset: async () => ["venues"],
      applyDataset: vi.fn(),
      loadDrops: () =>
        new Promise<string[]>((_, reject) => {
          rejectDrops = reject;
        }),
      applyDrops: vi.fn(),
    });

    await Promise.resolve();

    controller.abort();
    rejectDrops?.(new DOMException("Aborted", "AbortError"));
    await runPromise;

    expect(statuses).toEqual(["loading"]);
  });
});
