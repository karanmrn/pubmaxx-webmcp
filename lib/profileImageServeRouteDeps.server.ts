import "server-only";

import {
  defaultProfileImageServeDeps,
  PROFILE_IMAGE_SERVE_CACHE_CONTROL,
  type ProfileImageServeDeps,
} from "@/lib/profileImageServe.server";
import { profileCoverPhotoStore } from "@/lib/profileCoverPhotoStore";

export const AVATAR_SERVE_CACHE_CONTROL = PROFILE_IMAGE_SERVE_CACHE_CONTROL;

let avatarTestDeps: Partial<ProfileImageServeDeps> | null = null;
let coverTestDeps: Partial<ProfileImageServeDeps> | null = null;

export function __setAvatarServeRouteDepsForTest(
  deps: Partial<ProfileImageServeDeps> | null,
): void {
  avatarTestDeps = deps;
}

export function __setCoverServeRouteDepsForTest(
  deps: Partial<ProfileImageServeDeps> | null,
): void {
  coverTestDeps = deps;
}

export function avatarServeRouteDeps(): ProfileImageServeDeps {
  return { ...defaultProfileImageServeDeps, ...avatarTestDeps };
}

export function coverServeRouteDeps(): ProfileImageServeDeps {
  return {
    ...defaultProfileImageServeDeps,
    // A profile holds up to five covers and the row names only the first, so
    // this route also serves any generation the rotation records for it. The
    // store checks approval and the serving-key shape itself.
    extraServingKey: (profileId, generation) =>
      profileCoverPhotoStore().approvedObjectKey(profileId, generation),
    ...coverTestDeps,
  };
}
