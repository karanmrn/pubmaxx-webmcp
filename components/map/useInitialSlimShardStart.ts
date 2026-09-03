"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { resolveInitialSlimShardLifecycle } from "@/lib/slimShards";

export type InitialSlimShardStart<Viewport, Bounds> = {
  viewport: Viewport;
  settledBounds: Bounds | null;
};

export function useInitialSlimShardStart<Viewport, Bounds>({
  openingLocationResolved,
  openingLocationCancelled,
  openingLocationSettled,
  deferInitialSpatialLoad,
  initialMapView,
  openingLoadViewport,
  settledBounds,
}: {
  openingLocationResolved: boolean;
  openingLocationCancelled: boolean;
  openingLocationSettled: boolean;
  deferInitialSpatialLoad: boolean;
  initialMapView: Viewport;
  openingLoadViewport: Viewport;
  settledBounds: Bounds | null;
}): {
  ready: boolean;
  viewport: Viewport;
  readStart: () => InitialSlimShardStart<Viewport, Bounds>;
} {
  const lifecycle = resolveInitialSlimShardLifecycle({
    openingLocationResolved,
    openingLocationCancelled,
    openingLocationSettled,
    deferInitialSpatialLoad,
    initialMapView,
    openingLoadViewport,
  });
  const start = useMemo<InitialSlimShardStart<Viewport, Bounds>>(
    () => ({
      viewport: lifecycle.viewport,
      settledBounds:
        openingLocationCancelled && openingLocationSettled
          ? settledBounds
          : null,
    }),
    [
      lifecycle.viewport,
      openingLocationCancelled,
      openingLocationSettled,
      settledBounds,
    ],
  );
  const latestStartRef = useRef(start);

  useEffect(() => {
    latestStartRef.current = start;
  }, [start]);

  const readStart = useCallback(() => latestStartRef.current, []);

  return {
    ready: lifecycle.ready,
    viewport: lifecycle.viewport,
    readStart,
  };
}
