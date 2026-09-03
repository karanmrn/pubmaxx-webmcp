// The two owned-image slots a profile can fill: the face and the backdrop.
//
// ONE pipeline serves both (staging -> scan -> promote, EXIF strip, moderation,
// report/hide lane, tombstone deletion). Everything that differs between them
// lives in the table below, so a second slot is a row rather than a second copy
// of the pipeline. Pure and browser-safe: no sharp, no storage client, no node
// builtins, so a client component may import the copy and the aspect ratio.

export const PROFILE_IMAGE_SLOTS = ["avatar", "cover"] as const;

export type ProfileImageSlot = (typeof PROFILE_IMAGE_SLOTS)[number];

export type ProfileImageSlotSpec = {
  /** Storage prefix under the private bucket. */
  readonly prefix: string;
  /** Serving object file name (staging is always `staging.jpg`). */
  readonly servingFile: string;
  /** Public serve route base; the id and generation are appended. */
  readonly servePath: string;
  /** Longest edge the stored JPEG is resized down to. */
  readonly outputWidth: number;
  /** Square box for a face; width-only for a backdrop. */
  readonly outputHeight: number | null;
  /**
   * Rendered aspect ratio of the slot, so the composer's preview and the header
   * agree without either one restating a number the other owns.
   */
  readonly aspectRatio: number;
  /** Sentence noun for reader-facing copy ("Photo must be…"). */
  readonly noun: string;
  /** Same noun mid-sentence. */
  readonly nounLower: string;
};

export const PROFILE_IMAGE_SLOT_SPECS: Readonly<
  Record<ProfileImageSlot, ProfileImageSlotSpec>
> = {
  avatar: {
    prefix: "avatars",
    servingFile: "image.jpg",
    servePath: "/api/avatar",
    outputWidth: 512,
    outputHeight: 512,
    aspectRatio: 1,
    noun: "Photo",
    nounLower: "photo",
  },
  cover: {
    prefix: "covers",
    servingFile: "cover.jpg",
    servePath: "/api/cover",
    outputWidth: 1600,
    outputHeight: null,
    aspectRatio: 3,
    noun: "Cover photo",
    nounLower: "cover photo",
  },
};

export function isProfileImageSlot(value: unknown): value is ProfileImageSlot {
  return (
    typeof value === "string" &&
    (PROFILE_IMAGE_SLOTS as readonly string[]).includes(value)
  );
}

export function profileImageSlotSpec(slot: ProfileImageSlot): ProfileImageSlotSpec {
  return PROFILE_IMAGE_SLOT_SPECS[slot];
}

/**
 * The pixel box a finished image for this slot fills. A face slot states both
 * edges; a backdrop states its width and takes its height from the slot's own
 * aspect ratio. The crop step renders straight into this box and the composer's
 * preview reserves it, so neither one restates a number the table already owns.
 */
export function profileImageOutputBox(slot: ProfileImageSlot): {
  readonly width: number;
  readonly height: number;
} {
  const spec = PROFILE_IMAGE_SLOT_SPECS[slot];
  return {
    width: spec.outputWidth,
    height: spec.outputHeight ?? Math.round(spec.outputWidth / spec.aspectRatio),
  };
}

export function profileImageStagingKey(
  slot: ProfileImageSlot,
  profileId: string,
  generation: string,
): string {
  return `${PROFILE_IMAGE_SLOT_SPECS[slot].prefix}/${profileId}/${generation}/staging.jpg`;
}

export function profileImageServingKey(
  slot: ProfileImageSlot,
  profileId: string,
  generation: string,
): string {
  const spec = PROFILE_IMAGE_SLOT_SPECS[slot];
  return `${spec.prefix}/${profileId}/${generation}/${spec.servingFile}`;
}

export function isProfileImageServingKey(
  slot: ProfileImageSlot,
  profileId: string,
  generation: string,
  objectKey: string,
): boolean {
  return objectKey === profileImageServingKey(slot, profileId, generation);
}

/** Public serve path for an approved image in this slot. */
export function profileImageServePath(
  slot: ProfileImageSlot,
  profileId: string,
  generation: string,
): string {
  return `${PROFILE_IMAGE_SLOT_SPECS[slot].servePath}/${profileId}/${generation}`;
}
