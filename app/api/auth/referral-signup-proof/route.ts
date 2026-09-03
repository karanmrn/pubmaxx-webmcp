import { NextResponse } from "next/server";

import { publicApiError } from "@/lib/apiError";
import { isAuthAttemptId } from "@/lib/authRedirect";
import { mintReferralSignupProof } from "@/lib/referralSignupProof.server";

export async function GET(request: Request): Promise<Response> {
  const attemptId = new URL(request.url).searchParams.get("attempt");
  if (!isAuthAttemptId(attemptId)) {
    return publicApiError(
      "Sign-up could not be prepared.",
      "INVALID_AUTH_ATTEMPT",
      400,
      { retryable: false },
    );
  }
  try {
    return NextResponse.json(
      { proof: mintReferralSignupProof(attemptId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return publicApiError(
      "Sign-up could not be prepared right now.",
      "SIGNUP_PROOF_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
