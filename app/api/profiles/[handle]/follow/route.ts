// Follow / unfollow the profile at /u/[handle]. A follow needs a bearer whose
// account owns the follower handle. The body may name a handle, but an
// anonymous write is refused: an add link needs an ACCOUNT, and that law
// lives here as well as on the add-link surface. Writes go through the
// service role; the response echoes the new follow state and the target's
// fresh counts so the button + header update in one round trip.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { followOnce } from "@/lib/followWrite.server";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";
import { normalizeHandle } from "@/lib/profiles";
import { followStore, isSelfFollow } from "@/lib/followStore";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

assertServerEnv();

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  // Solo-operator emergency freeze (U15): changing the follow graph is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const target = normalizeHandle((await params).handle);
  if (!target) return publicApiError("Missing handle.", "INVALID_REQUEST", 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // ONE bearer verification for the whole write. `resolveMessageHandle` and
  // `gateHandleAction` each ask for the caller themselves, so resolving it here
  // and handing it down is what keeps a signed-in follow to a single round trip
  // instead of three.
  const caller = await callerUserId(request);

  // JWT-linked handle wins over a self-asserted body.follower when signed in.
  const follower = await resolveMessageHandle(request, readString(body.follower), caller);
  if (!follower) {
    return publicApiError("Choose a handle in your account first.", "INVALID_REQUEST", 400);
  }
  if (isSelfFollow(follower, target)) {
    return publicApiError("You can't follow yourself.", "INVALID_REQUEST", 400);
  }

  // An add link needs an ACCOUNT. The body may name a handle, but a write
  // without a bearer is how an unlinked handle used to follow anybody.
  if (!caller) {
    return publicApiError("Sign in to follow them.", "UNAUTHENTICATED", 401);
  }

  const ownership = await gateHandleAction(request, follower, caller);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  // Rate-limit per follower + hashed IP so the follow graph can't be spammed.
  const key = `follow:${follower}:${hashIp(clientIp(request))}`;
  if (await isLimited(follower, key)) {
    return publicApiError("Too many follow changes, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Follows storage is not configured.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }

  const unfollow = readString(body.action) === "unfollow";
  try {
    const s = followStore();
    // `followOnce` is the shared write (lib/followWrite.server.ts): a starter
    // pack follows a dozen accounts through the same call, so idempotence and
    // the new-follow notification cannot differ between one tap and twelve.
    let following: boolean;
    if (unfollow) {
      following = !(await s.unfollow(follower, target));
    } else {
      const outcome = await followOnce(follower, target);
      // A target that is gone is a REFUSAL, never the 503 below: telling
      // somebody to retry a deleted account is a door that will never open.
      if (outcome === "unavailable") {
        return publicApiError("That account isn't here any more.", "PROFILE_NOT_FOUND", 404);
      }
      following = outcome !== "self";
    }
    const counts = await s.counts(target);
    return jsonNoStore({ following, counts }, { status: 200 });
  } catch {
    return publicApiError("Follow storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}
