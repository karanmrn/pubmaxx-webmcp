"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  accountBoundFetch,
  captureAccountAuth,
} from "@/lib/accountBoundFetch";
import { readProviderIdentitySignal } from "@/lib/authProviderRevision";
import { markActivePlan, setActivePlanRole } from "@/lib/activePlan";
import {
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
  restorePlanCapability,
} from "@/lib/planSessionCapability";
import { discardBody } from "@/lib/responseBody";

// Records the plan being viewed as "on tonight" (lib/activePlan), so the shell's
// Night Mode card can surface it across every screen. Renders nothing — it's a
// pure side-effect marker mounted by the plan page.
//
// Gated on the same plan-member capability seam PlanCrew and NightCrawlMode
// read (lib/planSessionCapability, backed by the HttpOnly session in
// lib/planMemberCapability): only a viewer who holds host or accepted-guest
// capability for this plan gets marked. A pre-join visitor opening a shared
// /plan link has no capability yet, so nothing is marked and Night Mode never
// ambushes their join flow. An accepted mate does get Night Mode — joining
// writes the same capability event (role "guest") the host gets at creation
// (role "host"), so a mate who joins mid-visit picks this up live, no reload.
export default function ActivePlanMarker({ id, startTime }: { id: string; startTime: string }) {
  const { identityResolved, session, user } = useAuth();
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      const event = planCapabilityEvent(id);
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    },
    () => readPlanCapabilitySnapshot(id),
    () => "|0|",
  );
  const { role } = parsePlanCapabilitySnapshot(capabilitySnapshot);

  const restoreAttempt = useRef({ planId: id, identityResolved, attempted: false });

  useEffect(() => {
    if (role === "host" || role === "guest") {
      markActivePlan(id, startTime);
      setActivePlanRole(id, role);
    }
  }, [id, startTime, role]);

  useEffect(() => {
    const attempt = restoreAttempt.current;
    if (attempt.planId !== id || attempt.identityResolved !== identityResolved) {
      attempt.planId = id;
      attempt.identityResolved = identityResolved;
      attempt.attempted = false;
    }
    if (!identityResolved || role === "host" || role === "guest" || attempt.attempted) return;
    // No cached capability yet — this is either a bare visitor (fail closed,
    // mark nothing) or a member whose cookie hasn't been restored into the
    // client cache this tab. Ask once; a positive result fires the same
    // capability event and re-runs this effect with role set.
    attempt.attempted = true;
    void restorePlanCapability(id).catch(() => undefined);
  }, [id, identityResolved, role]);

  useEffect(() => {
    const auth = captureAccountAuth(user?.id ?? null, session);
    const actionSignal = readProviderIdentitySignal();
    if (!auth || (role !== "host" && role !== "guest") || actionSignal.aborted) {
      return;
    }
    let cancelled = false;
    const onAbort = (): void => {
      cancelled = true;
    };
    actionSignal.addEventListener("abort", onAbort, { once: true });
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const wait = (delayMs: number): Promise<void> => new Promise((resolve) => {
      retryTimer = setTimeout(resolve, delayMs);
    });
    const claim = async (): Promise<void> => {
      for (const delayMs of [0, 250, 1_000]) {
        if (cancelled) return;
        if (delayMs > 0) await wait(delayMs);
        if (cancelled) return;
        try {
          const response = await accountBoundFetch(
            auth,
            `/api/plans/${id}/session`,
            { method: "PUT", signal: actionSignal },
          );
          const retryableStatus = response.status === 429 || response.status === 503;
          discardBody(response);
          if (response.ok || !retryableStatus) return;
        } catch {
          // A session or network race gets the same bounded retry as a 503.
        }
      }
    };
    void claim();
    return () => {
      cancelled = true;
      actionSignal.removeEventListener("abort", onAbort);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [id, role, session, user?.id]);

  return null;
}
