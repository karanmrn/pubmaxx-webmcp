import "server-only";

import { log } from "@/lib/log";

// The bytes half of a pub photo wall: the same journey an owned profile image
// takes, pointed at a venue-scoped key instead of a profile-scoped one.
//
// staging -> signed URL -> safety scan -> promote unless the scan REFUSED.
// Refused bytes never reach the serving key, so nothing a scanner turned down
// is one request away from being public. The scan adapter is the SAME one the
// owned avatar uses (`lib/profileAvatarModeration.ts`), run through the one
// advisory policy in `lib/uploadedImageScan.server.ts`: with no key configured
// the wall still takes photos, and the report/hide lane is the safety net.
//
// The preparation itself is `lib/uploadedImage.server.ts`, shared with the
// profile slots, so the EXIF strip cannot drift between the two surfaces.

import {
  downloadUploadedImageObject,
  prepareUploadedImage,
  proveUploadedImageWrite,
  readUploadedImageObject,
  UPLOADED_IMAGE_MAX_BYTES,
  uploadUploadedImageObject,
  type DownloadedUploadedImage,
  type PreparedImage,
  type UploadedImageReadResult,
} from "@/lib/uploadedImage.server";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
  STORAGE_BUCKET,
} from "@/lib/supabase";
import {
  isVenuePhotoServingKey,
  VENUE_PHOTO_NOUN,
  VENUE_PHOTO_OUTPUT_HEIGHT,
  VENUE_PHOTO_OUTPUT_WIDTH,
  VENUE_PHOTO_STORAGE_PREFIX,
  venuePhotoServingKey,
  venuePhotoStagingKey,
} from "@/lib/venuePhotos";

export const VENUE_PHOTO_MAX_BYTES = UPLOADED_IMAGE_MAX_BYTES;
export const VENUE_PHOTO_SIGNED_TTL_SECONDS = 180;

export type PreparedVenuePhoto = PreparedImage;

export type StagedVenuePhoto = PreparedVenuePhoto & {
  venueId: string;
  photoId: string;
  stagingKey: string;
  objectKey: string;
};

export type VenuePhotoStorage = {
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  sign(path: string, ttlSeconds: number): Promise<string | null>;
  /** Read one written object back, so promotion can prove its own write. */
  readBack(path: string): Promise<UploadedImageReadResult>;
};

export class VenuePhotoError extends Error {
  constructor(
    public readonly code:
      | "INVALID_TYPE"
      | "TOO_LARGE"
      | "INVALID_DIMENSIONS"
      | "PROCESSING_FAILED"
      | "STORAGE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

/** The shared journey, in the wall's own portrait box. */
export async function prepareVenuePhoto(file: File): Promise<PreparedVenuePhoto> {
  return prepareUploadedImage(file, {
    outputWidth: VENUE_PHOTO_OUTPUT_WIDTH,
    outputHeight: VENUE_PHOTO_OUTPUT_HEIGHT,
    noun: VENUE_PHOTO_NOUN,
    maxBytes: VENUE_PHOTO_MAX_BYTES,
    fail: (code, message) => new VenuePhotoError(code, message),
  });
}

export const supabaseVenuePhotoStorage: VenuePhotoStorage = {
  async upload(path, bytes, contentType) {
    if (!isSupabaseConfigured()) {
      throw new VenuePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
    }
    // Through the shared writer, which is where the Blob wrap lives.
    const error = await uploadUploadedImageObject(path, bytes, contentType);
    if (error) throw new VenuePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  },
  readBack: readUploadedImageObject,
  async remove(paths) {
    if (paths.length === 0 || !isSupabaseConfigured()) return;
    const { error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(paths);
    if (error) throw new VenuePhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  },
  async sign(path, ttlSeconds) {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return error ? null : data.signedUrl;
  },
};

export async function stagePreparedVenuePhoto(
  venueId: string,
  photoId: string,
  prepared: PreparedVenuePhoto,
  storage: VenuePhotoStorage = supabaseVenuePhotoStorage,
): Promise<StagedVenuePhoto> {
  const stagingKey = venuePhotoStagingKey(venueId, photoId);
  const objectKey = venuePhotoServingKey(venueId, photoId);
  // Both keys are rebuilt from the pure builders and checked against the one
  // prefix, so a venue id that somehow escaped validation cannot write outside
  // the wall's own folder.
  if (
    !stagingKey.startsWith(`${VENUE_PHOTO_STORAGE_PREFIX}/${venueId}/`) ||
    !isVenuePhotoServingKey(venueId, photoId, objectKey)
  ) {
    throw new VenuePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(stagingKey, prepared.bytes, prepared.contentType);
  return { ...prepared, venueId, photoId, stagingKey, objectKey };
}

export async function promoteStagedVenuePhoto(
  staged: StagedVenuePhoto,
  storage: VenuePhotoStorage = supabaseVenuePhotoStorage,
): Promise<StagedVenuePhoto> {
  if (!isVenuePhotoServingKey(staged.venueId, staged.photoId, staged.objectKey)) {
    throw new VenuePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(staged.objectKey, staged.bytes, staged.contentType);

  // Read the serving key back before the wall claims the photo. A mangled write
  // answers 200 like any other, so without this the finding is a 404 on a wall
  // photo whose author watched it succeed days earlier.
  const proof = await proveUploadedImageWrite(staged.objectKey, staged, (key) =>
    storage.readBack(key),
  );
  if (proof === "corrupt") {
    try {
      await storage.remove([staged.objectKey]);
    } catch (error) {
      // Best-effort: the bytes are unservable either way, and no row points at
      // them yet.
      log("warn", "venue_photo.cleanup_failed", {
        venueId: staged.venueId,
        objectPath: staged.objectKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw new VenuePhotoError(
      "PROCESSING_FAILED",
      "That photo did not save correctly. Try uploading it again.",
    );
  }

  try {
    await storage.remove([staged.stagingKey]);
  } catch (error) {
    // Serving bytes are already private-owned; staging cleanup is best-effort.
    log("warn", "venue_photo.cleanup_failed", {
      venueId: staged.venueId,
      objectPath: staged.stagingKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return staged;
}

export async function discardStagedVenuePhoto(
  staged: Pick<StagedVenuePhoto, "stagingKey">,
  storage: VenuePhotoStorage = supabaseVenuePhotoStorage,
): Promise<void> {
  await storage.remove([staged.stagingKey]);
}

export async function signVenuePhotoObject(
  objectKey: string,
  storage: VenuePhotoStorage = supabaseVenuePhotoStorage,
): Promise<string | null> {
  return storage.sign(objectKey, VENUE_PHOTO_SIGNED_TTL_SECONDS);
}

export type DownloadedVenuePhoto = DownloadedUploadedImage;

/**
 * Read approved serving bytes out of the private bucket. Absent objects: null,
 * with one line saying why. Shared with the owned profile slots, because the
 * write half is shared and a second copy of "what counts as unreadable" is how
 * the two surfaces drift.
 */
export async function downloadVenuePhotoObject(
  objectKey: string,
): Promise<DownloadedVenuePhoto | null> {
  return downloadUploadedImageObject(objectKey);
}
