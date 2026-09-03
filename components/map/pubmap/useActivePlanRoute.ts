"use client";

import { useEffect, useState } from "react";

import {
  isPlanActiveNow,
  readActivePlan,
  subscribeActivePlan,
} from "@/lib/activePlan";
import type { PlanState, PlanStopDTO } from "@/lib/plan";

// C2 — the map's view of "is a plan on tonight, and what are its stops". Reuses
// the SAME client pointer (lib/activePlan) that drives the Night Mode shell card:
// when a plan is inside its active window we pull its ordered stops so the map
// can draw them through the existing crawl route paint. No active plan (or a
// pointer that's aged out of its window) → empty stops → no overlay. This hook
// carries data only; PubMap resolves the stops to venues against its live venue
// index and hands them to the existing `route` prop — one paint path, no second
// route renderer.

// Re-check the active-time window on this cadence so a plan that ages out of its
// span (start + POST) retires the map overlay without a navigation, mirroring
// useActivePlan's own WINDOW_TICK_MS. The window edges are hours wide, so 60s is
// plenty and stays off the paint/RAF hot path.
const WINDOW_TICK_MS = 60_000;

/**
 * Ordered stops of the plan that's on tonight, or [] when nothing is live.
 * SSR-safe: returns [] on the server / first paint (the active-plan pointer is
 * client-only), then upgrades after mount — no hydration mismatch.
 */
export function useActivePlanRoute(): PlanStopDTO[] {
  const [stops, setStops] = useState<PlanStopDTO[]>([]);

  useEffect(() => {
    let active = true;
    // Keep the overlay tied to the canonical plan read. A creator can save a
    // new route revision in another tab, so same-plan focus/timer events must
    // be allowed to refresh stops rather than being short-circuited by id.
    let requestController: AbortController | null = null;
    let loadedPlanId = "";

    const load = () => {
      const ref = readActivePlan();
      if (!ref || !isPlanActiveNow(ref, Date.now())) {
        requestController?.abort();
        requestController = null;
        loadedPlanId = "";
        if (active) setStops([]);
        return;
      }
      if (loadedPlanId !== ref.id) {
        loadedPlanId = ref.id;
        if (active) setStops([]);
      }
      requestController?.abort();
      requestController = new AbortController();
      const controller = requestController;
      fetch(`/api/plans/${ref.id}`, { cache: "no-store", signal: controller.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: PlanState | null) => {
          if (!active || controller !== requestController) return;
          setStops(body && Array.isArray(body.stops) ? body.stops : []);
        })
        .catch((error: unknown) => {
          if (!active || controller !== requestController) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          // Keep the last verified overlay during a transient refresh failure.
          // A new plan id was already cleared above, so this cannot show the
          // previous plan over a different active plan.
        });
    };

    load();
    const unsub = subscribeActivePlan(load);
    const timer = window.setInterval(load, WINDOW_TICK_MS);
    return () => {
      active = false;
      requestController?.abort();
      unsub();
      window.clearInterval(timer);
    };
  }, []);

  return stops;
}
