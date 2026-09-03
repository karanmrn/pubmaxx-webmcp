import "server-only";

import {
  defaultProfileCoverPhotoRouteDeps,
  type ProfileCoverPhotoRouteDeps,
} from "@/lib/profileCoverPhotoRoute.server";

let listTestDeps: Partial<ProfileCoverPhotoRouteDeps> | null = null;
let itemTestDeps: Partial<ProfileCoverPhotoRouteDeps> | null = null;

export function __setProfileCoverPhotosRouteDepsForTest(
  deps: Partial<ProfileCoverPhotoRouteDeps> | null,
): void {
  listTestDeps = deps;
}

export function __setProfileCoverPhotoRouteDepsForTest(
  deps: Partial<ProfileCoverPhotoRouteDeps> | null,
): void {
  itemTestDeps = deps;
}

export function profileCoverPhotosRouteDeps(): ProfileCoverPhotoRouteDeps {
  return { ...defaultProfileCoverPhotoRouteDeps, ...listTestDeps };
}

export function profileCoverPhotoRouteDeps(): ProfileCoverPhotoRouteDeps {
  return { ...defaultProfileCoverPhotoRouteDeps, ...itemTestDeps };
}
