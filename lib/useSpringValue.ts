"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  isSpringSettled,
  stepSpring,
  type SpringState,
} from "@/lib/springMotion";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type SpringAnimationOptions = {
  /** Presentation velocity in value units per second. */
  velocity?: number;
  dampingRatio?: number;
  onRest?: () => void;
};

export type SpringValueController = {
  value: number;
  running: boolean;
  animateTo: (target: number, options?: SpringAnimationOptions) => void;
  jumpTo: (value: number) => void;
  stop: () => SpringState;
};

export function useSpringValue(
  initialValue: number,
  {
    response = 0.34,
    dampingRatio = 1,
  }: {
    response?: number;
    dampingRatio?: number;
  } = {},
): SpringValueController {
  const [value, setValue] = useState(initialValue);
  const [running, setRunning] = useState(false);
  const stateRef = useRef<SpringState>({ value: initialValue, velocity: 0 });
  const targetRef = useRef(initialValue);
  const responseRef = useRef(response);
  const dampingRef = useRef(dampingRatio);
  const frameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const onRestRef = useRef<(() => void) | undefined>(undefined);
  const reducedMotionRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    responseRef.current = response;
  }, [response]);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    lastTimestampRef.current = null;
  }, []);

  const finishAtTarget = useCallback(() => {
    cancelFrame();
    const target = targetRef.current;
    stateRef.current = { value: target, velocity: 0 };
    if (mountedRef.current) {
      setValue(target);
      setRunning(false);
    }
    const onRest = onRestRef.current;
    onRestRef.current = undefined;
    onRest?.();
  }, [cancelFrame]);

  const runFrame = useCallback(
    function tick(timestamp: number) {
      const lastTimestamp = lastTimestampRef.current;
      lastTimestampRef.current = timestamp;

      if (lastTimestamp !== null) {
        const next = stepSpring(
          stateRef.current,
          targetRef.current,
          (timestamp - lastTimestamp) / 1000,
          {
            response: responseRef.current,
            dampingRatio: dampingRef.current,
          },
        );
        stateRef.current = next;
        if (mountedRef.current) setValue(next.value);

        if (isSpringSettled(next, targetRef.current)) {
          finishAtTarget();
          return;
        }
      }

      frameRef.current = requestAnimationFrame(tick);
    },
    [finishAtTarget],
  );

  const startFrame = useCallback(() => {
    if (frameRef.current !== null) return;
    lastTimestampRef.current = null;
    frameRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const animateTo = useCallback(
    (target: number, options: SpringAnimationOptions = {}) => {
      targetRef.current = target;
      dampingRef.current = options.dampingRatio ?? dampingRatio;
      onRestRef.current = options.onRest;
      if (options.velocity !== undefined) {
        stateRef.current.velocity = options.velocity;
      }

      if (reducedMotionRef.current) {
        finishAtTarget();
        return;
      }

      if (isSpringSettled(stateRef.current, target)) {
        finishAtTarget();
        return;
      }
      setRunning(true);
      startFrame();
    },
    [dampingRatio, finishAtTarget, startFrame],
  );

  const jumpTo = useCallback(
    (nextValue: number) => {
      cancelFrame();
      onRestRef.current = undefined;
      targetRef.current = nextValue;
      stateRef.current = { value: nextValue, velocity: 0 };
      if (mountedRef.current) {
        setValue(nextValue);
        setRunning(false);
      }
    },
    [cancelFrame],
  );

  const stop = useCallback((): SpringState => {
    cancelFrame();
    onRestRef.current = undefined;
    if (mountedRef.current) setRunning(false);
    return stateRef.current;
  }, [cancelFrame]);

  useEffect(() => {
    mountedRef.current = true;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    reducedMotionRef.current = media.matches;
    const onChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
      if (event.matches && frameRef.current !== null) finishAtTarget();
    };
    media.addEventListener("change", onChange);
    return () => {
      mountedRef.current = false;
      media.removeEventListener("change", onChange);
      cancelFrame();
      onRestRef.current = undefined;
    };
  }, [cancelFrame, finishAtTarget]);

  return { value, running, animateTo, jumpTo, stop };
}
