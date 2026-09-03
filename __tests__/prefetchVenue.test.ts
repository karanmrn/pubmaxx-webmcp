import { describe, it, expect, vi } from "vitest";

import {
  shouldPrefetch,
  venueDetailUrl,
  readConnection,
  createPrefetch,
  type ConnectionLike,
  type PrefetchDeps,
} from "@/lib/prefetchVenue";

// Pure-logic tests only — node env, no DOM. `fetch`, the connection descriptor,
// and the idle scheduler are all injected so we assert the gating + fire-once +
// abort behaviour deterministically without timers or the network.

// A synchronous scheduler: runs the callback immediately unless cancelled first.
// Lets us assert fetch behaviour without real setTimeout. It records the delay
// so we can also check the idle delay is plumbed through.
function syncScheduler() {
  const delays: number[] = [];
  return {
    delays,
    schedule: (run: () => void, delayMs: number) => {
      delays.push(delayMs);
      let cancelled = false;
      // Run on the next microtask so a caller's `cancel()` (returned
      // synchronously) can still pre-empt it — mirrors setTimeout ordering.
      queueMicrotask(() => {
        if (!cancelled) run();
      });
      return { cancel: () => (cancelled = true) };
    },
  };
}

function makeDeps(overrides: Partial<PrefetchDeps> = {}): {
  deps: PrefetchDeps;
  fetch: ReturnType<typeof vi.fn>;
} {
  const fetch = vi.fn(() => Promise.resolve({}));
  const deps: PrefetchDeps = {
    fetch,
    connection: null,
    seen: new Set<string>(),
    schedule: syncScheduler().schedule,
    ...overrides,
  };
  return { deps, fetch };
}

const flush = () => new Promise((resolve) => queueMicrotask(() => resolve(null)));

describe("shouldPrefetch (save-data / 2g gating)", () => {
  it("prefetches when there is no connection signal", () => {
    expect(shouldPrefetch(null)).toBe(true);
  });

  it("prefetches on a normal 4g connection", () => {
    expect(shouldPrefetch({ effectiveType: "4g", saveData: false })).toBe(true);
  });

  it("does NOT prefetch when saveData is on", () => {
    expect(shouldPrefetch({ saveData: true })).toBe(false);
  });

  it("does NOT prefetch on 2g or slow-2g", () => {
    expect(shouldPrefetch({ effectiveType: "2g" })).toBe(false);
    expect(shouldPrefetch({ effectiveType: "slow-2g" })).toBe(false);
  });

  it("prefetches on 3g (not fast, but worth warming)", () => {
    expect(shouldPrefetch({ effectiveType: "3g" })).toBe(true);
  });

  it("saveData wins even on a fast connection", () => {
    expect(shouldPrefetch({ effectiveType: "4g", saveData: true })).toBe(false);
  });
});

describe("venueDetailUrl", () => {
  it("builds the route path and encodes the id", () => {
    expect(venueDetailUrl("venue-abc")).toBe("/api/venue/venue-abc");
    expect(venueDetailUrl("a/b c")).toBe("/api/venue/a%2Fb%20c");
  });
});

describe("readConnection", () => {
  it("returns null for SSR / missing navigator", () => {
    expect(readConnection(undefined)).toBeNull();
    expect(readConnection(null)).toBeNull();
    expect(readConnection({})).toBeNull();
  });

  it("returns the connection descriptor when present", () => {
    const conn: ConnectionLike = { saveData: true, effectiveType: "2g" };
    expect(readConnection({ connection: conn })).toBe(conn);
  });
});

describe("createPrefetch — fire-once + abort safety", () => {
  it("fetches the venue detail url after the idle delay", async () => {
    const { deps, fetch } = makeDeps();
    const prefetch = createPrefetch(deps);
    prefetch("venue-1");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/venue/venue-1", expect.anything());
  });

  it("fires at most once per key per session", async () => {
    const { deps, fetch } = makeDeps();
    const prefetch = createPrefetch(deps);
    prefetch("venue-1");
    await flush();
    prefetch("venue-1");
    prefetch("venue-1");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shares the seen registry across distinct keys (each fires once)", async () => {
    const { deps, fetch } = makeDeps();
    const prefetch = createPrefetch(deps);
    prefetch("venue-1");
    prefetch("venue-2");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("no-ops on an empty id", async () => {
    const { deps, fetch } = makeDeps();
    createPrefetch(deps)("");
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fetch when the connection is blocked (saveData)", async () => {
    const { deps, fetch } = makeDeps({ connection: { saveData: true } });
    createPrefetch(deps)("venue-1");
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancelling before the idle delay elapses prevents the fetch", async () => {
    const { deps, fetch } = makeDeps();
    const handle = createPrefetch(deps)("venue-1");
    handle.cancel(); // synchronous, before the microtask runs
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a cancelled pass leaves the key retriable (not marked seen)", async () => {
    const { deps, fetch } = makeDeps();
    const prefetch = createPrefetch(deps);
    prefetch("venue-1").cancel();
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    // Same key can still fire on a later, uncancelled intent.
    prefetch("venue-1");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancel() after the fetch fires aborts the in-flight request", async () => {
    let seenSignal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      seenSignal = init?.signal;
      return new Promise(() => {}); // never resolves — stays in-flight
    });
    const { deps } = makeDeps({ fetch });
    const handle = createPrefetch(deps)("venue-1");
    await flush();
    expect(seenSignal?.aborted).toBe(false);
    handle.cancel();
    expect(seenSignal?.aborted).toBe(true);
  });

  it("swallows fetch rejection (best-effort, never throws)", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("boom")));
    const { deps } = makeDeps({ fetch });
    expect(() => createPrefetch(deps)("venue-1")).not.toThrow();
    await flush();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("plumbs a custom idle delay through to the scheduler", () => {
    const sched = syncScheduler();
    const { deps } = makeDeps({ schedule: sched.schedule, delayMs: 250 });
    createPrefetch(deps)("venue-1");
    expect(sched.delays).toEqual([250]);
  });
});
