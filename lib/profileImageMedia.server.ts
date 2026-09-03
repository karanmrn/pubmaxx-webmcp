import "server-only";

import { randomUUID } from "node:crypto";

import { log } from "@/lib/log";

import {
  isProfileImageServingKey,
  profileImageServingKey,
  profileImageSlotSpec,
  profileImageStagingKey,
  type ProfileImageSlot,
} from "@/lib/profileImageSlots";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
  STORAGE_BUCKET,
} from "@/lib/supabase";
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

export const PROFILE_IMAGE_MAX_BYTES = UPLOADED_IMAGE_MAX_BYTES;
export const PROFILE_IMAGE_SIGNED_TTL_SECONDS = 180;

export type PreparedProfileImage = PreparedImage;

export type UploadedProfileImage = PreparedProfileImage & {
  slot: ProfileImageSlot;
  profileId: string;
  generation: string;
  stagingKey: string;
  objectKey: string;
};

export type ProfileImageStorage = {
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  sign(path: string, ttlSeconds: number): Promise<string | null>;
  /**
   * Read one written object back, so promotion can prove its own write. Not
   * optional: a storage nobody can read back is one whose corruption surfaces
   * days later as a serve 404 (`proveUploadedImageWrite`).
   */
  readBack(path: string): Promise<UploadedImageReadResult>;
  listImageKeys?(slot: ProfileImageSlot, profileId: string): Promise<string[]>;
};

export class ProfileImageError extends Error {
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

/**
 * The shared journey (`lib/uploadedImage.server.ts`), pointed at this slot's own
 * box and noun. A cover keeps its own aspect (height stays null) so a wide
 * backdrop is never squared off.
 */
export async function prepareProfileImage(
  file: File,
  slot: ProfileImageSlot,
): Promise<PreparedProfileImage> {
  const spec = profileImageSlotSpec(slot);
  return prepareUploadedImage(file, {
    outputWidth: spec.outputWidth,
    outputHeight: spec.outputHeight,
    noun: spec.noun,
    maxBytes: PROFILE_IMAGE_MAX_BYTES,
    fail: (code, message) => new ProfileImageError(code, message),
  });
}

export const supabaseProfileImageStorage: ProfileImageStorage = {
  async upload(path, bytes, contentType) {
    if (!isSupabaseConfigured()) {
      throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
    }
    // Through the shared writer, which is where the Blob wrap lives.
    const error = await uploadUploadedImageObject(path, bytes, contentType);
    if (error) throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  },
  readBack: readUploadedImageObject,
  async remove(paths) {
    if (paths.length === 0 || !isSupabaseConfigured()) return;
    const { error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(paths);
    if (error) throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  },
  async sign(path, ttlSeconds) {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return error ? null : data.signedUrl;
  },
  async listImageKeys(slot, profileId) {
    if (!isSupabaseConfigured()) return [];
    const spec = profileImageSlotSpec(slot);
    const prefix = `${spec.prefix}/${profileId}`;
    const admin = requireSupabaseAdmin();
    const { data: generations, error } = await admin.storage.from(STORAGE_BUCKET).list(prefix);
    if (error || !generations) {
      throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
    }
    const keys: string[] = [];
    for (const entry of generations) {
      if (!entry?.name) continue;
      // Folder listing returns generation ids; also tolerate flat file names.
      if (entry.name === spec.servingFile || entry.name === "staging.jpg") {
        keys.push(`${prefix}/${entry.name}`);
        continue;
      }
      keys.push(profileImageServingKey(slot, profileId, entry.name));
      keys.push(profileImageStagingKey(slot, profileId, entry.name));
    }
    return keys;
  },
};

export async function stagePreparedProfileImage(
  slot: ProfileImageSlot,
  profileId: string,
  prepared: PreparedProfileImage,
  storage: ProfileImageStorage = supabaseProfileImageStorage,
  requestedGeneration?: string,
): Promise<UploadedProfileImage> {
  const generation = requestedGeneration ?? randomUUID();
  const stagingKey = profileImageStagingKey(slot, profileId, generation);
  const objectKey = profileImageServingKey(slot, profileId, generation);
  const spec = profileImageSlotSpec(slot);
  if (
    stagingKey !== `${spec.prefix}/${profileId}/${generation}/staging.jpg` ||
    objectKey !== `${spec.prefix}/${profileId}/${generation}/${spec.servingFile}`
  ) {
    throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(stagingKey, prepared.bytes, prepared.contentType);
  return { ...prepared, slot, profileId, generation, stagingKey, objectKey };
}

export async function promoteStagedProfileImage(
  staged: UploadedProfileImage,
  storage: ProfileImageStorage = supabaseProfileImageStorage,
): Promise<UploadedProfileImage> {
  if (
    !isProfileImageServingKey(staged.slot, staged.profileId, staged.generation, staged.objectKey)
  ) {
    throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(staged.objectKey, staged.bytes, staged.contentType);

  // The serving key is what a reader will ask for, so read it back before
  // anyone is told the photo is theirs. A write that mangled the bytes answers
  // 200 like any other, and the owner would only learn about it from a 404 on
  // their own face days later.
  const proof = await proveUploadedImageWrite(staged.objectKey, staged, (key) =>
    storage.readBack(key),
  );
  if (proof === "corrupt") {
    try {
      await storage.remove([staged.objectKey]);
    } catch (error) {
      // Best-effort: the bytes are unservable either way, and the next upload
      // to this slot writes its own generation.
      log("warn", "profile_image.cleanup_failed", {
        profileId: staged.profileId,
        objectPath: staged.objectKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw new ProfileImageError(
      "PROCESSING_FAILED",
      "That photo did not save correctly. Try uploading it again.",
    );
  }

  try {
    await storage.remove([staged.stagingKey]);
  } catch (error) {
    // Serving bytes are already private-owned; staging cleanup is best-effort.
    log("warn", "profile_image.cleanup_failed", {
      profileId: staged.profileId,
      objectPath: staged.stagingKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return staged;
}

export async function discardStagedProfileImage(
  staged: Pick<UploadedProfileImage, "stagingKey">,
  storage: ProfileImageStorage = supabaseProfileImageStorage,
): Promise<void> {
  await storage.remove([staged.stagingKey]);
}

export async function signProfileImageObject(
  objectKey: string,
  storage: ProfileImageStorage = supabaseProfileImageStorage,
): Promise<string | null> {
  return storage.sign(objectKey, PROFILE_IMAGE_SIGNED_TTL_SECONDS);
}

export type DownloadedProfileImage = DownloadedUploadedImage;

/**
 * Read approved serving bytes from the private bucket. Absent objects return
 * null and say why once in the log; the read half is shared with the pub photo
 * wall for the reason the write half is (`lib/uploadedImage.server.ts`).
 */
export async function downloadProfileImageObject(
  objectKey: string,
): Promise<DownloadedProfileImage | null> {
  return downloadUploadedImageObject(objectKey);
}

/** Delete every object in one slot under a profile (all generations). */
export async function purgeProfileImageObjects(
  slot: ProfileImageSlot,
  profileId: string,
  storage: ProfileImageStorage = supabaseProfileImageStorage,
  knownKeys: string[] = [],
): Promise<string[]> {
  const listed = storage.listImageKeys ? await storage.listImageKeys(slot, profileId) : [];
  const keys = Array.from(new Set([...knownKeys, ...listed].filter(Boolean)));
  if (keys.length === 0) return [];
  await storage.remove(keys);
  return keys;
}
