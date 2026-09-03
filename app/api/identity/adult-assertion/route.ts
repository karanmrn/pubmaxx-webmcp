import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

/**
 * Record the one tap that says "I'm 18 or over" (captain decision 2026-08-10,
 * migration 0103).
 *
 * The account is derived from the caller's own verified bearer token and from
 * nothing in the body, because an assertion made ABOUT somebody else is not an
 * assertion at all. The reply carries no state of its own: the caller re-asks
 * `/api/social/access`, which is the one authority on what a viewer may see.
 */
export async function POST(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError(
      "Sign in to confirm your age.",
      "UNAUTHENTICATED",
      401,
    );
  }
  const key = `adult-self-assertion:${userId}`;
  if (await isLimited(key, key)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  try {
    const assertedAt = await adultSelfAssertionStore().record(userId);
    return jsonNoStore({ assertedAt });
  } catch {
    return publicApiError(
      "We could not save that just now. Try again.",
      "UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
