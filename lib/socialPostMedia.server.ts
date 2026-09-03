import "server-only";

import { createHash, randomUUID } from "node:crypto";

import sharp from "sharp";

import { magicBytesOk } from "@/lib/imageSafety";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
  STORAGE_BUCKET,
} from "@/lib/supabase";
import { uploadUploadedImageObject } from "@/lib/uploadedImage.server";

export const SOCIAL_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const SOCIAL_PHOTO_MAX_DIMENSION = 12_000;
export const SOCIAL_PHOTO_MAX_PIXELS = 20_000_000;
export const SOCIAL_PHOTO_OUTPUT_DIMENSION = 1_200;
export const SOCIAL_MEDIA_SIGNED_TTL_SECONDS = 180;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PreparedSocialPhoto = {
  bytes: Buffer;
  contentType: "image/jpeg";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};

export type UploadedSocialPhoto = PreparedSocialPhoto & {
  mediaId: string;
  generation: string;
  objectKey: string;
};

export type ClaimedSocialPhotoCleanup = {
  mediaId: string;
  generation: string;
  objectKey: string;
  cleanupToken: string;
};

export type SocialPhotoStorage = {
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  sign(path: string, ttlSeconds: number): Promise<string | null>;
};

export class SocialPhotoError extends Error {
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

function safeDimension(value: number | undefined): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export async function prepareSocialPhoto(file: File): Promise<PreparedSocialPhoto> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new SocialPhotoError("INVALID_TYPE", "Photo must be a JPEG, PNG, or WebP image.");
  }
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > SOCIAL_PHOTO_MAX_BYTES) {
    throw new SocialPhotoError("TOO_LARGE", "Photo must be 10 MB or smaller.");
  }
  const input = Buffer.from(await file.arrayBuffer());
  if (input.byteLength !== file.size || !magicBytesOk(input, file.type)) {
    throw new SocialPhotoError("INVALID_TYPE", "Photo must be a JPEG, PNG, or WebP image.");
  }

  try {
    const metadata = await sharp(input, { failOn: "warning", limitInputPixels: false }).metadata();
    const width = safeDimension(metadata.width);
    const height = safeDimension(metadata.height);
    if (
      width === null || height === null ||
      width > SOCIAL_PHOTO_MAX_DIMENSION || height > SOCIAL_PHOTO_MAX_DIMENSION ||
      width * height > SOCIAL_PHOTO_MAX_PIXELS
    ) {
      throw new SocialPhotoError(
        "INVALID_DIMENSIONS",
        "Photo dimensions are too large.",
      );
    }
    const bytes = await sharp(input, { failOn: "warning", limitInputPixels: SOCIAL_PHOTO_MAX_PIXELS })
      .rotate()
      .resize({
        width: SOCIAL_PHOTO_OUTPUT_DIMENSION,
        height: SOCIAL_PHOTO_OUTPUT_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
    const output = await sharp(bytes).metadata();
    const outputWidth = safeDimension(output.width);
    const outputHeight = safeDimension(output.height);
    if (outputWidth === null || outputHeight === null) {
      throw new SocialPhotoError("PROCESSING_FAILED", "Photo could not be processed.");
    }
    return {
      bytes,
      contentType: "image/jpeg",
      width: outputWidth,
      height: outputHeight,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof SocialPhotoError) throw error;
    throw new SocialPhotoError(
      "PROCESSING_FAILED",
      "Photo could not be processed. Choose another image.",
    );
  }
}

export const supabaseSocialPhotoStorage: SocialPhotoStorage = {
  async upload(path, bytes, contentType) {
    if (!isSupabaseConfigured()) {
      throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
    }
    // Through the shared writer: a feed photo is the same bytes taking the same
    // storage-js branch, so it had the same corrupted write.
    const error = await uploadUploadedImageObject(path, bytes, contentType);
    if (error) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  },
  async remove(paths) {
    if (paths.length === 0 || !isSupabaseConfigured()) return;
    const { error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(paths);
    if (error) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  },
  async sign(path, ttlSeconds) {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return error ? null : data.signedUrl;
  },
};

export async function uploadPreparedSocialPhoto(
  ownerProfileId: string,
  prepared: PreparedSocialPhoto,
  storage: SocialPhotoStorage = supabaseSocialPhotoStorage,
  requestedMediaId?: string,
  requestedObjectKey?: string,
  requestedGeneration?: string,
): Promise<UploadedSocialPhoto> {
  const mediaId = requestedMediaId ?? randomUUID();
  const generation = requestedGeneration ?? randomUUID();
  void ownerProfileId;
  const objectKey = requestedObjectKey ?? `social/${mediaId}/${generation}/image.jpg`;
  if (objectKey !== `social/${mediaId}/${generation}/image.jpg`) {
    throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(objectKey, prepared.bytes, prepared.contentType);
  return { ...prepared, mediaId, generation, objectKey };
}

export async function reserveSocialPhotoUpload(
  ownerProfileId: string,
  prepared: PreparedSocialPhoto,
  requestedMediaId?: string,
): Promise<UploadedSocialPhoto> {
  const mediaId = requestedMediaId ?? randomUUID();
  const generation = randomUUID();
  const upload = { ...prepared, mediaId, generation, objectKey: `social/${mediaId}/${generation}/image.jpg` };
  if (!isSupabaseConfigured()) return upload;
  const { data, error } = await requireSupabaseAdmin().rpc("reserve_social_post_media_upload", {
    p_owner_profile_id: ownerProfileId,
    p_media_id: mediaId,
    p_sha256: prepared.sha256,
    p_width: prepared.width,
    p_height: prepared.height,
    p_byte_size: prepared.byteSize,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row || typeof row.media_id !== "string" || typeof row.generation !== "string" ||
    typeof row.object_key !== "string") {
    throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  return { ...prepared, mediaId: row.media_id, generation: row.generation, objectKey: row.object_key };
}

export async function reconcileSocialPhotoUpload(
  ownerProfileId: string,
  mediaId: string,
  generation: string,
  storage: SocialPhotoStorage = supabaseSocialPhotoStorage,
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const admin = requireSupabaseAdmin();
  const { data: claimRows, error: claimError } = await admin.rpc(
    "claim_social_post_media_upload_cleanup",
    { p_owner_profile_id: ownerProfileId, p_media_id: mediaId, p_generation: generation },
  );
  if (claimError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  const claim = Array.isArray(claimRows) ? claimRows[0] : null;
  if (!claim || typeof claim.object_key !== "string" || typeof claim.cleanup_token !== "string" ||
    typeof claim.generation !== "string") return false;
  await storage.remove([claim.object_key]);
  const { data: finalized, error: finalizeError } = await admin.rpc(
    "finalize_social_post_media_upload_cleanup",
    { p_media_id: mediaId, p_generation: claim.generation, p_cleanup_token: claim.cleanup_token },
  );
  if (finalizeError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  return finalized === true;
}

export async function signSocialPhotoObject(
  objectKey: string,
  storage: SocialPhotoStorage = supabaseSocialPhotoStorage,
): Promise<string | null> {
  return storage.sign(objectKey, SOCIAL_MEDIA_SIGNED_TTL_SECONDS);
}

export async function purgeDetachedSocialPhotos(limit = 50): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const admin = requireSupabaseAdmin();
  const { data, error } = await admin.rpc("claim_social_post_media_cleanup_batch", {
    p_limit: Math.min(Math.max(limit, 1), 100),
  });
  if (error) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  const rows = cleanupClaims(data);
  if (rows.length === 0) return 0;
  return purgeClaimedSocialPhotoRows(
    rows,
    async (key) => {
      const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove([key]);
      if (removeError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
    },
    async (claim) => {
      const { data: finalized, error: finalizeError } = await admin.rpc("finalize_social_post_media_cleanup", {
        p_media_id: claim.mediaId,
        p_generation: claim.generation,
        p_cleanup_token: claim.cleanupToken,
      });
      if (finalizeError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
      return finalized === true;
    },
  );
}

export async function purgeOrphanedSocialPhotoUploads(limit = 50): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const admin = requireSupabaseAdmin();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const { data, error } = await admin.rpc("claim_social_post_media_upload_cleanup_batch", {
    p_limit: Math.min(Math.max(limit, 1), 100),
    p_staged_before: cutoff,
  });
  if (error) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  const rows = cleanupClaims(data);
  if (rows.length === 0) return 0;
  return purgeClaimedSocialPhotoRows(rows, async (key) => {
    const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove([key]);
    if (removeError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  }, async (claim) => {
    const { data: finalized, error: finalizeError } = await admin.rpc(
      "finalize_social_post_media_upload_cleanup",
      { p_media_id: claim.mediaId, p_generation: claim.generation, p_cleanup_token: claim.cleanupToken },
    );
    if (finalizeError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
    return finalized === true;
  });
}

function cleanupClaims(value: unknown): ClaimedSocialPhotoCleanup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.media_id !== "string" || typeof row.generation !== "string" ||
      typeof row.object_key !== "string" || typeof row.cleanup_token !== "string") return [];
    return [{
      mediaId: row.media_id,
      generation: row.generation,
      objectKey: row.object_key,
      cleanupToken: row.cleanup_token,
    }];
  });
}

export async function purgeClaimedSocialPhotoRows(
  rows: ClaimedSocialPhotoCleanup[],
  removeObject: (key: string) => Promise<void>,
  finalize: (claim: ClaimedSocialPhotoCleanup) => Promise<boolean>,
): Promise<number> {
  if (rows.length === 0) return 0;
  let purged = 0;
  let firstError: unknown = null;
  for (const claim of rows) {
    try {
      await removeObject(claim.objectKey);
      if (await finalize(claim)) purged += 1;
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
  return purged;
}
