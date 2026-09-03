"use client";

import { useEffect } from "react";

import { subscribeToNewDrops } from "@/lib/realtime";

// Live map pins (issue #37). One self-contained hook PubMap consumes with a
// SINGLE wiring line:
//
//     useLiveDrops(pintDrops.refreshAllDrops);
//
// On each new-drop SIGNAL it calls the supplied refresh — which is
// usePintDrops' `refreshAllDrops`, the same filtered GET /api/pint-drops read
// the initial load uses (so #29 visibility/anonymity re-applies). Re-fetching
// re-groups drops by venue, which repaints every pin halo / venue signal, so a
// drop landing on a visible venue lights its halo without any per-pin plumbing.
//
// SIGNAL ONLY: the realtime payload (the raw drop row) is NEVER read here — the
// helper hands us a bare nudge; we refetch through the filtered API. See
// lib/realtime.ts for the full privacy contract.
//
// Resilience: with no Supabase env the subscription is a no-op that instead
// polls `refresh` every 30s; a dropped channel falls back to the same poll.
// Nothing throws; the map degrades to today's fetch-on-mount behaviour.
//
// The effect re-subscribes if `refresh` identity changes — usePintDrops returns
// a stable useCallback, so in practice it subscribes once per mount.
export function useLiveDrops(refresh: () => void): void {
  useEffect(() => {
    const unsubscribe = subscribeToNewDrops(refresh, { poll: refresh });
    return unsubscribe;
  }, [refresh]);
}
