"use client";

import { useEffect } from "react";

import { trackEvent } from "@/lib/analytics";

/** One listener keeps booking analytics out of every server-rendered card. */
export default function BookingClickAnalytics(): null {
  useEffect(() => {
    function onClick(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("[data-booking-link]");
      if (!link) return;
      const venueId = link.dataset.venueId;
      const tier = link.dataset.tier;
      if (!venueId || !tier) return;
      trackEvent("booking_click", { venueId, tier });
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
