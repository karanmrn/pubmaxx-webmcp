import "server-only";

// The owner's upload/remove handlers for one profile image slot.
//
// The face and the backdrop take the SAME journey — own the handle, stay inside
// the per-actor budget, strip metadata, stage the bytes privately, sign a
// short-lived URL, let the moderation adapter look at it, promote unless it
// REFUSED, and delete every earlier generation. Writing that twice is how the
// two slots drift, so `/api/profiles/[handle]/avatar` and
// `/api/profiles/[handle]/cover` are both thin route files over this one pair.
//
// The scan is advisory (`lib/uploadedImageScan.server.ts`): a refusal refuses,
// but a scanner we cannot reach is a fact about us, not about the photo, so it
// never costs an owner their own face.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedFormData, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import {
  discardStagedProfileImage,
  prepareProfileImage,
  PROFILE_IMAGE_MAX_BYTES,
  ProfileImageError,
  promoteStagedProfileImage,
  purgeProfileImageObjects,
  signProfileImageObject,
  stagePreparedProfileImage,
  supabaseProfileImageStorage,
  type ProfileImageStorage,
} from "@/lib/profileImageMedia.server";
import {
  profileImageSlotSpec,
  profileImageStagingKey,
  type ProfileImageSlot,
} from "@/lib/profileImageSlots";
import {
  createProfileAvatarModerationAdapter,
  type ProfileAvatarModerationAdapter,
} from "@/lib/profileAvatarModeration";
import { scanUploadedImage } from "@/lib/uploadedImageScan.server";
import {
  isProfileTombstoned,
  PROFILE_COVER_OWNER_WRITE_BLOCKED_LINE,
  profileImageState,
  profileOwnerImageWriteBlocked,
  profileStore,
  publicProfileFromRecord,
  reportProfileImage,
  type ProfileRecord,
} from "@/lib/profileStore";
import {
  clientIp,
  hashActor,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";
import { readString } from "@/lib/textClean";

const IMAGE_RATE_LIMIT = 10;
const IMAGE_RATE_WINDOW_MS = 60 * 60 * 1000;

function hiddenCoverOwnerWriteRefusal(): Response {
  return publicApiError(
    PROFILE_COVER_OWNER_WRITE_BLOCKED_LINE,
    "COVER_HIDDEN",
    409,
  );
}

export type ProfileImageRouteDeps = {
  storage: ProfileImageStorage;
  moderation: () => ProfileAvatarModerationAdapter;
};

export const defaultProfileImageRouteDeps: ProfileImageRouteDeps = {
  storage: supabaseProfileImageStorage,
  moderation: () => createProfileAvatarModerationAdapter(),
};

function photoError(error: unknown, slot: ProfileImageSlot): Response {
  const spec = profileImageSlotSpec(slot);
  if (error instanceof ProfileImageError) {
    const status = error.code === "TOO_LARGE" ? 413
      : error.code === "STORAGE_UNAVAILABLE" ? 503
        : 400;
    return publicApiError(error.message, error.code, status, {
      retryable: error.code === "STORAGE_UNAVAILABLE",
    });
  }
  if (error instanceof RequestBodyTooLargeError) {
    return publicApiError(`${spec.noun} must be 10 MB or smaller.`, "TOO_LARGE", 413);
  }
  return publicApiError(`${spec.noun} could not be processed.`, "PROCESSING_FAILED", 400);
}

async function requireOwnedProfile(
  request: Request,
  handle: string,
  slot: ProfileImageSlot,
): Promise<
  | { ok: true; profile: ProfileRecord; callerUserId: string }
  | { ok: false; response: Response }
> {
  const gate = await gateHandleAction(request, handle);
  if (!gate.allowed) {
    return { ok: false, response: publicApiErrorFromStatus(gate.error, gate.status) };
  }
  if (!gate.callerUserId) {
    return {
      ok: false,
      response: publicApiError(
        "Sign in with the account that owns this handle to continue.",
        "FORBIDDEN",
        403,
      ),
    };
  }

  const store = profileStore();
  const profile = await store.getByHandle(handle);
  if (!profile || isProfileTombstoned(profile)) {
    return {
      ok: false,
      response: publicApiError("Profile not found.", "NOT_FOUND", 404),
    };
  }
  if (!profile.userId || profile.userId !== gate.callerUserId) {
    return {
      ok: false,
      response: publicApiError(
        `Claim this handle before adding a ${profileImageSlotSpec(slot).nounLower}.`,
        "FORBIDDEN",
        403,
      ),
    };
  }
  return { ok: true, profile, callerUserId: gate.callerUserId };
}

/** Serving + staging keys of the generation this profile is replacing. */
function priorKeys(profile: ProfileRecord, slot: ProfileImageSlot): string[] {
  const state = profileImageState(profile, slot);
  return [
    state.objectKey,
    state.generation ? profileImageStagingKey(slot, profile.id, state.generation) : null,
  ].filter((key): key is string => typeof key === "string" && key.length > 0);
}

export async function handleProfileImageUpload(
  request: Request,
  rawHandle: string,
  slot: ProfileImageSlot,
  deps: ProfileImageRouteDeps,
): Promise<Response> {
  const spec = profileImageSlotSpec(slot);
  const handle = normalizeHandle(rawHandle);
  if (!handle) {
    return publicApiError("Missing handle.", "INVALID_REQUEST", 400);
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Profile storage is not configured.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  let owned: Awaited<ReturnType<typeof requireOwnedProfile>>;
  try {
    owned = await requireOwnedProfile(request, handle, slot);
  } catch {
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  if (!owned.ok) return owned.response;
  if (profileOwnerImageWriteBlocked(owned.profile, slot)) {
    return hiddenCoverOwnerWriteRefusal();
  }

  const limiterKey = `profile-${slot}:${hashActor(owned.callerUserId)}`;
  if (
    await isLimited(limiterKey, limiterKey, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError(
      `Too many ${spec.nounLower} uploads, slow down.`,
      "RATE_LIMITED",
      429,
      { retryable: true },
    );
  }

  let photo: File;
  try {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return publicApiError(
        `Send the ${spec.nounLower} as multipart form data.`,
        "INVALID_REQUEST",
        400,
      );
    }
    const form = await boundedFormData(request, PROFILE_IMAGE_MAX_BYTES + 64 * 1024);
    const parts = form.getAll("photo");
    if (parts.length !== 1 || !(parts[0] instanceof File)) {
      return publicApiError(`Attach one ${spec.nounLower}.`, "INVALID_REQUEST", 400);
    }
    photo = parts[0];
  } catch (error) {
    return photoError(error, slot);
  }

  const { storage, moderation } = deps;
  let staged: Awaited<ReturnType<typeof stagePreparedProfileImage>> | null = null;
  const previousKeys = priorKeys(owned.profile, slot);

  try {
    const prepared = await prepareProfileImage(photo, slot);
    staged = await stagePreparedProfileImage(slot, owned.profile.id, prepared, storage);

    const signedUrl = await signProfileImageObject(staged.stagingKey, storage);
    const scan = await scanUploadedImage({
      surface: slot === "avatar" ? "profile-avatar" : "profile-cover",
      signedUrl,
      adapter: moderation,
    });

    if (scan.verdict === "refused") {
      await discardStagedProfileImage(staged, storage);
      staged = null;
      return publicApiError(
        `That ${spec.nounLower} did not pass our checks. Choose another.`,
        "PHOTO_REFUSED",
        400,
      );
    }

    const promoted = await promoteStagedProfileImage(staged, storage);
    staged = null;

    const updated = await profileStore().setOwnedImage(handle, slot, {
      objectKey: promoted.objectKey,
      generation: promoted.generation,
      moderationState: "approved",
    });
    if (!updated) {
      await storage.remove([promoted.objectKey]);
      return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
        retryable: true,
      });
    }

    if (previousKeys.length > 0) {
      try {
        await storage.remove(previousKeys);
      } catch (error) {
        // The new image is live; old-generation cleanup is best-effort.
        log("warn", "profile_image.cleanup_failed", {
          handle,
          keys: previousKeys,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // The WHOLE public profile, not just the image that changed: the composer
    // replaces its held row with this reply, so it comes through the one shared
    // projection (`lib/profiles.toPublicProfile`) rather than a local copy.
    return jsonNoStore({ profile: publicProfileFromRecord(updated) }, { status: 200 });
  } catch (error) {
    if (staged) {
      try {
        await discardStagedProfileImage(staged, storage);
      } catch (cleanupError) {
        // Swallow cleanup errors so the original failure is reported.
        log("warn", "profile_image.cleanup_failed", {
          handle,
          objectPath: staged.stagingKey,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
    if (error instanceof ProfileImageError || error instanceof RequestBodyTooLargeError) {
      return photoError(error, slot);
    }
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function handleProfileImageDelete(
  request: Request,
  rawHandle: string,
  slot: ProfileImageSlot,
  deps: ProfileImageRouteDeps,
): Promise<Response> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) {
    return publicApiError("Missing handle.", "INVALID_REQUEST", 400);
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Profile storage is not configured.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  let owned: Awaited<ReturnType<typeof requireOwnedProfile>>;
  try {
    owned = await requireOwnedProfile(request, handle, slot);
  } catch {
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  if (!owned.ok) return owned.response;
  if (profileOwnerImageWriteBlocked(owned.profile, slot)) {
    return hiddenCoverOwnerWriteRefusal();
  }

  const limiterKey = `profile-${slot}-delete:${hashActor(owned.callerUserId)}`;
  if (
    await isLimited(limiterKey, limiterKey, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError("Too many edits, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const { storage } = deps;
  try {
    const updated = await profileStore().setOwnedImage(handle, slot, null);
    if (!updated) {
      return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
        retryable: true,
      });
    }
    try {
      await purgeProfileImageObjects(
        slot,
        owned.profile.id,
        storage,
        priorKeys(owned.profile, slot),
      );
    } catch {}
    return jsonNoStore({ profile: publicProfileFromRecord(updated) }, { status: 200 });
  } catch (error) {
    if (error instanceof ProfileImageError) return photoError(error, slot);
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

const REPORT_PER_ACTOR_LIMIT = 1;

/**
 * Reader flag lane, shared by both slots. A flag QUEUES an image for a human
 * moderator: it never auto-hides and never deletes storage or provenance. The
 * reporter actor is server-derived from the request origin (same shape as
 * visit-reports) so one client cannot mint many distinct reporters via a body
 * token.
 */
export async function handleProfileImageReport(
  request: Request,
  rawHandle: string,
  slot: ProfileImageSlot,
): Promise<Response> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) {
    return publicApiError("Profile not found.", "NOT_FOUND", 404);
  }

  let body: Record<string, unknown> | null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const actorHash = hashActor(`profile-${slot}:${hashIp(clientIp(request))}`);
  const handleKey = `profile-${slot}-report:${handle}`;
  const actorKey = `${handleKey}:${actorHash}`;
  if (
    (await isLimited(handleKey, handleKey)) ||
    (await isLimited(actorKey, actorKey, REPORT_PER_ACTOR_LIMIT))
  ) {
    return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  try {
    const done = await reportProfileImage(handle, slot, readString(body.reason), actorHash);
    return done
      ? jsonNoStore({ ok: true }, { status: 200 })
      : publicApiError(
          `Profile ${profileImageSlotSpec(slot).nounLower} not found.`,
          "NOT_FOUND",
          404,
        );
  } catch (err) {
    log("error", "profile_image.report_failed", {
      route: `POST /api/profiles/[handle]/${slot}/report`,
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
