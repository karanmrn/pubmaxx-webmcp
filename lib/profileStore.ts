import "server-only";

// Durable profile identity. ONE interface (ProfileStore), TWO implementations —
// process-memory (dev/demo/test) and Supabase (public.profiles) — chosen at a
// single seam by the API route (isSupabaseConfigured), exactly like
// lib/pintDropsStore.ts.
//
// A profile handle becomes account-owned when `userId` is set. Every unowned
// row is frozen against later account ownership. Authenticated creation uses a
// distinct atomic operation that never exposes an unowned intermediate row.

import {
  FOUNDING_MEMBER_CAP,
  parseFoundingMemberNumber,
} from "@/lib/foundingMembers";
import { normalizeHandle, toPublicProfile, type PublicProfile } from "@/lib/profiles";
import {
  PROFILE_IMAGE_SLOTS,
  profileImageServePath,
  type ProfileImageSlot,
} from "@/lib/profileImageSlots";
import { isReservedContributorHandle } from "@/lib/pubmaxxIdentity";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";
import { cleanText, isHttpUrl } from "@/lib/textClean";

/** Owned-image moderation states persisted on profiles (migrations 0089/0096). */
export type ProfileAvatarModerationState =
  | "pending"
  | "approved"
  | "needs_review"
  | "hidden";

export type ProfileOwnedImage = {
  objectKey: string;
  generation: string;
  moderationState: ProfileAvatarModerationState;
};

/**
 * A reported or hidden owned image as the moderator queue sees it. Carries the
 * report metadata a reviewer needs and NOTHING that identifies a reporter - the
 * actor hashes stay inside the store.
 */
export type ModeratorProfileImage = {
  slot: ProfileImageSlot;
  handle: string;
  profileId: string;
  generation: string;
  moderationState: ProfileAvatarModerationState;
  reportCount: number;
  reportedAt?: string;
  reportReason?: string;
  moderatedAt?: string;
  moderatorNote?: string;
  /** Public serve path while the image is still approved; absent once hidden. */
  previewUrl?: string;
};

export type ProfileRecord = {
  id: string;
  handle: string;
  // The linked Supabase Auth user id, or undefined while a legacy/demo profile
  // remains unlinked. NEVER serialized to the public /u/[handle] read. It is an
  // internal ownership key only. Null alone is NOT a tombstone — production
  // still holds live anonymous-era rows with user_id null.
  userId?: string;
  /**
   * Set when the linked auth.users row is deleted (migration 0078). Null means
   * live, including legacy user_id-null handles. Public "gone" gates on this.
   */
  tombstonedAt?: string;
  displayName?: string;
  avatarUrl?: string;
  /**
   * Owned avatar object key under our bucket (`avatars/{id}/{generation}/image.jpg`).
   * Internal: never crosses the public profile wire; use {@link publicOwnedImageUrl}.
   */
  avatarObjectKey?: string;
  /** Opaque generation id for the current owned avatar. Internal. */
  avatarGeneration?: string;
  /** Moderation state for the owned avatar. Internal. */
  avatarModerationState?: ProfileAvatarModerationState;
  /** Distinct hashed reporters for the current owned avatar. Internal. */
  avatarReportActors?: string[];
  /** Distinct reporter count derived from {@link avatarReportActors}. */
  avatarReportCount?: number;
  /** When the latest distinct avatar report was recorded. */
  avatarReportedAt?: string;
  /** Latest reader reason for the avatar report queue. */
  avatarReportReason?: string;
  /** When a moderator last kept-visible or hid the owned avatar. */
  avatarModeratedAt?: string;
  /** Optional moderator note on the latest avatar decision. */
  avatarModeratorNote?: string;
  /**
   * Owned cover object key (`covers/{id}/{generation}/cover.jpg`) and its
   * moderation lane. Same pipeline and same rules as the face; internal only.
   */
  coverObjectKey?: string;
  coverGeneration?: string;
  coverModerationState?: ProfileAvatarModerationState;
  coverReportActors?: string[];
  coverReportCount?: number;
  coverReportedAt?: string;
  coverReportReason?: string;
  coverModeratedAt?: string;
  coverModeratorNote?: string;
  homeCity?: string;
  bio?: string;
  /** Public by choice: the drink this account orders. */
  favouriteDrink?: string;
  /** Public by choice: what this account is into on a night out. */
  interests?: string;
  /** Public by choice: where this account works. Display-only, never a page. */
  workplace?: string;
  /**
   * Position among the first hundred claimed handles (migration 0097), or
   * undefined. Public by design and read ONLY to print a mark: no capability in
   * this product branches on it. See `lib/foundingMembers.ts`.
   */
  foundingMemberNumber?: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * The public CARD fields for one handle, as a list surface prints them. This is
 * deliberately narrower than `PublicProfile`: a followers page names a person
 * and shows their face, and nothing else about them crosses that wire.
 */
export type ProfilePublicCard = {
  displayName?: string;
  avatarUrl?: string;
};

/** The record fields backing one owned-image slot. */
type ProfileImageFieldNames = {
  objectKey: "avatarObjectKey" | "coverObjectKey";
  generation: "avatarGeneration" | "coverGeneration";
  moderationState: "avatarModerationState" | "coverModerationState";
  reportActors: "avatarReportActors" | "coverReportActors";
  reportCount: "avatarReportCount" | "coverReportCount";
  reportedAt: "avatarReportedAt" | "coverReportedAt";
  reportReason: "avatarReportReason" | "coverReportReason";
  moderatedAt: "avatarModeratedAt" | "coverModeratedAt";
  moderatorNote: "avatarModeratorNote" | "coverModeratorNote";
};

const IMAGE_FIELDS: Readonly<Record<ProfileImageSlot, ProfileImageFieldNames>> = {
  avatar: {
    objectKey: "avatarObjectKey",
    generation: "avatarGeneration",
    moderationState: "avatarModerationState",
    reportActors: "avatarReportActors",
    reportCount: "avatarReportCount",
    reportedAt: "avatarReportedAt",
    reportReason: "avatarReportReason",
    moderatedAt: "avatarModeratedAt",
    moderatorNote: "avatarModeratorNote",
  },
  cover: {
    objectKey: "coverObjectKey",
    generation: "coverGeneration",
    moderationState: "coverModerationState",
    reportActors: "coverReportActors",
    reportCount: "coverReportCount",
    reportedAt: "coverReportedAt",
    reportReason: "coverReportReason",
    moderatedAt: "coverModeratedAt",
    moderatorNote: "coverModeratorNote",
  },
};

/** The database columns backing one owned-image slot. */
const IMAGE_COLUMNS: Readonly<Record<ProfileImageSlot, Record<keyof ProfileImageFieldNames, string>>> = {
  avatar: {
    objectKey: "avatar_object_key",
    generation: "avatar_generation",
    moderationState: "avatar_moderation_state",
    reportActors: "avatar_report_actors",
    reportCount: "avatar_report_count",
    reportedAt: "avatar_reported_at",
    reportReason: "avatar_report_reason",
    moderatedAt: "avatar_moderated_at",
    moderatorNote: "avatar_moderator_note",
  },
  cover: {
    objectKey: "cover_object_key",
    generation: "cover_generation",
    moderationState: "cover_moderation_state",
    reportActors: "cover_report_actors",
    reportCount: "cover_report_count",
    reportedAt: "cover_reported_at",
    reportReason: "cover_report_reason",
    moderatedAt: "cover_moderated_at",
    moderatorNote: "cover_moderator_note",
  },
};

/** One slot's state read off a record, so the lane logic is written once. */
export type ProfileImageState = {
  objectKey?: string;
  generation?: string;
  moderationState?: ProfileAvatarModerationState;
  reportActors?: string[];
  reportCount?: number;
  reportedAt?: string;
  reportReason?: string;
  moderatedAt?: string;
  moderatorNote?: string;
};

export function profileImageState(
  profile: ProfileRecord,
  slot: ProfileImageSlot,
): ProfileImageState {
  const fields = IMAGE_FIELDS[slot];
  return {
    objectKey: profile[fields.objectKey],
    generation: profile[fields.generation],
    moderationState: profile[fields.moderationState],
    reportActors: profile[fields.reportActors],
    reportCount: profile[fields.reportCount],
    reportedAt: profile[fields.reportedAt],
    reportReason: profile[fields.reportReason],
    moderatedAt: profile[fields.moderatedAt],
    moderatorNote: profile[fields.moderatorNote],
  };
}

function ownerImageWritePreservesHidden(slot: ProfileImageSlot): boolean {
  return slot === "cover";
}

export const PROFILE_COVER_OWNER_WRITE_BLOCKED_LINE =
  "A moderator hid this cover. Owner changes are unavailable until it is restored.";

export function profileOwnerImageWriteBlocked(
  profile: ProfileRecord,
  slot: ProfileImageSlot,
): boolean {
  return (
    ownerImageWritePreservesHidden(slot) &&
    profileImageState(profile, slot).moderationState === "hidden"
  );
}

/** Overlay one slot's state onto a record. Undefined values clear the field. */
function withProfileImageState(
  profile: ProfileRecord,
  slot: ProfileImageSlot,
  state: ProfileImageState,
): ProfileRecord {
  const fields = IMAGE_FIELDS[slot];
  const next: ProfileRecord = { ...profile };
  next[fields.objectKey] = state.objectKey;
  next[fields.generation] = state.generation;
  next[fields.moderationState] = state.moderationState;
  next[fields.reportActors] = state.reportActors;
  next[fields.reportCount] = state.reportCount;
  next[fields.reportedAt] = state.reportedAt;
  next[fields.reportReason] = state.reportReason;
  next[fields.moderatedAt] = state.moderatedAt;
  next[fields.moderatorNote] = state.moderatorNote;
  for (const key of Object.values(fields)) {
    if (next[key] === undefined) delete next[key];
  }
  return next;
}

/**
 * Public served path for an approved owned image in one slot. Absent, pending,
 * flagged, or hidden images yield undefined so callers fall back to initials
 * (avatar) or the brass treatment (cover).
 */
export function publicOwnedImageUrl(
  profile: ProfileRecord,
  slot: ProfileImageSlot,
): string | undefined {
  const state = profileImageState(profile, slot);
  if (state.moderationState !== "approved") return undefined;
  if (!state.objectKey || !state.generation || !profile.id) return undefined;
  return profileImageServePath(slot, profile.id, state.generation);
}

/**
 * The stored row as it crosses the public wire. This is the ONLY wiring of a
 * `ProfileRecord` into `toPublicProfile`: the public read and every image write
 * share it, so the two can never disagree about what a public profile carries.
 * Internal keys (ownership, tombstone, storage object keys, moderation state)
 * stop here.
 *
 * The cover ROTATION lives in its own table (`lib/profileCoverPhotoStore.ts`),
 * so a caller that read it passes the resolved serve paths in rather than this
 * function reaching for a second store on every profile read. A caller that did
 * not read it says nothing, and the single back-compat `coverUrl` stands alone -
 * absence, never an empty rotation.
 */
export function publicProfileFromRecord(
  profile: ProfileRecord | null | undefined,
  images: { coverUrls?: readonly string[] } = {},
): PublicProfile | null {
  if (!profile) return null;
  return toPublicProfile(profile, {
    avatarUrl: publicOwnedImageUrl(profile, "avatar"),
    coverUrl: publicOwnedImageUrl(profile, "cover"),
    ...(images.coverUrls ? { coverUrls: images.coverUrls } : {}),
  });
}

/** True only when the auth-deletion trigger stamped tombstoned_at. */
export function isProfileTombstoned(
  profile: Pick<ProfileRecord, "tombstonedAt"> | null | undefined,
): boolean {
  return typeof profile?.tombstonedAt === "string" && profile.tombstonedAt.length > 0;
}

// The subset of columns a caller may set. Handle is the identity key and is
// never patchable here (renaming a handle is a different, auth-gated operation).
export type ProfilePatch = {
  displayName?: string | null;
  avatarUrl?: string | null;
  homeCity?: string | null;
  bio?: string | null;
  favouriteDrink?: string | null;
  interests?: string | null;
  workplace?: string | null;
};

export type ProfileSoftDeleteResult =
  | { status: "deleted"; profile: ProfileRecord; ownerUserId: string | null }
  | { status: "not-found" }
  | { status: "forbidden" };

// Editable-field caps — the store is the last line of defence so `update` is
// safe called directly (tests, future callers), independent of the route's own
// trust boundary. The route validates first; this cleans again, cheaply.
const MAX_DISPLAY_NAME = 60;
const MAX_BIO = 280;
const MAX_HOME_CITY = 60;
const MAX_AVATAR_URL = 400;
export const MAX_FAVOURITE_DRINK = 40;
export const MAX_INTERESTS = 140;
export const MAX_WORKPLACE = 60;

// Cleaning is the shared cleanText (lib/textClean): strip inline HTML angle
// brackets + control chars, collapse whitespace, cap. An empty result becomes
// null so the column is cleared rather than stored as "".
function cleanField(value: string | null | undefined, cap: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = cleanText(value, cap);
  return cleaned === "" ? null : cleaned;
}

// An avatar must be an http(s) URL within the cap, or null (cleared). Junk —
// javascript:/data: schemes, a bare string, an over-long URL — is dropped to
// null rather than stored, so nothing that isn't a real remote image URL ever
// reaches the header's <Image src>. Delegates the URL check to the shared
// isHttpUrl (lib/textClean); an invalid/empty value becomes null.
function cleanAvatar(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return isHttpUrl(value, MAX_AVATAR_URL) ?? null;
}

// Clean + cap a raw patch. Only keys present on the input survive, so an edit
// that omits a field leaves that column untouched; a present key with an empty
// or junk value clears the column (null).
function cleanPatch(patch: ProfilePatch): ProfilePatch {
  const out: ProfilePatch = {};
  if ("displayName" in patch) out.displayName = cleanField(patch.displayName, MAX_DISPLAY_NAME);
  if ("bio" in patch) out.bio = cleanField(patch.bio, MAX_BIO);
  if ("homeCity" in patch) out.homeCity = cleanField(patch.homeCity, MAX_HOME_CITY);
  if ("avatarUrl" in patch) out.avatarUrl = cleanAvatar(patch.avatarUrl);
  if ("favouriteDrink" in patch) {
    out.favouriteDrink = cleanField(patch.favouriteDrink, MAX_FAVOURITE_DRINK);
  }
  if ("interests" in patch) out.interests = cleanField(patch.interests, MAX_INTERESTS);
  if ("workplace" in patch) out.workplace = cleanField(patch.workplace, MAX_WORKPLACE);
  return out;
}

export type ProfileStore = {
  /** Read a profile by handle, or null when none exists yet. */
  getByHandle(handle: string): Promise<ProfileRecord | null>;
  /** Read a profile by stable id, or null when none exists. */
  getById(id: string): Promise<ProfileRecord | null>;
  /**
   * One query: approved owned avatars for linked handles only. Keys are
   * normalised handles; values are public serve paths.
   */
  getApprovedAvatarUrlsByHandles(handles: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /**
   * One query: the public CARD fields (display name, approved owned avatar) for
   * a set of handles. Keys are normalised handles; a handle with no row is
   * simply absent. This exists so a list surface reads its people in ONE round
   * trip: a followers page point-reading each row fanned out one PostgREST call
   * per follower on a public, unpaginated, unauthenticated route.
   */
  getPublicCardsByHandles(
    handles: readonly string[],
  ): Promise<ReadonlyMap<string, ProfilePublicCard>>;
  /**
   * Resolve the handle linked to an auth user id, or null when no profile has
   * claimed that uid yet. Used by messaging (and similar) so an authenticated
   * caller is identified by their linked profile rather than a self-asserted
   * body handle.
   */
  getHandleByUserId(userId: string): Promise<string | null>;
  /** Read a profile by linked auth user id, or null when none exists. */
  getByUserId(userId: string): Promise<ProfileRecord | null>;
  /** Get-or-create a minimal row for a handle. Never clobbers existing fields. */
  ensure(handle: string): Promise<ProfileRecord>;
  /** Atomically create an absent handle already owned by an account. */
  createOwned(handle: string, userId: string): Promise<ProfileRecord>;
  /** Apply a patch to an existing profile. Returns null when the handle is unknown. */
  update(handle: string, patch: ProfilePatch): Promise<ProfileRecord | null>;
  /**
   * Atomically authorize and soft-delete a profile. Anonymous callers may
   * clear only a row that is still unlinked. Authenticated callers may clear
   * an unlinked row or their own linked row. Keeping ownership in the UPDATE
   * predicate prevents a concurrent account claim from being deleted after a
   * stale route-level read. The row, handle, and user_id remain so social graph
   * edges are not cascade-destroyed.
   */
  softDeleteForCaller(
    handle: string,
    callerUserId: string | null,
  ): Promise<ProfileSoftDeleteResult>;
  /**
   * Confirm current ownership. Repeating the same handle and user is
   * idempotent. Absent, unowned, and differently owned handles are unavailable.
   */
  linkUser(handle: string, userId: string): Promise<ProfileRecord>;
  /**
   * Set or clear the owned (uploaded) image fields for one slot. Passing null
   * clears the object key, generation, and moderation state together. A new or
   * cleared image also clears report/hide stamps so provenance cannot attach to
   * the wrong generation. Owner writes cannot replace or clear a moderator-hidden
   * cover. Does not touch the legacy hotlinked `avatarUrl`.
   */
  setOwnedImage(
    handle: string,
    slot: ProfileImageSlot,
    image: ProfileOwnedImage | null,
  ): Promise<ProfileRecord | null>;
  /**
   * Queue a reader flag on the current owned image. Never changes public
   * visibility. Same-actor duplicates are idempotent.
   */
  reportOwnedImage(
    handle: string,
    slot: ProfileImageSlot,
    reason: string | undefined,
    actorHash: string,
  ): Promise<boolean>;
  /**
   * Moderator hide or restore. Hide stamps `hidden` and stops public serving;
   * restore returns the image to `approved`. Neither deletes storage or report
   * provenance.
   */
  moderateOwnedImage(
    handle: string,
    slot: ProfileImageSlot,
    action: "hide" | "restore",
    note?: string,
  ): Promise<boolean>;
  /** Reported, still-public owned images awaiting a moderator decision. */
  listReportedImages(
    slot: ProfileImageSlot,
    limit?: number,
  ): Promise<ModeratorProfileImage[]>;
  /** Already-hidden owned images (hide stays reversible from this lane). */
  listHiddenImages(
    slot: ProfileImageSlot,
    limit?: number,
  ): Promise<ModeratorProfileImage[]>;
  /**
   * Prefix search over claimed, non-tombstoned handles only (WP7 find-your-lot).
   * Never returns unowned or tombstoned rows. Bounded; ordered by handle.
   */
  searchClaimedByHandlePrefix(
    prefix: string,
    limit?: number,
  ): Promise<ProfileRecord[]>;
  /**
   * Browse claimed, non-tombstoned handles with no prefix (the people
   * directory). Same closed row set as the prefix search - claimed and live
   * only - so a directory can never surface an unowned or deleted account.
   * Ordered by handle and paged by it, so the cursor needs no second column.
   */
  listClaimedProfiles(input?: {
    limit?: number;
    afterHandle?: string;
  }): Promise<ProfileRecord[]>;
  /**
   * The founders wall, in number order. Claimed and live only, exactly like the
   * directory above, so a departed founder leaves the list and its number is
   * simply a gap. The cohort is capped at {@link FOUNDING_MEMBER_CAP}, so this
   * read is bounded by the data itself and needs no cursor.
   */
  listFoundingMembers(): Promise<ProfileRecord[]>;
};

const TABLE = "profiles";

function admin() {
  return requireSupabaseAdmin();
}

// profiles (snake_case) <-> ProfileRecord (camelCase). One place so a column
// rename is a one-line change on each side.
function avatarModerationFromRow(
  value: unknown,
): ProfileAvatarModerationState | undefined {
  if (
    value === "pending" ||
    value === "approved" ||
    value === "needs_review" ||
    value === "hidden"
  ) {
    return value;
  }
  return undefined;
}

function avatarReportActorsFromRow(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const actors = value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .map((entry) => entry);
  return actors.length ? actors : undefined;
}

function imageStateFromRow(
  row: Record<string, unknown>,
  slot: ProfileImageSlot,
): ProfileImageState {
  const columns = IMAGE_COLUMNS[slot];
  const reportActors = avatarReportActorsFromRow(row[columns.reportActors]);
  const reportCountRaw = row[columns.reportCount];
  const reportCount =
    typeof reportCountRaw === "number" && Number.isFinite(reportCountRaw)
      ? reportCountRaw
      : reportActors?.length;
  const text = (column: string): string | undefined =>
    row[column] ? String(row[column]) : undefined;
  return {
    objectKey: text(columns.objectKey),
    generation: text(columns.generation),
    moderationState: avatarModerationFromRow(row[columns.moderationState]),
    ...(reportActors ? { reportActors } : {}),
    ...(reportCount && reportCount > 0 ? { reportCount } : {}),
    reportedAt: text(columns.reportedAt),
    reportReason: text(columns.reportReason),
    moderatedAt: text(columns.moderatedAt),
    moderatorNote: text(columns.moderatorNote),
  };
}

function fromRow(row: Record<string, unknown>): ProfileRecord {
  const base: ProfileRecord = {
    id: String(row.id),
    handle: String(row.handle),
    userId: row.user_id ? String(row.user_id) : undefined,
    tombstonedAt: row.tombstoned_at ? String(row.tombstoned_at) : undefined,
    displayName: row.display_name ? String(row.display_name) : undefined,
    avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
    homeCity: row.home_city ? String(row.home_city) : undefined,
    bio: row.bio ? String(row.bio) : undefined,
    favouriteDrink: row.favourite_drink ? String(row.favourite_drink) : undefined,
    interests: row.interests ? String(row.interests) : undefined,
    workplace: row.workplace ? String(row.workplace) : undefined,
    ...(parseFoundingMemberNumber(row.founding_member_number) !== null
      ? { foundingMemberNumber: parseFoundingMemberNumber(row.founding_member_number)! }
      : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  return withProfileImageState(
    withProfileImageState(base, "avatar", imageStateFromRow(row, "avatar")),
    "cover",
    imageStateFromRow(row, "cover"),
  );
}

const IMAGE_REVIEW_LIMIT = 100;
const MAX_AVATAR_REPORT_REASON = 280;

function cleanAvatarReportReason(reason: string | undefined): string | undefined {
  if (typeof reason !== "string") return undefined;
  const cleaned = cleanText(reason, MAX_AVATAR_REPORT_REASON);
  return cleaned === "" ? undefined : cleaned;
}

const REPORT_ACTOR_APPEND_RPC = "append_profile_image_report_actor";
let reportActorRpcMissingWarned = false;

/** PostgREST / Postgres signals that migration 0105 is not deployed yet. */
function isMissingReportActorRpc(error: { message?: string; code?: string }): boolean {
  const code = error.code ?? "";
  // PGRST202 = function not in schema cache; 42883 = undefined_function.
  if (code === "PGRST202" || code === "42883") return true;
  const message = error.message ?? "";
  return (
    new RegExp(REPORT_ACTOR_APPEND_RPC, "i").test(message) &&
    /does not exist|Could not find the function|schema cache/i.test(message)
  );
}

/**
 * Append one reporter to an owned image in ONE statement, or NULL when the
 * function is not deployed - which is the caller's signal to take the older
 * read-modify-write path rather than to refuse a reader's flag.
 */
async function appendReportActorAtomically(
  handle: string,
  slot: ProfileImageSlot,
  actor: string,
  reason: string | undefined,
): Promise<boolean | null> {
  const { data, error } = await admin().rpc(REPORT_ACTOR_APPEND_RPC, {
    p_handle: handle,
    p_slot: slot,
    p_actor: actor,
    p_reason: reason ?? null,
  });
  if (error) {
    if (!isMissingReportActorRpc(error)) throw new Error(error.message);
    if (!reportActorRpcMissingWarned) {
      reportActorRpcMissingWarned = true;
      console.warn(
        `[profiles] ${REPORT_ACTOR_APPEND_RPC} not deployed - reporting falls back to a ` +
          "read-modify-write that loses one of two concurrent reporters (apply migration 0105).",
      );
    }
    return null;
  }
  return data === true;
}

function clearImageReportRow(slot: ProfileImageSlot): Record<string, unknown> {
  const columns = IMAGE_COLUMNS[slot];
  return {
    [columns.reportCount]: 0,
    [columns.reportedAt]: null,
    [columns.reportReason]: null,
    [columns.reportActors]: [],
    [columns.moderatedAt]: null,
    [columns.moderatorNote]: null,
  };
}

function toModeratorImage(
  profile: ProfileRecord,
  slot: ProfileImageSlot,
): ModeratorProfileImage | null {
  const state = profileImageState(profile, slot);
  if (!state.generation || !state.moderationState || !state.objectKey) return null;
  const previewUrl = publicOwnedImageUrl(profile, slot);
  return {
    slot,
    handle: profile.handle,
    profileId: profile.id,
    generation: state.generation,
    moderationState: state.moderationState,
    reportCount: state.reportCount ?? state.reportActors?.length ?? 0,
    ...(state.reportedAt ? { reportedAt: state.reportedAt } : {}),
    ...(state.reportReason ? { reportReason: state.reportReason } : {}),
    ...(state.moderatedAt ? { moderatedAt: state.moderatedAt } : {}),
    ...(state.moderatorNote ? { moderatorNote: state.moderatorNote } : {}),
    ...(previewUrl ? { previewUrl } : {}),
  };
}

function isReportedImageQueueRow(profile: ProfileRecord, slot: ProfileImageSlot): boolean {
  const state = profileImageState(profile, slot);
  const reports = state.reportCount ?? state.reportActors?.length ?? 0;
  return (
    reports > 0 &&
    !state.moderatedAt &&
    state.moderationState === "approved" &&
    Boolean(state.objectKey && state.generation)
  );
}

function isHiddenImageQueueRow(profile: ProfileRecord, slot: ProfileImageSlot): boolean {
  const state = profileImageState(profile, slot);
  return state.moderationState === "hidden" && Boolean(state.objectKey && state.generation);
}

// Only the columns present in `patch` are written — an absent key is left
// untouched; an explicit null clears the column. Handle/id/created_at never map.
function patchToRow(patch: ProfilePatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ("displayName" in patch) row.display_name = patch.displayName;
  if ("avatarUrl" in patch) row.avatar_url = patch.avatarUrl;
  if ("homeCity" in patch) row.home_city = patch.homeCity;
  if ("bio" in patch) row.bio = patch.bio;
  if ("favouriteDrink" in patch) row.favourite_drink = patch.favouriteDrink;
  if ("interests" in patch) row.interests = patch.interests;
  if ("workplace" in patch) row.workplace = patch.workplace;
  return row;
}

// A Postgres unique_violation — two concurrent ensure() inserts race on the
// handle unique index; the loser re-selects the winner's row.
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

// ── Supabase implementation ──────────────────────────────────────────────────
const AVATAR_BATCH_COLUMNS =
  "id, handle, user_id, tombstoned_at, avatar_object_key, avatar_generation, avatar_moderation_state";

function approvedAvatarUrlForProfile(profile: ProfileRecord): string | undefined {
  if (!profile.userId?.trim() || isProfileTombstoned(profile)) return undefined;
  return publicOwnedImageUrl(profile, "avatar");
}

const CARD_BATCH_COLUMNS = `${AVATAR_BATCH_COLUMNS}, display_name`;

/**
 * How many handles one PostgREST `.in(...)` may carry. The filter travels in the
 * request LINE, so an unpaginated caller (a followers list) would grow the URL
 * past the gateway's ceiling and fail the whole read rather than one page of it.
 */
const HANDLE_BATCH_SIZE = 200;

/**
 * How many of those requests may be in flight together. Chunking that AWAITED
 * each batch turned one round trip into ceil(n/200) stacked on top of the
 * follow-list join, so the batches overlap - but this route is public and
 * unauthenticated, so the overlap has a ceiling rather than being the follower
 * count divided by the batch size.
 */
const HANDLE_BATCH_CONCURRENCY = 6;

function handleBatches(handles: readonly string[]): string[][] {
  const keys = [...new Set(handles.map((handle) => normalizeHandle(handle)).filter(Boolean))];
  const batches: string[][] = [];
  for (let at = 0; at < keys.length; at += HANDLE_BATCH_SIZE) {
    batches.push(keys.slice(at, at + HANDLE_BATCH_SIZE));
  }
  return batches;
}

type BatchAnswer = { data: unknown[] | null; error: { message: string } | null };

/**
 * Every batched handle read, written once: chunk, run the chunks against a
 * bounded pool, then fold each returned row into one map. A reader that only
 * says WHICH query and WHAT to keep cannot reintroduce the fan-out, the
 * unbounded `.in(...)`, or the serial await that each cost this lane a round.
 */
async function readHandleBatches<T>(
  handles: readonly string[],
  query: (keys: string[]) => PromiseLike<BatchAnswer>,
  keep: (profile: ProfileRecord, into: Map<string, T>) => void,
): Promise<ReadonlyMap<string, T>> {
  const batches = handleBatches(handles);
  const out = new Map<string, T>();
  if (batches.length === 0) return out;

  const answers: BatchAnswer[] = new Array(batches.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(HANDLE_BATCH_CONCURRENCY, batches.length) },
    async () => {
      for (;;) {
        const at = next;
        next += 1;
        if (at >= batches.length) return;
        answers[at] = await query(batches[at]!);
      }
    },
  );
  await Promise.all(workers);

  for (const answer of answers) {
    if (answer.error) throw new Error(answer.error.message);
    for (const row of answer.data ?? []) keep(fromRow(row as Record<string, unknown>), out);
  }
  return out;
}

/**
 * A departed account keeps its row so its handle stays reserved, and the auth
 * tombstone trigger nulls its images but LEAVES its display name. So a card is
 * gated the way `approvedAvatarUrlForProfile` already gates a face: a tombstoned
 * row answers an empty card rather than printing a departed person's real name
 * beside their handle to any anonymous reader of a follow list.
 */
function publicCardForProfile(profile: ProfileRecord): ProfilePublicCard {
  const card: ProfilePublicCard = {};
  if (isProfileTombstoned(profile)) return card;
  if (profile.displayName) card.displayName = profile.displayName;
  const avatarUrl = approvedAvatarUrlForProfile(profile);
  if (avatarUrl) card.avatarUrl = avatarUrl;
  return card;
}

export const supabaseProfileStore: ProfileStore = {
  async getByHandle(handle) {
    const key = normalizeHandle(handle);
    if (!key) return null;
    const { data, error } = await admin().from(TABLE).select("*").eq("handle", key).limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    return row ? fromRow(row as Record<string, unknown>) : null;
  },

  async getById(id) {
    const key = typeof id === "string" ? id.trim() : "";
    if (!key) return null;
    const { data, error } = await admin().from(TABLE).select("*").eq("id", key).limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    return row ? fromRow(row as Record<string, unknown>) : null;
  },

  async getApprovedAvatarUrlsByHandles(handles) {
    return readHandleBatches<string>(
      handles,
      (keys) =>
        admin()
          .from(TABLE)
          .select(AVATAR_BATCH_COLUMNS)
          .in("handle", keys)
          .not("user_id", "is", null),
      (profile, into) => {
        const url = approvedAvatarUrlForProfile(profile);
        if (url) into.set(profile.handle, url);
      },
    );
  },

  async getPublicCardsByHandles(handles) {
    return readHandleBatches<ProfilePublicCard>(
      handles,
      (keys) =>
        admin()
          .from(TABLE)
          .select(CARD_BATCH_COLUMNS)
          .in("handle", keys)
          .is("tombstoned_at", null),
      (profile, into) => into.set(profile.handle, publicCardForProfile(profile)),
    );
  },

  async getHandleByUserId(userId) {
    if (!userId) return null;
    const { data, error } = await admin()
      .from(TABLE)
      .select("handle")
      .eq("user_id", userId)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as { handle?: unknown } | undefined;
    return row?.handle ? normalizeHandle(String(row.handle)) || null : null;
  },

  async getByUserId(userId) {
    const key = typeof userId === "string" ? userId.trim() : "";
    if (!key) return null;
    const { data, error } = await admin().from(TABLE).select("*").eq("user_id", key).limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    return row ? fromRow(row as Record<string, unknown>) : null;
  },

  async ensure(handle) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    const existing = await this.getByHandle(key);
    if (existing) return existing;

    const { data, error } = await admin()
      .from(TABLE)
      .insert({ handle: key })
      .select("*")
      .limit(1);
    if (error) {
      // Lost an insert race — the row now exists; read it back.
      if (isUniqueViolation(error)) {
        const row = await this.getByHandle(key);
        if (row) return row;
      }
      throw new Error(error.message);
    }
    return fromRow((data ?? [])[0] as Record<string, unknown>);
  },

  async createOwned(handle, userId) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    if (!userId) throw new Error("User id is missing.");
    if (isReservedContributorHandle(key)) {
      throw new Error("That handle is not available.");
    }
    const { data, error } = await admin().rpc("claim_pubmaxx_handle", {
      p_user_id: userId,
      p_handle: key,
    });
    if (error) throw new Error(error.message);
    const result = (Array.isArray(data) ? data[0] : data) as
      | Record<string, unknown>
      | null;
    if (result?.ok === true) {
      const profile = await this.getByHandle(key);
      if (profile?.userId === userId) return profile;
      throw new Error("Profile storage is unavailable.");
    }
    if (result?.code === "already_has_handle") {
      throw new Error("That account already has a handle.");
    }
    if (result?.code === "taken") {
      throw new Error("That handle is not available.");
    }
    throw new Error("Profile storage is unavailable.");
  },

  async update(handle, patch) {
    const key = normalizeHandle(handle);
    if (!key) return null;
    const row = patchToRow(cleanPatch(patch));
    // No writable fields in the patch → treat as a plain read so callers still
    // get the current row back without an empty UPDATE.
    if (Object.keys(row).length === 0) return this.getByHandle(key);
    row.updated_at = new Date().toISOString();
    const { data, error } = await admin()
      .from(TABLE)
      .update(row)
      .eq("handle", key)
      .select("*")
      .limit(1);
    if (error) throw new Error(error.message);
    const updated = (data ?? [])[0];
    return updated ? fromRow(updated as Record<string, unknown>) : null;
  },

  async softDeleteForCaller(handle, callerUserId) {
    const key = normalizeHandle(handle);
    if (!key) return { status: "not-found" };

    const row = patchToRow(cleanPatch({
      displayName: null,
      avatarUrl: null,
      homeCity: null,
      bio: null,
      favouriteDrink: null,
      interests: null,
      workplace: null,
    }));
    for (const slot of PROFILE_IMAGE_SLOTS) {
      const columns = IMAGE_COLUMNS[slot];
      row[columns.objectKey] = null;
      row[columns.generation] = null;
      row[columns.moderationState] = null;
      Object.assign(row, clearImageReportRow(slot));
    }
    row.updated_at = new Date().toISOString();

    let query = admin()
      .from(TABLE)
      .update(row)
      .eq("handle", key);
    const caller = callerUserId?.trim() || null;
    query = caller
      ? query.or(`user_id.is.null,user_id.eq.${caller}`)
      : query.is("user_id", null);

    const { data, error } = await query.select("*").limit(1);
    if (error) throw new Error(error.message);
    const deleted = (data ?? [])[0];
    if (deleted) {
      const profile = fromRow(deleted as Record<string, unknown>);
      return {
        status: "deleted",
        profile,
        ownerUserId: profile.userId ?? null,
      };
    }

    const current = await this.getByHandle(key);
    return current ? { status: "forbidden" } : { status: "not-found" };
  },

  async linkUser(handle, userId) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    if (!userId) throw new Error("User id is missing.");
    if (isReservedContributorHandle(key)) {
      throw new Error("That handle is not available.");
    }
    const existing = await this.getByHandle(key);
    if (existing?.userId === userId) return existing;
    throw new Error("That handle is not available.");
  },

  async setOwnedImage(handle, slot, image) {
    const key = normalizeHandle(handle);
    if (!key) return null;
    const columns = IMAGE_COLUMNS[slot];
    const row: Record<string, unknown> = {
      [columns.objectKey]: image?.objectKey ?? null,
      [columns.generation]: image?.generation ?? null,
      [columns.moderationState]: image?.moderationState ?? null,
      // A new generation is a different image; old flags must not travel with it.
      ...clearImageReportRow(slot),
      updated_at: new Date().toISOString(),
    };
    let query = admin()
      .from(TABLE)
      .update(row)
      .eq("handle", key);
    if (ownerImageWritePreservesHidden(slot)) {
      query = query.or(
        `${columns.moderationState}.is.null,${columns.moderationState}.neq.hidden`,
      );
    }
    const { data, error } = await query.select("*")
      .limit(1);
    if (error) throw new Error(error.message);
    const updated = (data ?? [])[0];
    return updated ? fromRow(updated as Record<string, unknown>) : null;
  },

  async reportOwnedImage(handle, slot, reason, actorHash) {
    const key = normalizeHandle(handle);
    const actor = typeof actorHash === "string" ? actorHash.trim() : "";
    if (!key || !actor) return false;

    // ONE statement, so two reporters cannot clobber each other: the append
    // happens in Postgres and the UPDATE's own predicate carries the gate.
    // Migration 0105. Until it is applied the read-modify-write below still
    // runs - correct for one reporter, racy for two, which is what it always was.
    const appended = await appendReportActorAtomically(
      key,
      slot,
      actor,
      cleanAvatarReportReason(reason),
    );
    if (appended !== null) return appended;

    const existing = await this.getByHandle(key);
    if (!existing) return false;
    const state = profileImageState(existing, slot);
    if (!state.objectKey || !state.generation || state.moderationState !== "approved") {
      return false;
    }
    const actors = state.reportActors ?? [];
    if (actors.includes(actor)) return true;
    const nextActors = [...actors, actor];
    const cleanedReason = cleanAvatarReportReason(reason);
    const columns = IMAGE_COLUMNS[slot];
    const row: Record<string, unknown> = {
      [columns.reportActors]: nextActors,
      [columns.reportCount]: nextActors.length,
      [columns.reportedAt]: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // A fresh flag after "keep visible" re-opens the reported lane.
      [columns.moderatedAt]: null,
    };
    if (cleanedReason) row[columns.reportReason] = cleanedReason;
    const { data, error } = await admin()
      .from(TABLE)
      .update(row)
      .eq("handle", key)
      .eq(columns.moderationState, "approved")
      .select("id")
      .limit(1);
    if (error) throw new Error(error.message);
    return Boolean((data ?? [])[0]);
  },

  async moderateOwnedImage(handle, slot, action, note) {
    const key = normalizeHandle(handle);
    if (!key) return false;
    const existing = await this.getByHandle(key);
    if (!existing) return false;
    const state = profileImageState(existing, slot);
    if (!state.objectKey || !state.generation || !state.moderationState) return false;
    if (state.moderationState !== "approved" && state.moderationState !== "hidden") {
      return false;
    }

    const cleanedNote = cleanAvatarReportReason(note);
    const columns = IMAGE_COLUMNS[slot];
    const row: Record<string, unknown> = {
      [columns.moderationState]: action === "hide" ? "hidden" : "approved",
      [columns.moderatedAt]: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (cleanedNote) row[columns.moderatorNote] = cleanedNote;
    const { data, error } = await admin()
      .from(TABLE)
      .update(row)
      .eq("handle", key)
      .select("id")
      .limit(1);
    if (error) throw new Error(error.message);
    return Boolean((data ?? [])[0]);
  },

  async listReportedImages(slot, limit = IMAGE_REVIEW_LIMIT) {
    const bounded = Math.min(Math.max(limit, 1), IMAGE_REVIEW_LIMIT);
    const columns = IMAGE_COLUMNS[slot];
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .eq(columns.moderationState, "approved")
      .gt(columns.reportCount, 0)
      .is(columns.moderatedAt, null)
      .not(columns.objectKey, "is", null)
      .order(columns.reportedAt, { ascending: false, nullsFirst: false })
      .limit(bounded);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((row) => toModeratorImage(fromRow(row as Record<string, unknown>), slot))
      .filter((row): row is ModeratorProfileImage => row !== null);
  },

  async listHiddenImages(slot, limit = IMAGE_REVIEW_LIMIT) {
    const bounded = Math.min(Math.max(limit, 1), IMAGE_REVIEW_LIMIT);
    const columns = IMAGE_COLUMNS[slot];
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .eq(columns.moderationState, "hidden")
      .not(columns.objectKey, "is", null)
      .order(columns.moderatedAt, { ascending: false, nullsFirst: false })
      .limit(bounded);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((row) => toModeratorImage(fromRow(row as Record<string, unknown>), slot))
      .filter((row): row is ModeratorProfileImage => row !== null);
  },

  async searchClaimedByHandlePrefix(prefix, limit = 8) {
    const key = normalizeHandle(prefix);
    if (!key || key.length < 2) return [];
    const bounded = Math.min(Math.max(limit, 1), 12);
    // Claimed = user_id set; live = tombstoned_at null. ilike prefix only.
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .not("user_id", "is", null)
      .is("tombstoned_at", null)
      .ilike("handle", `${key}%`)
      .order("handle", { ascending: true })
      .limit(bounded);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
  },

  async listClaimedProfiles(input = {}) {
    const bounded = Math.min(Math.max(input.limit ?? 24, 1), 48);
    const after = normalizeHandle(input.afterHandle ?? "");
    let query = admin()
      .from(TABLE)
      .select("*")
      .not("user_id", "is", null)
      .is("tombstoned_at", null)
      .order("handle", { ascending: true })
      .limit(bounded);
    if (after) query = query.gt("handle", after);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
  },

  async listFoundingMembers() {
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .not("founding_member_number", "is", null)
      .not("user_id", "is", null)
      .is("tombstoned_at", null)
      .order("founding_member_number", { ascending: true })
      .limit(FOUNDING_MEMBER_CAP);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Resets on restart — right for dev/demo/test. Keyed by normalized handle.
const memoryProfiles = new Map<string, ProfileRecord>();

// Deterministic-enough id for the memory store: handle-scoped so follows/saved
// can reference it stably within a process. Never leaves dev.
function memoryId(handle: string): string {
  return `mem-profile-${handle}`;
}

/**
 * The memory half of migration 0097's grant. Same rules, same cap: the next
 * number while the cohort has room, nothing once it is full, and a tombstone
 * keeps the number it was given rather than handing it to the next arrival.
 *
 * No lock is needed here and none is faked: this store lives in one process and
 * JavaScript runs this whole function before any other claim resumes. The race
 * the Postgres helper exists to stop cannot happen in a single event loop.
 */
function grantMemoryFoundingNumber(): number | undefined {
  let taken = 0;
  let highest = 0;
  for (const profile of memoryProfiles.values()) {
    if (profile.foundingMemberNumber === undefined) continue;
    taken += 1;
    if (profile.foundingMemberNumber > highest) highest = profile.foundingMemberNumber;
  }
  if (taken >= FOUNDING_MEMBER_CAP || highest >= FOUNDING_MEMBER_CAP) return undefined;
  return highest + 1;
}

export const memoryProfileStore: ProfileStore = {
  async getByHandle(handle) {
    return memoryProfiles.get(normalizeHandle(handle)) ?? null;
  },

  async getById(id) {
    const key = typeof id === "string" ? id.trim() : "";
    if (!key) return null;
    for (const profile of memoryProfiles.values()) {
      if (profile.id === key) return profile;
    }
    return null;
  },

  async getApprovedAvatarUrlsByHandles(handles) {
    const out = new Map<string, string>();
    for (const raw of handles) {
      const key = normalizeHandle(raw);
      if (!key) continue;
      const profile = memoryProfiles.get(key);
      if (!profile) continue;
      const url = approvedAvatarUrlForProfile(profile);
      if (url) out.set(profile.handle, url);
    }
    return out;
  },

  async getPublicCardsByHandles(handles) {
    const out = new Map<string, ProfilePublicCard>();
    for (const raw of handles) {
      const key = normalizeHandle(raw);
      if (!key) continue;
      const profile = memoryProfiles.get(key);
      if (!profile) continue;
      out.set(profile.handle, publicCardForProfile(profile));
    }
    return out;
  },

  async getHandleByUserId(userId) {
    if (!userId) return null;
    for (const record of memoryProfiles.values()) {
      if (record.userId === userId) return record.handle;
    }
    return null;
  },

  async getByUserId(userId) {
    const key = typeof userId === "string" ? userId.trim() : "";
    if (!key) return null;
    for (const profile of memoryProfiles.values()) {
      if (profile.userId === key) return profile;
    }
    return null;
  },

  async ensure(handle) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    const existing = memoryProfiles.get(key);
    if (existing) return existing;
    const now = new Date().toISOString();
    const record: ProfileRecord = {
      id: memoryId(key),
      handle: key,
      createdAt: now,
      updatedAt: now,
    };
    memoryProfiles.set(key, record);
    return record;
  },

  async createOwned(handle, userId) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    if (!userId) throw new Error("User id is missing.");
    if (isReservedContributorHandle(key)) {
      throw new Error("That handle is not available.");
    }
    const existing = memoryProfiles.get(key);
    if (existing?.userId === userId) return existing;
    if (existing) throw new Error("That handle is not available.");
    for (const profile of memoryProfiles.values()) {
      if (profile.userId === userId) {
        throw new Error("That account already has a handle.");
      }
    }
    const now = new Date().toISOString();
    const founding = grantMemoryFoundingNumber();
    const record: ProfileRecord = {
      id: memoryId(key),
      handle: key,
      userId,
      ...(founding === undefined ? {} : { foundingMemberNumber: founding }),
      createdAt: now,
      updatedAt: now,
    };
    memoryProfiles.set(key, record);
    return record;
  },

  async update(handle, rawPatch) {
    const key = normalizeHandle(handle);
    const existing = memoryProfiles.get(key);
    if (!existing) return null;
    const patch = cleanPatch(rawPatch);
    const next: ProfileRecord = {
      ...existing,
      ...("displayName" in patch ? { displayName: patch.displayName ?? undefined } : {}),
      ...("avatarUrl" in patch ? { avatarUrl: patch.avatarUrl ?? undefined } : {}),
      ...("homeCity" in patch ? { homeCity: patch.homeCity ?? undefined } : {}),
      ...("bio" in patch ? { bio: patch.bio ?? undefined } : {}),
      ...("favouriteDrink" in patch
        ? { favouriteDrink: patch.favouriteDrink ?? undefined }
        : {}),
      ...("interests" in patch ? { interests: patch.interests ?? undefined } : {}),
      ...("workplace" in patch ? { workplace: patch.workplace ?? undefined } : {}),
      updatedAt: new Date().toISOString(),
    };
    memoryProfiles.set(key, next);
    return next;
  },

  async softDeleteForCaller(handle, callerUserId) {
    const key = normalizeHandle(handle);
    const existing = memoryProfiles.get(key);
    if (!existing) return { status: "not-found" };

    const caller = callerUserId?.trim() || null;
    if (existing.userId && existing.userId !== caller) {
      return { status: "forbidden" };
    }

    const cleared: ProfileRecord = {
      ...existing,
      displayName: undefined,
      avatarUrl: undefined,
      homeCity: undefined,
      bio: undefined,
      favouriteDrink: undefined,
      interests: undefined,
      workplace: undefined,
      updatedAt: new Date().toISOString(),
    };
    const profile = PROFILE_IMAGE_SLOTS.reduce<ProfileRecord>(
      (record, slot) => withProfileImageState(record, slot, {}),
      cleared,
    );
    memoryProfiles.set(key, profile);
    return {
      status: "deleted",
      profile,
      ownerUserId: profile.userId ?? null,
    };
  },

  async linkUser(handle, userId) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    if (!userId) throw new Error("User id is missing.");
    if (isReservedContributorHandle(key)) {
      throw new Error("That handle is not available.");
    }
    const existing = memoryProfiles.get(key);
    if (existing?.userId === userId) return existing;
    throw new Error("That handle is not available.");
  },

  async setOwnedImage(handle, slot, image) {
    const key = normalizeHandle(handle);
    const existing = memoryProfiles.get(key);
    if (!existing) return null;
    if (profileOwnerImageWriteBlocked(existing, slot)) {
      return null;
    }
    // A new generation is a different image; old flags must not travel with it.
    const next = withProfileImageState(
      { ...existing, updatedAt: new Date().toISOString() },
      slot,
      image
        ? {
            objectKey: image.objectKey,
            generation: image.generation,
            moderationState: image.moderationState,
          }
        : {},
    );
    memoryProfiles.set(key, next);
    return next;
  },

  async reportOwnedImage(handle, slot, reason, actorHash) {
    const key = normalizeHandle(handle);
    const actor = typeof actorHash === "string" ? actorHash.trim() : "";
    if (!key || !actor) return false;
    const existing = memoryProfiles.get(key);
    if (!existing) return false;
    const state = profileImageState(existing, slot);
    if (!state.objectKey || !state.generation || state.moderationState !== "approved") {
      return false;
    }
    const actors = state.reportActors ?? [];
    if (actors.includes(actor)) return true;
    const nextActors = [...actors, actor];
    const cleanedReason = cleanAvatarReportReason(reason);
    const next = withProfileImageState(
      { ...existing, updatedAt: new Date().toISOString() },
      slot,
      {
        ...state,
        reportActors: nextActors,
        reportCount: nextActors.length,
        reportedAt: new Date().toISOString(),
        moderatedAt: undefined,
        ...(cleanedReason ? { reportReason: cleanedReason } : {}),
      },
    );
    memoryProfiles.set(key, next);
    return true;
  },

  async moderateOwnedImage(handle, slot, action, note) {
    const key = normalizeHandle(handle);
    if (!key) return false;
    const existing = memoryProfiles.get(key);
    if (!existing) return false;
    const state = profileImageState(existing, slot);
    if (!state.objectKey || !state.generation || !state.moderationState) return false;
    if (state.moderationState !== "approved" && state.moderationState !== "hidden") {
      return false;
    }
    const cleanedNote = cleanAvatarReportReason(note);
    const next = withProfileImageState(
      { ...existing, updatedAt: new Date().toISOString() },
      slot,
      {
        ...state,
        moderationState: action === "hide" ? "hidden" : "approved",
        moderatedAt: new Date().toISOString(),
        ...(cleanedNote ? { moderatorNote: cleanedNote } : {}),
      },
    );
    memoryProfiles.set(key, next);
    return true;
  },

  async listReportedImages(slot, limit = IMAGE_REVIEW_LIMIT) {
    const bounded = Math.min(Math.max(limit, 1), IMAGE_REVIEW_LIMIT);
    return [...memoryProfiles.values()]
      .filter((profile) => isReportedImageQueueRow(profile, slot))
      .sort((a, b) => {
        const left = profileImageState(a, slot).reportedAt ?? a.updatedAt;
        const right = profileImageState(b, slot).reportedAt ?? b.updatedAt;
        return right.localeCompare(left);
      })
      .slice(0, bounded)
      .map((profile) => toModeratorImage(profile, slot))
      .filter((row): row is ModeratorProfileImage => row !== null);
  },

  async listHiddenImages(slot, limit = IMAGE_REVIEW_LIMIT) {
    const bounded = Math.min(Math.max(limit, 1), IMAGE_REVIEW_LIMIT);
    return [...memoryProfiles.values()]
      .filter((profile) => isHiddenImageQueueRow(profile, slot))
      .sort((a, b) => {
        const left = profileImageState(a, slot).moderatedAt ?? a.updatedAt;
        const right = profileImageState(b, slot).moderatedAt ?? b.updatedAt;
        return right.localeCompare(left);
      })
      .slice(0, bounded)
      .map((profile) => toModeratorImage(profile, slot))
      .filter((row): row is ModeratorProfileImage => row !== null);
  },

  async searchClaimedByHandlePrefix(prefix, limit = 8) {
    const key = normalizeHandle(prefix);
    if (!key || key.length < 2) return [];
    const bounded = Math.min(Math.max(limit, 1), 12);
    return [...memoryProfiles.values()]
      .filter(
        (profile) =>
          Boolean(profile.userId) &&
          !isProfileTombstoned(profile) &&
          profile.handle.startsWith(key),
      )
      .sort((a, b) => a.handle.localeCompare(b.handle))
      .slice(0, bounded);
  },

  async listClaimedProfiles(input = {}) {
    const bounded = Math.min(Math.max(input.limit ?? 24, 1), 48);
    const after = normalizeHandle(input.afterHandle ?? "");
    return [...memoryProfiles.values()]
      .filter(
        (profile) =>
          Boolean(profile.userId) &&
          !isProfileTombstoned(profile) &&
          (!after || profile.handle > after),
      )
      .sort((a, b) => a.handle.localeCompare(b.handle))
      .slice(0, bounded);
  },

  async listFoundingMembers() {
    return [...memoryProfiles.values()]
      .filter(
        (profile) =>
          profile.foundingMemberNumber !== undefined &&
          Boolean(profile.userId) &&
          !isProfileTombstoned(profile),
      )
      .sort((a, b) => (a.foundingMemberNumber ?? 0) - (b.foundingMemberNumber ?? 0))
      .slice(0, FOUNDING_MEMBER_CAP);
  },
};

/** The single backend selection point (mirrors commentsStore / roundsStore). */
export function profileStore(): ProfileStore {
  return selectStore(memoryProfileStore, supabaseProfileStore);
}

/** Test-only: clear the in-memory profile map between cases. */
export function __resetMemoryProfiles(): void {
  memoryProfiles.clear();
}

/** Test-only: model a pre-0071 unlinked row after the in-memory store resets. */
export function __seedMemoryLegacyProfile(handle: string): ProfileRecord {
  const key = normalizeHandle(handle);
  if (!key) throw new Error("A profile needs a non-empty handle.");
  const now = new Date().toISOString();
  const record: ProfileRecord = {
    id: memoryId(key),
    handle: key,
    createdAt: now,
    updatedAt: now,
  };
  memoryProfiles.set(key, record);
  return record;
}

/**
 * Test-only: model a production-linked row, including reserved contributor
 * handles. A claimed handle in production carries a founding number while the
 * cohort has room, so a seeded one does too - a seed that skipped the grant
 * would let a test pass on a profile shape production never produces.
 */
export function __seedMemoryOwnedProfile(handle: string, userId: string): ProfileRecord {
  const record = __seedMemoryLegacyProfile(handle);
  const key = normalizeHandle(handle);
  const founding = grantMemoryFoundingNumber();
  const owned: ProfileRecord = {
    ...record,
    userId,
    ...(founding === undefined ? {} : { foundingMemberNumber: founding }),
    updatedAt: new Date().toISOString(),
  };
  memoryProfiles.set(key, owned);
  return owned;
}

/**
 * Test-only: model auth.users deletion.
 * Trigger stamps tombstoned_at; FK then clears user_id. Row and handle stay
 * (attribution + reservation). Legacy null-user_id rows are NOT tombstones.
 * Avatar fields are nulled to mirror migration 0089's tombstone path.
 */
export function __tombstoneMemoryProfile(handle: string): ProfileRecord | null {
  const key = normalizeHandle(handle);
  if (!key) return null;
  const existing = memoryProfiles.get(key);
  if (!existing) return null;
  const now = new Date().toISOString();
  const cleared: ProfileRecord = {
    ...existing,
    userId: undefined,
    tombstonedAt: existing.tombstonedAt ?? now,
    avatarUrl: undefined,
    updatedAt: now,
  };
  const next = PROFILE_IMAGE_SLOTS.reduce<ProfileRecord>(
    (record, slot) => withProfileImageState(record, slot, {}),
    cleared,
  );
  memoryProfiles.set(key, next);
  return next;
}

/** Convenience wrappers used by the image report/admin routes and tests. */
export function reportProfileImage(
  handle: string,
  slot: ProfileImageSlot,
  reason: string | undefined,
  actorHash: string,
): Promise<boolean> {
  return profileStore().reportOwnedImage(handle, slot, reason, actorHash);
}

export function moderateProfileImage(
  handle: string,
  slot: ProfileImageSlot,
  action: "hide" | "restore",
  note?: string,
): Promise<boolean> {
  return profileStore().moderateOwnedImage(handle, slot, action, note);
}

export function listReportedProfileImages(
  slot: ProfileImageSlot,
  limit?: number,
): Promise<ModeratorProfileImage[]> {
  return profileStore().listReportedImages(slot, limit);
}

export function listHiddenProfileImages(
  slot: ProfileImageSlot,
  limit?: number,
): Promise<ModeratorProfileImage[]> {
  return profileStore().listHiddenImages(slot, limit);
}
