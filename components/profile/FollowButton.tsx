"use client";

import { useState } from "react";

import {
  followActionDescription,
  followActionLabel,
  followPendingLabel,
  followRelationHint,
  resolveFollowRelation,
} from "@/lib/followRelation";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import type { FollowCounts } from "@/lib/followStore";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

// Follow / unfollow control for a public profile. The follower handle is passed
// in by the page so this button stays dumb about where identity comes from, and
// the request carries the signed-in account's bearer token so the SERVER, not
// the body, decides who is acting. Without it a signed-in drinker's follow
// arrived anonymous, so their own linked handle read as a hijack attempt and
// the route answered "This handle belongs to a signed-in account." Optimistic:
// it flips state immediately, POSTs, and reconciles from the server's
// authoritative counts (or rolls back on failure). Rendered only when there IS
// a viewer handle and it differs from the profile owner — the page owns that
// gate.
//
// It carries BOTH follow edges because one of them cannot say where a
// friendship stands: "Following" and "Mates" look identical to a reader who
// only knows their own edge, and "Follows you" is invisible entirely. The
// resolution lives in lib/followRelation.ts, so the button holds state, never
// policy. Only the viewer's own edge is optimistic - a tap cannot make somebody
// else follow back, so `followsViewer` is never guessed.
type FollowButtonProps = {
  targetHandle: string;
  followerHandle: string;
  initialFollowing: boolean;
  /** Does the profile follow the viewer back? Drives "Mates" and "Follow back". */
  followsViewer?: boolean;
  onCountsChange?: (counts: FollowCounts) => void;
};

export default function FollowButton({
  targetHandle,
  followerHandle,
  initialFollowing,
  followsViewer = false,
  onCountsChange,
}: FollowButtonProps) {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relation = resolveFollowRelation({
    viewerFollowing: following,
    followsViewer,
  });
  const hint = followRelationHint(relation);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const next = !following;
    setFollowing(next); // optimistic

    try {
      const res = await authedActionFetch(`/api/profiles/${encodeURIComponent(targetHandle)}/follow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          follower: followerHandle,
          action: next ? "follow" : "unfollow",
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setFollowing(!next); // roll back
        setError(
          offlineOrMessage(errorMessageFrom(body, "Could not update. Try again."))
        );
        return;
      }
      // Reconcile with the server's truth (handles already-following, races).
      if (body && typeof body === "object") {
        const b = body as { following?: boolean; counts?: FollowCounts };
        if (typeof b.following === "boolean") setFollowing(b.following);
        if (b.counts && onCountsChange) onCountsChange(b.counts);
      }
    } catch {
      setFollowing(!next); // roll back on network error
      setError(
        offlineOrMessage("Could not update. Try again.")
      );
    } finally {
      setBusy(false);
    }
  }

  if (!socialFriendsLaunchEnabled) return null;

  return (
    <div className="profileFollow">
      <button
        type="button"
        className={`followBtn${following ? " isFollowing" : ""}${relation === "mates" ? " isMates" : ""}`}
        aria-pressed={following}
        aria-label={followActionDescription(relation, targetHandle)}
        disabled={busy}
        onClick={toggle}
      >
        {busy ? followPendingLabel(relation) : followActionLabel(relation)}
      </button>
      {hint ? <span className="followHint">{hint}</span> : null}
      {error ? (
        <span className="followError" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
