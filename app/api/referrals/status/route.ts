import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { referralStore } from "@/lib/referralStore";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";

export async function GET(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to view referral progress.", "UNAUTHENTICATED", 401);
  }
  try {
    return jsonNoStore(await referralStore().privateStatus(userId));
  } catch {
    return publicApiError("Referral progress is unavailable right now.", "UNAVAILABLE", 503, { retryable: true });
  }
}
