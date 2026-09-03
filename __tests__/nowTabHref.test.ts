import { afterEach, describe, expect, it, vi } from "vitest";

import {
  msUntilNowTabFlip,
  nowTabHref,
  serverNowTabHref,
  subscribeNowTabHref,
} from "@/components/nav/navigationModel";

// The Now tab keeps both /today and /tonight live and only flips the TAB
// href. 17:00 Europe/London is the cut. Winter (GMT) and summer (BST) both
// have to land on the same wall-clock hour, so these instants are pinned in
// UTC to those two London clocks.

describe("nowTabHref", () => {
  it("points at /today before 17:00 Europe/London in winter", () => {
    expect(nowTabHref(new Date("2026-01-15T16:59:00Z"))).toBe("/today");
  });

  it("points at /tonight from 17:00 Europe/London in winter", () => {
    expect(nowTabHref(new Date("2026-01-15T17:00:00Z"))).toBe("/tonight");
  });

  it("points at /today before 17:00 Europe/London in summer", () => {
    // 16:59 BST = 15:59 UTC
    expect(nowTabHref(new Date("2026-08-16T15:59:00Z"))).toBe("/today");
  });

  it("points at /tonight from 17:00 Europe/London in summer", () => {
    // 17:00 BST = 16:00 UTC
    expect(nowTabHref(new Date("2026-08-16T16:00:00Z"))).toBe("/tonight");
  });
});

// `/` and `/map` are prerendered and held by the CDN for up to an hour, so the
// server snapshot may not read a clock: a document built at 16:30 and hydrated
// at 17:10 would meet markup saying /today with a browser that had already
// decided /tonight. The constant holds, then getSnapshot flips it after mount.
describe("serverNowTabHref", () => {
  it("answers the same href whatever the hour", () => {
    expect(serverNowTabHref()).toBe("/today");
    expect(nowTabHref(new Date("2026-08-16T16:00:00Z"))).not.toBe(serverNowTabHref());
  });
});

// The href moves twice a day, so the subscription owes ONE timer aimed at the
// next of those two moments. It used to be a 30 second `setInterval` running for
// the life of every page in both the tab bar and the desktop nav.
describe("msUntilNowTabFlip", () => {
  const HOUR = 60 * 60 * 1000;

  it("counts down to 17:00 from the morning, in both London offsets", () => {
    // 11:00 BST
    expect(msUntilNowTabFlip(new Date("2026-08-16T10:00:00Z"))).toBe(6 * HOUR);
    // 11:00 GMT
    expect(msUntilNowTabFlip(new Date("2026-01-15T11:00:00Z"))).toBe(6 * HOUR);
  });

  it("counts down to midnight once the evening has turned", () => {
    // 17:00 BST, the flip itself: the next change is midnight.
    expect(msUntilNowTabFlip(new Date("2026-08-16T16:00:00Z"))).toBe(7 * HOUR);
    // 23:30 BST
    expect(msUntilNowTabFlip(new Date("2026-08-16T22:30:00Z"))).toBe(30 * 60 * 1000);
  });

  it("keeps a floor under a boundary that is one millisecond away", () => {
    // A delay of 1ms would re-arm on a clock the browser may hand back
    // fractionally early, and spin.
    expect(msUntilNowTabFlip(new Date("2026-08-16T15:59:59.999Z"))).toBe(1_000);
    expect(msUntilNowTabFlip(new Date("2026-08-16T22:59:59.999Z"))).toBe(1_000);
  });

  it("lands on the instant the href really changes", () => {
    const before = new Date("2026-08-16T10:00:00Z");
    const at = new Date(before.getTime() + msUntilNowTabFlip(before));
    expect(nowTabHref(before)).toBe("/today");
    expect(nowTabHref(at)).toBe("/tonight");
    expect(nowTabHref(new Date(at.getTime() - 1))).toBe("/today");
  });
});

describe("subscribeNowTabHref", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function stubBrowser(): { fireVisible: () => void; listeners: number } {
    const handlers = new Set<() => void>();
    vi.stubGlobal("window", {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    });
    const state = {
      fireVisible: () => {
        for (const handler of [...handlers]) handler();
      },
      get listeners() {
        return handlers.size;
      },
    };
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: (_type: string, handler: () => void) => handlers.add(handler),
      removeEventListener: (_type: string, handler: () => void) => handlers.delete(handler),
    });
    return state;
  }

  it("stays silent until the boundary, then notifies once and re-arms", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T10:00:00Z")); // 11:00 BST
    stubBrowser();
    const onStoreChange = vi.fn();
    const unsubscribe = subscribeNowTabHref(onStoreChange);

    // A 30 second poll would have woken 719 times by here.
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 - 1);
    expect(onStoreChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onStoreChange).toHaveBeenCalledTimes(1);

    // Re-armed on the next boundary, midnight, and quiet in between.
    vi.advanceTimersByTime(7 * 60 * 60 * 1000 - 1);
    expect(onStoreChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onStoreChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(onStoreChange).toHaveBeenCalledTimes(2);
  });

  it("re-reads the clock when the tab comes back into view", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T10:00:00Z"));
    const browser = stubBrowser();
    const onStoreChange = vi.fn();
    const unsubscribe = subscribeNowTabHref(onStoreChange);
    expect(browser.listeners).toBe(1);

    // A backgrounded tab has its timers throttled and a suspended device runs
    // none, so returning is its own reason to read the clock.
    browser.fireVisible();
    expect(onStoreChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(browser.listeners).toBe(0);
    browser.fireVisible();
    expect(onStoreChange).toHaveBeenCalledTimes(1);
  });
});
