import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { hasConfirmedAltText, NIGHT_MOMENT_ALT_TEXT_MAX } from "@/lib/nightMemory";
import { setMomentAltText } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

/**
 * Author-confirm the alt text on the caller's OWN photo Moment (Wayfinder 5.6).
 * This is a PRIVATE authoring write — deliberately NOT behind the social freeze
 * and never a publication. Saving a non-empty description IS the confirmation;
 * saving an empty one clears it. `setMomentAltText` enforces owner + has-media.
 */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  const limiterKey = `night-moment-alt-text:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const actorId = await callerUserId(request);
  if (!actorId) return publicApiError("Sign in to describe your photo.", "UNAUTHENTICATED", 401);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  if (typeof body.altText === "string" && body.altText.length > NIGHT_MOMENT_ALT_TEXT_MAX * 4) {
    // Cheap upper bound before normalisation; cleanText applies the real cap.
    return publicApiError("That description is too long.", "INVALID_REQUEST", 400);
  }
  const { id } = await context.params;
  const moment = await setMomentAltText(actorId, id, body.altText);
  return moment
    ? jsonNoStore({
        // No account/memory identifiers — mirror the other Night surfaces.
        altText: moment.altText,
        altTextConfirmed: hasConfirmedAltText(moment),
      })
    : publicApiError("Only the owner of a photo Moment can describe it.", "FORBIDDEN", 403);
}
