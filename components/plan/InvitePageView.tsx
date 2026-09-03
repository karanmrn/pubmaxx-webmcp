"use client";

import { useEffect, useRef } from "react";

import { analyticsCollectionAllowed, trackEvent } from "@/lib/analytics";

// Fires invite_page_viewed once per mount of the public /invite/[token] page.
// Mirrors PintIndexArrival.tsx's ref-guarded mount-once pattern: a
// re-running effect (React strict mode, a prop change) must not double-count
// a view. hasRsvps is server-computed (the page already loads the RSVP
// summary to render the card) so the funnel can split "guest lands on an
// empty invite" from "guest lands on one with a guest list already".
export default function InvitePageView({ hasRsvps }: { hasRsvps: boolean }) {
  const recorded = useRef(false);

  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    if (!analyticsCollectionAllowed()) return;
    trackEvent("invite_page_viewed", { hasRsvps });
  }, [hasRsvps]);

  return null;
}
