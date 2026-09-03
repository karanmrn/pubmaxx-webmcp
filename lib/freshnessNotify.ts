// Notification seam for the freshness-audit cron. A finding logs at ERROR level
// with a distinct `[freshness-audit][ALERT]` marker so it is loud enough to trip
// log-based alerting (monitors escalate error, not warn) and stays greppable —
// the advisory warn nobody read is gone. It remains a deliberate seam so a later
// push integration (Sol's push lane owns delivery: lib/push*, sw.js) can hang off
// ONE place. This module MUST NOT send pushes.
//
// TWO ALERTS, NOT ONE. A stale feed and an unmeasurable feed are different
// incidents with different owners, and merging them is exactly how this alarm
// became noise: eleven feeds the audit could not read drowned two feeds that
// really had gone stale, under a single header claiming all thirteen had breached
// a budget. So:
//   • STALE       — the data is old. A refresh job owes us a run. Has a real age.
//   • UNRESOLVED  — the audit could not determine the age at all. Says NOTHING
//                   about whether the data is good; the defect is in our reach of
//                   the artifact, and each line names the artifact and how it
//                   failed. Still an alert: silence would let a genuinely stale
//                   feed hide behind an unreadable file.
// Neither may ever be reported as fresh.

import type { FreshnessResult } from "@/lib/freshness";

export type StaleFeedNotice = {
  id: string;
  label: string;
  status: FreshnessResult["status"];
  observedAt: string | null;
  ageHours: number | null;
  detail: string;
};

export type FreshnessFindings = {
  /** Feeds whose measured age is over budget. */
  stale: StaleFeedNotice[];
  /** Feeds whose age could not be measured. Age is unknown, not fine. */
  unresolved: StaleFeedNotice[];
};

function toNotice(r: FreshnessResult): StaleFeedNotice {
  return {
    id: r.id,
    label: r.label,
    status: r.status,
    observedAt: r.observedAt,
    ageHours: r.ageHours,
    detail: r.detail,
  };
}

function logGroup(header: string, notices: readonly StaleFeedNotice[]): void {
  if (notices.length === 0) return;
  console.error(`[freshness-audit][ALERT] ${header}`);
  for (const notice of notices) {
    console.error(
      `[freshness-audit][ALERT]   ${notice.id} (${notice.status}): ${notice.detail}` +
        (notice.observedAt ? ` observedAt=${notice.observedAt}` : ""),
    );
  }
}

/**
 * Report the audit's findings, stale and unresolved kept apart. Console-only by
 * design (structured line per feed so it is greppable in Vercel logs). Returns
 * the notices it emitted so the cron response can echo them. A future notifier
 * can replace the body of this function — callers and the shape stay put.
 */
export function notifyFreshnessFindings(
  stale: readonly FreshnessResult[],
  unresolved: readonly FreshnessResult[],
): FreshnessFindings {
  const findings: FreshnessFindings = {
    stale: stale.map(toNotice),
    unresolved: unresolved.map(toNotice),
  };

  if (findings.stale.length === 0 && findings.unresolved.length === 0) {
    console.log("[freshness-audit] all tracked feeds within budget.");
    return findings;
  }

  logGroup(
    `${findings.stale.length} feed(s) breaching freshness budget:`,
    findings.stale,
  );
  logGroup(
    `${findings.unresolved.length} feed(s) whose age could not be determined ` +
      "(the data may be fine; the audit cannot see it):",
    findings.unresolved,
  );

  // Seam marker: a later alerting integration delivers `findings` from here.
  return findings;
}
