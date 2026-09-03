// Email delivery seam. ONE interface, TWO implementations — a no-op that is
// active until email-provider credentials exist, and a Resend stub whose SHAPE
// is final but whose HTTP body is a deliberate later drop. Selection mirrors the
// env-based store seam (lib/storeBackend.ts selectStore) and the push seam
// (lib/pushProvider.ts selectPushProvider): the moment RESEND_API_KEY (+ a
// verified EMAIL_FROM) lands, selectEmailProvider() flips to the real sender
// with no caller change.
//
// PROVIDER DECISION (owner): Resend is the recommended default — first-class
// transactional API, generous free tier, trivial single-endpoint HTTP send, and
// DKIM/SPF via a verified domain (hello@pubmaxxing.com is already on the owner
// queue). Postmark is the documented alternative: same seam, only isResend*
// / resendEmailProvider swap for Postmark equivalents (POST
// https://api.postmarkapp.com/email, header `X-Postmark-Server-Token`, JSON
// { From, To, Subject, HtmlBody, TextBody }). Either drops into the stub below
// without touching any caller. No email SDK is a dependency yet.
//
// The real resendEmailProvider will POST to https://api.resend.com/emails per
// message (or use the /emails/batch endpoint for &gt;1 recipient) with:
//   headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" }
//   body:    { from: EMAIL_FROM, to: [msg.to], subject: msg.subject,
//              html: msg.html, text: msg.text }
// mapping a 200 → { status: "sent", id: <resend id> }, a 4xx invalid-recipient
// → { status: "invalid" }, and a 429/5xx → { status: "error" } (retryable).
// That transport is intentionally NOT implemented here.

import type { DeliveryStatus } from "@/lib/deliveryStatus";

/** A single email, provider-agnostic. Rendered HTML + a plain-text alternative
 *  (both required — every message ships a text/plain part for deliverability and
 *  for clients that refuse HTML). */
export type EmailMessage = {
  /** Recipient address. Validated by the caller before it reaches send(). */
  to: string;
  subject: string;
  /** Email-safe HTML (inline styles only — no external CSS/fonts/images). */
  html: string;
  /** Plain-text alternative of the same content. */
  text: string;
};

/** Terminal disposition of a single message in a send. `invalid` addresses are
 *  pruned/suppressed by the caller (hard bounce / malformed); `error` is
 *  retryable (rate limit, transient 5xx).
 *  Derived from the shared DeliveryStatus owner (lib/deliveryStatus.ts). */
export type EmailDeliveryStatus = DeliveryStatus;

export type PerMessageResult = {
  to: string;
  status: EmailDeliveryStatus;
  /** Provider message id when sent — for logging / idempotency, never a secret. */
  id?: string;
  /** Human-readable cause for skipped/invalid/error — never a secret. */
  reason?: string;
};

export interface EmailProvider {
  /** Deliver each message. Resolves one result per input message, in input
   *  order; never throws for a per-message failure (that is a result, not a
   *  throw). A whole-batch misconfiguration MAY throw (see resendEmailProvider). */
  send(messages: readonly EmailMessage[]): Promise<PerMessageResult[]>;
}

/** The env keys the real Resend sender needs. Both must be present to go live —
 *  an API key with no verified From address cannot deliver. */
export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Active until email-provider credentials exist. Logs the count once and reports
 * every message as `skipped` — a truthful "nothing was delivered" the batch can
 * summarise without special-casing. Never sends, never throws.
 */
export const noopEmailProvider: EmailProvider = {
  async send(messages) {
    if (messages.length > 0) {
      console.info(
        `[emailProvider:noop] would deliver "${messages[0].subject}" to ${messages.length} recipient(s) — email provider not configured, skipping.`,
      );
    }
    return messages.map((msg) => ({
      to: msg.to,
      status: "skipped" as const,
      reason: "email_provider_not_configured",
    }));
  },
};

/**
 * Resend sender — STUB. The env is read and validated so a misconfiguration
 * fails loud, but the HTTP delivery is the later drop-in. Reaching send() means
 * selectEmailProvider() chose Resend (keys present) yet the transport is not
 * wired, so it throws a clear, actionable error rather than silently dropping
 * mail.
 */
export const resendEmailProvider: EmailProvider = {
  async send() {
    if (!isResendConfigured()) {
      throw new Error(
        "resendEmailProvider: RESEND_API_KEY and EMAIL_FROM must both be set.",
      );
    }
    throw new Error(
      "resendEmailProvider: Resend HTTP delivery is not implemented yet (credentials present but transport is a pending drop-in). See lib/emailProvider.ts.",
    );
  },
};

/** Single selection point (mirrors lib/storeBackend.ts selectStore and
 *  lib/pushProvider.ts selectPushProvider): the real Resend sender when its env
 *  keys exist, the no-op otherwise. */
export function selectEmailProvider(): EmailProvider {
  return isResendConfigured() ? resendEmailProvider : noopEmailProvider;
}
