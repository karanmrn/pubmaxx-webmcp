// Public profile read seam for /u/[handle]. Returns the STORED profile row (or
// null when a handle has dropped no pints yet / Supabase is unconfigured), its
// follower/following counts, and — when a `?viewer=<handle>` is supplied — whether
// that viewer already follows this handle (drives the follow button's initial
// state without a second request).
//
// Store choice is the single seam pattern from app/api/pint-drops/route.ts:
// Supabase when configured, process-memory otherwise. Reads never 503 — a
// missing profile is a first-class "null" result, so the page always renders.

import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import {
  PROFILE_IMAGE_SLOTS,
  profileImageStagingKey,
} from "@/lib/profileImageSlots";
import {
  isProfileTombstoned,
  MAX_FAVOURITE_DRINK,
  MAX_INTERESTS,
  MAX_WORKPLACE,
  profileImageState,
  profileStore,
  publicProfileFromRecord,
  type ProfilePatch,
  type ProfileRecord,
} from "@/lib/profileStore";
import { publicCoverUrls } from "@/lib/profileCoverPhotoStore";
import { followStore } from "@/lib/followStore";
import { markContributorsDepartedByProfileId } from "@/lib/nightMemoryStore";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { referralStore } from "@/lib/referralStore";
import { socialConnectionStore } from "@/lib/socialConnectionStore";
import { publicSocialLinks, type PublicSocialLink } from "@/lib/socialConnections";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";
import { cleanText } from "@/lib/textClean";
import { assertServerEnv } from "@/lib/serverEnv";
import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isSocialFriendsLaunchEnabled, SOCIAL_FRIENDS_LAUNCH_ENV } from "@/lib/socialLaunch";

assertServerEnv();

function stores() {
  return { profiles: profileStore(), follows: followStore() };
}

// The owner's own linked socials. Public on purpose: a person typed each one in
// on their own account and can remove it in one tap. This is the ONLY public
// addition to the payload: email, date of birth, gender and full name stay
// behind the owner-authenticated onboarding read
// (__tests__/profilesRoutePrivacy.test.ts pins that). Fail-soft, because a
// connections hiccup may not take a whole profile page down with it.
async function publicLinksFor(profile: ProfileRecord | null): Promise<PublicSocialLink[]> {
  if (!profile?.userId || isProfileTombstoned(profile)) return [];
  try {
    return publicSocialLinks(await socialConnectionStore().list(profile.userId));
  } catch {
    return [];
  }
}

// Trust boundary for profile edits — the request body is untrusted. cleanText
// (lib/textClean) strips inline HTML angle brackets + control chars, collapses
// whitespace, and caps length; isHttpUrl validates the avatar link. Both mirror
// the shared trust boundary so every write path agrees.

// Editable field caps. The handle itself is NOT editable here (it is the
// identity key — renaming is a separate, auth-gated operation).
const MAX_DISPLAY_NAME = 60;
const MAX_BIO = 280;
const MAX_HOME_CITY = 60;

// Build a ProfilePatch from an untrusted body.
// sent are included, so an edit form that omits a field never clears it. Empty
// strings are meaningful: they clear an optional field (stored as null).
function buildPatch(
  body: Record<string, unknown>,
): { ok: true; patch: ProfilePatch } | { ok: false; error: string } {
  const patch: ProfilePatch = {};

  if ("displayName" in body) {
    const name = cleanText(body.displayName, MAX_DISPLAY_NAME);
    patch.displayName = name || null;
  }
  if ("bio" in body) {
    const bio = cleanText(body.bio, MAX_BIO);
    patch.bio = bio || null;
  }
  if ("homeCity" in body) {
    const city = cleanText(body.homeCity, MAX_HOME_CITY);
    patch.homeCity = city || null;
  }
  if ("favouriteDrink" in body) {
    const drink = cleanText(body.favouriteDrink, MAX_FAVOURITE_DRINK);
    patch.favouriteDrink = drink || null;
  }
  if ("interests" in body) {
    const interests = cleanText(body.interests, MAX_INTERESTS);
    patch.interests = interests || null;
  }
  if ("workplace" in body) {
    const workplace = cleanText(body.workplace, MAX_WORKPLACE);
    patch.workplace = workplace || null;
  }
  if ("avatarUrl" in body) {
    return {
      ok: false,
      error: "Use the photo upload on your profile to change your avatar.",
    };
  }

  return { ok: true, patch };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  if (!handle) {
    return publicApiError("Missing handle.", "INVALID_REQUEST", 400);
  }

  const { profiles, follows } = stores();
  const socialEnabled = isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV]);
  const viewer = normalizeHandle(new URL(request.url).searchParams.get("viewer") ?? "");

  try {
    const [profile, counts] = await Promise.all([
      profiles.getByHandle(handle),
      socialEnabled ? follows.counts(handle) : Promise.resolve(null),
    ]);
    // Only compute follow status for a *different* viewer — a handle never
    // "follows itself", and asking short-circuits to false.
    // BOTH edges travel, because one of them cannot tell "Mates" from
    // "Follows you" (lib/followRelation.ts owns that resolution). The reverse
    // edge is already public through /following and /lot, so this adds a round
    // trip's worth of convenience, never a new disclosure.
    const [viewerFollowing, followsViewer] =
      socialEnabled && viewer && viewer !== handle
        ? await Promise.all([
            follows.isFollowing(viewer, handle),
            follows.isFollowing(handle, viewer),
          ])
        : [false, false];

    // Auth-deletion stamp only. Legacy user_id-null rows stay fully live.
    if (isProfileTombstoned(profile)) {
      return jsonNoStore(
        {
          profile: null,
          status: "gone",
          socialLinks: [],
          counts,
          viewerFollowing: false,
          followsViewer: false,
        },
        { status: 200 },
      );
    }

    // The card's backdrop is a ROTATION of up to five photos, so the public
    // read carries the ordered list beside the single back-compat cover. A list
    // that could not be read travels as absent rather than as empty, and the
    // header falls back to cover #1.
    const coverUrls = profile ? await publicCoverUrls(profile.id) : undefined;
    return jsonNoStore(
      {
        profile: publicProfileFromRecord(profile, coverUrls ? { coverUrls } : {}),
        socialLinks: socialEnabled ? await publicLinksFor(profile) : [],
        counts,
        viewerFollowing,
        followsViewer,
      },
      { status: 200 },
    );
  } catch {
    // A backend hiccup degrades to the synthesized-profile path on the client —
    // return an empty-but-valid shape rather than an error the page must handle.
    return jsonNoStore(
      {
        profile: null,
        socialLinks: [],
        counts: null,
        viewerFollowing: false,
        followsViewer: false,
      },
      { status: 200 },
    );
  }
}

// Update the editable fields of a profile ("claim your handle" / edit-profile).
//
// OWNERSHIP (user story 31), enforced HERE at the API seam because writes route
// through the service-role admin client (which bypasses RLS — so RLS alone can't
// gate the app's own writes; see lib/profileOwnership.ts + migration 0009):
//   • We resolve the caller's VERIFIED auth uid from their bearer token
//     (callerUserId → Supabase auth.getUser). No token / invalid token → null
//     (anonymous), never a trusted uid.
//   • An unlinked legacy handle keeps anonymous demo edits, but an authenticated
//     write cannot turn it into account ownership. A genuinely new handle can
//     be created and linked. A LINKED handle is editable only by its owner, so a
//     non-owner (anonymous OR a different account) gets 403. This is the security
//     win: once claimed, a handle can't be hijacked.
//
// Regardless of auth we still apply the full server-side trust boundary below
// (strip HTML/control chars, cap lengths, validate the avatar URL) and
// rate-limit, so any caller can neither inject markup nor flood the write path.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  if (!handle) {
    return publicApiError("Missing handle.", "INVALID_REQUEST", 400);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  if (!body || typeof body !== "object") {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // Rate-limit per handle + hashed IP so a profile can't be edit-spammed.
  const key = `profile-edit:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(handle, key)) {
    return publicApiError("Too many edits, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const built = buildPatch(body);
  if (!built.ok) {
    return publicApiError(built.error, "INVALID_REQUEST", 400);
  }

  // In production we require the durable store — silently editing an in-memory
  // row that vanishes on the next cold start would be a lie about persistence.
  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Profile storage is not configured.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }

  // OWNERSHIP GATE: linked handle → JWT owner only; unlinked → demo path.
  const gate = await gateHandleAction(request, handle);
  if (!gate.allowed) {
    return publicApiErrorFromStatus(gate.error, gate.status);
  }

  try {
    const store = profileStore();
    // Ensure a lightweight anonymous row exists before an anonymous demo edit.
    // An authenticated new-handle write was already created by the gate.
    await store.ensure(handle);
    const profile = await store.update(handle, built.patch);
    return jsonNoStore({ profile: publicProfileFromRecord(profile) }, { status: 200 });
  } catch {
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}

// Soft-delete a profile (clear editable fields). Same ownership gate as PATCH:
// unlinked handles stay deletable by anyone (demo); linked handles require the
// matching authenticated owner. We deliberately do NOT hard-delete the row —
// follows and handle-keyed activity would cascade — see
// ProfileStore.softDeleteForCaller.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  if (!handle) {
    return publicApiError("Missing handle.", "INVALID_REQUEST", 400);
  }

  const key = `profile-delete:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(handle, key)) {
    return publicApiError("Too many edits, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Profile storage is not configured.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }

  const gate = await gateHandleAction(request, handle);
  if (!gate.allowed) {
    return publicApiErrorFromStatus(gate.error, gate.status);
  }

  try {
    const store = profileStore();
    // Capture owned-avatar keys before soft-delete nulls them so Storage cleanup
    // can still find the face bytes.
    const prior = await store.getByHandle(handle);
    const deletion = await store.softDeleteForCaller(handle, gate.callerUserId);
    if (deletion.status === "not-found") {
      return publicApiError("Profile not found.", "NOT_FOUND", 404);
    }
    if (deletion.status === "forbidden") {
      return publicApiError("This handle belongs to a signed-in account. Sign in as its owner to continue.", "FORBIDDEN", 403);
    }

    const { ownerUserId, profile } = deletion;

    if (prior?.id) {
      for (const slot of PROFILE_IMAGE_SLOTS) {
        const state = profileImageState(prior, slot);
        if (!state.objectKey && !state.generation) continue;
        try {
          const { purgeProfileImageObjects, supabaseProfileImageStorage } = await import(
            "@/lib/profileImageMedia.server"
          );
          const known = [
            state.objectKey,
            state.generation
              ? profileImageStagingKey(slot, prior.id, state.generation)
              : null,
          ].filter((key): key is string => typeof key === "string" && key.length > 0);
          await purgeProfileImageObjects(slot, prior.id, supabaseProfileImageStorage, known);
        } catch (err) {
          console.error(
            `[${slot}] profile soft-delete for @${handle}: FAILED to purge ${slot} objects`,
            err,
          );
        }
      }
    }

    if (ownerUserId) {
      await privateIdentityStore().erase(ownerUserId);
      await referralStore().eraseAccount(ownerUserId);
    }

    // Redaction on account deletion (Wayfinder 5.5): mark this account's Story
    // contributions "withdrawn" so the publish gate erases their content +
    // identity from every published Story on the next public read — without
    // destroying the rest of anyone's Story. Additive, and fail-soft: a marking
    // hiccup must not fail the delete the caller already succeeded at, but it is
    // logged loudly so the owner can reconcile.
    if (ownerUserId) {
      try {
        const marked = await markContributorsDepartedByProfileId(ownerUserId);
        if (marked > 0) {
          console.info(
            `[redaction] account deletion for @${handle}: marked ${marked} Story contribution(s) departed`,
          );
        }
      } catch (err) {
        console.error(
          `[redaction] account deletion for @${handle}: FAILED to mark Story contributions departed: reconcile manually`,
          err,
        );
      }
    }

    return jsonNoStore({ profile: publicProfileFromRecord(profile) }, { status: 200 });
  } catch {
    return publicApiError("Profile storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}

// Some clients (and form libraries) prefer PUT for a full-resource update. The
// semantics here are identical — a validated, rate-limited field patch — so PUT
// is an alias for PATCH.
export const PUT = PATCH;
