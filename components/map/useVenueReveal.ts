"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

import {
  revealForm,
  venuePriceRevealMotion,
  venuePriceRevealMotionClass,
  venueRevealRootClasses,
  VENUE_REVEAL_CINEMA_MS,
  VENUE_REVEAL_REDUCED_MOTION_QUERY,
  VENUE_REVEAL_SHORT_MS,
  venueRevealPrefersReducedMotion,
  type VenuePriceRevealMotion,
  type VenueRevealForm,
} from "@/lib/venueReveal";
import type { CommunityPrice } from "@/lib/communityPrice";
import { orderVenueDrinkPrices, DEFAULT_DRINK_LANE } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(VENUE_REVEAL_REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function reducedMotionSnapshot(): boolean {
  return venueRevealPrefersReducedMotion();
}

function reducedMotionServerSnapshot(): boolean {
  return true;
}

export type VenueRevealState = {
  sequence: number;
  venueId: string;
  startedAt: number;
  elapsedMs: number;
  form: VenueRevealForm;
  priceMotion: VenuePriceRevealMotion;
  priceMotionClass: string;
  interrupted: boolean;
  active: boolean;
};

export function useVenueReveal(externallyInterrupted = false) {
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    reducedMotionServerSnapshot,
  );
  const lastRevealAtRef = useRef<number | null>(null);
  const revealRunningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealRootRef = useRef<HTMLElement | null>(null);
  const [reveal, setReveal] = useState<VenueRevealState | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const interruptReveal = useCallback(() => {
    revealRunningRef.current = false;
    clearTimer();
    setReveal((current) =>
      current?.active ? { ...current, interrupted: true, active: false } : current,
    );
  }, [clearTimer]);

  const beginReveal = useCallback(
    (
      venueId: string,
      rows: readonly CommunityPrice[] | undefined,
      lane: DrinkCategory = DEFAULT_DRINK_LANE,
      options?: { startedAt?: number; form?: VenueRevealForm; sequence?: number },
    ) => {
      if (prefersReducedMotion) {
        revealRunningRef.current = false;
        clearTimer();
        setReveal(null);
        return false;
      }
      const requestedStartAt = options?.startedAt;
      const visualStartAt =
        typeof requestedStartAt === "number" && Number.isFinite(requestedStartAt)
          ? requestedStartAt
          : Date.now();
      const form = options?.form ?? (revealRunningRef.current
        ? "short"
        : revealForm(visualStartAt, lastRevealAtRef.current));
      lastRevealAtRef.current = visualStartAt;
      revealRunningRef.current = form === "full";
      const duration = form === "full" ? VENUE_REVEAL_CINEMA_MS : VENUE_REVEAL_SHORT_MS;
      const elapsed = Math.max(0, Date.now() - visualStartAt);
      const ordered = orderVenueDrinkPrices(rows, lane);
      const lead = ordered[0]?.price;
      const priceMotion = venuePriceRevealMotion(
        { communityLead: lead },
        visualStartAt,
      );
      if (elapsed >= duration) {
        revealRunningRef.current = false;
        clearTimer();
        setReveal({
          sequence: options?.sequence ?? 0,
          venueId,
          startedAt: visualStartAt,
          elapsedMs: elapsed,
          form,
          priceMotion,
          priceMotionClass: venuePriceRevealMotionClass(priceMotion),
          interrupted: false,
          active: false,
        });
        return true;
      }
      clearTimer();
      setReveal({
        sequence: options?.sequence ?? 0,
        venueId,
        startedAt: visualStartAt,
        elapsedMs: elapsed,
        form,
        priceMotion,
        priceMotionClass: venuePriceRevealMotionClass(priceMotion),
        interrupted: false,
        active: true,
      });
      timerRef.current = setTimeout(() => {
        revealRunningRef.current = false;
        setReveal((current) =>
          current?.venueId === venueId
            ? { ...current, active: false }
            : current,
        );
        timerRef.current = null;
      }, duration - elapsed);
      return true;
    },
    [clearTimer, prefersReducedMotion],
  );

  const updateRevealPriceMotion = useCallback(
    (
      venueId: string,
      rows: readonly CommunityPrice[] | undefined,
      lane: DrinkCategory = DEFAULT_DRINK_LANE,
    ) => {
      setReveal((current) => {
        if (!current?.active || current.venueId !== venueId) return current;
        const lead = orderVenueDrinkPrices(rows, lane)[0]?.price;
        const priceMotion = venuePriceRevealMotion({ communityLead: lead }, Date.now());
        return {
          ...current,
          priceMotion,
          priceMotionClass: venuePriceRevealMotionClass(priceMotion),
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (!prefersReducedMotion) return;
    revealRunningRef.current = false;
    clearTimer();
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setReveal(null);
    });
    return () => {
      cancelled = true;
    };
  }, [clearTimer, prefersReducedMotion]);

  useEffect(() => {
    if (!reveal?.active || !revealRootRef.current) return;
    let frame = 0;
    const tick = () => {
      revealRootRef.current?.style.setProperty(
        "--venue-reveal-elapsed",
        `${Math.max(0, Date.now() - reveal.startedAt)}ms`,
      );
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [reveal?.active, reveal?.startedAt]);

  useEffect(() => clearTimer, [clearTimer]);

  const rootClasses =
    reveal?.active && !reveal.interrupted && !externallyInterrupted
      ? venueRevealRootClasses({
          active: true,
          form: reveal.form,
          interrupted: false,
        })
      : "";

  const revealStyle: CSSProperties | undefined =
    reveal?.active && !externallyInterrupted
    ? ({
        "--venue-reveal-elapsed": `${reveal.elapsedMs}ms`,
      } as CSSProperties)
    : undefined;

  const entranceOvershoot = Boolean(
    reveal?.active &&
      reveal.form === "full" &&
      !reveal.interrupted &&
      !externallyInterrupted,
  );

  return {
    reveal,
    beginReveal,
    updateRevealPriceMotion,
    interruptReveal,
    revealRootRef,
    rootClasses,
    revealStyle,
    entranceOvershoot,
  };
}
