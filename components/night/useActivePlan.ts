"use client";

import { useEffect, useState } from "react";

import {
  isNightModeDismissed,
  isPlanActiveNow,
  isWithinRecapGrace,
  readActivePlan,
  subscribeActivePlan,
  subscribeNightModeDismiss,
  type ActivePlanRef,
} from "@/lib/activePlan";
import { readPendingPlanRecap, subscribePendingPlanRecap } from "@/lib/planRecap";
import { restorePlanCapability } from "@/lib/planSessionCapability";

// How often we re-check the time window, so a plan that ages out of its active
// span (start + POST) retires the card without a navigation. 60s is plenty —
// the window edges are hours wide, not seconds.
const WINDOW_TICK_MS = 60_000;

export type NightModeState = {
  /** The live plan pointer, or null when nothing is on tonight. */
  ref: ActivePlanRef | null;
  /** True when there's an active plan the user has not dismissed this session. */
  visible: boolean;
  /** True when there's an active plan that IS dismissed (show the re-open pill). */
  dismissed: boolean;
};

const IDLE: NightModeState = { ref: null, visible: false, dismissed: false };

function resolve(now: number): NightModeState {
  const ref = readActivePlan();
  if (!ref) return IDLE;
  // Once the active window closes the card normally retires — unless the night
  // ended with a private recap still unsaved on this device. That recap can only
  // be saved from this card, so it stays reachable through the recap grace
  // period. An unresolved recap seeds itself the morning after; a saved or
  // discarded one leaves no pending draft and the card retires as before.
  if (!isPlanActiveNow(ref, now)) {
    const recap = readPendingPlanRecap(ref.id);
    if (!recap || !isWithinRecapGrace(recap.completedAt, now)) return IDLE;
  }
  const dismissed = isNightModeDismissed(ref.id);
  return { ref, visible: !dismissed, dismissed };
}

/**
 * Active-plan detection for the Night Mode shell card. Reads the localStorage
 * pointer (lib/activePlan), subscribes to same-tab/cross-tab changes and to the
 * dismiss toggle, and re-evaluates the active-time window on an interval. Pure
 * SSR-safe: returns the idle state on the server and first paint, then upgrades
 * after mount (no hydration mismatch, since the pointer is client-only state).
 */
export function useActivePlan(): NightModeState {
  const [state, setState] = useState<NightModeState>(IDLE);

  useEffect(() => {
    const recompute = () => setState(resolve(Date.now()));
    recompute();
    const unsubPlan = subscribeActivePlan(recompute);
    const unsubDismiss = subscribeNightModeDismiss(recompute);
    const timer = window.setInterval(recompute, WINDOW_TICK_MS);
    return () => {
      unsubPlan();
      unsubDismiss();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (state.ref?.id) void restorePlanCapability(state.ref.id).catch(() => undefined);
  }, [state.ref?.id]);

  // Retire the card promptly when the recap that was keeping it alive past the
  // window is saved or discarded — without this the interval tick would leave a
  // resolved night's card lingering up to a minute.
  useEffect(() => {
    const id = state.ref?.id;
    if (!id) return;
    return subscribePendingPlanRecap(id, () => setState(resolve(Date.now())));
  }, [state.ref?.id]);

  return state;
}
