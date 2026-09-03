import { isModerator, moderatorStaffRoleId } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { signSocialPhotoObject } from "@/lib/socialPostMedia.server";
import { clientIp, hashIp } from "@/lib/supabase";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";

type Context = { params: Promise<{ mediaId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function missing(): Response {
  return publicApiError("Photo not found.", "NOT_FOUND", 404, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request, context: Context): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  if (!isModerator(request)) {
    return publicApiError("Moderator access required.", "FORBIDDEN", 403, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const staffRoleId = moderatorStaffRoleId(request);
  if (!staffRoleId) {
    return publicApiError("Social moderation is unavailable.", "UNAVAILABLE", 503, {
      retryable: true,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const limitKey = `admin-social-media:${hashIp(clientIp(request))}`;
  if (await isLimited(limitKey, limitKey, 120, 60_000)) return missing();
  const { mediaId } = await context.params;
  if (!UUID.test(mediaId)) return missing();
  try {
    const objectKey = await socialPostConsentStore.adminMediaObjectKey(staffRoleId, mediaId);
    if (!objectKey) return missing();
    const signedUrl = await signSocialPhotoObject(objectKey);
    if (!signedUrl) return missing();
    return new Response(null, {
      status: 302,
      headers: {
        Location: signedUrl,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return publicApiError("Social post photo is unavailable.", "UNAVAILABLE", 503, {
      retryable: true,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
