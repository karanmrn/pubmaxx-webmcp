// A profile's backdrop is up to FIVE photos on one rotation, and this file owns
// every rule about them.
//
// PURE and browser-safe on purpose (no sharp, no storage client, no node
// builtins), exactly like `lib/profileImageSlots.ts` beside it: the header, the
// editor, the routes and the migration all read one copy of the cap, the
// ordering and the copy rather than four.
//
// THE FOUR RULES THIS FILE OWNS
//
// 1. THE CAP is five. It is enforced on the write path against the account's
//    own LIVE rows, so a moderator hide gives the slot back - a removal is not a
//    spent slot. A composer that hides its Add button at five is a courtesy;
//    the route is the fence.
//
// 2. ORDER IS THE OWNER'S. `position` is 1-based and the list is read in
//    position order with `createdAt` then `id` as tie-breaks, so a half-applied
//    reorder still reads as one deterministic list rather than a shuffle.
//    Moving is the whole ordering vocabulary this wave has: up, down, nothing
//    else. `moveCoverPosition` is the ONE write, and it is pure.
//
// 3. COVER #1 IS THE COVER. The single `profiles.cover_*` columns stay the
//    back-compat lane, so the first photo in this list is what a surface that
//    only knows `coverUrl` still paints. `profileCoverUrls` is the ONE reader
//    that resolves the two: a list when one travelled, the single cover when it
//    did not, and an EMPTY list only when there is really no backdrop. An absent
//    list is absence, never an empty wall.
//
// 4. THE ROTATION IS A COURTESY, NOT A DEMAND. Five seconds a photo, a gentle
//    crossfade, and `prefers-reduced-motion: reduce` shows the first cover
//    static with no timer at all. `coverCarouselRotates` is the one predicate,
//    so no surface can decide that question a second way.

/** The captain's number: five covers per profile. */
export const PROFILE_COVER_PHOTO_CAP = 5;

/** How long one cover holds the header before the next takes it. */
export const PROFILE_COVER_ROTATION_MS = 5_000;

/** How long the two covers overlap while one becomes the other. */
export const PROFILE_COVER_CROSSFADE_MS = 900;

/** Positions are 1-based, so "cover #1" in the copy is `position === 1`. */
export const PROFILE_COVER_FIRST_POSITION = 1;

/**
 * Moderation states, the same closed set every owned image carries. A photo
 * only ever reaches a serving key as `approved` (a scan that REFUSED promotes
 * nothing); `hidden` is a moderator decision and stays reversible, because
 * hiding never deletes the row, its bytes or its report trail.
 */
export const PROFILE_COVER_MODERATION_STATES = [
  "approved",
  "needs_review",
  "hidden",
] as const;

export type ProfileCoverModerationState =
  (typeof PROFILE_COVER_MODERATION_STATES)[number];

export function isProfileCoverModerationState(
  value: unknown,
): value is ProfileCoverModerationState {
  return (
    typeof value === "string" &&
    (PROFILE_COVER_MODERATION_STATES as readonly string[]).includes(value)
  );
}

/**
 * A read either answered or it did not. The same three-way honesty every other
 * read in this tree carries: an empty cover list under a FAILED read may never
 * be worded as a profile that chose no backdrop.
 */
export type ProfileCoverReadStatus = "ready" | "degraded";

/** The stored row. Never crosses the wire - `ProfileCoverPhotoDTO` does. */
export type ProfileCoverPhoto = {
  id: string;
  profileId: string;
  /** 1-based rotation position. Owner-chosen; the list is read in this order. */
  position: number;
  /** Opaque generation id, and the segment of the serving key and serve path. */
  generation: string;
  objectKey: string;
  moderationState: ProfileCoverModerationState;
  createdAt: string;
  reportCount?: number;
  reportActors?: string[];
  reportedAt?: string;
  reportReason?: string;
  moderatedAt?: string;
  moderatorNote?: string;
};

/** What the owner's own editor reads for one cover. No storage key, ever. */
export type ProfileCoverPhotoDTO = {
  id: string;
  position: number;
  url: string;
};

export type ProfileCoverPhotoList = {
  status: ProfileCoverReadStatus;
  covers: ProfileCoverPhotoDTO[];
};

/** The fields a writer supplies. `position` is derived, never client-supplied. */
export type ProfileCoverPhotoFields = {
  /**
   * The row's own id, minted by the writer BEFORE anything is staged, so the
   * row and its object cannot drift apart the way a derived id would let them.
   */
  id: string;
  profileId: string;
  generation: string;
  objectKey: string;
};

// ── Ordering ────────────────────────────────────────────────────────────────

/**
 * Position first, then the day it arrived, then the id. The last two are what
 * make a half-applied reorder read as one deterministic list rather than as a
 * shuffle: two rows that momentarily share a position still sort the same way
 * for everybody.
 */
export function byCoverPosition(
  a: Pick<ProfileCoverPhoto, "position" | "createdAt" | "id">,
  b: Pick<ProfileCoverPhoto, "position" | "createdAt" | "id">,
): number {
  return (
    a.position - b.position ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

export type CoverMoveDirection = "up" | "down";

export function isCoverMoveDirection(value: unknown): value is CoverMoveDirection {
  return value === "up" || value === "down";
}

/**
 * The ONE reorder write, expressed as a pure permutation of ids in their
 * current order. "up" means one place nearer the front of the rotation.
 *
 * Moving the first cover up, or the last one down, returns the SAME order
 * rather than an error: the button is disabled at the ends, and a request that
 * arrives anyway asked for the order it already has.
 */
export function moveCoverPosition(
  orderedIds: readonly string[],
  id: string,
  direction: CoverMoveDirection,
): string[] {
  const next = [...orderedIds];
  const at = next.indexOf(id);
  if (at < 0) return next;
  const to = direction === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= next.length) return next;
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** Positions 1..n over an already-ordered list of ids. */
export function coverPositionsFor(
  orderedIds: readonly string[],
): Array<{ id: string; position: number }> {
  return orderedIds.map((id, index) => ({
    id,
    position: PROFILE_COVER_FIRST_POSITION + index,
  }));
}

/** The position a NEW cover takes: the back of the rotation. */
export function nextCoverPosition(
  existing: readonly Pick<ProfileCoverPhoto, "position">[],
): number {
  const highest = existing.reduce(
    (max, row) => (row.position > max ? row.position : max),
    PROFILE_COVER_FIRST_POSITION - 1,
  );
  return highest + 1;
}

// ── What a reading surface paints ───────────────────────────────────────────

/**
 * The ONE resolution of "what backdrops does this profile have", shared by the
 * header, the editor and every test.
 *
 * A profile that travelled its list uses the list. A profile from a surface
 * that does not carry one falls back to the single back-compat cover, because a
 * reader that asked a narrower question deserves the answer it can use rather
 * than a blank header. Absence of both is an empty list, which is the only
 * honest way to say "no backdrop".
 */
export function profileCoverUrls(profile: {
  coverUrl?: string;
  coverUrls?: readonly string[];
} | null | undefined): string[] {
  if (!profile) return [];
  const listed = (profile.coverUrls ?? []).filter(
    (url): url is string => typeof url === "string" && url.length > 0,
  );
  if (listed.length > 0) return listed;
  return profile.coverUrl ? [profile.coverUrl] : [];
}

/**
 * Whether the header may run its timer. TWO reasons it may not, and they are
 * different reasons: a single cover has nothing to rotate to, and a reader who
 * asked for less motion asked for none of this.
 */
export function coverCarouselRotates(input: {
  count: number;
  reducedMotion: boolean;
}): boolean {
  return !input.reducedMotion && input.count > 1;
}

/** The cover after this one, wrapping round. Total safety on a junk count. */
export function nextCoverIndex(current: number, count: number): number {
  if (!Number.isInteger(count) || count < 1) return 0;
  if (!Number.isInteger(current) || current < 0) return 0;
  return (current + 1) % count;
}

// ── Copy ────────────────────────────────────────────────────────────────────
// Empty, capped and refused states say what happened and hand the owner the
// next move. None of them leaks plumbing, and none of them slams the door.

export const PROFILE_COVER_SECTION_LABEL = "Cover photos";

/** Says the limit and what to do about it, because a Remove really is there. */
export function profileCoverCapLine(): string {
  return `You have all ${PROFILE_COVER_PHOTO_CAP} cover photos. Remove one to add another.`;
}

export function profileCoverEmptyLine(status: ProfileCoverReadStatus): string {
  return status === "degraded"
    ? "We could not read your cover photos just now. Try again in a moment."
    : "No cover photo yet. The first one you add sits behind your name.";
}

/**
 * What the rotation is, said once, above the list. It names the interval
 * because a person choosing five photos deserves to know how long each is up,
 * and it names the reduced-motion answer because that is the reader's own
 * setting rather than something the page decided for them.
 */
export function profileCoverRotationNote(count: number): string | null {
  if (count < 2) return null;
  const seconds = Math.round(PROFILE_COVER_ROTATION_MS / 1000);
  return `Your ${count} covers take turns behind your name, ${seconds} seconds each. A reader who asks for less motion sees the first one only.`;
}

/** The accessible name of one thumbnail in the editor's list. */
export function profileCoverThumbnailLabel(position: number): string {
  return `Cover ${position}`;
}

export const PROFILE_COVER_MOVE_UP_LABEL = "Move up";
export const PROFILE_COVER_MOVE_DOWN_LABEL = "Move down";
export const PROFILE_COVER_REMOVE_LABEL = "Remove";
/** The field-level control beside Add cover, matching the avatar's Remove photo. */
export const PROFILE_COVER_REMOVE_ALL_LABEL = "Remove cover";
export const PROFILE_COVER_ADD_LABEL = "Add cover";

/** Shown before a field-level remove clears every cover and restores the default band. */
export function profileCoverRemoveConfirmLine(): string {
  return "Remove your cover photo? Your profile will go back to the default backdrop.";
}

/**
 * The EDITOR's own view of the rotation read, which is one state wider than the
 * wire's: a route answers `ready` or `degraded`, but a surface holding neither
 * yet has not asked. "Not asked" is not "empty", and merging the two is what let
 * a remove be armed at the wrong lane while the GET was still in flight.
 */
export type ProfileCoverReadState = ProfileCoverReadStatus | "loading";

export type ProfileCoverRemoveLane = "rotation" | "mirror" | "none" | "unavailable";

/**
 * Which lane a field-level "Remove cover" belongs in, decided ONCE.
 *
 * "The rotation is empty", "we could not read the rotation" and "we have not
 * asked yet" are THREE findings. An editor that merged any of them classified an
 * owner with five rotation rows as mirror-only, sent the remove at the
 * single-cover DELETE, cleared `profiles.cover_*` alone and reported success:
 * every row survived and the backdrop kept rotating. The mirror-only CARD and
 * the remove lane read this one answer, so the thing shown and the thing done
 * cannot disagree.
 */
export function profileCoverRemoveLane(input: {
  status: ProfileCoverReadState;
  rotationCount: number;
  mirrorCount: number;
}): ProfileCoverRemoveLane {
  if (input.status !== "ready") return "unavailable";
  if (input.rotationCount > 0) return "rotation";
  if (input.mirrorCount > 0) return "mirror";
  return "none";
}

/**
 * The sentence under the field, or nothing. A read still in flight gets NO
 * sentence: "no cover photo yet" is a claim about the rotation, and the only
 * honest thing to say before it answers is nothing at all.
 */
export function profileCoverStatusLine(state: ProfileCoverReadState): string | null {
  if (state === "loading") return null;
  return profileCoverEmptyLine(state);
}

/**
 * Why a field-level remove will not run. A read that could NOT answer says so:
 * an empty rotation list from a failed read is not an empty rotation, and
 * routing the remove to the single-cover lane on that guess clears the mirror
 * while every rotation row survives, so the backdrop keeps rotating over a
 * receipt that said it was gone.
 */
export function profileCoverRemoveUnavailableLine(): string {
  return "We could not read your cover photos just now, so nothing was removed. Try again in a moment.";
}

export const PROFILE_COVER_REFUSED_LINE =
  "That cover photo did not pass our checks. Choose another.";
