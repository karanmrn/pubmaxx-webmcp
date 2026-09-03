import "server-only";

// ONE follow write, so a second caller cannot follow somebody differently.
//
// `/api/profiles/[handle]/follow` writes one edge and a starter pack writes a
// dozen, but a follow is a follow: same store, same idempotence, same "a new
// follow tells the person it happened". A copy of this in the pack route is
// exactly how the notification, or the idempotence, would drift.
//
// It reports whether the edge was NEW, which the single-target route does not
// need but a pack does: a follow-all owes the drinker an honest per-member line
// and "already following them" is not a failure. The read before the write is a
// label, never a gate - `FollowStore.follow` is idempotent on its own, so a
// race can only mislabel a line, never double-write an edge.
//
// Authorisation is NOT here. Who may act as the follower is decided by the
// route through `resolveMessageHandle` + `gateHandleAction`, and this module is
// reached only after that answered.

import { followStore, isSelfFollow } from "@/lib/followStore";
import { emitNotification } from "@/lib/notificationsStore";
import { isProfileTombstoned, profileStore } from "@/lib/profileStore";
import { isSupabaseConfigured } from "@/lib/supabase";

export type FollowWriteResult = "followed" | "already" | "self" | "unavailable";

/**
 * Follow `target` as `follower`. Idempotent. A brand new edge notifies the
 * target, best-effort: `emitNotification` never throws and a failed
 * notification must never fail the follow.
 *
 * A REFUSAL AND AN OUTAGE ARE TWO FINDINGS. A target that is gone answers
 * `unavailable`, which the caller reports as itself; a store that could not
 * answer still throws, so it stays a retryable fault. And a read that could not
 * answer is not evidence of absence: only a DURABLE store's silence proves the
 * target does not exist, because the in-memory store a keyless build runs on
 * holds no profiles at all. A tombstone is refused whichever store said so.
 */
export async function followOnce(
  follower: string,
  target: string,
): Promise<FollowWriteResult> {
  const targetProfile = await profileStore().getByHandle(target);
  if (isProfileTombstoned(targetProfile)) return "unavailable";
  if (!targetProfile && isSupabaseConfigured()) return "unavailable";
  if (isSelfFollow(follower, target)) return "self";
  const store = followStore();
  const already = await store.isFollowing(follower, target);
  await store.follow(follower, target);
  if (already) return "already";
  void emitNotification({
    recipientHandle: target,
    actorHandle: follower,
    kind: "follow",
    subjectRef: follower,
  });
  return "followed";
}
