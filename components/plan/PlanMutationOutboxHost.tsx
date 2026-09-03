"use client";

// Site-wide Night Crawl outbox flusher. NightCrawlMode also flushes while the
// plan page is open; this host keeps held arrive/skip mutations moving when the
// drinker leaves /plan/[id] and signal returns elsewhere in the app.

import { useEffect } from "react";

import { requestNightModeEndingFromFlush } from "@/lib/nightModeHandoff";
import {
  applyActivePlanFlushRollback,
  flushPlanMutationOutbox,
  removePlanMutationOutboxEntry,
  subscribePlanMutationOutbox,
} from "@/lib/planMutationOutbox";

export default function PlanMutationOutboxHost() {
  useEffect(() => {
    const flush = () => {
      void flushPlanMutationOutbox().then((results) => {
        for (const result of results) {
          if (result.outcome === "confirmed") {
            requestNightModeEndingFromFlush(result);
          }
          if (
            result.outcome === "forbidden" ||
            result.outcome === "rejected" ||
            result.outcome === "conflict"
          ) {
            applyActivePlanFlushRollback(result);
            removePlanMutationOutboxEntry(result.entryId);
          }
        }
      });
    };
    flush();
    window.addEventListener("online", flush);
    const unsub = subscribePlanMutationOutbox(flush);
    return () => {
      window.removeEventListener("online", flush);
      unsub();
    };
  }, []);

  return null;
}
