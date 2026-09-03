// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInitialSlimShardStart } from "@/components/map/useInitialSlimShardStart";

import {
  openingLocationCancellationAfterAttempt,
  resolveInitialSlimShardLifecycle,
  scheduleSlimShardViewportLoad,
} from "@/lib/slimShards";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type HarnessViewport = { id: string };
type HarnessBounds = { id: string };
type LifecycleHarnessProps = {
  openingLocationResolved: boolean;
  openingLocationCancelled: boolean;
  openingLocationSettled: boolean;
  deferInitialSpatialLoad: boolean;
  initialMapView: HarnessViewport;
  openingLoadViewport: HarnessViewport;
  settledBounds: HarnessBounds | null;
  starts: Array<HarnessViewport | HarnessBounds>;
};

function LifecycleHarness({ starts, ...input }: LifecycleHarnessProps) {
  const { ready, viewport, readStart } = useInitialSlimShardStart(input);

  useEffect(() => {
    if (!ready) return;
    const start = readStart();
    starts.push(start.settledBounds ?? start.viewport);
  }, [readStart, ready, starts, viewport]);

  return null;
}

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

describe("first useful map pins", () => {
  it("starts target viewport work now and leaves later refreshes for idle time", () => {
    const targetLoad = vi.fn();
    const refreshLoad = vi.fn();
    const requestIdleCallback = vi.fn();
    const setTimeout = vi.fn();
    const timing = { requestIdleCallback, setTimeout };

    scheduleSlimShardViewportLoad(targetLoad, "target", timing);

    expect(targetLoad).toHaveBeenCalledTimes(1);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();

    scheduleSlimShardViewportLoad(refreshLoad, "refresh", timing);

    expect(refreshLoad).not.toHaveBeenCalled();
    expect(requestIdleCallback).toHaveBeenCalledWith(refreshLoad, { timeout: 3_000 });
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it("keeps the one-second fallback only for later refreshes", () => {
    const refreshLoad = vi.fn();
    const setTimeout = vi.fn();

    scheduleSlimShardViewportLoad(refreshLoad, "refresh", { setTimeout });

    expect(refreshLoad).not.toHaveBeenCalled();
    expect(setTimeout).toHaveBeenCalledWith(refreshLoad, 1_000);
  });

  it("wires every settled viewport through the two ring lanes", () => {
    const source = readFileSync(
      join(process.cwd(), "components/PubMap.tsx"),
      "utf8",
    );

    expect(source).toContain("scheduleRingLoad(loader, bounds);");
    expect(source).not.toContain('scheduleRingLoad(loader, bounds, "target")');
    expect(source).not.toContain('scheduleRingLoad(loader, bounds, "refresh")');
    expect(source).toContain("useInitialSlimShardStart({");
  });

  it("keeps the compatibility-core viewport stable while location resolves", () => {
    const initialMapView = { name: "initial" };
    const holdViewport = { name: "hold" };
    const resolvedViewport = { name: "resolved" };

    const beforeResolution = resolveInitialSlimShardLifecycle({
      openingLocationResolved: false,
      openingLocationCancelled: false,
      openingLocationSettled: false,
      deferInitialSpatialLoad: true,
      initialMapView,
      openingLoadViewport: holdViewport,
    });
    const afterResolution = resolveInitialSlimShardLifecycle({
      openingLocationResolved: true,
      openingLocationCancelled: false,
      openingLocationSettled: false,
      deferInitialSpatialLoad: true,
      initialMapView,
      openingLoadViewport: resolvedViewport,
    });

    expect(beforeResolution).toEqual({ ready: true, viewport: initialMapView });
    expect(afterResolution).toEqual({ ready: true, viewport: initialMapView });
    expect(afterResolution.viewport).toBe(beforeResolution.viewport);
  });

  it("waits for cancelled camera settlement and stays stable after resolution", () => {
    const initialMapView = { name: "initial" };
    const openingLoadViewport = { name: "opening" };

    const unresolved = resolveInitialSlimShardLifecycle({
      openingLocationResolved: false,
      openingLocationCancelled: false,
      openingLocationSettled: false,
      deferInitialSpatialLoad: false,
      initialMapView,
      openingLoadViewport,
    });
    const cancelledBeforeSettle = resolveInitialSlimShardLifecycle({
      openingLocationResolved: false,
      openingLocationCancelled: true,
      openingLocationSettled: false,
      deferInitialSpatialLoad: false,
      initialMapView,
      openingLoadViewport,
    });
    const cancelledAndSettled = resolveInitialSlimShardLifecycle({
      openingLocationResolved: false,
      openingLocationCancelled: true,
      openingLocationSettled: true,
      deferInitialSpatialLoad: false,
      initialMapView,
      openingLoadViewport,
    });
    const laterResolved = resolveInitialSlimShardLifecycle({
      openingLocationResolved: true,
      openingLocationCancelled: true,
      openingLocationSettled: true,
      deferInitialSpatialLoad: false,
      initialMapView,
      openingLoadViewport,
    });
    const resolvedBeforeCancelledCameraSettles =
      resolveInitialSlimShardLifecycle({
        openingLocationResolved: true,
        openingLocationCancelled: true,
        openingLocationSettled: false,
        deferInitialSpatialLoad: false,
        initialMapView,
        openingLoadViewport,
      });

    expect(unresolved).toEqual({ ready: false, viewport: openingLoadViewport });
    expect(cancelledBeforeSettle).toEqual({ ready: false, viewport: initialMapView });
    expect(resolvedBeforeCancelledCameraSettles).toEqual({
      ready: false,
      viewport: initialMapView,
    });
    expect(cancelledAndSettled).toEqual({ ready: true, viewport: initialMapView });
    expect(laterResolved).toEqual({ ready: true, viewport: initialMapView });
    expect(laterResolved.viewport).toBe(cancelledAndSettled.viewport);
  });

  it("owns every opening-location cancellation through one reactive callback", () => {
    const source = readFileSync(
      join(process.cwd(), "components/PubMap.tsx"),
      "utf8",
    );

    expect(source.match(/openingLocationCancelledRef\.current = true/g)).toHaveLength(1);
    expect(source).toContain("openingLocationCancellationAfterAttempt({");
    expect(source).toContain(
      "setOpeningLocationCancelledBeforeResolution(nextCancellation)",
    );
    expect(source.match(/cancelOpeningLocation\(\)/g)).toHaveLength(2);
  });

  it("does not turn a post-resolution camera move into cancellation", () => {
    expect(openingLocationCancellationAfterAttempt({
      openingLocationResolved: false,
      openingLocationCancelledBeforeResolution: false,
    })).toBe(true);
    expect(openingLocationCancellationAfterAttempt({
      openingLocationResolved: true,
      openingLocationCancelledBeforeResolution: false,
    })).toBe(false);
    expect(openingLocationCancellationAfterAttempt({
      openingLocationResolved: true,
      openingLocationCancelledBeforeResolution: true,
    })).toBe(true);
  });

  it("starts one returning-user loader only after cancelled camera settlement", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const starts: Array<HarnessViewport | HarnessBounds> = [];
    const initialMapView = { id: "initial" };
    const openingLoadViewport = { id: "hold" };
    const latestBounds = { id: "latest-bounds" };
    const render = async (
      overrides: Partial<LifecycleHarnessProps>,
    ) => {
      await act(async () => {
        root?.render(createElement(LifecycleHarness, {
          openingLocationResolved: false,
          openingLocationCancelled: false,
          openingLocationSettled: false,
          deferInitialSpatialLoad: false,
          initialMapView,
          openingLoadViewport,
          settledBounds: null,
          starts,
          ...overrides,
        }));
        await Promise.resolve();
      });
    };

    await render({});
    await render({ openingLocationCancelled: true });
    await render({
      openingLocationResolved: true,
      openingLocationCancelled: true,
    });
    expect(starts).toEqual([]);

    await render({
      openingLocationResolved: true,
      openingLocationCancelled: true,
      openingLocationSettled: true,
      settledBounds: latestBounds,
    });
    expect(starts).toEqual([latestBounds]);

    await render({
      openingLocationResolved: true,
      openingLocationCancelled: true,
      openingLocationSettled: true,
      openingLoadViewport: { id: "later-resolution" },
      settledBounds: { id: "later-camera-move" },
    });
    expect(starts).toEqual([latestBounds]);
  });

  it("starts one first-visit loader across hold-to-resolved transition", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const starts: Array<HarnessViewport | HarnessBounds> = [];
    const initialMapView = { id: "initial" };
    const base = {
      openingLocationCancelled: false,
      openingLocationSettled: false,
      deferInitialSpatialLoad: true,
      initialMapView,
      settledBounds: null,
      starts,
    };

    await act(async () => {
      root?.render(createElement(LifecycleHarness, {
        ...base,
        openingLocationResolved: false,
        openingLoadViewport: { id: "hold" },
      }));
      await Promise.resolve();
    });
    await act(async () => {
      root?.render(createElement(LifecycleHarness, {
        ...base,
        openingLocationResolved: true,
        openingLoadViewport: { id: "resolved" },
      }));
      await Promise.resolve();
    });

    expect(starts).toEqual([initialMapView]);
  });
});
