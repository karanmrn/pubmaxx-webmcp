import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import {
  removeNightMomentPhoto,
  signedNightMomentPhotoUrl,
  uploadNightMomentPhoto,
} from "@/lib/nightMomentMedia";
import { addNightMoment, listNightMoments } from "@/lib/nightMemoryStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to view Night Moments.", "UNAUTHENTICATED", 401);
  const { id } = await context.params;
  const moments = await listNightMoments(ownerId, id);
  return jsonNoStore({
    moments: await Promise.all(moments.map(async (moment) => ({
      ...moment,
      mediaUrl: await signedNightMomentPhotoUrl(moment.mediaObjectKey),
    }))),
  });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `night-moment-create:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // Solo-operator emergency freeze (U15): posting a Night Moment is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to add a Night Moment.", "UNAUTHENTICATED", 401);
  const { id } = await context.params;
  const contentType = request.headers.get("content-type") ?? "";
  let body: unknown;
  let uploadedKey: string | null = null;
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const photo = form.get("photo");
      if (!(photo instanceof File) || photo.size === 0) {
        return publicApiError("Choose a photo for this Moment.", "INVALID_REQUEST", 400);
      }
      uploadedKey = await uploadNightMomentPhoto(ownerId, id, photo);
      body = {
        kind: "photo",
        caption: form.get("caption"),
        venueId: form.get("venueId"),
        occurredAt: form.get("occurredAt"),
        mediaObjectKey: uploadedKey,
        // Author-written photo description from the capture surface. Optional at
        // save time (a photo can be kept privately without one); it only becomes
        // REQUIRED at publication (the publish gate), never for a private save.
        altText: form.get("altText"),
      };
    } else {
      body = await request.json();
    }
  } catch (error) {
    if (uploadedKey) await removeNightMomentPhoto(uploadedKey);
    const message = error instanceof Error ? error.message : "That photo could not be saved.";
    const status = contentType.includes("multipart/form-data") && /unavailable|storage|configure/i.test(message)
      ? 503
      : 400;
    return publicApiErrorFromStatus(message, status);
  }
  let writeFailed = false;
  const moment = await addNightMoment(ownerId, id, body).catch(async () => {
    writeFailed = true;
    if (uploadedKey) await removeNightMomentPhoto(uploadedKey);
    return null;
  });
  if (!moment && uploadedKey) await removeNightMomentPhoto(uploadedKey);
  return moment
    ? jsonNoStore({
        moment: {
          ...moment,
          mediaUrl: await signedNightMomentPhotoUrl(moment.mediaObjectKey),
        },
      }, { status: 201 })
    : writeFailed
      ? publicApiError("That Moment could not be saved. Your draft is safe.", "UNAVAILABLE", 503, { retryable: true })
      : publicApiError("That Memory cannot accept this Moment.", "INVALID_REQUEST", 400);
}
