import { describe, expect, it } from "vitest";

import {
  BASEMAP_RETRY_NOTICE,
  PIN_PAINT_RETRY_NOTICE,
  PIN_PAINT_RETRY_PENDING_NOTICE,
  PIN_PAINT_RETRY_SPENT_NOTICE,
  VENUE_DATA_RETRY_NOTICE,
  VENUE_DATA_RETRY_PENDING_NOTICE,
  VENUE_DATA_RETRY_SPENT_NOTICE,
  createPinRevealCoordinator,
  pinRetryPendingNotice,
  pinRetrySpentNotice,
  revealTimeoutNotice,
  venueDataFailureNotice,
  venueRetryMayDispatch,
  venueRetrySettleNotice,
  venueRetrySpentAfterRead,
  type BasemapNoticeOwner,
} from "@/components/map/canvas/pinRevealCoordinator";

function harness({
  confirmVisibleFrameBeforeReveal = false,
  visibleFrameHoldMs = 0,
  requiresBasemapPaint = true,
}: {
  confirmVisibleFrameBeforeReveal?: boolean;
  visibleFrameHoldMs?: number;
  requiresBasemapPaint?: boolean;
} = {}) {
  let basemapPainted = false;
  let pinsPaintable = true;
  let nextId = 1;
  const timers = new Map<number, () => void>();
  const timerDelays = new Map<number, number>();
  const renderListeners = new Set<() => void>();
  const idleListeners = new Set<() => void>();
  const visibility: boolean[] = [];
  const reveals: Array<{ reason: string; generation: number }> = [];
  const timeoutRecoveries: number[] = [];
  let noticeOwner: BasemapNoticeOwner = "none";

  const coordinator = createPinRevealCoordinator({
    pinRevealTimeoutMs: 3_000,
    readyCeilingMs: 12_000,
    hasBasemapPainted: () => basemapPainted,
    hasPinsPaintable: () => pinsPaintable,
    requiresBasemapPaint,
    confirmVisibleFrameBeforeReveal,
    visibleFrameHoldMs,
    setPinsVisible: (visible) => visibility.push(visible),
    subscribeRender: (listener) => {
      renderListeners.add(listener);
      return () => renderListeners.delete(listener);
    },
    subscribeIdle: (listener) => {
      idleListeners.add(listener);
      return () => idleListeners.delete(listener);
    },
    setTimer: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, callback);
      timerDelays.set(id, delayMs);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
      timerDelays.delete(id);
    },
    canRecoverAfterTimeout: () => noticeOwner === "timeout",
    onPaintAfterTimeout: (generation: number) => {
      noticeOwner = "none";
      timeoutRecoveries.push(generation);
    },
    onReveal: (reason, generation) => {
      const notice = revealTimeoutNotice(reason, noticeOwner, {
        basemapPainted,
        venueData: pinsPaintable ? "ready" : "pending",
        pinsPaintable,
      });
      if (notice?.kind === "tiles") noticeOwner = "timeout";
      reveals.push({ reason, generation });
    },
  });

  return {
    coordinator,
    visibility,
    reveals,
    timeoutRecoveries,
    renderListeners,
    idleListeners,
    timers,
    getNoticeOwner() {
      return noticeOwner;
    },
    reportGenuineFailure() {
      noticeOwner = "errors";
    },
    setBasemapPainted(value: boolean) { basemapPainted = value; },
    setPinsPaintable(value: boolean) { pinsPaintable = value; },
    fireRender() { [...renderListeners].forEach((listener) => listener()); },
    fireIdle() { [...idleListeners].forEach((listener) => listener()); },
    fireByDelay(delayMs: number) {
      for (const [id, delay] of timerDelays) {
        if (delay === delayMs) {
          const callback = timers.get(id);
          callback?.();
          return;
        }
      }
    },
    firePinTimeout() { this.fireByDelay(3_000); },
    fireCeiling() { this.fireByDelay(12_000); },
  };
}

describe("pin reveal coordinator", () => {
  it("names the signal that missed, and says nothing when none did", () => {
    const nothingReady = {
      basemapPainted: false,
      venueData: "pending" as const,
      pinsPaintable: false,
    };
    const basemapOnly = {
      basemapPainted: true,
      venueData: "pending" as const,
      pinsPaintable: false,
    };
    const venuesButNoSource = {
      basemapPainted: true,
      venueData: "ready" as const,
      pinsPaintable: false,
    };
    const allReady = {
      basemapPainted: true,
      venueData: "ready" as const,
      pinsPaintable: true,
    };

    // A painted reveal owes no notice at all.
    expect(revealTimeoutNotice("tiles", "none", nothingReady)).toBeNull();
    expect(revealTimeoutNotice("idle", "none", nothingReady)).toBeNull();

    expect(revealTimeoutNotice("timeout", "none", nothingReady)).toEqual(
      BASEMAP_RETRY_NOTICE,
    );
    // The venue index is the owner's, and no redraw produces one, so it gets
    // its own lane rather than promising a repaint that cannot help.
    expect(revealTimeoutNotice("timeout", "none", basemapOnly)).toEqual(
      VENUE_DATA_RETRY_NOTICE,
    );
    expect(revealTimeoutNotice("timeout", "none", venuesButNoSource)).toEqual(
      PIN_PAINT_RETRY_NOTICE,
    );
    // Everything ready: only the compositor confirmation ran out, and the pins
    // are on screen. Nothing failed, so nothing is claimed.
    expect(revealTimeoutNotice("timeout", "none", allReady)).toBeNull();

    // An error-owned notice is truthful until Retry rebuilds the map.
    expect(revealTimeoutNotice("timeout", "errors", nothingReady)).toBeNull();
    expect(revealTimeoutNotice("timeout", "errors", basemapOnly)).toBeNull();
  });

  it("reads a REFUSED venue index as missing, never as ready", () => {
    // The read settles either way, so a two-state flag answers true for a list
    // that arrived AND for one that never will. A refusal names the pub list.
    expect(
      revealTimeoutNotice("timeout", "none", {
        basemapPainted: true,
        venueData: "failed",
        pinsPaintable: true,
      }),
    ).toEqual(VENUE_DATA_RETRY_NOTICE);
    expect(
      revealTimeoutNotice("timeout", "none", {
        basemapPainted: true,
        venueData: "failed",
        pinsPaintable: false,
      }),
    ).toEqual(VENUE_DATA_RETRY_NOTICE);
    // A basemap that never painted still comes first: it is the outer signal.
    expect(
      revealTimeoutNotice("timeout", "none", {
        basemapPainted: false,
        venueData: "failed",
        pinsPaintable: true,
      }),
    ).toEqual(BASEMAP_RETRY_NOTICE);
  });

  it("changes the sentence while a dispatched Retry is still working", () => {
    expect(pinRetryPendingNotice("pins")).toEqual(PIN_PAINT_RETRY_PENDING_NOTICE);
    expect(pinRetryPendingNotice("venues")).toEqual(
      VENUE_DATA_RETRY_PENDING_NOTICE,
    );
    // Same lane, so one recovery still clears whichever is showing.
    expect(pinRetryPendingNotice("pins").kind).toBe(PIN_PAINT_RETRY_NOTICE.kind);
    expect(pinRetryPendingNotice("venues").kind).toBe(
      VENUE_DATA_RETRY_NOTICE.kind,
    );
    // The tap must not leave the sentence that raised it on screen unchanged.
    for (const kind of ["pins", "venues"] as const) {
      const pending = pinRetryPendingNotice(kind).message;
      expect(pending).not.toBe(pinRetrySpentNotice(kind).message);
      expect(pending).not.toBe(VENUE_DATA_RETRY_NOTICE.message);
      expect(pending).not.toBe(PIN_PAINT_RETRY_NOTICE.message);
      // In flight is not a failure and offers no verdict.
      expect(pending).not.toMatch(/Retry/);
    }
  });

  it("lets a venue Retry follow the live read, not a clock", () => {
    expect(venueRetryMayDispatch(false)).toBe(true);
    expect(venueRetryMayDispatch(true)).toBe(false);
    // Dispatch is not a read: spent stays put until the index answers.
    expect(venueRetrySpentAfterRead(false, "pending")).toBe(false);
    expect(venueRetrySpentAfterRead(true, "pending")).toBe(true);
    expect(venueRetrySpentAfterRead(false, "failed")).toBe(true);
    expect(venueRetrySpentAfterRead(true, "ready")).toBe(false);
    expect(venueRetrySettleNotice("pending")).toEqual(
      VENUE_DATA_RETRY_PENDING_NOTICE,
    );
    expect(venueRetrySettleNotice("failed")).toEqual(
      VENUE_DATA_RETRY_SPENT_NOTICE,
    );
    expect(venueRetrySettleNotice("ready")).toBeNull();
  });

  it("says a refused venue index differently once a Retry has been spent", () => {
    expect(venueDataFailureNotice(false)).toEqual(VENUE_DATA_RETRY_NOTICE);
    expect(venueDataFailureNotice(true)).toEqual(VENUE_DATA_RETRY_SPENT_NOTICE);
    // Same lane either way, so one recovery clears whichever is showing.
    expect(venueDataFailureNotice(false).kind).toBe(
      venueDataFailureNotice(true).kind,
    );
    // Never a dead end: both keep the way on.
    expect(venueDataFailureNotice(false).message).toMatch(/Retry/);
    expect(venueDataFailureNotice(true).message).toMatch(/Retry/);
  });

  it("gives every ceiling notice its own words and its own lane", () => {
    expect(BASEMAP_RETRY_NOTICE.kind).toBe("tiles");
    expect(PIN_PAINT_RETRY_NOTICE.kind).toBe("pins");
    expect(VENUE_DATA_RETRY_NOTICE.kind).toBe("venues");
    const messages = [
      BASEMAP_RETRY_NOTICE.message,
      PIN_PAINT_RETRY_NOTICE.message,
      VENUE_DATA_RETRY_NOTICE.message,
      PIN_PAINT_RETRY_PENDING_NOTICE.message,
      VENUE_DATA_RETRY_PENDING_NOTICE.message,
      PIN_PAINT_RETRY_SPENT_NOTICE.message,
      VENUE_DATA_RETRY_SPENT_NOTICE.message,
    ];
    expect(new Set(messages).size).toBe(messages.length);
    expect(PIN_PAINT_RETRY_NOTICE.message).not.toMatch(/background/i);
    expect(VENUE_DATA_RETRY_NOTICE.message).not.toMatch(/background/i);
  });

  it("keeps a spent pin Retry in its own lane and says it is a second ask", () => {
    expect(pinRetrySpentNotice("pins")).toEqual(PIN_PAINT_RETRY_SPENT_NOTICE);
    expect(pinRetrySpentNotice("venues")).toEqual(VENUE_DATA_RETRY_SPENT_NOTICE);
    expect(pinRetrySpentNotice("pins").kind).toBe(PIN_PAINT_RETRY_NOTICE.kind);
    expect(pinRetrySpentNotice("venues").kind).toBe(
      VENUE_DATA_RETRY_NOTICE.kind,
    );
    // A notice that came back word for word reads as a button that did nothing.
    expect(pinRetrySpentNotice("pins").message).not.toBe(
      PIN_PAINT_RETRY_NOTICE.message,
    );
    expect(pinRetrySpentNotice("venues").message).not.toBe(
      VENUE_DATA_RETRY_NOTICE.message,
    );
    // Still a way on, never a dead end.
    expect(pinRetrySpentNotice("pins").message).toMatch(/Retry/);
    expect(pinRetrySpentNotice("venues").message).toMatch(/Retry/);
  });

  it("keeps pins gated until basemap tiles have painted", () => {
    const h = harness();
    h.coordinator.arm();

    h.fireRender();
    h.fireIdle();
    expect(h.visibility).toEqual([false]);

    h.setBasemapPainted(true);
    h.fireRender();

    expect(h.visibility).toEqual([false, true]);
    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
    expect(h.renderListeners.size).toBe(0);
    expect(h.idleListeners.size).toBe(0);
    expect(h.timers.size).toBe(0);
  });

  it("can reveal phone pins from their own painted source before basemap tiles settle", () => {
    const h = harness({ requiresBasemapPaint: false });
    h.coordinator.arm();

    h.fireRender();

    expect(h.visibility).toEqual([false, true]);
    expect(h.reveals).toEqual([{ reason: "pins", generation: 1 }]);
  });

  it("keeps readiness gated until the latest pub source is paintable", () => {
    const h = harness();
    h.setBasemapPainted(true);
    h.setPinsPaintable(false);
    h.coordinator.arm();

    h.fireRender();
    h.fireIdle();
    expect(h.visibility).toEqual([false]);
    expect(h.reveals).toEqual([]);

    h.setPinsPaintable(true);
    h.fireRender();

    expect(h.visibility).toEqual([false, true]);
    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
  });

  it("can keep parent loading active until a frame renders visible pins", () => {
    const h = harness({ confirmVisibleFrameBeforeReveal: true });
    h.setBasemapPainted(true);
    h.coordinator.arm();

    // First frame proves sources are ready and un-gates the pin layers, but it
    // was painted while those layers were still hidden.
    h.fireRender();
    expect(h.visibility).toEqual([false, true]);
    expect(h.reveals).toEqual([]);

    // Only the next render can contain the now-visible pin layers.
    h.fireRender();
    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
  });

  it("can hold loading chrome through the phone's visual composite", () => {
    const h = harness({
      confirmVisibleFrameBeforeReveal: true,
      visibleFrameHoldMs: 500,
    });
    h.setBasemapPainted(true);
    h.coordinator.arm();

    h.fireRender();
    h.fireRender();
    expect(h.reveals).toEqual([]);

    h.fireByDelay(500);
    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
  });

  it("emits timeout when no phone frame follows the paintable-source render", () => {
    const h = harness({
      confirmVisibleFrameBeforeReveal: true,
      visibleFrameHoldMs: 500,
    });
    h.setBasemapPainted(true);
    h.coordinator.arm();
    h.fireRender();
    expect(h.reveals).toEqual([]);

    h.fireCeiling();

    expect(h.reveals).toEqual([{ reason: "timeout", generation: 1 }]);
  });

  it("un-gates pins on the short fallback without lifting the parent chrome", () => {
    const h = harness();
    h.coordinator.arm();
    // Slow tile stream: the short pin fallback fires first.
    h.firePinTimeout();

    // Pins un-gate so they can't hang hidden...
    expect(h.visibility).toEqual([false, true]);
    // ...but the parent chrome stays up (no reveal) until a real frame or ceiling.
    expect(h.reveals).toEqual([]);
    expect(h.renderListeners.size).toBe(1);
    expect(h.idleListeners.size).toBe(1);
  });

  it("reveals from a real frame after the pin fallback, without the ceiling", () => {
    const h = harness();
    h.coordinator.arm();
    h.firePinTimeout();
    expect(h.reveals).toEqual([]);

    // The basemap finally paints: the real frame lifts the chrome, not the ceiling.
    h.setBasemapPainted(true);
    h.fireRender();

    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
    // Pins were already shown by the fallback, so no duplicate visibility write.
    expect(h.visibility).toEqual([false, true]);
    expect(h.timers.size).toBe(0);
  });

  it("accepts a painted basemap while another tiled source is still pending", () => {
    const h = harness();
    h.coordinator.arm();
    h.setBasemapPainted(true);

    h.fireRender();
    h.fireCeiling();

    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
    expect(h.visibility).toEqual([false, true]);
  });

  it("lets rendered tiles beat the ceiling in the same event turn", () => {
    const h = harness();
    h.coordinator.arm();
    h.setBasemapPainted(true);

    h.fireRender();
    h.fireCeiling();

    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
    expect(h.getNoticeOwner()).toBe("none");
  });

  it("lifts the chrome at the honest ceiling only when tiles never settle", () => {
    const h = harness();
    h.coordinator.arm();
    h.firePinTimeout();
    h.fireCeiling();
    h.fireCeiling();

    expect(h.visibility).toEqual([false, true]);
    expect(h.reveals).toEqual([{ reason: "timeout", generation: 1 }]);
  });

  it("clears a timeout-owned notice in the first render that paints the basemap", () => {
    const h = harness();
    h.coordinator.arm();
    h.fireCeiling();
    expect(h.getNoticeOwner()).toBe("timeout");

    h.setBasemapPainted(true);
    h.fireRender();

    expect(h.getNoticeOwner()).toBe("none");
    expect(h.timeoutRecoveries).toEqual([1]);
  });

  it("preserves an error-owned notice when the basemap later renders", () => {
    const h = harness();
    h.coordinator.arm();
    h.fireCeiling();
    h.reportGenuineFailure();

    h.setBasemapPainted(true);
    h.fireRender();

    expect(h.getNoticeOwner()).toBe("errors");
    expect(h.timeoutRecoveries).toEqual([]);
  });

  it("keeps an error-owned notice through the ceiling and later paint", () => {
    const h = harness();
    h.coordinator.arm();
    h.reportGenuineFailure();

    h.fireCeiling();
    expect(h.getNoticeOwner()).toBe("errors");

    h.setBasemapPainted(true);
    h.fireRender();

    expect(h.getNoticeOwner()).toBe("errors");
    expect(h.timeoutRecoveries).toEqual([]);
  });

  it("cancels obsolete style generations and ignores stale callbacks", () => {
    const h = harness();
    h.coordinator.arm();
    const staleRender = [...h.renderListeners][0];
    const firstTimer = [...h.timers.values()][0];

    h.coordinator.arm();
    h.setBasemapPainted(true);
    staleRender?.();
    firstTimer?.();
    expect(h.reveals).toEqual([]);

    h.fireRender();
    expect(h.visibility).toEqual([false, false, true]);
    expect(h.reveals).toEqual([{ reason: "tiles", generation: 2 }]);
  });

  it("prevents post-unmount event and timer writes", () => {
    const h = harness();
    h.setBasemapPainted(true);
    h.coordinator.arm();
    const staleRender = [...h.renderListeners][0];
    const staleTimer = [...h.timers.values()][0];

    h.coordinator.dispose();
    staleRender?.();
    staleTimer?.();

    expect(h.visibility).toEqual([false]);
    expect(h.reveals).toEqual([]);
    expect(h.renderListeners.size).toBe(0);
    expect(h.idleListeners.size).toBe(0);
  });

  it("does not trust the pre-render tile-ready value after a style load", () => {
    const h = harness();
    h.setBasemapPainted(true);
    h.coordinator.arm();

    expect(h.reveals).toEqual([]);

    h.fireRender();
    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
  });

  it("reveals from idle only after tile readiness and still does so once", () => {
    const h = harness();
    h.coordinator.arm();
    h.setBasemapPainted(true);
    h.fireIdle();
    h.fireRender();

    expect(h.reveals).toEqual([{ reason: "idle", generation: 1 }]);
    expect(h.visibility).toEqual([false, true]);
  });
});
