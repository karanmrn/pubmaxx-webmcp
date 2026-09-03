// WP7 find-your-lot: prefix search over claimed, non-tombstoned public handles.
// Returns ONLY the public projection fields - never email, DOB, userId, or
// tombstone/ownership internals. Rate-limited; errors via publicApiError.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
  type ProfileRecord,
} from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

assertServerEnv();

const SEARCH_LIMIT = 8;
const MIN_PREFIX = 2;

function toPublicMatch(profile: ProfileRecord): {
  id: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
} {
  const avatarUrl = publicOwnedImageUrl(profile, "avatar");
  return {
    id: profile.id,
    handle: profile.handle,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export async function GET(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const limiterKey = `profile-search:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many searches, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError(
      "Profile search is unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  const url = new URL(request.url);
  const q = normalizeHandle(url.searchParams.get("q") ?? "");
  if (!q || q.length < MIN_PREFIX) {
    return publicApiError(
      "Type at least two characters of a handle.",
      "INVALID_REQUEST",
      400,
    );
  }

  try {
    const rows = await profileStore().searchClaimedByHandlePrefix(q, SEARCH_LIMIT);
    const matches = rows
      .filter((row) => Boolean(row.userId) && !isProfileTombstoned(row))
      .map(toPublicMatch);
    return jsonNoStore({ matches }, { status: 200 });
  } catch {
    return publicApiError(
      "Profile search is unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
