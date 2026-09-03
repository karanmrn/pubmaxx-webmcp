import "server-only";

// "Also share to your feed", and the honest answer to it.
//
// A crosspost is a SECOND write to a different product with its own gate. The
// wall takes any signed-in adult with a claimed handle; the friends-launch
// Social feed takes a VERIFIED Social actor, which is a narrower set. So the
// checkbox is a request, never a guarantee, and this module returns which of
// the three things really happened (`VenuePhotoCrosspostState`).
//
// WHY IT REUSES THE SOCIAL POST MACHINERY WHOLE: a photo on a feed has to carry
// that feed's moderation queue, its media reservation and cleanup, its
// idempotency and its venue projection. Writing a shortcut row would give the
// wall a lane through Social's safety work, which is the one thing a second
// path must never buy. The wall's own scan has already passed here; the feed
// still runs its own, because they answer to different moderators.
//
// A CROSSPOST FAILURE NEVER FAILS THE WALL. The photo is already approved and
// stored; taking the whole request down because a feed was unavailable would
// throw away work the drinker already did, so the failure is reported instead.

import { log } from "@/lib/log";
import {
  prepareSocialPhoto,
  reconcileSocialPhotoUpload,
  reserveSocialPhotoUpload,
  uploadPreparedSocialPhoto,
  type UploadedSocialPhoto,
} from "@/lib/socialPostMedia.server";
import { socialPhotoMediaId, socialPostRequestDigest } from "@/lib/socialPostIdempotency.server";
import { socialPostStore, type SocialPostActor } from "@/lib/socialPostStore";
import type { SocialPostFields } from "@/lib/socialPosts";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import type { VenuePhotoCrosspost } from "@/lib/venuePhotos";

export type VenuePhotoCrosspostInput = {
  /** The wall photo's own caption; it becomes the post body verbatim. */
  caption: string;
  venueId: string;
  /** The exact JPEG the wall approved, so both surfaces show one photo. */
  photo: File;
  /** Stable per-request key, so a retry cannot post twice. */
  idempotencyKey: string;
  /** The wall's own author, already resolved. Used to refuse a mismatch. */
  authorProfileId: string;
};

/**
 * The one sentence a feed post says when the drinker wrote no caption. It
 * describes the act, claims nothing about the pub, and carries no figure.
 */
export const VENUE_PHOTO_CROSSPOST_FALLBACK_BODY = "Added a photo to this pub's wall.";

export type CrosspostDeps = {
  resolveActor: (request: Request) => Promise<
    { ok: true; actor: SocialPostActor } | { ok: false }
  >;
};

const defaultDeps: CrosspostDeps = {
  resolveActor: async (request) => {
    const access = await requireVerifiedSocialActor(request);
    return access.ok ? { ok: true, actor: access.actor } : { ok: false };
  },
};

/**
 * Create the feed post, or say plainly that no feed post exists. Never throws:
 * the wall write has already succeeded by the time this runs.
 */
export async function crosspostVenuePhotoToFeed(
  request: Request,
  input: VenuePhotoCrosspostInput,
  deps: CrosspostDeps = defaultDeps,
): Promise<VenuePhotoCrosspost> {
  let reserved: UploadedSocialPhoto | null = null;
  try {
    const access = await deps.resolveActor(request);
    if (!access.ok) return { state: "unavailable" };
    // The wall resolved its author from the same session. A Social actor whose
    // profile is a different one means two identities in one request, which is
    // never a thing to write through.
    if (access.actor.profileId !== input.authorProfileId) return { state: "unavailable" };

    const prepared = await prepareSocialPhoto(input.photo);
    const mediaId = socialPhotoMediaId(
      access.actor.profileId,
      input.idempotencyKey,
      prepared.sha256,
    );
    const body = input.caption || VENUE_PHOTO_CROSSPOST_FALLBACK_BODY;
    const fields: SocialPostFields = {
      kind: "standard",
      // Friends-launch default. A wall photo is public on the wall, but the
      // feed's own audience rule is the feed's to keep.
      visibility: "friends",
      body,
      area: null,
      venueId: input.venueId,
      hashtags: [],
      commentPolicy: "friends",
      photo: { mediaId, altText: body },
    };
    const requestDigest = socialPostRequestDigest(fields, prepared.sha256, []);

    reserved = await reserveSocialPhotoUpload(access.actor.profileId, prepared, mediaId);
    const uploaded = await uploadPreparedSocialPhoto(
      access.actor.profileId,
      prepared,
      undefined,
      reserved.mediaId,
      reserved.objectKey,
      reserved.generation,
    );
    const post = await socialPostStore().create(access.actor, fields, {
      media: {
        mediaId: uploaded.mediaId,
        objectKey: uploaded.objectKey,
        sha256: uploaded.sha256,
        width: uploaded.width,
        height: uploaded.height,
        byteSize: uploaded.byteSize,
      },
      tagHandles: [],
      idempotencyKey: input.idempotencyKey,
      requestDigest,
    });
    reserved = null;
    return { state: "posted", postId: post.id };
  } catch (error) {
    if (reserved) {
      await reconcileSocialPhotoUpload(
        input.authorProfileId,
        reserved.mediaId,
        reserved.generation,
      ).catch(() => false);
    }
    log("error", "venue_photo.crosspost_failed", {
      route: "POST /api/venue-photos",
      error: error instanceof Error ? error.message : String(error),
    });
    return { state: "unavailable" };
  }
}
