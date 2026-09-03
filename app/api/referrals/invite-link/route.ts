import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import {
  ReferralIdentityDeletedError,
  referralStore,
} from "@/lib/referralStore";
import { siteOrigin } from "@/lib/siteUrl";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";

export async function POST(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const limiterKey = `referral-invite-link:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to get your invite link.", "UNAUTHENTICATED", 401);
  }
  let code: string;
  try {
    ({ code } = await referralStore().getOrCreateInviteCode(userId));
  } catch (error) {
    if (error instanceof ReferralIdentityDeletedError) {
      return publicApiError(error.message, "CONFLICT", 409);
    }
    return publicApiError("Your invite link could not be made right now.", "UNAVAILABLE", 503, { retryable: true });
  }
  const url = new URL(
    `/r/${encodeURIComponent(code)}`,
    siteOrigin(request.url) ?? request.url,
  );
  return jsonNoStore({ url: url.toString() });
}
