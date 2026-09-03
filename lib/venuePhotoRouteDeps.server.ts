import "server-only";

import {
  createProfileAvatarModerationAdapter,
  type ProfileAvatarModerationAdapter,
} from "@/lib/profileAvatarModeration";
import { crosspostVenuePhotoToFeed } from "@/lib/venuePhotoCrosspost.server";
import {
  supabaseVenuePhotoStorage,
  type VenuePhotoStorage,
} from "@/lib/venuePhotoMedia.server";

export type VenuePhotoRouteDeps = {
  storage: VenuePhotoStorage;
  moderation: () => ProfileAvatarModerationAdapter;
  crosspost: typeof crosspostVenuePhotoToFeed;
};

const defaultVenuePhotoRouteDeps: VenuePhotoRouteDeps = {
  storage: supabaseVenuePhotoStorage,
  moderation: () => createProfileAvatarModerationAdapter(),
  crosspost: crosspostVenuePhotoToFeed,
};

let testDeps: Partial<VenuePhotoRouteDeps> | null = null;

export function __setVenuePhotoRouteDepsForTest(
  deps: Partial<VenuePhotoRouteDeps> | null,
): void {
  testDeps = deps;
}

export function venuePhotoRouteDeps(): VenuePhotoRouteDeps {
  return { ...defaultVenuePhotoRouteDeps, ...testDeps };
}
