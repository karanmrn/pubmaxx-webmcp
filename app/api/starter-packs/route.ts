// A signed-in drinker may follow these starter packs in one tap. A stranger
// may read the public pack list without an account.
//
// The pack list is the same closed row set the people directory reads, so this
// discloses nothing the directory would not: handle, optional display name,
// optional approved avatar, optional founding number. Email, date of birth,
// gender, full name, user id and every ownership or tombstone internal stay
// behind the owner-authenticated reads.
//
// The pack list is public and the optional viewer makes the response
// personalised and `no-store`. The gate ("offer packs to somebody following
// fewer than three accounts") has to be answered by the read that lists the
// packs, because the fail-soft `/api/profiles/[handle]/following` returns an
// empty list for BOTH "follows nobody" and "could not check", and a surface
// that read the second as the first would push starter packs at a drinker with
// a full lot. So `viewerFollowing` is TRI-STATE here: a number, or null meaning
// nobody asked or the read could not answer. A stranger gets null and uses only
// the public pack list; `viewerNeedsStarterPacks` renders nothing for null.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { followStore } from "@/lib/followStore";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";
import { loadStarterPacks } from "@/lib/starterPacks.server";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";

assertServerEnv();

/** The viewer's follow count, or null when there is no viewer or no answer. */
async function viewerFollowingCount(handle: string): Promise<number | null> {
  if (!handle) return null;
  try {
    const counts = await followStore().counts(handle);
    return counts.following;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const limiterKey = `starter-packs:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError(
      "Starter packs are unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  // Same actor seam as the follow route: a JWT-linked handle wins, and the
  // query handle serves only the unlinked demo identity, which can already read
  // its own follow list from `/api/profiles/[handle]/following` unauthenticated.
  const params = new URL(request.url).searchParams;
  const viewer = await resolveMessageHandle(request, params.get("viewer"));

  try {
    const [scan, viewerFollowing] = await Promise.all([
      loadStarterPacks(),
      viewerFollowingCount(viewer),
    ]);
    return jsonNoStore(
      {
        packs: scan.packs,
        viewerFollowing,
        // The account scan is bounded. `partial` says a pack may hold people
        // this read did not reach; it never means a listed member is not real.
        coverage: scan.truncated ? "partial" : "complete",
      },
      { status: 200 },
    );
  } catch {
    return publicApiError(
      "Starter packs are unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
