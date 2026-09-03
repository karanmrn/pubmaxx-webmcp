// Follow / unfollow another handle's named saved-pub list. Identity is still the
// self-asserted handle used by saved pubs, crawl authorship, and profile follows;
// this route does not pretend auth-backed ownership exists yet.

import { isLimited } from "@/lib/pintDrops";
import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  cleanListType,
  savedListFollowsStore,
  type SavedListFollowsStore,
} from "@/lib/savedPubsStore";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";

assertServerEnv();

function store(): SavedListFollowsStore {
  return savedListFollowsStore();
}

function isSelfListFollow(followerHandle: string, ownerHandle: string): boolean {
  const follower = normalizeHandle(followerHandle);
  const owner = normalizeHandle(ownerHandle);
  return follower !== "" && follower === owner;
}

export async function GET(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const params = new URL(request.url).searchParams;
  const follower = normalizeHandle(params.get("follower") ?? "");
  const owner = normalizeHandle(params.get("owner") ?? "");
  const listType = cleanListType(params.get("listType"));

  try {
    if (owner && listType) {
      const [following, counts] = await Promise.all([
        follower ? store().isFollowingList(follower, owner, listType) : Promise.resolve(false),
        store().counts(owner, listType),
      ]);
      return jsonNoStore({ following, counts }, { status: 200 });
    }

    if (!follower) return jsonNoStore({ followedLists: [] }, { status: 200 });
    const followedLists = await store().listFollowedBy(follower);
    return jsonNoStore({ followedLists }, { status: 200 });
  } catch {
    // Fail-soft read: followed lists are additive social context, not a reason to
    // break the saved view/profile.
    return owner && listType
      ? jsonNoStore(
          { status: "unavailable", following: null, counts: { followers: null, savedPubs: null } },
          { status: 200 },
        )
      : jsonNoStore({ status: "unavailable", followedLists: null }, { status: 200 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // JWT-linked handle wins over a self-asserted body.follower when signed in.
  const follower = await resolveMessageHandle(request, readString(body.follower));
  if (!follower) {
    return publicApiError("Choose a handle in your account first.", "INVALID_REQUEST", 400);
  }

  const owner = normalizeHandle(readString(body.owner) ?? "");
  if (!owner) return publicApiError("Missing list author.", "INVALID_REQUEST", 400);

  const listType = cleanListType(body.listType);
  if (!listType) return publicApiError("Add a list name.", "INVALID_REQUEST", 400);

  if (isSelfListFollow(follower, owner)) {
    return publicApiError("You can't follow your own list.", "INVALID_REQUEST", 400);
  }

  const ownership = await gateHandleAction(request, follower);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  const actorHash = hashIp(clientIp(request));
  if (await isLimited(`list-follow:${follower}`, `list-follow:${follower}:${actorHash}`)) {
    return publicApiError("Too many list follows, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("List follow storage is not configured.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }

  const unfollow = readString(body.action) === "unfollow";
  try {
    const s = store();
    const following = unfollow
      ? !(await s.unfollowList(ownership.handle, owner, listType))
      : await s.followList(ownership.handle, owner, listType);
    const counts = await s.counts(owner, listType);
    return jsonNoStore({ following, counts }, { status: 200 });
  } catch {
    return publicApiError("List follow storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}
