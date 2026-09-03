"use client";

import { useEffect } from "react";

import { analyticsCollectionAllowed, trackEvent } from "@/lib/analytics";
import { dayBucketFromDate, parseStoredDayBucket, shouldRecordDailyActivity } from "@/lib/dailyActivity";

const STORAGE_KEY = "pubmaxx:last-activity-day:v1";

/**
 * Fires the `activity_pulse` return-rate signal at most once per UTC
 * calendar day. Renders nothing. Reads/writes localStorage only after
 * consent is already granted — same fail-soft, consent-gated pattern as the
 * rest of the analytics rail (lib/analytics.ts); trackEvent itself no-ops
 * again as defence in depth.
 */
export default function DailyActivityPulse() {
  useEffect(() => {
    try {
      if (typeof window === "undefined" || !analyticsCollectionAllowed()) return;
      const now = new Date();
      const lastRecordedDayBucket = parseStoredDayBucket(window.localStorage.getItem(STORAGE_KEY));
      if (!shouldRecordDailyActivity(lastRecordedDayBucket, now)) return;
      const dayBucket = dayBucketFromDate(now);
      trackEvent("activity_pulse", { dayBucket });
      window.localStorage.setItem(STORAGE_KEY, String(dayBucket));
    } catch {
      // Analytics must never break a flow — a blocked/unavailable storage
      // just means this visit doesn't contribute a return-rate signal.
    }
  }, []);

  return null;
}
