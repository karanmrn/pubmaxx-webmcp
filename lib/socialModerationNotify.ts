// Operator alert seam for stranded Social moderation (Social Launch WP4).
//
// Avatar uploads scan ADVISORY at the route, so an OpenAI outage surfaces
// nowhere but this log. The ported social-post queue can still leave posts
// `pending` on outage with nothing for a human to review. This module reports
// a growing pending backlog and repeated/terminal moderation failures as their
// own named finding - never as silence.
//
// Console-only today (same posture as lib/freshnessNotify): ERROR lines with a
// distinct `[social-moderation][ALERT]` marker for log-based monitors. Returns
// the findings so the cron response can echo them. MUST NOT send pushes.

import "server-only";

import type { SocialPostModerationResult } from "@/lib/socialPostStore";
import { checkRateLimitDurableDetailed } from "@/lib/supabase";

/** Counts the durable/memory moderation queue may surface to operators. */
export type SocialModerationBacklog = {
  /** Visible posts still awaiting a usable moderation decision. */
  pending: number;
  /** Pending posts whose job has exhausted retries (stranded on outage). */
  strandedTerminal: number;
  /** Age in ms of the oldest pending job, or null when the queue is empty. */
  oldestPendingAgeMs: number | null;
};

export type SocialModerationFinding = {
  kind: "pending_backlog" | "stranded_terminal" | "repeated_failures";
  detail: string;
  pending: number;
  strandedTerminal: number;
  oldestPendingAgeMs: number | null;
  terminalErrors?: number;
};

export type SocialModerationFindings = {
  findings: SocialModerationFinding[];
};

/** Pending posts above this count are a named finding on their own. */
export const SOCIAL_MODERATION_PENDING_ALERT_FLOOR = 10;
/** A pending job older than this (with any count) is a named finding. */
export const SOCIAL_MODERATION_PENDING_AGE_ALERT_MS = 30 * 60 * 1000;
/** Repeat an unchanged operator alert no more than once per shift. */
export const SOCIAL_MODERATION_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** Alert delivery must not wait on operational state for the cron lifetime. */
export const SOCIAL_MODERATION_ALERT_STATE_TIMEOUT_MS = 500;

const localAlertWindows = new Map<string, number>();

/**
 * Pure evaluation of backlog + last drain. Kept free of I/O so unit tests can
 * assert the alert contract without a cron or store.
 */
export function evaluateSocialModerationFindings(
  backlog: SocialModerationBacklog,
  lastRun?: Pick<SocialPostModerationResult, "terminalErrors" | "retried">,
): SocialModerationFindings {
  const findings: SocialModerationFinding[] = [];
  const base = {
    pending: backlog.pending,
    strandedTerminal: backlog.strandedTerminal,
    oldestPendingAgeMs: backlog.oldestPendingAgeMs,
  };

  if (backlog.strandedTerminal > 0) {
    findings.push({
      kind: "stranded_terminal",
      detail:
        `${backlog.strandedTerminal} Social post(s) are still pending after ` +
        "moderation retries were exhausted. An outage must not read as nothing to review.",
      ...base,
    });
  }

  const aged =
    backlog.oldestPendingAgeMs != null &&
    backlog.oldestPendingAgeMs >= SOCIAL_MODERATION_PENDING_AGE_ALERT_MS;
  if (backlog.pending >= SOCIAL_MODERATION_PENDING_ALERT_FLOOR || aged) {
    const ageMinutes =
      backlog.oldestPendingAgeMs == null
        ? null
        : Math.round(backlog.oldestPendingAgeMs / 60_000);
    findings.push({
      kind: "pending_backlog",
      detail:
        `${backlog.pending} Social post(s) remain pending` +
        (ageMinutes != null ? ` (oldest about ${ageMinutes} minutes)` : "") +
        ". The moderation queue is growing or stuck.",
      ...base,
    });
  }

  const terminalErrors = lastRun?.terminalErrors ?? 0;
  if (terminalErrors > 0) {
    findings.push({
      kind: "repeated_failures",
      detail:
        `The latest moderation drain recorded ${terminalErrors} terminal ` +
        "failure(s). Posts may stay held with no decision.",
      ...base,
      terminalErrors,
    });
  }

  return { findings };
}

function logFindings(findings: readonly SocialModerationFinding[]): void {
  console.error(
    `[social-moderation][ALERT] ${findings.length} moderation finding(s):`,
  );
  for (const finding of findings) {
    console.error(
      `[social-moderation][ALERT]   ${finding.kind}: ${finding.detail}` +
        ` pending=${finding.pending} stranded=${finding.strandedTerminal}`,
    );
  }
}

function alertFingerprint(findings: readonly SocialModerationFinding[]): string {
  const kinds = findings.map((finding) => finding.kind).sort().join(",");
  const first = findings[0];
  const terminalErrors = findings.reduce(
    (total, finding) => total + (finding.terminalErrors ?? 0),
    0,
  );
  return [kinds, first?.pending ?? 0, first?.strandedTerminal ?? 0, terminalErrors].join(":");
}

function isLocallySuppressed(key: string, now: number): boolean {
  for (const [entry, expiresAt] of localAlertWindows) {
    if (expiresAt <= now) localAlertWindows.delete(entry);
  }
  const expiresAt = localAlertWindows.get(key);
  if (expiresAt != null && expiresAt > now) return true;
  localAlertWindows.set(key, now + SOCIAL_MODERATION_ALERT_COOLDOWN_MS);
  return false;
}

async function isAlertSuppressed(
  findings: readonly SocialModerationFinding[],
): Promise<boolean> {
  const fingerprint = alertFingerprint(findings);
  const key = `social-moderation-alert:${fingerprint}`;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const durableVerdict = checkRateLimitDurableDetailed(
    key,
    1,
    SOCIAL_MODERATION_ALERT_COOLDOWN_MS,
    controller.signal,
  ).then(({ verdict }) => verdict, () => null);
  const deadline = new Promise<null>((resolve) => {
    timeout = setTimeout(
      () => {
        controller.abort(new Error("Moderation alert state lookup timed out."));
        resolve(null);
      },
      SOCIAL_MODERATION_ALERT_STATE_TIMEOUT_MS,
    );
  });
  const verdict = await Promise.race([durableVerdict, deadline]);
  if (timeout) clearTimeout(timeout);
  if (verdict != null) return verdict;
  return isLocallySuppressed(key, Date.now());
}

/**
 * Report stranded/growing Social moderation. Console-only by design. Returns
 * the findings so the cron can echo them. A later notifier can replace the
 * body - callers and the shape stay put.
 */
export async function notifySocialModerationFindings(
  backlog: SocialModerationBacklog,
  lastRun?: Pick<SocialPostModerationResult, "terminalErrors" | "retried">,
): Promise<SocialModerationFindings> {
  const evaluated = evaluateSocialModerationFindings(backlog, lastRun);
  if (
    evaluated.findings.length > 0 &&
    !(await isAlertSuppressed(evaluated.findings))
  ) {
    logFindings(evaluated.findings);
  }
  return evaluated;
}
