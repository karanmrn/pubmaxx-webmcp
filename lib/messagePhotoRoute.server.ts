import "server-only";

import {
  createProfileAvatarModerationAdapter,
  type ProfileAvatarModerationAdapter,
} from "@/lib/profileAvatarModeration";
import {
  supabaseMessagePhotoStorage,
  type MessagePhotoStorage,
} from "@/lib/messagePhotoMedia.server";

/** Dependencies for the message-photo write journey. */
export type MessagePhotoRouteDeps = {
  storage: MessagePhotoStorage;
  moderation: () => ProfileAvatarModerationAdapter;
};

/** Production dependencies, kept outside the Next route module. */
const defaultMessagePhotoRouteDeps: MessagePhotoRouteDeps = {
  storage: supabaseMessagePhotoStorage,
  moderation: () => createProfileAvatarModerationAdapter(),
};

let testDeps: Partial<MessagePhotoRouteDeps> | null = null;

/** Test seam for the storage and moderation boundaries. */
export function __setMessagePhotoRouteDepsForTest(
  deps: Partial<MessagePhotoRouteDeps> | null,
): void {
  testDeps = deps;
}

export function messagePhotoRouteDeps(): MessagePhotoRouteDeps {
  return { ...defaultMessagePhotoRouteDeps, ...testDeps };
}
