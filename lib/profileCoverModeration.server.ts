import "server-only";

// A cover takedown crosses TWO stores, and this module is the one place that
// knows it. `profiles.cover_*` is the back-compat mirror the admin console
// writes; `profile_cover_photos` is the five-photo rotation the serve route also
// reads. The admin lane used to write only the mirror, so a hidden cover kept
// being served out of the rotation whose own row was still `approved`.
//
// The serve route already refuses terminally on a moderation decision
// (`lib/profileImageServe.server.ts`), so the bytes stop travelling either way.
// This mirror is what stops the ROTATION from disagreeing: `listApproved` feeds
// the public carousel, so without it a hidden backdrop would still be named on
// the profile card and paint five broken frames.
//
// Profile-level cover decisions remain whole-profile. The named rotation-row
// helper below handles per-photo reports when no mirror exists.

import { log } from "@/lib/log";
import {
  moderateDurableProfileCoverAcrossStores,
  profileCoverPhotoStore,
} from "@/lib/profileCoverPhotoStore";
import type { ProfileImageSlot } from "@/lib/profileImageSlots";
import {
  moderateProfileImage,
  profileImageState,
  profileStore,
} from "@/lib/profileStore";

/**
 * Apply a moderator decision to an owned image, and for the cover apply the SAME
 * decision to every photo in that profile's rotation. Returns whether the image
 * itself moved or the rotation moved: rotation-only covers have no mirror row
 * but still earn a takedown on every rotation photograph. A rotation sync
 * failure is logged and propagated so the API never reports a partial success.
 */
export async function moderateProfileImageAcrossStores(
  handle: string,
  slot: ProfileImageSlot,
  action: "hide" | "restore",
  note?: string,
): Promise<boolean> {
  if (slot === "cover") {
    const durable = await moderateDurableProfileCoverAcrossStores(
      handle,
      action === "hide" ? "hidden" : "approved",
      note,
    );
    if (durable !== null) return durable;
  }
  const ok = await moderateProfileImage(handle, slot, action, note);
  if (slot !== "cover") return ok;

  let rotationMoved = 0;
  try {
    const profile = await profileStore().getByHandle(handle);
    if (!profile) {
      if (!ok) return false;
      throw new Error("Profile cover sync target is missing.");
    }
    // A restore with no mirror image left nothing to put back on the profile row.
    if (action === "restore" && !ok) return false;
    rotationMoved = await profileCoverPhotoStore().moderateAllForProfile(
      profile.id,
      action === "hide" ? "hidden" : "approved",
      note,
    );
  } catch (error) {
    log("warn", "profile_cover.moderation_sync_failed", {
      handle,
      action,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  return ok || rotationMoved > 0;
}

/** Apply a moderator decision to one rotation row. Rows reported through the
 * carousel have no profile-mirror handle when mirroring failed, so the admin
 * lane must address the row by id. When the row is the current mirror, retain
 * the whole-profile decision so the two public cover lanes cannot disagree. */
export async function moderateProfileCoverPhotoAcrossStores(
  handle: string,
  coverId: string,
  action: "hide" | "restore",
  note?: string,
): Promise<boolean> {
  const profile = await profileStore().getByHandle(handle);
  if (!profile) return false;

  const cover = await profileCoverPhotoStore().getById(coverId);
  if (!cover || cover.profileId !== profile.id) return false;

  const mirror = profileImageState(profile, "cover");
  if (mirror.objectKey && mirror.generation === cover.generation) {
    return moderateProfileImageAcrossStores(handle, "cover", action, note);
  }

  return profileCoverPhotoStore().moderate(
    coverId,
    action === "hide" ? "hidden" : "approved",
    note,
  );
}
