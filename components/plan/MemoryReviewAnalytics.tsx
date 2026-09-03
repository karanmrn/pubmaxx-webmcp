"use client";

import { useEffect } from "react";

import { trackEvent, trackMeaningfulCoreAction } from "@/lib/analytics";

/** Records an explicit visit to the completed Plan's private full recap. */
export default function MemoryReviewAnalytics() {
  useEffect(() => {
    trackEvent("memory_reviewed", { source: "full_recap" });
    trackMeaningfulCoreAction("memory_reviewed");
  }, []);

  return null;
}
