import "server-only";

import { publicApiError } from "@/lib/apiError";
import { isTrustedSigningKeyUnavailableError, trustedSigningKey } from "@/lib/trustedSigningKey.server";

export function planSigningUnavailableResponse(error: unknown): Response | null {
  if (!isTrustedSigningKeyUnavailableError(error)) return null;
  return publicApiError(
    "Plan saving is temporarily unavailable. Try again.",
    "PLAN_SIGNING_UNAVAILABLE",
    503,
    { retryable: true, headers: { "Retry-After": "60" } },
  );
}

/** Fail before a durable mutation if its required verified response cannot be signed. */
export function planSigningPreflightResponse(): Response | null {
  try {
    trustedSigningKey();
    return null;
  } catch (error) {
    const unavailable = planSigningUnavailableResponse(error);
    if (unavailable) return unavailable;
    throw error;
  }
}
