import "server-only";

import { log } from "@/lib/log";

// The bytes half of a message photo: the same journey an owned profile image
// and a pub wall photo take, pointed at a conversation-scoped key.
//
// staging -> signed URL -> safety scan -> promote unless the scan REFUSED ->
// prove the write. Refused bytes never reach the serving key, so nothing a
// scanner turned down is one request away from being readable.
//
// The preparation itself is `lib/uploadedImage.server.ts`, shared with the
// profile slots and the pub wall, so the asserted EXIF strip cannot drift
// between the surfaces. The scan is the SAME advisory policy
// (`lib/uploadedImageScan.server.ts`): a VERDICT is honoured, everything else
// is a fact about us rather than about the photo, and the report lane is the
// net.

import {
  isMessagePhotoServingKey,
  MESSAGE_PHOTO_NOUN,
  MESSAGE_PHOTO_JPEG_QUALITY,
  MESSAGE_PHOTO_OUTPUT_HEIGHT,
  MESSAGE_PHOTO_OUTPUT_WIDTH,
  MESSAGE_PHOTO_STORAGE_PREFIX,
  messagePhotoServingKey,
  messagePhotoStagingKey,
} from "@/lib/messageAttachments";
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

export const MESSAGE_PHOTO_MAX_BYTES = UPLOADED_IMAGE_MAX_BYTES;
export const MESSAGE_PHOTO_SIGNED_TTL_SECONDS = 180;

export type PreparedMessagePhoto = PreparedImage;

export type StagedMessagePhoto = PreparedMessagePhoto & {
  conversationId: string;
  messageId: string;
  stagingKey: string;
  objectKey: string;
};

export type MessagePhotoStorage = {
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  sign(path: string, ttlSeconds: number): Promise<string | null>;
  /** Read one written object back, so promotion can prove its own write. */
  readBack(path: string): Promise<UploadedImageReadResult>;
};

export class MessagePhotoError extends Error {
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

/** The shared journey, in the thread's own portrait box. */
export async function prepareMessagePhoto(file: File): Promise<PreparedMessagePhoto> {
  return prepareUploadedImage(file, {
    outputWidth: MESSAGE_PHOTO_OUTPUT_WIDTH,
    outputHeight: MESSAGE_PHOTO_OUTPUT_HEIGHT,
    jpegQuality: MESSAGE_PHOTO_JPEG_QUALITY,
    noun: MESSAGE_PHOTO_NOUN,
    maxBytes: MESSAGE_PHOTO_MAX_BYTES,
    fail: (code, message) => new MessagePhotoError(code, message),
  });
}

export const supabaseMessagePhotoStorage: MessagePhotoStorage = {
  async upload(path, bytes, contentType) {
    if (!isSupabaseConfigured()) {
      throw new MessagePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
    }
    // Through the shared writer, which is where the Blob wrap lives.
    const error = await uploadUploadedImageObject(path, bytes, contentType);
    if (error) {
      throw new MessagePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
    }
  },
  readBack: readUploadedImageObject,
  async remove(paths) {
    if (paths.length === 0 || !isSupabaseConfigured()) return;
    const { error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(paths);
    if (error) {
      throw new MessagePhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
    }
  },
  async sign(path, ttlSeconds) {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return error ? null : data.signedUrl;
  },
};

export async function stagePreparedMessagePhoto(
  conversationId: string,
  messageId: string,
  prepared: PreparedMessagePhoto,
  storage: MessagePhotoStorage = supabaseMessagePhotoStorage,
): Promise<StagedMessagePhoto> {
  const stagingKey = messagePhotoStagingKey(conversationId, messageId);
  const objectKey = messagePhotoServingKey(conversationId, messageId);
  // Both keys are rebuilt from the pure builders and checked against the one
  // prefix, so an id that somehow escaped validation cannot write outside this
  // conversation's own folder.
  if (
    !stagingKey.startsWith(`${MESSAGE_PHOTO_STORAGE_PREFIX}/${conversationId}/`) ||
    !isMessagePhotoServingKey(conversationId, messageId, objectKey)
  ) {
    throw new MessagePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(stagingKey, prepared.bytes, prepared.contentType);
  return { ...prepared, conversationId, messageId, stagingKey, objectKey };
}

export async function promoteStagedMessagePhoto(
  staged: StagedMessagePhoto,
  storage: MessagePhotoStorage = supabaseMessagePhotoStorage,
): Promise<StagedMessagePhoto> {
  if (!isMessagePhotoServingKey(staged.conversationId, staged.messageId, staged.objectKey)) {
    throw new MessagePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(staged.objectKey, staged.bytes, staged.contentType);

  // Read the serving key back before a message claims the photo. A mangled
  // write answers 200 like any other, so without this the finding is a photo
  // that will not open in a thread whose sender watched it send.
  const proof = await proveUploadedImageWrite(staged.objectKey, staged, (key) =>
    storage.readBack(key),
  );
  if (proof === "corrupt") {
    try {
      await storage.remove([staged.objectKey]);
    } catch (error) {
      // Best-effort: the bytes are unservable either way, and no row points at
      // them yet.
      log("warn", "message_photo.cleanup_failed", {
        conversationId: staged.conversationId,
        objectPath: staged.objectKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw new MessagePhotoError(
      "PROCESSING_FAILED",
      "That photo did not save correctly. Try sending it again.",
    );
  }

  try {
    await storage.remove([staged.stagingKey]);
  } catch (error) {
    // Serving bytes are already private-owned; staging cleanup is best-effort.
    log("warn", "message_photo.cleanup_failed", {
      conversationId: staged.conversationId,
      objectPath: staged.stagingKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return staged;
}

export async function discardStagedMessagePhoto(
  staged: Pick<StagedMessagePhoto, "stagingKey">,
  storage: MessagePhotoStorage = supabaseMessagePhotoStorage,
): Promise<void> {
  await storage.remove([staged.stagingKey]);
}

/** Delete the serving bytes of a photo no message may point at any more. */
export async function removeMessagePhotoObject(
  objectKey: string,
  storage: MessagePhotoStorage = supabaseMessagePhotoStorage,
): Promise<void> {
  await storage.remove([objectKey]);
}

export async function signMessagePhotoObject(
  objectKey: string,
  storage: MessagePhotoStorage = supabaseMessagePhotoStorage,
): Promise<string | null> {
  return storage.sign(objectKey, MESSAGE_PHOTO_SIGNED_TTL_SECONDS);
}

export type DownloadedMessagePhoto = DownloadedUploadedImage;

/**
 * Read serving bytes out of the private bucket. Absent objects: null, with one
 * line saying why. Shared with the owned profile slots and the pub wall,
 * because the write half is shared and a second copy of "what counts as
 * unreadable" is how the surfaces drift.
 */
export async function downloadMessagePhotoObject(
  objectKey: string,
): Promise<DownloadedMessagePhoto | null> {
  return downloadUploadedImageObject(objectKey);
}
