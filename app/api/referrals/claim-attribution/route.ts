import { NextResponse } from "next/server";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";

import { publicApiError } from "@/lib/apiError";
import { callerAuthIdentity } from "@/lib/authServer";
import { isAuthAttemptId } from "@/lib/authRedirect";
import { isProfileTombstoned, profileStore } from "@/lib/profileStore";
import { verifyReferralSignupProof } from "@/lib/referralSignupProof.server";
import { isReferralCode } from "@/lib/referrals";
import { referralStore } from "@/lib/referralStore";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";

function reply(body: unknown, status = 200): Response {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const limiterKey = `referral-claim:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const identity = await callerAuthIdentity(request);
  if (!identity) {
    return publicApiError("Sign in to record an invite.", "AUTH_REQUIRED", 401, {
      retryable: false,
    });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return publicApiError(
      "This referral handoff is invalid.",
      "INVALID_REQUEST",
      400,
      { retryable: false },
    );
  }
  const body = await request.json().catch(() => null) as
    | {
        code?: unknown;
        authAttemptId?: unknown;
        signupProof?: unknown;
      }
    | null;
  const code = body?.code;
  const authAttemptId = body?.authAttemptId;
  if (!isReferralCode(code) || !isAuthAttemptId(authAttemptId)) {
    return publicApiError(
      "This referral handoff is invalid.",
      "INVALID_REQUEST",
      400,
      { retryable: false },
    );
  }
  const proof = verifyReferralSignupProof(
    body?.signupProof,
    authAttemptId,
  );
  if (!proof) {
    return reply({
      attributed: false,
      reason: "invalid_signup_proof",
    });
  }
  if (!identity.createdAt) {
    return reply(
      { attributed: false, reason: "missing_account_creation_time" },
    );
  }

  let result: Awaited<
    ReturnType<ReturnType<typeof referralStore>["claimCode"]>
  >;
  try {
    result = await referralStore().claimCode({
      code,
      inviteeUserId: identity.id,
      inviteeCreatedAt: identity.createdAt,
      authAttemptStartedAt: proof.issuedAt,
    });
  } catch {
    return publicApiError(
      "This invite could not be recorded right now.",
      "REFERRAL_STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (result.ok) {
    // Public handle only — never the inviter user id. Absent when they have no
    // claimed live profile yet; follow-back simply stays hidden.
    let inviterUserId = result.inviterUserId;
    if (!inviterUserId) {
      // Durable RPC success shapes before WP7 omit inviter_user_id; recover
      // from the edge keyed by this invitee.
      try {
        inviterUserId = (await referralStore().getInviterForInvitee(identity.id)) ?? "";
      } catch {
        inviterUserId = "";
      }
    }
    let inviterHandle: string | undefined;
    if (inviterUserId) {
      try {
        const inviter = await profileStore().getByUserId(inviterUserId);
        if (
          inviter &&
          inviter.userId &&
          !isProfileTombstoned(inviter) &&
          inviter.handle
        ) {
          inviterHandle = inviter.handle;
        }
      } catch {
        inviterHandle = undefined;
      }
    }
    return reply({
      attributed: true,
      ...(inviterHandle ? { inviterHandle } : {}),
    });
  }
  return reply({ attributed: false, reason: result.reason });
}
