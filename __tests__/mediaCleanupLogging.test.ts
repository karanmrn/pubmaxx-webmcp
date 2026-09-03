import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  promoteStagedMessagePhoto,
  type MessagePhotoStorage,
  type StagedMessagePhoto,
} from "@/lib/messagePhotoMedia.server";
import { messagePhotoServingKey, messagePhotoStagingKey } from "@/lib/messageAttachments";
import {
  promoteStagedProfileImage,
  type ProfileImageStorage,
  type UploadedProfileImage,
} from "@/lib/profileImageMedia.server";
import { profileImageServingKey, profileImageStagingKey } from "@/lib/profileImageSlots";
import {
  promoteStagedVenuePhoto,
  type StagedVenuePhoto,
  type VenuePhotoStorage,
} from "@/lib/venuePhotoMedia.server";
import { venuePhotoServingKey, venuePhotoStagingKey } from "@/lib/venuePhotos";

const bytes = Buffer.from("jpeg");
const prepared = {
  bytes,
  contentType: "image/jpeg" as const,
  width: 1,
  height: 1,
  byteSize: 4,
  sha256: "41e5787e9f28562d07b891b1816b492309d646c0f2829743fa4963a9f9cc1d61",
};

function cleanupFailingStorage(): MessagePhotoStorage & ProfileImageStorage & VenuePhotoStorage {
  return {
    upload: vi.fn(async () => {}),
    remove: vi.fn(async () => {
      throw new Error("cleanup unavailable");
    }),
    sign: vi.fn(async () => null),
    readBack: vi.fn(async () => ({
      ok: true as const,
      image: { bytes, contentType: "image/jpeg" as const },
    })),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("media cleanup diagnostics", () => {
  it("names each orphaned staging object without logger redaction", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => output.push(String(line)));

    const conversationId = "conversation-a";
    const messageId = "message-a";
    const message: StagedMessagePhoto = {
      ...prepared,
      conversationId,
      messageId,
      stagingKey: messagePhotoStagingKey(conversationId, messageId),
      objectKey: messagePhotoServingKey(conversationId, messageId),
    };
    await promoteStagedMessagePhoto(message, cleanupFailingStorage());

    const profileId = "profile-a";
    const generation = "generation-a";
    const profile: UploadedProfileImage = {
      ...prepared,
      slot: "avatar",
      profileId,
      generation,
      stagingKey: profileImageStagingKey("avatar", profileId, generation),
      objectKey: profileImageServingKey("avatar", profileId, generation),
    };
    await promoteStagedProfileImage(profile, cleanupFailingStorage());

    const venueId = "venue-a";
    const photoId = "photo-a";
    const venue: StagedVenuePhoto = {
      ...prepared,
      venueId,
      photoId,
      stagingKey: venuePhotoStagingKey(venueId, photoId),
      objectKey: venuePhotoServingKey(venueId, photoId),
    };
    await promoteStagedVenuePhoto(venue, cleanupFailingStorage());

    expect(output.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: "message_photo.cleanup_failed",
        objectPath: message.stagingKey,
      }),
      expect.objectContaining({
        event: "profile_image.cleanup_failed",
        objectPath: profile.stagingKey,
      }),
      expect.objectContaining({
        event: "venue_photo.cleanup_failed",
        objectPath: venue.stagingKey,
      }),
    ]);
  });
});
