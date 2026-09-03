import "server-only";

import {
  defaultProfileImageRouteDeps,
  type ProfileImageRouteDeps,
} from "@/lib/profileImageRoute.server";

let avatarTestDeps: Partial<ProfileImageRouteDeps> | null = null;
let coverTestDeps: Partial<ProfileImageRouteDeps> | null = null;

export function __setProfileAvatarRouteDepsForTest(
  deps: Partial<ProfileImageRouteDeps> | null,
): void {
  avatarTestDeps = deps;
}

export function __setProfileCoverRouteDepsForTest(
  deps: Partial<ProfileImageRouteDeps> | null,
): void {
  coverTestDeps = deps;
}

export function profileAvatarRouteDeps(): ProfileImageRouteDeps {
  return { ...defaultProfileImageRouteDeps, ...avatarTestDeps };
}

export function profileCoverRouteDeps(): ProfileImageRouteDeps {
  return { ...defaultProfileImageRouteDeps, ...coverTestDeps };
}
