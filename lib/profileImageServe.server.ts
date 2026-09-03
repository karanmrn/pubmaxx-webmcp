import "server-only";

// Public read of one approved owned image, byte-for-byte out of the private
// bucket. Shared by /api/avatar/[profileId]/[generation] and
// /api/cover/[profileId]/[generation]: an unclaimed, tombstoned, pending,
// flagged, or hidden image is a 404, never a stale serve.
//
// Every refusal here answers the reader the SAME "Photo not found.", which is
// the right answer and a useless finding: nine different gates wear it. So a
// refusal also names itself once in the log (`profile_image.serve_refused`),
// the way an advisory scan skip does. The reader is told nothing extra.

import { publicApiError } from "@/lib/apiError";
import { profileMayWearAvatar } from "@/lib/avatarResolve";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { downloadProfileImageObject } from "@/lib/profileImageMedia.server";
import {
  isProfileImageServingKey,
  type ProfileImageSlot,
} from "@/lib/profileImageSlots";
import {
  profileImageState,
  profileStore,
  type ProfileRecord,
} from "@/lib/profileStore";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PROFILE_IMAGE_SERVE_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";

export type ProfileImageServeDeps = {
  getProfileById: (id: string) => Promise<ProfileRecord | null>;
  downloadObject: (objectKey: string) => Promise<Awaited<ReturnType<typeof downloadProfileImageObject>>>;
  /**
   * Generations this slot may serve BESIDES the one on the profile row. Only
   * the cover supplies it: a profile holds up to five covers
   * (`lib/profileCoverPhotoStore.ts`) and every one of them is served by this
   * route. The lookup owns its own approval and key checks, so a null here is
   * as final as a refusal from the row.
   */
  extraServingKey?: (profileId: string, generation: string) => Promise<string | null>;
};

export const defaultProfileImageServeDeps: ProfileImageServeDeps = {
  getProfileById: (id) => profileStore().getById(id),
  downloadObject: (objectKey) => downloadProfileImageObject(objectKey),
};

/**
 * Which gate refused. Every one of these answers the reader the same 404, so
 * without a name on it an owner's own face and a key that never existed are one
 * indistinguishable finding - which is exactly how an avatar that uploaded 200
 * and served 404 on every read stayed undiagnosable. Log-only closed set:
 * nothing branches on it, and the reader is told nothing new.
 */
type ProfileImageServeRefusal =
  | "storage_unconfigured"
  | "malformed_request"
  | "profile_missing"
  | "profile_unclaimed"
  | "moderation_not_approved"
  | "image_absent"
  | "generation_mismatch"
  | "object_key_unexpected"
  | "object_unreadable";

function notFound(
  slot: ProfileImageSlot,
  reason: ProfileImageServeRefusal,
  params: { profileId: string; generation: string },
): Response {
  // One quiet line. `warn`, not `error`: the reader got a defined answer, and
  // most of these reasons are the gate doing its job. The ids are the two the
  // caller already put in a public URL, so nothing here is new to anybody.
  log("warn", "profile_image.serve_refused", {
    slot,
    reason,
    profileId: params.profileId,
    generation: params.generation,
  });
  return publicApiError("Photo not found.", "NOT_FOUND", 404, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * The serving key this profile may hand out for this slot and generation, or
 * the gate that said no. A reason rather than a bare null, because "hidden",
 * "replaced by a newer generation" and "the stored key is not the one we would
 * write" are three different operator problems wearing one 404.
 */
function servingKey(
  profile: ProfileRecord,
  slot: ProfileImageSlot,
  generation: string,
): { objectKey: string } | { refusal: ProfileImageServeRefusal } {
  if (!profileMayWearAvatar(profile)) return { refusal: "profile_unclaimed" };
  const state = profileImageState(profile, slot);
  if (!state.objectKey && !state.generation && !state.moderationState) {
    return { refusal: "image_absent" };
  }
  if (state.moderationState !== "approved") return { refusal: "moderation_not_approved" };
  if (!state.objectKey || !state.generation) return { refusal: "object_key_unexpected" };
  if (state.generation !== generation) return { refusal: "generation_mismatch" };
  if (!isProfileImageServingKey(slot, profile.id, generation, state.objectKey)) {
    return { refusal: "object_key_unexpected" };
  }
  return { objectKey: state.objectKey };
}

/**
 * The closed set of row refusals a second serving lane may still answer. Both
 * say "this generation is not the one on the row"; neither says anything about
 * whether the profile's images are allowed to be seen.
 */
const ROTATION_MAY_ANSWER: ReadonlySet<ProfileImageServeRefusal> = new Set([
  "generation_mismatch",
  "image_absent",
]);

function mayAskRotation(refusal: ProfileImageServeRefusal): boolean {
  return ROTATION_MAY_ANSWER.has(refusal);
}

export async function handleProfileImageServe(
  request: Request,
  slot: ProfileImageSlot,
  params: { profileId: string; generation: string },
  deps: ProfileImageServeDeps,
): Promise<Response> {
  const ipHash = hashIp(clientIp(request));
  if (
    await isLimited(`${slot}-serve:${ipHash}`, `${slot}-serve:${ipHash}`, 240, 60_000)
  ) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  if (!isSupabaseConfigured()) return notFound(slot, "storage_unconfigured", params);

  const id = decodeURIComponent(params.profileId).trim();
  const gen = decodeURIComponent(params.generation).trim();
  if (!UUID.test(id) || !UUID.test(gen)) {
    return notFound(slot, "malformed_request", params);
  }

  const profile = await deps.getProfileById(id);
  if (!profile) return notFound(slot, "profile_missing", { profileId: id, generation: gen });

  const resolved = servingKey(profile, slot, gen);
  let objectKey = "objectKey" in resolved ? resolved.objectKey : null;
  // The row holds ONE generation, and a cover rotation holds up to five. So a
  // generation the row does not name is asked of the list before it is refused.
  // ONLY those two refusals may ask: every other one is a DECISION about this
  // profile's images rather than a fact about which generation was asked for,
  // and a decision must be terminal. A moderator hide used to fall through to
  // the rotation - whose own row the admin lane never touches - and the hidden
  // bytes kept serving 200. `moderation_not_approved` is checked BEFORE the
  // generation, so refusing here takes covers 2-5 down with cover 1.
  if (!objectKey && deps.extraServingKey && "refusal" in resolved && mayAskRotation(resolved.refusal)) {
    objectKey = await deps.extraServingKey(id, gen);
  }
  if (!objectKey) {
    return notFound(
      slot,
      "refusal" in resolved ? resolved.refusal : "image_absent",
      { profileId: id, generation: gen },
    );
  }

  // `downloadObject` logs the storage error or the byte mismatch itself: it is
  // the only half that knows which, and this half is the only one that knows a
  // reader was refused because of it.
  const downloaded = await deps.downloadObject(objectKey);
  if (!downloaded) {
    return notFound(slot, "object_unreadable", { profileId: id, generation: gen });
  }

  return new Response(new Uint8Array(downloaded.bytes), {
    status: 200,
    headers: {
      "Content-Type": downloaded.contentType,
      "Cache-Control": PROFILE_IMAGE_SERVE_CACHE_CONTROL,
    },
  });
}
