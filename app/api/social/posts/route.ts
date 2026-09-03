import { assertServerEnv } from "@/lib/serverEnv";
import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import {
  prepareSocialPhoto,
  reconcileSocialPhotoUpload,
  reserveSocialPhotoUpload,
  SOCIAL_PHOTO_MAX_BYTES,
  SocialPhotoError,
  uploadPreparedSocialPhoto,
  type UploadedSocialPhoto,
} from "@/lib/socialPostMedia.server";
import { socialPostStore, SocialPostStoreError } from "@/lib/socialPostStore";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { parseSocialCreateSubmission } from "@/lib/socialPostSubmission";
import { projectSocialVenueName, projectSocialVenueNames, resolveSocialVenueId, type SocialVenueResolution } from "@/lib/socialPostVenue.server";
import { enrichSocialPostAuthors, isSocialPostArea, type SocialPostFields } from "@/lib/socialPosts";
import { hashActor } from "@/lib/supabase";
import { boundedFormData, boundedJson } from "@/lib/boundedRequest.server";
import { socialPhotoMediaId, socialPostRequestDigest, validSocialPostIdempotencyKey } from "@/lib/socialPostIdempotency.server";
import { readSocialPostCreateRequest } from "@/lib/socialPostCreateRequest.server";

assertServerEnv();

const FEED_RATE_LIMIT = 60;
const FEED_RATE_WINDOW_MS = 60_000;

function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

async function submissionBody(request: Request): Promise<{
  input: unknown;
  photo: File | null;
} | null> {
  try {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return { input: await boundedJson(request), photo: null };
    }
    const form = await boundedFormData(request, SOCIAL_PHOTO_MAX_BYTES + 64 * 1024);
    if ([...form.keys()].some((key) => key !== "post" && key !== "photo")) return null;
    const postParts = form.getAll("post");
    const photoParts = form.getAll("photo");
    if (postParts.length !== 1 || typeof postParts[0] !== "string" || photoParts.length > 1) return null;
    const photo = photoParts[0] ?? null;
    if (photo !== null && !(photo instanceof File)) return null;
    return { input: JSON.parse(postParts[0]), photo };
  } catch {
    return null;
  }
}

function accessError(access: Exclude<Awaited<ReturnType<typeof requireVerifiedSocialActor>>, { ok: true }>): Response {
  return publicApiError(access.error, access.code, access.status, { retryable: access.retryable === true, headers: { "Cache-Control": "private, no-store" } });
}

function storeError(error: unknown): Response {
  if (error instanceof Error && /invalid Social tags/i.test(error.message)) {
    return publicApiError("Photo tags are not valid.", "INVALID_TAGS", 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (error instanceof SocialPostStoreError) {
    const status = error.code === "FORBIDDEN" ? 403
      : error.code === "NOT_FOUND" ? 404
        : error.code === "EDIT_CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT" ? 409
          : 400;
    return publicApiError(error.message, error.code, status, { headers: { "Cache-Control": "private, no-store" } });
  }
  return publicApiError("Social posts are unavailable right now.", "SOCIAL_POSTS_UNAVAILABLE", 503, { retryable: true, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return accessError(access);
  const params = new URL(request.url).searchParams;
  const lane = params.get("lane") ?? "discover";
  if (lane !== "discover" && lane !== "nearby" && lane !== "following") {
    return publicApiError("Choose a Social feed.", "INVALID_LANE", 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return publicApiError("Feed size must be between 1 and 50.", "INVALID_LIMIT", 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  const area = params.get("area");
  if (lane === "nearby" && !isSocialPostArea(area)) {
    return publicApiError("Choose a listed area.", "INVALID_AREA", 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  const areaScope = lane === "nearby" ? area : "all";
  const feedKey = `social-post-feed:${hashActor(access.actor.profileId)}:${lane}:${areaScope}`;
  if (await isLimited(feedKey, feedKey, FEED_RATE_LIMIT, FEED_RATE_WINDOW_MS)) {
    return publicApiError("Too many Social feed requests. Slow down.", "RATE_LIMITED", 429, { retryable: true, headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    const page = await socialPostStore().feed(access.actor, {
      lane,
      area: area ?? undefined,
      cursor: params.get("cursor"),
      limit,
    });
    const photoPostIds = page.posts.filter((post) => post.photo).map((post) => post.id);
    const tags = photoPostIds.length > 0
      ? await socialPostConsentStore.approvedTags(access.actor, photoPostIds)
      : new Map();
    return privateJson({
      ...page,
      posts: await enrichSocialPostAuthors(
        await projectSocialVenueNames(page.posts.map((post) => post.photo
          ? { ...post, photo: { ...post.photo, tags: tags.get(post.id) ?? [] } }
          : post)),
      ),
    });
  } catch (error) {
    return storeError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return accessError(access);
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!validSocialPostIdempotencyKey(idempotencyKey)) return publicApiError("Post request key is not valid.", "INVALID_IDEMPOTENCY_KEY", 400, { headers: { "Cache-Control": "private, no-store" } });
  const submitted = await submissionBody(request);
  if (submitted === null) {
    return publicApiError("Post request is not valid.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  const validation = parseSocialCreateSubmission(submitted.input, submitted.photo !== null);
  if (!validation.ok) {
    return publicApiError(validation.error, validation.code, 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  const limitKey = `social-post-create:${hashActor(access.actor.profileId)}`;
  if (await isLimited(limitKey, limitKey)) {
    return publicApiError("Too many Social posts. Slow down.", "RATE_LIMITED", 429, { retryable: true, headers: { "Cache-Control": "private, no-store" } });
  }
  let fields: SocialPostFields = { ...validation.post, photo: null };
  let resolvedVenue: Extract<SocialVenueResolution, { ok: true }> | null = null;
  if (fields.venueId) {
    const venue = await resolveSocialVenueId(fields.venueId);
    if (!venue.ok) {
      return venue.unavailable
        ? publicApiError("Venue search is unavailable right now.", "VENUE_LOOKUP_UNAVAILABLE", 503, { retryable: true, headers: { "Cache-Control": "private, no-store" } })
        : publicApiError("Choose a pub from Venue search.", "INVALID_VENUE", 400, { headers: { "Cache-Control": "private, no-store" } });
    }
    fields = { ...fields, venueId: venue.venueId };
    resolvedVenue = venue;
  }
  let uploaded: UploadedSocialPhoto | null = null;
  let reserved: UploadedSocialPhoto | null = null;
  let replayExistingMedia = false;
  let requestDigest = socialPostRequestDigest(fields, null, []);
  try {
    if (submitted.photo) {
      const prepared = await prepareSocialPhoto(submitted.photo);
      const mediaId = socialPhotoMediaId(access.actor.profileId, idempotencyKey, prepared.sha256);
      fields = {
        ...fields,
        photo: { mediaId, altText: validation.photoAltText! },
      };
      const digest = socialPostRequestDigest(fields, prepared.sha256, validation.tagHandles);
      requestDigest = digest;
      const prior = await readSocialPostCreateRequest(access.actor.profileId, idempotencyKey);
      if (prior && prior.digest !== digest) throw new SocialPostStoreError("IDEMPOTENCY_CONFLICT", "That post request key was already used for different content.");
      replayExistingMedia = prior !== null;
      if (!prior) {
        reserved = await reserveSocialPhotoUpload(access.actor.profileId, prepared, mediaId);
        uploaded = await uploadPreparedSocialPhoto(
          access.actor.profileId,
          prepared,
          undefined,
          reserved.mediaId,
          reserved.objectKey,
          reserved.generation,
        );
      }
    }
    const post = uploaded
      ? await socialPostStore().create(access.actor, fields, {
          media: {
            mediaId: uploaded.mediaId,
            objectKey: uploaded.objectKey,
            sha256: uploaded.sha256,
            width: uploaded.width,
            height: uploaded.height,
            byteSize: uploaded.byteSize,
          },
          tagHandles: validation.tagHandles,
          idempotencyKey,
          requestDigest,
        })
      : await socialPostStore().create(access.actor, fields, {
          idempotencyKey,
          requestDigest,
          ...(replayExistingMedia ? { replayExistingMedia: true } : {}),
        });
    return privateJson({ post: await projectSocialVenueName(post, resolvedVenue) }, { status: 201 });
  } catch (error) {
    if (reserved) {
      await reconcileSocialPhotoUpload(access.actor.profileId, reserved.mediaId, reserved.generation).catch(() => false);
    }
    if (error instanceof SocialPhotoError) {
      const unavailable = error.code === "STORAGE_UNAVAILABLE";
      return publicApiError(error.message, error.code, unavailable ? 503 : 400, {
        retryable: unavailable,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    return storeError(error);
  }
}
