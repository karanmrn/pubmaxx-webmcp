// A pub's photo wall: what a drinker may put on it, and what the wall may say.
//
// PURE and browser-safe on purpose (no sharp, no storage client, no node
// builtins), so the composer, the wall and the migration all read one copy of
// the rules rather than three.
//
// THE THREE RULES THIS FILE OWNS
//
// 1. A wall is the PUB's, and a slot on it belongs to ONE account. The cap is
//    per account per venue (`VENUE_PHOTO_CAP_PER_ACCOUNT`), never per venue:
//    a wall that filled up because one drinker posted a hundred pints would be
//    a wall the hundred-and-first person could not join. The count is what the
//    account currently HAS on the wall, so a moderator hide gives the slot back
//    - a removal is not a spent slot, and counting it would turn one moderation
//    decision into a permanent penalty nobody explained.
//
// 2. A photo carries a TAG and a CAPTION, and both are optional. The tag is a
//    drink category from the one closed taxonomy (`lib/drinks.ts`), so a wall
//    can be read by drink without inventing a second vocabulary; a caption is
//    140 characters, the same short account a Visit Report gets. Neither is a
//    price: nothing here reaches the community-price store, the pins, the
//    cheapest buckets or the Pint Index. A photo is a photo.
//
// 3. A crosspost is a PROMISE, so its answer is three-state
//    (`VenuePhotoCrosspostState`), never a boolean. "We shared it" when the
//    author's Social access was not verified would be a lie the author only
//    discovers by opening a feed that has nothing in it, so an unverified
//    author is told the wall took the photo and the feed did not.

import { categoryLabel, DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";
import type { CropTarget } from "@/lib/profileImagePicker";

/**
 * The captain's number: 100 photos per pub per account. Enforced on the write
 * path against the account's own live rows for that venue, and mirrored by no
 * client - a composer that hides the button is a courtesy, never the fence.
 */
export const VENUE_PHOTO_CAP_PER_ACCOUNT = 100;

/** One short account of the photo, the same length a Visit Report note gets. */
export const VENUE_PHOTO_CAPTION_MAX = 140;

/** Venue ids are the slim-index / uk_base stable ids; cap them like every writer. */
export const VENUE_PHOTO_VENUE_ID_MAX = 64;

/** One page of a wall. A wall is browsed, so it pages rather than truncating. */
export const VENUE_PHOTO_PAGE_SIZE = 24;
export const VENUE_PHOTO_PAGE_SIZE_MAX = 48;

/** The rendered shape of a wall tile and of the crop that fills it. */
export const VENUE_PHOTO_ASPECT_RATIO = 4 / 5;
export const VENUE_PHOTO_OUTPUT_WIDTH = 1_080;
export const VENUE_PHOTO_OUTPUT_HEIGHT = Math.round(
  VENUE_PHOTO_OUTPUT_WIDTH / VENUE_PHOTO_ASPECT_RATIO,
);

/** Sentence noun for reader-facing copy, so one wording serves every message. */
export const VENUE_PHOTO_NOUN = "Photo";
export const VENUE_PHOTO_NOUN_LOWER = "photo";

/**
 * The crop step's target. A drink photo is portrait because a pint is: a
 * landscape frame of a glass is mostly table. Shared with the profile slots
 * through one cropper, so this is a row in the same table rather than a second
 * crop implementation.
 */
export const VENUE_PHOTO_CROP_TARGET: CropTarget = {
  id: "venue-photo",
  aspectRatio: VENUE_PHOTO_ASPECT_RATIO,
  outputBox: { width: VENUE_PHOTO_OUTPUT_WIDTH, height: VENUE_PHOTO_OUTPUT_HEIGHT },
  nounLower: VENUE_PHOTO_NOUN_LOWER,
  fileName: "venue-photo.jpg",
};

/**
 * Moderation states, the same closed set the owned-profile images carry. A row
 * only ever reaches storage as `approved` (a scan that REFUSED promotes
 * nothing); `hidden` is a moderator decision and is reversible, because hiding
 * never deletes the row or its provenance.
 */
export const VENUE_PHOTO_MODERATION_STATES = [
  "approved",
  "needs_review",
  "hidden",
] as const;

export type VenuePhotoModerationState = (typeof VENUE_PHOTO_MODERATION_STATES)[number];

/**
 * A read either answered or it did not. Same three-way honesty every other read
 * in this tree carries: an empty wall under a FAILED read may never be worded
 * as a pub nobody has photographed.
 */
export type VenuePhotoReadStatus = "ready" | "degraded";

/** The author, projected for a public wall. */
export type VenuePhotoAuthor = {
  handle: string;
  /** Approved avatar serve path only, never a hotlinked remote URL. */
  avatarUrl?: string;
  /** Public by design, exactly as on the profile card and the founders wall. */
  foundingMemberNumber?: number;
};

/** The stored row. Never crosses the wire - `VenuePhotoDTO` does. */
export type VenuePhoto = {
  id: string;
  venueId: string;
  /** Stable profile actor, `profile:{uuid}`. Survives a handle rename. */
  authorActor: string;
  authorProfileId: string;
  objectKey: string;
  drinkCategory: DrinkCategory | null;
  caption: string;
  width: number;
  height: number;
  moderationState: VenuePhotoModerationState;
  createdAt: string;
  reportCount?: number;
  reportActors?: string[];
  reportedAt?: string;
  reportReason?: string;
  moderatedAt?: string;
  moderatorNote?: string;
};

/** What a public wall read returns for one photo. */
export type VenuePhotoDTO = {
  id: string;
  venueId: string;
  url: string;
  drinkCategory: DrinkCategory | null;
  caption: string;
  width: number;
  height: number;
  createdAt: string;
  author: VenuePhotoAuthor;
  /** True only for the signed-in account that posted it. */
  ownedByViewer: boolean;
};

export type VenuePhotoFields = {
  /**
   * The photo's own id, minted by the writer BEFORE the bytes are staged,
   * because the storage key is built from it. Passing it explicitly is what
   * keeps the row and its object in agreement: deriving one from the other
   * would let a memory-store write drift into a row whose serve route 404s.
   */
  id: string;
  venueId: string;
  authorActor: string;
  authorProfileId: string;
  objectKey: string;
  drinkCategory: DrinkCategory | null;
  caption: string;
  width: number;
  height: number;
};

/** The wall's own page. `nextCursor` is null when the wall has been read out. */
export type VenuePhotoPage = {
  status: VenuePhotoReadStatus;
  photos: VenuePhotoDTO[];
  nextCursor: string | null;
};

// ── Storage keys ─────────────────────────────────────────────────────────────
// Both keys are pure strings so the CHECK constraint in the migration, the
// serve route and the upload path agree without any of them restating a path.
// Serving and staging are SIBLINGS rather than nested, so a listing of the
// venue prefix never confuses one generation's folder for a file.

export const VENUE_PHOTO_STORAGE_PREFIX = "venue-photos";

export function venuePhotoServingKey(venueId: string, photoId: string): string {
  return `${VENUE_PHOTO_STORAGE_PREFIX}/${venueId}/${photoId}.jpg`;
}

export function venuePhotoStagingKey(venueId: string, photoId: string): string {
  return `${VENUE_PHOTO_STORAGE_PREFIX}/${venueId}/${photoId}.staging.jpg`;
}

export function isVenuePhotoServingKey(
  venueId: string,
  photoId: string,
  objectKey: string,
): boolean {
  return objectKey === venuePhotoServingKey(venueId, photoId);
}

/** Public serve path for an approved wall photo. */
export function venuePhotoServePath(venueId: string, photoId: string): string {
  return `/api/venue-photo/${encodeURIComponent(venueId)}/${encodeURIComponent(photoId)}`;
}

// ── Validation ───────────────────────────────────────────────────────────────

const VENUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const CATEGORY_SET = new Set<string>(DRINK_CATEGORIES);

/**
 * Venue ids reach the storage key and the CHECK constraint, so the shape is
 * narrow on purpose: no slashes, no dots that could walk a path, nothing that
 * needs escaping to be a key segment.
 */
export function isVenuePhotoVenueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= VENUE_PHOTO_VENUE_ID_MAX &&
    VENUE_ID.test(value) &&
    !value.includes("..")
  );
}

export function cleanVenuePhotoCaption(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VENUE_PHOTO_CAPTION_MAX);
}

/**
 * The tag is a category from the ONE taxonomy or nothing. An unknown value is
 * refused rather than quietly dropped: a drinker who tagged a stout and got an
 * untagged photo back would have no way to tell it did not take.
 */
export function parseVenuePhotoDrinkCategory(
  value: unknown,
): DrinkCategory | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  return CATEGORY_SET.has(value) ? (value as DrinkCategory) : undefined;
}

export type VenuePhotoSubmission = {
  venueId: string;
  drinkCategory: DrinkCategory | null;
  caption: string;
  /** The author asked for it; whether it happens is a separate question. */
  shareToFeed: boolean;
};

export type VenuePhotoValidation =
  | { ok: true; value: VenuePhotoSubmission }
  | { ok: false; error: string };

export function validateVenuePhotoSubmission(input: unknown): VenuePhotoValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Photo details are not valid." };
  }
  const raw = input as Record<string, unknown>;
  if (!isVenuePhotoVenueId(raw.venueId)) {
    return { ok: false, error: "Choose a pub." };
  }
  const drinkCategory = parseVenuePhotoDrinkCategory(raw.drinkCategory);
  if (drinkCategory === undefined) {
    return { ok: false, error: "Choose a listed drink." };
  }
  return {
    ok: true,
    value: {
      venueId: raw.venueId,
      drinkCategory,
      caption: cleanVenuePhotoCaption(raw.caption),
      shareToFeed: raw.shareToFeed === true,
    },
  };
}

// ── Ordering ─────────────────────────────────────────────────────────────────

/**
 * Newest first, with the id as a deterministic tie-break so a page boundary
 * never repeats or skips a photo two accounts posted in the same millisecond.
 */
export function byNewestVenuePhoto(a: VenuePhoto, b: VenuePhoto): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

export function venuePhotoCursor(photo: Pick<VenuePhoto, "createdAt" | "id">): string {
  return `${photo.createdAt}|${photo.id}`;
}

export function parseVenuePhotoCursor(
  value: string | null | undefined,
): { createdAt: string; id: string } | null {
  if (typeof value !== "string" || !value.includes("|")) return null;
  const at = value.indexOf("|");
  const createdAt = value.slice(0, at);
  const id = value.slice(at + 1);
  if (!createdAt || !id || !Number.isFinite(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

/** Rows strictly older than the cursor, in the wall's own order. */
export function isBeforeVenuePhotoCursor(
  photo: Pick<VenuePhoto, "createdAt" | "id">,
  cursor: { createdAt: string; id: string },
): boolean {
  const byDate = photo.createdAt.localeCompare(cursor.createdAt);
  if (byDate !== 0) return byDate < 0;
  return photo.id.localeCompare(cursor.id) < 0;
}

// ── Crosspost ────────────────────────────────────────────────────────────────

/**
 * What actually happened to the "Also share to your feed" box. Three states
 * because the honest answers are three: the author did not ask, the author
 * asked and it went, the author asked and Social could not take it. A boolean
 * would have to pick one lie for the third case.
 */
export type VenuePhotoCrosspostState = "off" | "posted" | "unavailable";

export type VenuePhotoCrosspost = {
  state: VenuePhotoCrosspostState;
  /** The Social post id, present only when one really exists. */
  postId?: string;
};

/** The checkbox label. It says where the photo goes, not how good that is. */
export const VENUE_PHOTO_CROSSPOST_LABEL = "Also share to your feed";

/**
 * One sentence per outcome, said after the wall already took the photo. The
 * unavailable line names the wall's success first, because that is the part the
 * drinker cares about, and then says plainly what did not happen.
 */
export function venuePhotoCrosspostNote(state: VenuePhotoCrosspostState): string | null {
  if (state === "posted") return "Shared to your feed.";
  if (state === "unavailable") {
    return "On the wall. Your feed did not take it, so nothing was shared.";
  }
  return null;
}

// ── Copy ─────────────────────────────────────────────────────────────────────
// Empty, denied and refused states say what happened and hand the reader the
// next move. None of them leaks plumbing, and none of them slams the door.

export function venuePhotoWallEmptyLine(status: VenuePhotoReadStatus): string {
  return status === "degraded"
    ? "We could not read this wall just now. Try again in a moment."
    : "No photos on this wall yet. Yours would be the first.";
}

export const VENUE_PHOTO_SIGN_IN_LINE =
  "Sign in and pick a handle to add a photo to this wall.";

/**
 * An empty wall that NAMES an action has to OFFER it. The sentence above was
 * the whole of the signed-out state and nothing on it was pressable, so the
 * surface said what to do and gave the reader nowhere to do it.
 *
 * The door carries the way back, because the wall is read from three places
 * (the map's venue sheet, a bar tab and a ledger) and a person sent to sign in
 * and then dropped on the map has lost the pub they were looking at. `from`
 * takes a path on this site or nothing; `arrivalDestination` refuses an
 * off-site one on the other side regardless.
 */
export function venuePhotoSignInHref(from?: string | null): string {
  const back = from && from.startsWith("/") ? from : "/map";
  return `/login?from=${encodeURIComponent(back)}`;
}

export const VENUE_PHOTO_REFUSED_LINE =
  "That photo did not pass our checks. Choose another.";

/**
 * What a drinker at the cap is told. It says the limit and stops: the wall
 * offers its author no delete, so "remove one to add another" would be an
 * instruction to use a control that is not there. Naming the pub is optional
 * because the write path knows the venue id and not its name.
 */
export function venuePhotoCapLine(venueName?: string): string {
  const where = venueName ? `on ${venueName}` : "on this pub's wall";
  return `You have all ${VENUE_PHOTO_CAP_PER_ACCOUNT} of your photos ${where}. That is one account's limit for one pub.`;
}

/**
 * The accessible name of one wall tile. It names the author and the drink when
 * there is one, because a wall read by a screen reader is a list of who was
 * there with what - not a list of "Photo, photo, photo".
 */
export function venuePhotoAltText(photo: {
  author: { handle: string };
  drinkCategory: DrinkCategory | null;
  caption: string;
}): string {
  if (photo.caption) return `@${photo.author.handle}: ${photo.caption}`;
  // The label, not the slug, and in a clause of its own: the taxonomy's names
  // are Title Case and some are plural ("Cocktails", "Soft drinks"), so
  // "A Cocktails photo" is what naming the drink mid-sentence would produce.
  if (photo.drinkCategory) {
    return `${categoryLabel(photo.drinkCategory)}, photographed by @${photo.author.handle}`;
  }
  return `A photo by @${photo.author.handle}`;
}
