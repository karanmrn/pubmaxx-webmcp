// The handles in a MUTUAL follow with this profile — its "lot" (the Social Loop
// definition of a friend: each side follows the other). Powers the "Your lot"
// feed tab (app/feed): the /feed page fetches this for the viewer's own handle,
// then keeps only drops + check-ins authored by a handle in the returned set.
//
// A one-way follow is NOT a friend here, which is why this is distinct from
// /following. Same seam as the sibling routes (Supabase when configured, memory
// otherwise) and the same fail-soft posture: a pure read that MUST never 500.

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { followStore } from "@/lib/followStore";
import { normalizeHandle } from "@/lib/profiles";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";

assertServerEnv();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const handle = normalizeHandle((await params).handle);
  if (!handle) return jsonNoStore({ lot: [] }, { status: 200 });

  try {
    const lot = await followStore().listMutuals(handle);
    return jsonNoStore({ lot }, { status: 200 });
  } catch {
    // Fail-soft: a backend error must not break the feed. The lane falls through
    // to its "your lot is quiet" empty state.
    return jsonNoStore({ lot: [] }, { status: 200 });
  }
}
