// Shared retry policy for asynchronous moderation jobs (social posts, social
// interactions). One schedule, one retryability check, one attempts cap - a
// change to abuse tuning only needs one edit instead of drifting across the
// stores that queue these jobs.

/** A job stops retrying once it has made this many attempts. */
export const MODERATION_RETRY_MAX_ATTEMPTS = 8;

/**
 * An error is retryable unless it explicitly says otherwise. A malformed or
 * unrecognised error shape (not an object, no `retryable` field) is treated
 * as retryable, since only a provider adapter that deliberately marks its
 * own error `retryable: false` should stop the retry loop.
 */
export function isModerationErrorRetryable(error: unknown): boolean {
  return (
    !error ||
    typeof error !== "object" ||
    !("retryable" in error) ||
    (error as { retryable?: unknown }).retryable !== false
  );
}

/** Exponential backoff: 1 minute doubling, capped at 60 minutes. */
export function moderationRetryBackoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), 3_600_000);
}

/** Whether a job should retry again after this attempt. */
export function moderationJobShouldRetry(error: unknown, attempts: number): boolean {
  return isModerationErrorRetryable(error) && attempts < MODERATION_RETRY_MAX_ATTEMPTS;
}
