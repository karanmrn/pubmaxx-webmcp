import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeToReconnectRecovery } from "@/lib/useReconnectRecovery";

type VisibilityTarget = EventTarget & {
  visibilityState: DocumentVisibilityState;
};

type WindowTarget = EventTarget & {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

function makeWindow(): WindowTarget {
  return Object.assign(new EventTarget() as WindowTarget, {
    setTimeout,
    clearTimeout,
  });
}

function makeDocument(): VisibilityTarget {
  const target = new EventTarget() as VisibilityTarget;
  target.visibilityState = "hidden";
  return target;
}

describe("reconnect recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reloads once after a debounced online event", () => {
    const windowTarget = makeWindow();
    const documentTarget = makeDocument();
    const reload = vi.fn();
    const stop = subscribeToReconnectRecovery(reload, {
      windowTarget,
      documentTarget,
      debounceMs: 50,
    });

    windowTarget.dispatchEvent(new Event("online"));
    windowTarget.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(49);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reloads when the document becomes visible", () => {
    const windowTarget = makeWindow();
    const documentTarget = makeDocument();
    const reload = vi.fn();
    const stop = subscribeToReconnectRecovery(reload, {
      windowTarget,
      documentTarget,
      debounceMs: 25,
    });

    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(25);

    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it("coalesces a reconnect and foreground pair into one reload", () => {
    const windowTarget = makeWindow();
    const documentTarget = makeDocument();
    const reload = vi.fn();
    const stop = subscribeToReconnectRecovery(reload, {
      windowTarget,
      documentTarget,
      debounceMs: 50,
    });

    windowTarget.dispatchEvent(new Event("online"));
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(50);

    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not loop when reload itself emits online", () => {
    const windowTarget = makeWindow();
    const documentTarget = makeDocument();
    const reload = vi.fn(() => {
      windowTarget.dispatchEvent(new Event("online"));
    });
    const stop = subscribeToReconnectRecovery(reload, {
      windowTarget,
      documentTarget,
      debounceMs: 10,
    });

    windowTarget.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(10);
    vi.advanceTimersByTime(10);

    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it("cancels a pending recovery during cleanup", () => {
    const windowTarget = makeWindow();
    const documentTarget = makeDocument();
    const reload = vi.fn();
    const stop = subscribeToReconnectRecovery(reload, {
      windowTarget,
      documentTarget,
      debounceMs: 25,
    });

    windowTarget.dispatchEvent(new Event("online"));
    stop();
    vi.advanceTimersByTime(25);

    expect(reload).not.toHaveBeenCalled();
  });

  it("supports pageshow recovery only when restored from bfcache", () => {
    const windowTarget = makeWindow();
    const documentTarget = makeDocument();
    const reload = vi.fn();
    const stop = subscribeToReconnectRecovery(reload, {
      windowTarget,
      documentTarget,
      events: ["pageshow"],
      debounceMs: 25,
    });

    const normalPageShow = new Event("pageshow");
    Object.defineProperty(normalPageShow, "persisted", { value: false });
    windowTarget.dispatchEvent(normalPageShow);
    vi.advanceTimersByTime(25);
    expect(reload).not.toHaveBeenCalled();

    const restoredPageShow = new Event("pageshow");
    Object.defineProperty(restoredPageShow, "persisted", { value: true });
    windowTarget.dispatchEvent(restoredPageShow);
    vi.advanceTimersByTime(25);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it("can limit recovery to foreground events", () => {
    const windowTarget = makeWindow();
    const documentTarget = makeDocument();
    const reload = vi.fn();
    const stop = subscribeToReconnectRecovery(reload, {
      windowTarget,
      documentTarget,
      events: ["visible", "pageshow"],
      debounceMs: 25,
    });

    windowTarget.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(25);
    expect(reload).not.toHaveBeenCalled();

    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(25);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });
});
