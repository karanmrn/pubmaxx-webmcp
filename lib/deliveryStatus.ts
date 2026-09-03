/**
 * Terminal disposition of one delivery attempt (push token or email address).
 * One owner so push and email seams cannot drift (repo review principle 22).
 *
 * - `sent` — provider accepted the message
 * - `skipped` — no provider configured; nothing was delivered
 * - `invalid` — hard failure the caller should prune/suppress
 * - `error` — retryable (rate limit, transient 5xx)
 */
export type DeliveryStatus = "sent" | "skipped" | "invalid" | "error";
