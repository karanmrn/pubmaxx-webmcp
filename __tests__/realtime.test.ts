import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Realtime helper (issue #37). Two things matter and are unit-testable
// without a live socket:
//   1. countSpillingNow — a pure recency counter.
//   2. The SIGNAL-ONLY contract: on a postgres_changes INSERT event the helper
//      invokes the caller's nudge and NEVER hands over the payload row (which
//      would leak a hidden/anonymous drop, bypassing #29). We assert this with a
//      fake channel that captures the registered handler and fires it with a
//      raw row — the nudge must receive NOTHING from that row.
//
// authClient is mocked so no real Supabase env / browser is needed.

// ── Fake browser client + channel ────────────────────────────────────────────
type ChangeHandler = (payload: unknown) => void;

let capturedHandler: ChangeHandler | null = null;
let subscribeCb: ((status: string) => void) | null = null;
let removed = false;

function makeFakeChannel() {
  return {
    on(_event: string, _filter: unknown, handler: ChangeHandler) {
      capturedHandler = handler;
      return this;
    },
    subscribe(cb: (status: string) => void) {
      subscribeCb = cb;
      return this;
    },
  };
}

const fakeSupabase = {
  channel: () => makeFakeChannel(),
  removeChannel: () => {
    removed = true;
  },
};

vi.mock("@/lib/authClient", () => ({
  getSupabaseBrowser: () => fakeSupabase,
  isAuthConfigured: () => true,
}));

// Imported AFTER the mock is registered.
import {
  countSpillingNow,
  SPILLING_NOW_WINDOW_MIN,
  subscribeToComments,
  subscribeToNewDrops,
} from "@/lib/realtime";

beforeEach(() => {
  capturedHandler = null;
  subscribeCb = null;
  removed = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("countSpillingNow (pure)", () => {
  const now = Date.parse("2026-07-06T22:00:00.000Z");
  const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

  it("counts only drops within the window", () => {
    const drops = [
      { createdAt: minsAgo(5) }, // in
      { createdAt: minsAgo(59) }, // in
      { createdAt: minsAgo(61) }, // out (older than 60m)
    ];
    expect(countSpillingNow(drops, now)).toBe(2);
  });

  it("uses the default 60-minute window", () => {
    expect(SPILLING_NOW_WINDOW_MIN).toBe(60);
    const drops = [{ createdAt: minsAgo(30) }];
    expect(countSpillingNow(drops, now)).toBe(1);
  });

  it("ignores bad, missing, and future timestamps (no inflation)", () => {
    const drops = [
      { createdAt: "not-a-date" },
      { createdAt: null },
      {},
      { createdAt: new Date(now + 60_000).toISOString() }, // future
      { createdAt: minsAgo(1) }, // the only valid one
    ];
    expect(countSpillingNow(drops, now)).toBe(1);
  });

  it("respects a custom window", () => {
    const drops = [{ createdAt: minsAgo(20) }];
    expect(countSpillingNow(drops, now, 10)).toBe(0);
    expect(countSpillingNow(drops, now, 30)).toBe(1);
  });
});

describe("subscribeToNewDrops — SIGNAL ONLY", () => {
  it("fires the nudge on an INSERT event WITHOUT passing the raw payload row", () => {
    const nudge = vi.fn();
    const unsub = subscribeToNewDrops(nudge);
    // Simulate a successful channel join so the watchdog is cancelled.
    subscribeCb?.("SUBSCRIBED");
    expect(capturedHandler).toBeTypeOf("function");

    // A raw postgres_changes payload carries the whole row — handle, visibility.
    capturedHandler?.({
      eventType: "INSERT",
      new: { id: "d1", handle: "secret-user", visibility: "anonymous" },
    });

    // The nudge was called — but with NO arguments (signal, not content).
    expect(nudge).toHaveBeenCalledTimes(1);
    expect(nudge.mock.calls[0]).toHaveLength(0);

    unsub();
    expect(removed).toBe(true);
  });

  it("falls back to polling on a 30s interval if the channel never joins", () => {
    const poll = vi.fn();
    const unsub = subscribeToNewDrops(() => {}, { poll });
    // Never call subscribeCb('SUBSCRIBED') — let the join watchdog (5s) fire.
    vi.advanceTimersByTime(5_000);
    // Now the poll interval (30s) should be running.
    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("falls back to polling if the channel errors mid-session", () => {
    const poll = vi.fn();
    const unsub = subscribeToNewDrops(() => {}, { poll });
    subscribeCb?.("SUBSCRIBED"); // joins fine
    subscribeCb?.("CHANNEL_ERROR"); // then drops
    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    unsub();
  });
});

describe("subscribeToComments", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });

  it("is a no-op for a falsy dropId", () => {
    const nudge = vi.fn();
    const unsub = subscribeToComments("", nudge);
    expect(capturedHandler).toBeNull();
    expect(() => unsub()).not.toThrow();
  });

  it("is a no-op when enabled is false (gated drop — no refetch subscription)", () => {
    const nudge = vi.fn();
    const unsub = subscribeToComments("drop-1", nudge, { enabled: false });
    expect(capturedHandler).toBeNull();
    expect(() => unsub()).not.toThrow();
  });

  it("polls the filtered API even when a Realtime channel could report subscribed", () => {
    const nudge = vi.fn();
    const unsub = subscribeToComments("drop-1", nudge);

    expect(capturedHandler).toBeNull();
    expect(subscribeCb).toBeNull();
    vi.advanceTimersByTime(30_000);
    expect(nudge).toHaveBeenCalledTimes(1);
    expect(nudge.mock.calls[0]).toHaveLength(0);

    unsub();
    vi.advanceTimersByTime(30_000);
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  it("uses an explicit filtered-API poll callback when supplied", () => {
    const nudge = vi.fn();
    const poll = vi.fn();
    const unsub = subscribeToComments("drop-1", nudge, { poll });

    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(nudge).not.toHaveBeenCalled();
    unsub();
  });

  it("does not retain a polling timer during server rendering", () => {
    vi.unstubAllGlobals();
    const nudge = vi.fn();
    const unsub = subscribeToComments("drop-1", nudge);

    vi.advanceTimersByTime(60_000);
    expect(nudge).not.toHaveBeenCalled();
    expect(() => unsub()).not.toThrow();
  });
});
