import "server-only";

import { randomUUID } from "node:crypto";

import { MOMENT_MAX_PHOTO_BYTES } from "@/lib/momentPhotoEditor";
import { deletePhotos, uploadPhoto } from "@/lib/pintDropsStore";
import { isSupabaseConfigured, requireSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";

export async function uploadNightMomentPhoto(
  ownerId: string,
  memoryId: string,
  file: File,
): Promise<string> {
  if (!isSupabaseConfigured()) {
    throw new Error("Photo storage is unavailable. Your draft is still on this device.");
  }
  return uploadPhoto(
    "venue",
    `night-moments/${ownerId}/${memoryId}`,
    randomUUID(),
    file,
    MOMENT_MAX_PHOTO_BYTES,
  );
}

export async function removeNightMomentPhoto(key: string): Promise<void> {
  await deletePhotos([key]);
}

/** Default signed-URL lifetime for owner-facing surfaces (Memory workspace). */
export const NIGHT_MOMENT_PHOTO_TTL_SECONDS = 60 * 60;

/**
 * Short lifetime for the PUBLIC recap page. Supabase signed URLs cannot be
 * revoked, so a withdrawn consent leaves an already-issued URL fetchable until
 * it expires. The public page is dynamic and re-signs on every render, so a
 * tight TTL bounds that exposure window to minutes — a withdrawn photo stops
 * being served on the next render and its last URL dies shortly after.
 */
export const PUBLIC_RECAP_PHOTO_TTL_SECONDS = 180;

export async function signedNightMomentPhotoUrl(
  key: string | null,
  ttlSeconds: number = NIGHT_MOMENT_PHOTO_TTL_SECONDS,
): Promise<string | null> {
  if (!key || !isSupabaseConfigured()) return null;
  const { data, error } = await requireSupabaseAdmin()
    .storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(key, ttlSeconds);
  return error ? null : data.signedUrl;
}
