// What one account is to another, in one closed word.
//
// The follow graph has two independent edges and a reader needs BOTH to know
// where a friendship stands. `viewerFollowing` (I follow them) has always been
// on the public profile read; `followsViewer` (they follow me) is its mirror.
// One edge alone cannot tell "Mates" from "Follows you", and a surface that
// prints only "Following" hides the single fact that decides whether the two
// of you share a lot.
//
// A lot is MUTUAL (lib/followStore listMutuals), so `mates` is the only state
// that means friendship formed. Keep this module presentation-free: the labels
// are copy, the relation is the fact.

export const FOLLOW_RELATIONS = [
  "none",
  "following",
  "follows_you",
  "mates",
] as const;

export type FollowRelation = (typeof FOLLOW_RELATIONS)[number];

export type FollowEdges = {
  /** The viewer follows this profile. */
  viewerFollowing: boolean;
  /** This profile follows the viewer back. */
  followsViewer: boolean;
};

export function isFollowRelation(value: unknown): value is FollowRelation {
  return FOLLOW_RELATIONS.includes(value as FollowRelation);
}

export function resolveFollowRelation(edges: FollowEdges): FollowRelation {
  if (edges.viewerFollowing && edges.followsViewer) return "mates";
  if (edges.viewerFollowing) return "following";
  if (edges.followsViewer) return "follows_you";
  return "none";
}

/** True only when both sides follow: the definition a lot is built from. */
export function isMutual(relation: FollowRelation): boolean {
  return relation === "mates";
}

/**
 * The word on the follow control. "Follow back" is deliberate: when they
 * already follow you, one tap makes you mates, and the button should say so.
 */
export function followActionLabel(relation: FollowRelation): string {
  switch (relation) {
    case "mates":
      return "Mates";
    case "following":
      return "Following";
    case "follows_you":
      return "Follow back";
    case "none":
      return "Follow";
  }
}

/**
 * The quiet line beside the control. It states the edge the button cannot,
 * and stays silent when the button already says everything.
 */
export function followRelationHint(relation: FollowRelation): string | null {
  switch (relation) {
    case "mates":
      return "You follow each other";
    case "following":
      return "They have not followed back yet";
    case "follows_you":
      return "Follows you";
    case "none":
      return null;
  }
}

/** The pending beat between a tap and the server's answer. */
export function followPendingLabel(relation: FollowRelation): string {
  return relation === "following" || relation === "mates"
    ? "Removing…"
    : "Adding…";
}

/**
 * What a tap does next. A mate tap UNFOLLOWS, which breaks the lot, so the
 * accessible name has to say that rather than repeating the state word.
 */
export function followActionDescription(
  relation: FollowRelation,
  handle: string,
): string {
  switch (relation) {
    case "mates":
      return `Stop following @${handle}. You would no longer be mates.`;
    case "following":
      return `Stop following @${handle}.`;
    case "follows_you":
      return `Follow @${handle} back to become mates.`;
    case "none":
      return `Follow @${handle}.`;
  }
}
