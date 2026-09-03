import { publicApiError } from "@/lib/apiError";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { signSocialPhotoObject } from "@/lib/socialPostMedia.server";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { isLimited } from "@/lib/pintDrops";
import { hashActor } from "@/lib/supabase";

type Context = { params: Promise<{ mediaId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function missing(): Response {
  return publicApiError("Photo not found.", "NOT_FOUND", 404, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return missing();
  const limitKey = `social-media-sign:${hashActor(access.actor.profileId)}`;
  if (await isLimited(limitKey, limitKey, 120, 60_000)) return missing();
  const { mediaId } = await context.params;
  if (!UUID.test(mediaId)) return missing();
  try {
    const objectKey = await socialPostConsentStore.mediaObjectKey(access.actor, mediaId);
    if (!objectKey) return missing();
    const signedUrl = await signSocialPhotoObject(objectKey);
    if (!signedUrl) return missing();
    return new Response(null, { status: 302, headers: { Location: signedUrl, "Cache-Control": "private, no-store" } });
  } catch { return missing(); }
}
