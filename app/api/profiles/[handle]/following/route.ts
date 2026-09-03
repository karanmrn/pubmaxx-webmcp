// The people this profile follows (its followees). Every row is one
// `FollowListEntry` (lib/followList.ts): a handle, plus a display name and an
// approved owned avatar when the profile read offers them. Powers the Friends
// feed lane (lib/feed.ts): the /feed page fetches this once for the viewer's own
// handle, then keeps only drops authored by a handle in the returned set, which
// it reads through `followListHandleSet` rather than trusting the row to be a
// bare string.
//
// Store choice is the same seam as the sibling routes: Supabase when configured,
// process-memory otherwise. This is a pure read and MUST never 500 — a bad
// handle or a backend hiccup degrades to an empty list so the feed still renders
// (the Friends lane just falls through to its "follow people" empty state).

import { jsonNoStore } from "@/lib/apiResponses";
import { followListEntries } from "@/lib/followListProjection.server";
import { normalizeHandle } from "@/lib/profiles";
import { followStore } from "@/lib/followStore";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";
import { publicApiError } from "@/lib/apiError";

assertServerEnv();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const handle = normalizeHandle((await params).handle);
  // An empty handle has no follow graph — return the empty list, not a 400, so
  // the feed's fetch has one uniform shape to read.
  if (!handle) return jsonNoStore({ following: [] }, { status: 200 });

  try {
    const handles = await followStore().listFollowing(handle);
    const following = await followListEntries(handles);
    return jsonNoStore({ following }, { status: 200 });
  } catch {
    // Fail-soft: a backend error must not break the feed. The Friends lane will
    // simply show its "follow people" empty state.
    return jsonNoStore({ following: [] }, { status: 200 });
  }
}
