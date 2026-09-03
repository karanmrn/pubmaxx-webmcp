import "server-only";

// ONE journey from "a person chose a file" to "bytes we are willing to store".
//
// Chain C (the pint-drop `uploadPhoto` order, kept exactly): declared type ->
// size -> magic bytes -> stripImageMetadata -> sharp rotate -> resize inside
// the caller's box -> jpeg -> re-probe. GPS removal is an ASSERTED strip step,
// never an encoder side effect, which is why `stripImageMetadata` runs before
// sharp rather than being assumed out of the re-encode.
//
// It lives here because the owned profile images and the pub photo walls take
// the same journey with different boxes and different nouns. Writing it twice
// is how the two drift, and the thing that would drift is the EXIF strip.
//
// The caller brings its own error class through `fail`, so an existing
// `error instanceof ProfileImageError` check keeps working: the shape of the
// failure is shared, the identity of it is not.

import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  detectImageKind,
  magicBytesOk,
  stripImageMetadata,
} from "@/lib/imageSafety";
import { log } from "@/lib/log";
import { isSupabaseConfigured, requireSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";

export const UPLOADED_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOADED_IMAGE_MAX_DIMENSION = 12_000;
export const UPLOADED_IMAGE_MAX_PIXELS = 20_000_000;

/**
 * What the server is willing to decode. Deliberately three types and not the
 * picker's five: a browser converts an iPhone's HEIC to JPEG in the crop step,
 * so widening a picker never widens this.
 */
export const UPLOADED_IMAGE_ALLOWED_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Serving bytes read back out of the private bucket. */
export type DownloadedUploadedImage = {
  bytes: Buffer;
  contentType: "image/jpeg";
};

/**
 * Why bytes we stored could not be read back.
 *
 * `storage_unconfigured` and `storage_error` say we could not LOOK;
 * `magic_bytes_mismatch` says we looked and what came back is not an image.
 * A reader that collapsed the two would make the write proof below either
 * blind to a mangled object or hostage to a momentary outage.
 */
export type UploadedImageReadFailure =
  | "storage_unconfigured"
  | "storage_error"
  | "magic_bytes_mismatch";

/** One read of a stored object, with the refusal named rather than nulled. */
export type UploadedImageReadResult =
  | { ok: true; image: DownloadedUploadedImage }
  | { ok: false; failure: UploadedImageReadFailure; detail: string };

// A null here becomes a reader-facing 404, which is the right answer and a
// terrible finding: a photo its owner uploaded minutes ago and a key that was
// never written read identically. One quiet warn line, naming the object and
// what actually refused, is the difference between a bug report and a
// diagnosis. `warn` rather than `error` for the reason the advisory scan skip
// is: the reader got a defined answer, our storage is what is not well.
function unreadable(
  objectKey: string,
  failure: UploadedImageReadFailure,
  detail: string,
): UploadedImageReadResult {
  log("warn", "uploaded_image.object_unreadable", { objectKey, reason: failure, detail });
  return { ok: false, failure, detail };
}

/** The first four bytes, for a log line that says what actually came back. */
function leadingBytes(bytes: Buffer): string {
  return (
    [...bytes.subarray(0, 4)].map((byte) => byte.toString(16).padStart(2, "0")).join(" ") || "none"
  );
}

/**
 * Read one stored JPEG back, naming the refusal. Shared by every owned-image
 * serve route - the avatar, the cover and a pub wall photo - because the write
 * half is shared and a second copy of "what counts as unreadable" is how the
 * surfaces drift.
 */
export async function readUploadedImageObject(
  objectKey: string,
): Promise<UploadedImageReadResult> {
  // Silent: nothing was written here either, so there is no object to report on.
  if (!isSupabaseConfigured()) {
    return { ok: false, failure: "storage_unconfigured", detail: "storage is not configured" };
  }
  const { data, error } = await requireSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .download(objectKey);
  if (error || !data) {
    return unreadable(objectKey, "storage_error", error?.message ?? "no object returned");
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!magicBytesOk(bytes, "image/jpeg")) {
    // What we stored is sharp's own JPEG, checked before it left this module,
    // so a mismatch is the object having changed under us rather than a picky
    // reader. Say what actually came back.
    return unreadable(
      objectKey,
      "magic_bytes_mismatch",
      `${bytes.byteLength} bytes, leading ${leadingBytes(bytes)}`,
    );
  }
  return { ok: true, image: { bytes, contentType: "image/jpeg" } };
}

/**
 * The serve routes' half of the reader: absent or unreadable objects are one
 * null, because a reader is owed a 404 either way and the log line above
 * already said which gate refused.
 */
export async function downloadUploadedImageObject(
  objectKey: string,
): Promise<DownloadedUploadedImage | null> {
  const result = await readUploadedImageObject(objectKey);
  return result.ok ? result.image : null;
}

/**
 * Bytes on their way INTO the bucket, wrapped so @supabase/storage-js takes its
 * Blob branch.
 *
 * `uploadOrUpdate` builds a multipart FormData body for a Blob and ONLY for a
 * Blob; a Buffer or Uint8Array falls through to `params.body = body` and is
 * handed to the runtime's `fetch` raw. On the Vercel Node runtime that body was
 * string-decoded on the way out, so the object that landed in the bucket was
 * the JPEG re-encoded as UTF-8 - leading `ef bf bd`, the replacement character,
 * where the SOI marker had been. Storage answered 200, the row was written, and
 * the finding arrived days later as a serve 404 on a magic-byte check that was
 * reading exactly what we stored.
 *
 * The `contentType` option still rides along beside this, because the multipart
 * branch sends the option rather than the Blob's own type.
 */
export function uploadedImageStorageBody(bytes: Buffer, contentType: string): Blob {
  // An explicit copy rather than the Buffer itself: a pooled Buffer is a view
  // into a larger ArrayBuffer, and this is not the bug to be clever about.
  return new Blob([new Uint8Array(bytes)], { type: contentType });
}

/**
 * Write one prepared image to the private bucket. Shared by every owned-image
 * surface for the reason the reader is: the Blob wrap above is the whole fix
 * for a corrupted write, and a second copy of the call is how one surface keeps
 * the bug. Returns the storage error message, or null when the object landed.
 */
export async function uploadUploadedImageObject(
  objectKey: string,
  bytes: Buffer,
  contentType: string,
): Promise<string | null> {
  const { error } = await requireSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .upload(objectKey, uploadedImageStorageBody(bytes, contentType), {
      contentType,
      upsert: true,
    });
  if (!error) return null;
  const detail = error.message || "storage refused the write";
  log("warn", "uploaded_image.write_failed", { objectKey, detail });
  return detail;
}

/** Whether the bytes we just wrote read back as the bytes we made. */
export type UploadedImageWriteProof = "verified" | "corrupt" | "unproven";

/**
 * Prove one just-written serving object by reading it back through the SAME
 * reader the serve route uses.
 *
 * A mangled write is invisible at upload time: storage answers 200, the row is
 * right, and the owner watches their photo succeed. So promotion proves its own
 * write once, while there is still a person on the other end of the request to
 * be told, instead of leaving a 404 to be diagnosed days later.
 *
 * `unproven` is not a failure. A storage that cannot be read back wrote
 * somewhere this cannot look, and an outage on the read says nothing about the
 * bytes - the same reading `lib/uploadedImageScan.server.ts` gives a scanner it
 * cannot reach. Only bytes we DID read and that are not ours are `corrupt`.
 */
export async function proveUploadedImageWrite(
  objectKey: string,
  expected: Pick<PreparedImage, "sha256" | "byteSize">,
  read: (objectKey: string) => Promise<UploadedImageReadResult>,
): Promise<UploadedImageWriteProof> {
  let stored: UploadedImageReadResult;
  try {
    stored = await read(objectKey);
  } catch (error) {
    return unproven(objectKey, error instanceof Error ? error.message : String(error));
  }

  if (!stored.ok) {
    if (stored.failure === "magic_bytes_mismatch") {
      return corrupt(objectKey, "magic_bytes_mismatch", stored.detail);
    }
    return unproven(objectKey, stored.detail);
  }

  const { bytes } = stored.image;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 === expected.sha256) return "verified";
  return corrupt(
    objectKey,
    "sha256_mismatch",
    `wrote ${expected.byteSize} bytes, read ${bytes.byteLength} bytes, leading ${leadingBytes(bytes)}`,
  );
}

// `error` rather than the reader's `warn`: bytes that cannot be served are a
// broken write, and the upload is about to be refused over it.
function corrupt(
  objectKey: string,
  reason: "magic_bytes_mismatch" | "sha256_mismatch",
  detail: string,
): UploadedImageWriteProof {
  log("error", "uploaded_image.write_corrupt", { objectKey, reason, detail });
  return "corrupt";
}

// The safety net is down, the photo is fine. Same idiom, same `warn`, as an
// unreachable scan.
function unproven(objectKey: string, detail: string): UploadedImageWriteProof {
  log("warn", "uploaded_image.write_unproven", { objectKey, detail });
  return "unproven";
}

export type UploadedImageErrorCode =
  | "INVALID_TYPE"
  | "TOO_LARGE"
  | "INVALID_DIMENSIONS"
  | "PROCESSING_FAILED"
  | "STORAGE_UNAVAILABLE";

export type PreparedImage = {
  bytes: Buffer;
  contentType: "image/jpeg";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};

export type ImagePreparationSpec = {
  /** Longest edge the stored JPEG is resized down to. */
  readonly outputWidth: number;
  /** Square/portrait box; null keeps the source aspect at the given width. */
  readonly outputHeight: number | null;
  /** Sentence noun for reader-facing copy ("Cover photo must be…"). */
  readonly noun: string;
  readonly maxBytes?: number;
  /** JPEG quality for the stored output. Defaults to 84. */
  readonly jpegQuality?: number;
  /** The caller's own error type, so `instanceof` checks upstream still hold. */
  readonly fail: (code: UploadedImageErrorCode, message: string) => Error;
};

function safeDimension(value: number | undefined): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export async function prepareUploadedImage(
  file: File,
  spec: ImagePreparationSpec,
): Promise<PreparedImage> {
  const maxBytes = spec.maxBytes ?? UPLOADED_IMAGE_MAX_BYTES;
  // Errors this call worded itself, remembered by identity. The sharp block
  // below has to tell "the box is too big", which is already a sentence a
  // reader can act on, from "sharp threw", which is not - and comparing
  // constructors or messages would guess where this knows.
  const worded = new Set<unknown>();
  const fail = (code: UploadedImageErrorCode, message: string): Error => {
    const error = spec.fail(code, message);
    worded.add(error);
    return error;
  };
  const wrongType = () =>
    fail("INVALID_TYPE", `${spec.noun} must be a JPEG, PNG, or WebP image.`);

  if (!UPLOADED_IMAGE_ALLOWED_TYPES.has(file.type)) throw wrongType();
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > maxBytes) {
    throw fail(
      "TOO_LARGE",
      `${spec.noun} must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.`,
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  if (input.byteLength !== file.size || !magicBytesOk(input, file.type)) throw wrongType();

  const kind = detectImageKind(input);
  if (!kind) throw wrongType();

  let stripped: Uint8Array;
  try {
    stripped = stripImageMetadata(input, kind);
  } catch {
    throw fail(
      "PROCESSING_FAILED",
      `${spec.noun} must be a valid, uncorrupted image.`,
    );
  }

  try {
    const metadata = await sharp(Buffer.from(stripped), {
      failOn: "warning",
      limitInputPixels: false,
    }).metadata();
    const width = safeDimension(metadata.width);
    const height = safeDimension(metadata.height);
    if (
      width === null ||
      height === null ||
      width > UPLOADED_IMAGE_MAX_DIMENSION ||
      height > UPLOADED_IMAGE_MAX_DIMENSION ||
      width * height > UPLOADED_IMAGE_MAX_PIXELS
    ) {
      throw fail("INVALID_DIMENSIONS", `${spec.noun} dimensions are too large.`);
    }

    const bytes = await sharp(Buffer.from(stripped), {
      failOn: "warning",
      limitInputPixels: UPLOADED_IMAGE_MAX_PIXELS,
    })
      .rotate()
      .resize({
        width: spec.outputWidth,
        ...(spec.outputHeight === null ? {} : { height: spec.outputHeight }),
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: spec.jpegQuality ?? 84, mozjpeg: true })
      .toBuffer();

    if (!magicBytesOk(bytes, "image/jpeg")) {
      throw fail("PROCESSING_FAILED", `${spec.noun} could not be processed.`);
    }

    const output = await sharp(bytes).metadata();
    const outputWidth = safeDimension(output.width);
    const outputHeight = safeDimension(output.height);
    if (outputWidth === null || outputHeight === null) {
      throw fail("PROCESSING_FAILED", `${spec.noun} could not be processed.`);
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
    // A failure this call already worded travels unchanged; anything sharp
    // threw becomes one sentence that names the next move.
    if (worded.has(error)) throw error;
    throw fail(
      "PROCESSING_FAILED",
      `${spec.noun} could not be processed. Choose another image.`,
    );
  }
}
