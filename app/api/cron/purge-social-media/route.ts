import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import {
  purgeDetachedSocialPhotos,
  purgeOrphanedSocialPhotoUploads,
} from "@/lib/socialPostMedia.server";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
} from "@/lib/socialLaunch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return jsonNoStore({ ok: true, skipped: "social_rollback" });
  }
  try {
    const [detached, orphaned] = await Promise.all([
      purgeDetachedSocialPhotos(50),
      purgeOrphanedSocialPhotoUploads(50),
    ]);
    return jsonNoStore({ ok: true, detached, orphaned });
  } catch {
    return publicApiError("Social photo cleanup is unavailable.", "UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { ok: false },
    });
  }
}
