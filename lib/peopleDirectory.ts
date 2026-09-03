// What the people directory is FOR, in one place.
//
// The directory is DISCOVERY: it answers "who is here that I do not know yet".
// It shipped answering "who is here", so an account you already followed, and
// even a mate who follows you back, kept sitting in a list headed "People on
// PUBMAXX" with a spent "Mates" button on it. A suggestion you have already
// acted on is not a suggestion, it is a receipt.
//
// A follow is one-sided and a lot is MUTUAL (lib/followRelation.ts), so the one
// edge that decides discovery is `viewerFollowing`: mates are a subset of the
// accounts you follow, so dropping who you follow drops your mates with them.
// The mirror edge stays: somebody who follows YOU and whom you have not
// followed back is the best suggestion on the page, and their row says "Follow
// back".
//
// The viewer's OWN row is not a suggestion either, but it is not removed here:
// the surface prints it as "You", and that treatment is deliberate. Discovery
// hides only what a tap already did.
//
// This module is pure, and it is the only place the two empty lines exist. A
// second copy is how a surface starts telling somebody with a full lot that
// nobody has claimed a handle yet.

import { normalizeHandle } from "@/lib/profiles";

/** The one field discovery reads. Rows carry more; this is all it needs. */
export type DirectoryHandleRow = { handle: string };

/** The viewer's follow set, or null when the read could not answer. */
export type ViewerFollowSet = ReadonlySet<string> | null;

/**
 * The rows a viewer has not already followed.
 *
 * `following` is TRI-STATE by way of null: a read that FAILED must not filter,
 * because an empty set from a broken read is indistinguishable from a drinker
 * who follows nobody, and acting on it would hide the whole city. Not filtering
 * costs a reader a stale row; filtering on a failed read costs them the page.
 */
export function discoverableRows<Row extends DirectoryHandleRow>(
  rows: readonly Row[],
  following: ViewerFollowSet,
): Row[] {
  if (!following || following.size === 0) return [...rows];
  return rows.filter((row) => !following.has(normalizeHandle(row.handle)));
}

/** Every handle in a follow list, normalised, ready for `discoverableRows`. */
export function followSet(handles: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const handle of handles) {
    const clean = normalizeHandle(handle);
    if (clean) set.add(clean);
  }
  return set;
}

export type DirectoryEmptyState = {
  /** How many rows discovery removed because the viewer already follows them. */
  alreadyFollowing: number;
  /** Whether the surface still has a page it has not asked for. */
  moreToLoad: boolean;
};

/**
 * The line a directory with nothing left to show prints.
 *
 * Three states, three sentences. An all-followed list may not read as an empty
 * city, and a list with another page behind it may not claim it has shown you
 * everyone, because the reader can see the button that says otherwise.
 */
export function directoryEmptyLine(state: DirectoryEmptyState): string {
  if (state.alreadyFollowing <= 0) {
    return "Nobody has claimed a handle yet. You could be first.";
  }
  return state.moreToLoad
    ? "You already follow everyone on show. Show more people to see who else has joined."
    : "You already follow everyone here. Search a handle to find somebody new.";
}
