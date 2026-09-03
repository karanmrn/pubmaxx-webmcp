import { describe, expect, it, vi } from "vitest";

// Wake-lock state machine behaviour (components/night/useScreenWakeLock.ts).
// The React hook is a thin wrapper; the acquire/release/re-acquire logic lives
// in the framework-free createWakeLockManager, tested here against a mocked
// navigator.wakeLock (Node env — no DOM, no renderer).
import {
  createWakeLockManager,
  wakeLockSupported,
  type WakeLockNavigatorLike,
  type WakeLockSentinelLike,
} from "@/components/night/useScreenWakeLock";

type FakeSentinel = WakeLockSentinelLike & {
  released: boolean;
  releaseListeners: Array<() => void>;
  fireBrowserRelease: () => void;
};

function makeSentinel(): FakeSentinel {
  const listeners: Array<() => void> = [];
  const sentinel: FakeSentinel = {
    released: false,
    releaseListeners: listeners,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: (_type, listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    fireBrowserRelease: () => {
      sentinel.released = true;
      listeners.slice().forEach((listener) => listener());
    },
  };
  return sentinel;
}

function makeNavigator(): { nav: WakeLockNavigatorLike; sentinels: FakeSentinel[]; requests: () => number } {
  const sentinels: FakeSentinel[] = [];
  let requests = 0;
  const nav: WakeLockNavigatorLike = {
    wakeLock: {
      request: vi.fn(async (type: "screen") => {
        expect(type).toBe("screen");
        requests += 1;
        const sentinel = makeSentinel();
        sentinels.push(sentinel);
        return sentinel;
      }),
    },
  };
  return { nav, sentinels, requests: () => requests };
}

describe("wakeLockSupported", () => {
  it("is true only when navigator.wakeLock.request exists", () => {
    expect(wakeLockSupported(undefined)).toBe(false);
    expect(wakeLockSupported(null)).toBe(false);
    expect(wakeLockSupported({})).toBe(false);
    expect(wakeLockSupported({ wakeLock: {} as never })).toBe(false);
    expect(wakeLockSupported(makeNavigator().nav)).toBe(true);
  });
});

describe("createWakeLockManager", () => {
  it("acquires a screen lock on enable and reports active", async () => {
    const { nav, sentinels, requests } = makeNavigator();
    const changes: boolean[] = [];
    const manager = createWakeLockManager(nav, (active) => changes.push(active));

    expect(manager.supported).toBe(true);
    expect(manager.isActive()).toBe(false);

    await manager.enable();

    expect(requests()).toBe(1);
    expect(sentinels).toHaveLength(1);
    expect(manager.isActive()).toBe(true);
    expect(changes).toContain(true);
  });

  it("releases the held lock on disable", async () => {
    const { nav, sentinels } = makeNavigator();
    const manager = createWakeLockManager(nav);

    await manager.enable();
    await manager.disable();

    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(manager.isActive()).toBe(false);
  });

  it("does not acquire twice when already active", async () => {
    const { nav, requests } = makeNavigator();
    const manager = createWakeLockManager(nav);

    await manager.enable();
    await manager.enable();

    expect(requests()).toBe(1);
  });

  it("re-acquires when the page becomes visible after the browser dropped the lock", async () => {
    const { nav, sentinels, requests } = makeNavigator();
    const manager = createWakeLockManager(nav);

    await manager.enable();
    expect(requests()).toBe(1);

    // Browser auto-releases the sentinel when the tab hides.
    sentinels[0].fireBrowserRelease();
    expect(manager.isActive()).toBe(false);

    // Coming back into view while still armed re-acquires.
    await manager.handleVisibility(true);
    expect(requests()).toBe(2);
    expect(manager.isActive()).toBe(true);
  });

  it("ignores a visibility gain once disabled", async () => {
    const { nav, requests } = makeNavigator();
    const manager = createWakeLockManager(nav);

    await manager.enable();
    await manager.disable();
    await manager.handleVisibility(true);

    expect(requests()).toBe(1); // only the initial enable acquired
    expect(manager.isActive()).toBe(false);
  });

  it("does nothing on a visibility loss", async () => {
    const { nav, sentinels } = makeNavigator();
    const manager = createWakeLockManager(nav);

    await manager.enable();
    await manager.handleVisibility(false);

    // The lock is left to the browser's own release; we do not touch it.
    expect(sentinels[0].release).not.toHaveBeenCalled();
    expect(manager.isActive()).toBe(true);
  });

  it("stays inactive and never throws when the request is denied", async () => {
    const nav: WakeLockNavigatorLike = {
      wakeLock: { request: vi.fn(async () => Promise.reject(new Error("denied"))) },
    };
    const changes: boolean[] = [];
    const errors: string[] = [];
    const manager = createWakeLockManager(
      nav,
      (active) => changes.push(active),
      () => errors.push("failed"),
    );

    await expect(manager.enable()).resolves.toBeUndefined();
    expect(manager.isActive()).toBe(false);
    expect(changes).not.toContain(true);
    expect(errors).toEqual(["failed"]);
  });

  it("is inert on an unsupported navigator", async () => {
    const manager = createWakeLockManager(undefined);
    expect(manager.supported).toBe(false);
    await manager.enable();
    await manager.handleVisibility(true);
    expect(manager.isActive()).toBe(false);
  });
});
