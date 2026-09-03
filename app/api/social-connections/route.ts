import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerUserId } from "@/lib/authServer";
import { socialConnectionStore } from "@/lib/socialConnectionStore";
import { publicSocialConnection } from "@/lib/socialConnections";
import { assertServerEnv } from "@/lib/serverEnv";
import { socialProviderAvailability } from "@/lib/socialOAuth";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to manage connected accounts.", "AUTH_REQUIRED", 401);
  try {
    const rows = await socialConnectionStore().list(ownerId);
    return jsonNoStore({
      connections: rows.map(publicSocialConnection),
      providers: socialProviderAvailability(),
    });
  } catch {
    return publicApiError("Connected accounts are unavailable.", "SOCIAL_CONNECTIONS_UNAVAILABLE", 503, { retryable: true });
  }
}
