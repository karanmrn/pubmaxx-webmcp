import "server-only";

// The owner's add / remove / reorder handlers for the cover ROTATION, plus the
// reader flag lane for one cover.
//
// Every photo here takes the SAME journey the single cover already takes
// (`lib/profileImageRoute.server.ts`): own the handle, stay inside the
// per-actor budget, strip metadata, stage the bytes privately, sign a
// short-lived URL, let the moderation adapter look at it, promote unless it
// REFUSED, and prove the write before anybody is told the photo is theirs. What
// is new is the LIST: a row per photo, a cap of five counted against live rows,
// and an order the owner chooses.
//
// The scan stays ADVISORY (`lib/uploadedImageScan.server.ts`): a refusal
// refuses, but a scanner we cannot reach is a fact about us, not about the
// photo, so it never costs an owner their own backdrop.
//
// EVERY reply carries the WHOLE public profile AND the whole rotation, because
// the composer replaces what it holds with the reply. A reply that named only
// the photo that changed is how a founding member's brass mark fell off an
// image write once already.

import { randomUUID } from "node:crypto";

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedFormData, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import {
  isCoverMoveDirection,
  moveCoverPosition,
  profileCoverCapLine,
  PROFILE_COVER_PHOTO_CAP,
  PROFILE_COVER_REFUSED_LINE,
  type CoverMoveDirection,
  type ProfileCoverPhoto,
  type ProfileCoverPhotoDTO,
} from "@/lib/profileCovers";
import {
  mirrorFirstCoverOntoProfile,
  ProfileCoverCapReachedError,
  ProfileCoverUploadBlockedError,
  profileCoverPhotoStore,
} from "@/lib/profileCoverPhotoStore";
import {
  discardStagedProfileImage,
  prepareProfileImage,
  PROFILE_IMAGE_MAX_BYTES,
  ProfileImageError,
  promoteStagedProfileImage,
  signProfileImageObject,
  stagePreparedProfileImage,
  supabaseProfileImageStorage,
  type ProfileImageStorage,
} from "@/lib/profileImageMedia.server";
import {
  profileImageServePath,
  profileImageSlotSpec,
  profileImageStagingKey,
} from "@/lib/profileImageSlots";
import {
  createProfileAvatarModerationAdapter,
  type ProfileAvatarModerationAdapter,
} from "@/lib/profileAvatarModeration";
import { scanUploadedImage } from "@/lib/uploadedImageScan.server";
import {
  isProfileTombstoned,
  PROFILE_COVER_OWNER_WRITE_BLOCKED_LINE,
  profileOwnerImageWriteBlocked,
  profileStore,
  publicProfileFromRecord,
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

const COVER_RATE_LIMIT = 20;
const COVER_RATE_WINDOW_MS = 60 * 60 * 1000;
const REPORT_PER_ACTOR_LIMIT = 1;

const SPEC = profileImageSlotSpec("cover");

export type ProfileCoverPhotoRouteDeps = {
  storage: ProfileImageStorage;
  moderation: () => ProfileAvatarModerationAdapter;
};

export const defaultProfileCoverPhotoRouteDeps: ProfileCoverPhotoRouteDeps = {
  storage: supabaseProfileImageStorage,
  moderation: () => createProfileAvatarModerationAdapter(),
};

function photoError(error: unknown): Response {
  if (error instanceof ProfileImageError) {
    const status =
      error.code === "TOO_LARGE" ? 413 : error.code === "STORAGE_UNAVAILABLE" ? 503 : 400;
    return publicApiError(error.message, error.code, status, {
      retryable: error.code === "STORAGE_UNAVAILABLE",
    });
  }
  if (error instanceof RequestBodyTooLargeError) {
    return publicApiError(`${SPEC.noun} must be 10 MB or smaller.`, "TOO_LARGE", 413);
  }
  return publicApiError(`${SPEC.noun} could not be processed.`, "PROCESSING_FAILED", 400);
}

function unavailable(): Response {
  return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, {
    retryable: true,
  });
}

function hiddenCoverUploadRefusal(): Response {
  return publicApiError(
    PROFILE_COVER_OWNER_WRITE_BLOCKED_LINE,
    "COVER_HIDDEN",
    409,
  );
}

async function requireOwnedProfile(
  request: Request,
  handle: string,
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

  const profile = await profileStore().getByHandle(handle);
  if (!profile || isProfileTombstoned(profile)) {
    return { ok: false, response: publicApiError("Profile not found.", "NOT_FOUND", 404) };
  }
  if (!profile.userId || profile.userId !== gate.callerUserId) {
    return {
      ok: false,
      response: publicApiError(
        `Claim this handle before adding a ${SPEC.nounLower}.`,
        "FORBIDDEN",
        403,
      ),
    };
  }
  return { ok: true, profile, callerUserId: gate.callerUserId };
}

/** What the editor reads. A serve path and a position; never a storage key. */
export function coverPhotoDTOs(
  covers: readonly ProfileCoverPhoto[],
): ProfileCoverPhotoDTO[] {
  return covers.map((cover) => ({
    id: cover.id,
    position: cover.position,
    url: profileImageServePath("cover", cover.profileId, cover.generation),
  }));
}

/**
 * The one reply shape. Cover #1 is mirrored onto the profile row first, so the
 * profile this reads back and the rotation beside it agree about which photo is
 * the backdrop.
 */
async function settledReply(
  handle: string,
  covers: readonly ProfileCoverPhoto[],
  status = 200,
): Promise<Response> {
  await mirrorFirstCoverOntoProfile(handle, covers);
  const record = await profileStore().getByHandle(handle);
  const dtos = coverPhotoDTOs(covers);
  return jsonNoStore(
    {
      profile: publicProfileFromRecord(record, { coverUrls: dtos.map((cover) => cover.url) }),
      covers: dtos,
      status: "ready",
    },
    { status },
  );
}

function guards(handle: string): Response | null {
  if (!handle) return publicApiError("Missing handle.", "INVALID_REQUEST", 400);
  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Profile storage is not configured.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  return null;
}

async function budgetSpent(action: string, callerUserId: string): Promise<boolean> {
  const key = `profile-covers-${action}:${hashActor(callerUserId)}`;
  return isLimited(key, key, COVER_RATE_LIMIT, COVER_RATE_WINDOW_MS, { failClosed: true });
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * The owner's own rotation, with the ids the editor needs to move and remove.
 * A read that failed answers `degraded` rather than an empty list, because an
 * owner told they have no covers would add a sixth.
 */
export async function handleProfileCoverPhotoList(
  request: Request,
  rawHandle: string,
): Promise<Response> {
  const handle = normalizeHandle(rawHandle);
  const refused = guards(handle);
  if (refused) return refused;

  let owned: Awaited<ReturnType<typeof requireOwnedProfile>>;
  try {
    owned = await requireOwnedProfile(request, handle);
  } catch {
    return unavailable();
  }
  if (!owned.ok) return owned.response;

  try {
    const covers = await profileCoverPhotoStore().listApproved(owned.profile.id);
    return jsonNoStore({ status: "ready", covers: coverPhotoDTOs(covers) }, { status: 200 });
  } catch (error) {
    log("warn", "profile_cover.list_failed", {
      handle,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore({ status: "degraded", covers: [] }, { status: 200 });
  }
}

// ── Add ──────────────────────────────────────────────────────────────────────

export async function handleProfileCoverPhotoUpload(
  request: Request,
  rawHandle: string,
  deps: ProfileCoverPhotoRouteDeps,
): Promise<Response> {
  const handle = normalizeHandle(rawHandle);
  const refused = guards(handle);
  if (refused) return refused;

  let owned: Awaited<ReturnType<typeof requireOwnedProfile>>;
  try {
    owned = await requireOwnedProfile(request, handle);
  } catch {
    return unavailable();
  }
  if (!owned.ok) return owned.response;
  if (profileOwnerImageWriteBlocked(owned.profile, "cover")) {
    return hiddenCoverUploadRefusal();
  }

  // Every upload costs a safety scan, which anyone with an Add button can
  // spend, so the budget fails CLOSED.
  if (await budgetSpent("upload", owned.callerUserId)) {
    return publicApiError(
      `Too many ${SPEC.nounLower} uploads, slow down.`,
      "RATE_LIMITED",
      429,
      { retryable: true },
    );
  }

  const store = profileCoverPhotoStore();
  let held: number;
  try {
    held = await store.countForProfile(owned.profile.id);
  } catch (error) {
    log("error", "profile_cover.count_failed", {
      handle,
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailable();
  }
  // A cap we could not count must never read as room to spare, which is why the
  // count above has no fail-soft path.
  if (held >= PROFILE_COVER_PHOTO_CAP) {
    return publicApiError(profileCoverCapLine(), "COVER_CAP_REACHED", 409);
  }

  let photo: File;
  try {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return publicApiError(
        `Send the ${SPEC.nounLower} as multipart form data.`,
        "INVALID_REQUEST",
        400,
      );
    }
    const form = await boundedFormData(request, PROFILE_IMAGE_MAX_BYTES + 64 * 1024);
    const parts = form.getAll("photo");
    if (parts.length !== 1 || !(parts[0] instanceof File)) {
      return publicApiError(`Attach one ${SPEC.nounLower}.`, "INVALID_REQUEST", 400);
    }
    photo = parts[0];
  } catch (error) {
    return photoError(error);
  }

  const { storage, moderation } = deps;
  let staged: Awaited<ReturnType<typeof stagePreparedProfileImage>> | null = null;

  try {
    const prepared = await prepareProfileImage(photo, "cover");
    staged = await stagePreparedProfileImage("cover", owned.profile.id, prepared, storage);

    const signedUrl = await signProfileImageObject(staged.stagingKey, storage);
    const scan = await scanUploadedImage({
      surface: "profile-cover",
      signedUrl,
      adapter: moderation,
    });

    if (scan.verdict === "refused") {
      // Refused bytes never reach the serving key, so nothing public was ever
      // one request away from existing.
      await discardStagedProfileImage(staged, storage);
      staged = null;
      return publicApiError(PROFILE_COVER_REFUSED_LINE, "PHOTO_REFUSED", 400);
    }

    const promoted = await promoteStagedProfileImage(staged, storage);
    staged = null;

    try {
      await store.create({
        id: randomUUID(),
        profileId: owned.profile.id,
        generation: promoted.generation,
        objectKey: promoted.objectKey,
      });
    } catch (error) {
      // The row is what makes the bytes reachable, so bytes with no row are
      // deleted rather than left orphaned in the bucket.
      try {
        await storage.remove([promoted.objectKey]);
      } catch (cleanupError) {
        // Best-effort: the object is unreferenced either way.
        log("warn", "profile_cover.cleanup_failed", {
          handle,
          objectPath: promoted.objectKey,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
      throw error;
    }

    const covers = await store.listApproved(owned.profile.id);
    return settledReply(handle, covers, 201);
  } catch (error) {
    if (staged) {
      try {
        await discardStagedProfileImage(staged, storage);
      } catch (cleanupError) {
        // Swallow cleanup errors so the original failure is what is reported.
        log("warn", "profile_cover.cleanup_failed", {
          handle,
          objectPath: staged.stagingKey,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
    if (error instanceof ProfileImageError || error instanceof RequestBodyTooLargeError) {
      return photoError(error);
    }
    if (error instanceof ProfileCoverUploadBlockedError) {
      return hiddenCoverUploadRefusal();
    }
    if (error instanceof ProfileCoverCapReachedError) {
      return publicApiError(profileCoverCapLine(), "COVER_CAP_REACHED", 409);
    }
    log("error", "profile_cover.create_failed", {
      handle,
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailable();
  }
}

// ── Remove ───────────────────────────────────────────────────────────────────

export async function handleProfileCoverPhotoDelete(
  request: Request,
  rawHandle: string,
  coverId: string,
  deps: ProfileCoverPhotoRouteDeps,
): Promise<Response> {
  const handle = normalizeHandle(rawHandle);
  const refused = guards(handle);
  if (refused) return refused;

  let owned: Awaited<ReturnType<typeof requireOwnedProfile>>;
  try {
    owned = await requireOwnedProfile(request, handle);
  } catch {
    return unavailable();
  }
  if (!owned.ok) return owned.response;

  if (await budgetSpent("edit", owned.callerUserId)) {
    return publicApiError("Too many edits, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const store = profileCoverPhotoStore();
  try {
    const removed = await store.remove(coverId, owned.profile.id);
    if (!removed) {
      return publicApiError(`${SPEC.noun} not found.`, "NOT_FOUND", 404);
    }
    // Both keys go: the serving object and any staging bytes an earlier
    // attempt on the same generation left behind.
    try {
      await deps.storage.remove([
        removed.objectKey,
        profileImageStagingKey("cover", owned.profile.id, removed.generation),
      ]);
    } catch (cleanupError) {
      // The row is gone, so the photo is off the card; object cleanup is
      // best-effort exactly as it is on the single-cover path.
      log("warn", "profile_cover.cleanup_failed", {
        handle,
        objectPaths: [
          removed.objectKey,
          profileImageStagingKey("cover", owned.profile.id, removed.generation),
        ],
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
    // Close the gap the removal left, so the rotation stays 1..n.
    const remaining = await store.listApproved(owned.profile.id);
    const settled = await store.reorder(
      owned.profile.id,
      remaining.map((cover) => cover.id),
    );
    return settledReply(handle, settled);
  } catch (error) {
    if (error instanceof ProfileImageError) return photoError(error);
    log("error", "profile_cover.delete_failed", {
      handle,
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailable();
  }
}

// ── Reorder ──────────────────────────────────────────────────────────────────

export async function handleProfileCoverPhotoMove(
  request: Request,
  rawHandle: string,
  coverId: string,
): Promise<Response> {
  const handle = normalizeHandle(rawHandle);
  const refused = guards(handle);
  if (refused) return refused;

  let body: Record<string, unknown> | null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const direction: unknown = body.move;
  if (!isCoverMoveDirection(direction)) {
    return publicApiError("Choose move up or move down.", "INVALID_REQUEST", 400);
  }

  let owned: Awaited<ReturnType<typeof requireOwnedProfile>>;
  try {
    owned = await requireOwnedProfile(request, handle);
  } catch {
    return unavailable();
  }
  if (!owned.ok) return owned.response;

  if (await budgetSpent("edit", owned.callerUserId)) {
    return publicApiError("Too many edits, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const store = profileCoverPhotoStore();
  try {
    const held = await store.listApproved(owned.profile.id);
    if (!held.some((cover) => cover.id === coverId)) {
      return publicApiError(`${SPEC.noun} not found.`, "NOT_FOUND", 404);
    }
    const nextOrder = moveCoverPosition(
      held.map((cover) => cover.id),
      coverId,
      direction as CoverMoveDirection,
    );
    const settled = await store.reorder(owned.profile.id, nextOrder);
    return settledReply(handle, settled);
  } catch (error) {
    log("error", "profile_cover.move_failed", {
      handle,
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailable();
  }
}

// ── Reader flag ──────────────────────────────────────────────────────────────

/**
 * Per-cover flag lane, the same shape the single cover already has. A flag
 * QUEUES one photo for a human moderator: it never auto-hides, never deletes,
 * and never touches the other four. The reporter actor is server-derived from
 * the request origin, so one client cannot mint many distinct reporters.
 */
export async function handleProfileCoverPhotoReport(
  request: Request,
  rawHandle: string,
  coverId: string,
): Promise<Response> {
  const handle = normalizeHandle(rawHandle);
  if (!handle || !coverId) {
    return publicApiError(`${SPEC.noun} not found.`, "NOT_FOUND", 404);
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

  const actorHash = hashActor(`profile-cover-photo:${hashIp(clientIp(request))}`);
  const flagKey = `profile-cover-photo-report:${coverId}`;
  const actorKey = `${flagKey}:${actorHash}`;
  if (
    (await isLimited(flagKey, flagKey)) ||
    (await isLimited(actorKey, actorKey, REPORT_PER_ACTOR_LIMIT))
  ) {
    return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  try {
    const done = await profileCoverPhotoStore().report(
      coverId,
      readString(body.reason),
      actorHash,
    );
    return done
      ? jsonNoStore({ ok: true }, { status: 200 })
      : publicApiError(`${SPEC.noun} not found.`, "NOT_FOUND", 404);
  } catch (error) {
    log("error", "profile_cover.report_failed", {
      route: "POST /api/profiles/[handle]/covers/[coverId]/report",
      error: error instanceof Error ? error.message : String(error),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
