import "server-only";

// Public read of one approved wall photo, byte-for-byte out of the private
// bucket. A photo that is pending, flagged into review, hidden by a moderator,
// or whose author has left is a 404 - never a stale serve.
//
// The bytes are cached at the edge because an approved wall photo is immutable:
// its id is minted per upload and never reused, so a moderator hide is the only
// thing that changes an answer, and that answer is a 404 the browser is told
// not to keep.

import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { isProfileTombstoned, profileStore, type ProfileRecord } from "@/lib/profileStore";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";
import {
  downloadVenuePhotoObject,
  type DownloadedVenuePhoto,
} from "@/lib/venuePhotoMedia.server";
import { venuePhotoStore, type VenuePhotoStore } from "@/lib/venuePhotoStore";
import {
  isVenuePhotoServingKey,
  isVenuePhotoVenueId,
  type VenuePhoto,
} from "@/lib/venuePhotos";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const VENUE_PHOTO_SERVE_CACHE_CONTROL = "public, max-age=300, s-maxage=86400";

export type VenuePhotoServeDeps = {
  getPhoto: (id: string) => Promise<VenuePhoto | null>;
  getProfileById: (id: string) => Promise<ProfileRecord | null>;
  downloadObject: (objectKey: string) => Promise<DownloadedVenuePhoto | null>;
};

export const defaultVenuePhotoServeDeps: VenuePhotoServeDeps = {
  getPhoto: (id) => (venuePhotoStore() as VenuePhotoStore).getById(id),
  getProfileById: (id) => profileStore().getById(id),
  downloadObject: (objectKey) => downloadVenuePhotoObject(objectKey),
};

function notFound(): Response {
  return publicApiError("Photo not found.", "NOT_FOUND", 404, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function handleVenuePhotoServe(
  request: Request,
  params: { venueId: string; photoId: string },
  deps: VenuePhotoServeDeps = defaultVenuePhotoServeDeps,
): Promise<Response> {
  const ipHash = hashIp(clientIp(request));
  const key = `venue-photo-serve:${ipHash}`;
  if (await isLimited(key, key, 480, 60_000)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  if (!isSupabaseConfigured()) return notFound();

  const venueId = decodeURIComponent(params.venueId).trim();
  const photoId = decodeURIComponent(params.photoId).trim();
  if (!isVenuePhotoVenueId(venueId) || !UUID.test(photoId)) return notFound();

  const photo = await deps.getPhoto(photoId);
  if (!photo || photo.venueId !== venueId) return notFound();
  if (photo.moderationState !== "approved") return notFound();
  // The key is rebuilt from the row rather than trusted off it, so a hand-
  // edited object_key cannot make this route read somebody else's object.
  if (!isVenuePhotoServingKey(venueId, photoId, photo.objectKey)) return notFound();

  const author = await deps.getProfileById(photo.authorProfileId);
  if (!author || isProfileTombstoned(author)) return notFound();

  const downloaded = await deps.downloadObject(photo.objectKey);
  if (!downloaded) return notFound();

  return new Response(new Uint8Array(downloaded.bytes), {
    status: 200,
    headers: {
      "Content-Type": downloaded.contentType,
      "Cache-Control": VENUE_PHOTO_SERVE_CACHE_CONTROL,
    },
  });
}
