// The people who follow this profile. The exact mirror of /following, which
// has always been here; the reverse direction had no read at all, so a
// "Followers: 14" figure on a profile could be printed and never opened.
//
// Same store seam, same projection and the same fail-soft posture as its
// sibling: every row is one `FollowListEntry` (handle, plus a display name and
// an approved owned avatar when the profile read offers them, and nothing else
// about the person), built in ONE round trip by `followListEntries`. This is a
// pure read and MUST never 500. A bad handle or a backend hiccup degrades to an
// empty list so the list surface still renders its own empty state, and a
// failed enrichment costs a name and a face rather than the list.

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
  if (!handle) return jsonNoStore({ followers: [] }, { status: 200 });

  try {
    const handles = await followStore().listFollowers(handle);
    const followers = await followListEntries(handles);
    return jsonNoStore({ followers }, { status: 200 });
  } catch {
    return jsonNoStore({ followers: [] }, { status: 200 });
  }
}
