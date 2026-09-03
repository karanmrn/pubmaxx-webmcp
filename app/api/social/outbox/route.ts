import { publicApiError } from "@/lib/apiError";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { SocialPostConsentStoreError, socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { projectSocialVenueNames } from "@/lib/socialPostVenue.server";

export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const headers = { "Cache-Control": "private, no-store" };
  if (!access.ok) return publicApiError(access.error, access.code, access.status, { headers });
  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor");
  const limit = Number(params.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
    [...params.keys()].some((key) => key !== "cursor" && key !== "limit")) {
    return publicApiError("Owner post page is not valid.", "MALFORMED_REQUEST", 400, { headers });
  }
  try {
    const page = await socialPostConsentStore.outbox(access.actor, { cursor, limit });
    return Response.json({ ...page, posts: await projectSocialVenueNames(page.posts) }, { headers });
  }
  catch (error) {
    if (error instanceof SocialPostConsentStoreError && /page is not valid/i.test(error.message)) {
      return publicApiError("Owner post page is not valid.", "MALFORMED_REQUEST", 400, { headers });
    }
    return publicApiError("Social outbox is unavailable right now.", "SOCIAL_OUTBOX_UNAVAILABLE", 503, { retryable: true, headers });
  }
}
