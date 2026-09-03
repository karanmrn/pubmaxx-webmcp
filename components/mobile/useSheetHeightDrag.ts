"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  resolveSheetHeightSnap,
  SHEET_ENTRANCE_OVERSHOOT_DAMPING,
  sheetEntranceStartHeight,
  sheetSnapCaps,
  type SheetSnap,
} from "@/lib/sheetSnap";
import { useSpringValue } from "@/lib/useSpringValue";

// Drag gesture for the bottom-anchored portal sheet. Pointer travel controls
// presented height one-to-one. Release velocity selects a projected snap and
// hands the same velocity into an interruptible spring.

const SHEET_GESTURE_MAX_WIDTH = 640;
const RUBBERBAND_CONSTANT = 0.55;
const RELEASE_PAUSE_MS = 66;
const VELOCITY_SMOOTHING = 0.55;
const MOMENTUM_VELOCITY_THRESHOLD = 0.5;

export interface SheetHeightDrag {
  sheetSnap: SheetSnap;
  setSheetSnap: (snap: SheetSnap) => void;
  settleToRest: (snap?: SheetSnap) => void;
  openAtSnap: (snap: SheetSnap, options?: { entranceOvershoot?: boolean }) => void;
  requestDismiss: (presentedHeight?: number) => void;
  sheetHeight: number;
  dragging: boolean;
  settling: boolean;
  onSheetDragStart: (event: React.PointerEvent<HTMLElement>) => void;
  onSheetDragMove: (event: React.PointerEvent<HTMLElement>) => void;
  onSheetDragEnd: (event: React.PointerEvent<HTMLElement>) => void;
}

function rubberband(overshoot: number, dimension: number): number {
  if (dimension <= 0) return 0;
  return (
    (overshoot * dimension * RUBBERBAND_CONSTANT) /
    (dimension + RUBBERBAND_CONSTANT * overshoot)
  );
}

function presentHeight(raw: number, fullCap: number): number {
  const capped =
    raw > fullCap
      ? fullCap + rubberband(raw - fullCap, fullCap)
      : raw;
  return Math.max(0, capped);
}

export function useSheetHeightDrag(onDismiss: () => void): SheetHeightDrag {
  const [sheetSnap, setRestingSnap] = useState<SheetSnap>("half");
  const [dragging, setDragging] = useState(false);
  const onDismissRef = useRef(onDismiss);
  const {
    value: sheetHeight,
    running: settling,
    animateTo,
    jumpTo,
    stop,
  } = useSpringValue(0, { response: 0.34, dampingRatio: 1 });
  const dragRef = useRef<{
    startClientY: number;
    startHeight: number;
    caps: ReturnType<typeof sheetSnapCaps>;
    startSnap: SheetSnap;
    lastY: number;
    lastTime: number;
    velocity: number;
    active: boolean;
  } | null>(null);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const gestureEnabled = useCallback(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth <= SHEET_GESTURE_MAX_WIDTH,
    [],
  );

  const capsForViewport = useCallback(
    () =>
      sheetSnapCaps(
        typeof window === "undefined" ? 0 : window.innerHeight,
        0,
      ),
    [],
  );

  const setSheetSnap = useCallback(
    (snap: SheetSnap) => {
      setRestingSnap(snap);
      animateTo(capsForViewport()[snap], { dampingRatio: 1 });
    },
    [animateTo, capsForViewport],
  );

  const settleToRest = useCallback((targetSnap: SheetSnap = sheetSnap) => {
    setRestingSnap(targetSnap);
    stop();
    animateTo(capsForViewport()[targetSnap], { dampingRatio: 1 });
  }, [animateTo, capsForViewport, sheetSnap, stop]);

  const openAtSnap = useCallback(
    (snap: SheetSnap, options?: { entranceOvershoot?: boolean }) => {
      setRestingSnap(snap);
      const targetHeight = capsForViewport()[snap];
      jumpTo(
        sheetEntranceStartHeight(
          targetHeight,
          options?.entranceOvershoot === true,
        ),
      );
      animateTo(targetHeight, {
        dampingRatio: options?.entranceOvershoot ? SHEET_ENTRANCE_OVERSHOOT_DAMPING : 1,
      });
    },
    [animateTo, capsForViewport, jumpTo],
  );

  const dismissWithVelocity = useCallback(
    (velocityPxPerMillisecond: number, presentedHeight?: number) => {
      if (presentedHeight !== undefined) {
        jumpTo(Math.max(0, presentedHeight));
      }
      animateTo(0, {
        velocity: velocityPxPerMillisecond * 1000,
        dampingRatio:
          Math.abs(velocityPxPerMillisecond) >= MOMENTUM_VELOCITY_THRESHOLD
            ? 0.8
            : 1,
        onRest: () => {
          setRestingSnap("half");
          onDismissRef.current();
        },
      });
    },
    [animateTo, jumpTo],
  );

  const requestDismiss = useCallback(
    (presentedHeight?: number) => {
      dismissWithVelocity(0, presentedHeight);
    },
    [dismissWithVelocity],
  );

  const onSheetDragStart = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!gestureEnabled()) return;
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, textarea, select")) return;
      const drawer = (
        event.currentTarget as HTMLElement
      ).closest<HTMLElement>(".mapDrawer");
      if (!drawer) return;

      stop();
      const startHeight = drawer.getBoundingClientRect().height;
      jumpTo(startHeight);
      const dockPx =
        Number.parseFloat(window.getComputedStyle(drawer).bottom) || 0;
      dragRef.current = {
        startClientY: event.clientY,
        startHeight,
        caps: sheetSnapCaps(window.innerHeight, dockPx),
        startSnap: sheetSnap,
        lastY: event.clientY,
        lastTime: performance.now(),
        velocity: 0,
        active: true,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    [gestureEnabled, jumpTo, sheetSnap, stop],
  );

  const onSheetDragMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag?.active) return;
      event.preventDefault();
      event.stopPropagation();

      const now = performance.now();
      const deltaMilliseconds = now - drag.lastTime;
      if (deltaMilliseconds > 0) {
        const instantVelocity =
          (drag.lastY - event.clientY) / deltaMilliseconds;
        drag.velocity =
          drag.velocity * (1 - VELOCITY_SMOOTHING) +
          instantVelocity * VELOCITY_SMOOTHING;
      }
      drag.lastY = event.clientY;
      drag.lastTime = now;

      const raw =
        drag.startHeight + (drag.startClientY - event.clientY);
      jumpTo(presentHeight(raw, drag.caps.full));
    },
    [jumpTo],
  );

  const onSheetDragEnd = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag?.active) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(false);

      const raw =
        drag.startHeight + (drag.startClientY - event.clientY);
      const releaseHeight = presentHeight(raw, drag.caps.full);
      const paused = performance.now() - drag.lastTime > RELEASE_PAUSE_MS;
      const velocity = paused ? 0 : drag.velocity;
      const { snap, dismissed } = resolveSheetHeightSnap({
        startSnap: drag.startSnap,
        startHeightPx: drag.startHeight,
        releaseHeightPx: releaseHeight,
        velocity,
        caps: drag.caps,
      });

      if (dismissed) {
        dismissWithVelocity(velocity);
        return;
      }

      setRestingSnap(snap);
      animateTo(drag.caps[snap], {
        velocity: velocity * 1000,
        dampingRatio:
          Math.abs(velocity) >= MOMENTUM_VELOCITY_THRESHOLD ? 0.8 : 1,
      });
    },
    [animateTo, dismissWithVelocity],
  );

  return {
    sheetSnap,
    setSheetSnap,
    settleToRest,
    openAtSnap,
    requestDismiss,
    sheetHeight,
    dragging,
    settling,
    onSheetDragStart,
    onSheetDragMove,
    onSheetDragEnd,
  };
}
