// Owned-image moderation queue for the admin console (Social Launch WP4).
//   GET  ?status=reported|hidden&slot=avatar|cover -> { avatars: ModeratorProfileImage[], rotationCovers?: ModeratorProfileCover[] }
//   POST { action, handle, slot?, coverId?, note? } -> { ok: true }   action ∈ hide | restore
//
// Readers flag via POST /api/profiles/[handle]/{avatar,cover}/report. This route
// is where a human acts. Hide stamps the image hidden (public serve becomes 404,
// so a face falls back to initials and a cover to the brass treatment) and never
// deletes storage or report provenance; restore puts an approved image back.
// Reporter actor hashes never leave the store. `slot` defaults to the face, so a
// console that predates covers keeps working unchanged. A profile-level COVER
// decision crosses two stores - see `lib/profileCoverModeration.server.ts` -
// while a named rotation row can be moderated on its own when the mirror is
// absent.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { isProfileImageSlot, type ProfileImageSlot } from "@/lib/profileImageSlots";
import {
  moderateProfileCoverPhotoAcrossStores,
  moderateProfileImageAcrossStores,
} from "@/lib/profileCoverModeration.server";
import {
  profileCoverPhotoStore,
  toModeratorProfileCover,
  type ModeratorProfileCover,
} from "@/lib/profileCoverPhotoStore";
import {
  listHiddenProfileImages,
  listReportedProfileImages,
  profileImageState,
  profileStore,
} from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

function requestedSlot(value: unknown): ProfileImageSlot {
  return isProfileImageSlot(value) ? value : "avatar";
}

async function listRotationCovers(
  status: "reported" | "hidden",
): Promise<ModeratorProfileCover[]> {
  const rows =
    status === "hidden"
      ? await profileCoverPhotoStore().listHidden()
      : await profileCoverPhotoStore().listForReview();
  const covers = await Promise.all(
    rows.map(async (row) => {
      const profile = await profileStore().getById(row.profileId);
      if (!profile) return null;
      const mirror = profileImageState(profile, "cover");
      const mirrorMatches = Boolean(mirror.objectKey && mirror.generation === row.generation);
      // A matching rotation row is only a duplicate after its profile mirror
      // has entered the same moderation lane. Until then, keep it as a
      // profile-level row so a rotation report cannot disappear before the
      // mirror report syncs.
      const mirrorAlreadyQueued =
        mirrorMatches &&
        (status === "hidden"
          ? mirror.moderationState === "hidden"
          : mirror.moderationState === "approved" &&
            (mirror.reportCount ?? 0) > 0 &&
            !mirror.moderatedAt);
      if (mirrorAlreadyQueued) return null;
      const rotationOnly = !mirrorMatches;
      return toModeratorProfileCover(row, profile.handle, rotationOnly);
    }),
  );
  return covers.filter((cover): cover is ModeratorProfileCover => cover !== null);
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-avatars:${ipKey}`, `admin-avatars:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const query = new URL(request.url).searchParams;
  const status = query.get("status");
  const slot = requestedSlot(query.get("slot"));
  try {
    const avatars =
      status === "hidden"
        ? await listHiddenProfileImages(slot)
        : await listReportedProfileImages(slot);
    const rotationCovers =
      slot === "cover" && (status === "reported" || status === "hidden")
        ? await listRotationCovers(status)
        : undefined;
    return jsonNoStore(
      { avatars, ...(rotationCovers ? { rotationCovers } : {}) },
      { status: 200 },
    );
  } catch {
    return publicApiError("Image moderation is unavailable right now.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-avatars:${ipKey}`, `admin-avatars:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const handle = normalizeHandle(readString(body.handle) ?? "");
  if (!handle) return publicApiError("Missing handle.", "INVALID_REQUEST", 400);

  const action = readString(body.action);
  if (action !== "hide" && action !== "restore") {
    return publicApiError("Unknown action.", "INVALID_REQUEST", 400);
  }

  try {
    const slot = requestedSlot(body.slot);
    const coverId = readString(body.coverId);
    const ok =
      slot === "cover" && coverId
        ? await moderateProfileCoverPhotoAcrossStores(
            handle,
            coverId,
            action,
            readString(body.note),
          )
        : await moderateProfileImageAcrossStores(handle, slot, action, readString(body.note));
    if (!ok) return publicApiError("Profile image not found.", "NOT_FOUND", 404);
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch {
    return publicApiError("Image moderation is unavailable right now.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
