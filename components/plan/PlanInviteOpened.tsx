"use client";

// Fires plan_invite_opened once per page load for anonymous / first-open viewers
// of a shared plan link. Members who already have a capability still count as an
// invite open when they arrive via the shared URL (source from ?vibe= when set).

import { useEffect, useRef } from "react";

import { trackEvent } from "@/lib/analytics";

export default function PlanInviteOpened({ planId }: { planId: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    let source = "shared-plan";
    try {
      const vibe = new URLSearchParams(window.location.search).get("vibe");
      if (vibe) source = "vibe-link";
    } catch {
      source = "shared-plan";
    }
    trackEvent("plan_invite_opened", { source });
    void planId;
  }, [planId]);

  return null;
}
