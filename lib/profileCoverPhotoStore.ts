import "server-only";

// The rotating-cover store - the impure seam. ONE interface, TWO
// implementations (process-memory + Supabase `public.profile_cover_photos`),
// chosen at the single `profileCoverPhotoStore()` seam, exactly like
// `venuePhotoStore` beside it.
//
// THREE things this store owns that a route must not re-derive.
//
// 1. THE CAP. `countForProfile` is the only place the captain's five is
//    counted, and it counts every stored row because the schema gives each row
//    one of five unique positions. A profile-wide hide refuses new uploads.
//
// 2. THE ORDER. `listApproved` returns the rotation in `byCoverPosition` order
//    and `reorder` is the only write that changes it. Positions are rewritten
//    whole (bounded at five rows), so a move is one settled list rather than
//    two rows negotiating over one number.
//
// 3. COVER #1's BACK-COMPAT LANE. The single `profiles.cover_*` columns stay
//    the lane every surface that only knows `coverUrl` still reads, so this
//    store mirrors whichever row is currently at position 1 into them through
//    `setOwnedImage`. Nothing else writes those columns on this path, and the
//    mirror runs after EVERY change to the list - an add, a delete or a move -
//    because "the first cover" is a fact about the list rather than about the
//    write that happened to change it.

import { log } from "@/lib/log";
import {
  byCoverPosition,
  coverPositionsFor,
  isProfileCoverModerationState,
  nextCoverPosition,
  PROFILE_COVER_PHOTO_CAP,
  profileCoverCapLine,
  type ProfileCoverModerationState,
  type ProfileCoverPhoto,
  type ProfileCoverPhotoFields,
} from "@/lib/profileCovers";
import { profileImageServePath, profileImageServingKey } from "@/lib/profileImageSlots";
import {
  PROFILE_COVER_OWNER_WRITE_BLOCKED_LINE,
  profileOwnerImageWriteBlocked,
  profileStore,
} from "@/lib/profileStore";
import {
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const TABLE = "profile_cover_photos";
const MIGRATION_HINT = "apply migration 0100";
const REVIEW_LIMIT = 200;
const REPORT_ACTOR_APPEND_RPC = "append_profile_cover_photo_report_actor";

export class ProfileCoverUploadBlockedError extends Error {
  constructor() {
    super(PROFILE_COVER_OWNER_WRITE_BLOCKED_LINE);
    this.name = "ProfileCoverUploadBlockedError";
  }
}

export class ProfileCoverGuardUnavailableError extends Error {
  constructor() {
    super("Profile cover state is unavailable.");
    this.name = "ProfileCoverGuardUnavailableError";
  }
}

export class ProfileCoverCapReachedError extends Error {
  constructor() {
    super(profileCoverCapLine());
    this.name = "ProfileCoverCapReachedError";
  }
}

export type ProfileCoverPhotoStore = {
  /**
   * Persist an approved cover at the back of the rotation. THROWS on a hard
   * storage failure so the route answers 503 rather than telling an owner their
   * photo is on a card it never reached.
   */
  create(fields: ProfileCoverPhotoFields, now?: number): Promise<ProfileCoverPhoto>;
  /** The rotation, approved only, in the owner's order. */
  listApproved(profileId: string): Promise<ProfileCoverPhoto[]>;
  /** How many stored covers this profile already holds. */
  countForProfile(profileId: string): Promise<number>;
  getById(id: string): Promise<ProfileCoverPhoto | null>;
  /**
   * The serving key this profile may hand out for one generation, or null. The
   * serve route's second lane: a profile holds up to five covers and every one
   * of them is served by `/api/cover/[profileId]/[generation]`.
   */
  approvedObjectKey(profileId: string, generation: string): Promise<string | null>;
  /** Remove one cover. Returns the removed row so its bytes can be deleted. */
  remove(id: string, profileId: string): Promise<ProfileCoverPhoto | null>;
  /** Rewrite positions from an ordered id list. Ids not held are ignored. */
  reorder(profileId: string, orderedIds: readonly string[]): Promise<ProfileCoverPhoto[]>;
  /** Reader flag: per-actor deduped, queues for a human, never hides. */
  report(id: string, reason: string | undefined, actorHash: string): Promise<boolean>;
  /** Moderator decision. Hiding never deletes. */
  moderate(
    id: string,
    state: ProfileCoverModerationState,
    note?: string,
  ): Promise<boolean>;
  /**
   * The SAME moderator decision, applied to every cover this profile holds.
   * A hide on `profiles.cover_*` is a decision about this person's backdrop, and
   * the rotation carries up to five photographs the admin lane never named; the
   * two lanes must not disagree about whether a backdrop may be seen. Returns
   * how many rows moved.
   */
  moderateAllForProfile(
    profileId: string,
    state: ProfileCoverModerationState,
    note?: string,
  ): Promise<number>;
  /** Moderator queue: flagged and undecided. Throws when durable read fails. */
  listForReview(): Promise<ProfileCoverPhoto[]>;
  /** Moderator hidden lane, so a hide stays reversible. Throws when durable read fails. */
  listHidden(): Promise<ProfileCoverPhoto[]>;
};

/** Rotation-row shape for the moderator console. Storage keys and reporter
 * actors stay inside this store. `rotationOnly` lets the console distinguish a
 * per-photo row from the profile mirror queue. */
export type ModeratorProfileCover = {
  id: string;
  profileId: string;
  handle: string;
  position: number;
  generation: string;
  moderationState: ProfileCoverModerationState;
  reportCount: number;
  reportedAt?: string;
  reportReason?: string;
  moderatedAt?: string;
  moderatorNote?: string;
  previewUrl?: string;
  rotationOnly: boolean;
};

export function toModeratorProfileCover(
  photo: ProfileCoverPhoto,
  handle: string,
  rotationOnly: boolean,
): ModeratorProfileCover {
  return {
    id: photo.id,
    profileId: photo.profileId,
    handle,
    position: photo.position,
    generation: photo.generation,
    moderationState: photo.moderationState,
    reportCount: photo.reportCount ?? 0,
    ...(photo.reportedAt ? { reportedAt: photo.reportedAt } : {}),
    ...(photo.reportReason ? { reportReason: photo.reportReason } : {}),
    ...(photo.moderatedAt ? { moderatedAt: photo.moderatedAt } : {}),
    ...(photo.moderatorNote ? { moderatorNote: photo.moderatorNote } : {}),
    ...(photo.moderationState === "approved"
      ? { previewUrl: profileImageServePath("cover", photo.profileId, photo.generation) }
      : {}),
    rotationOnly,
  };
}

// ── Cover #1 mirror ──────────────────────────────────────────────────────────

/**
 * Put whichever cover now sits at position 1 into the single back-compat
 * columns, or clear them when the rotation is empty. Best-effort by design: the
 * list is the authority and a mirror that failed must not fail the write the
 * owner asked for. It says so once in the log instead, in the
 * `uploaded_image.scan_skipped` idiom.
 */
export async function mirrorFirstCoverOntoProfile(
  handle: string,
  covers: readonly ProfileCoverPhoto[],
): Promise<void> {
  const first = [...covers].sort(byCoverPosition)[0];
  try {
    await profileStore().setOwnedImage(
      handle,
      "cover",
      first
        ? {
            objectKey: first.objectKey,
            generation: first.generation,
            moderationState: "approved",
          }
        : null,
    );
  } catch (error) {
    log("warn", "profile_cover.mirror_skipped", {
      handle,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The rotation as a public read wants it: ordered serve paths, or UNDEFINED
 * when the list could not be read. Undefined is the honest answer there, and it
 * is why the field is optional on `PublicProfile`: the reader then falls back
 * to the single back-compat cover instead of being told this profile chose no
 * backdrop.
 */
export async function publicCoverUrls(
  profileId: string,
): Promise<string[] | undefined> {
  try {
    const covers = await profileCoverPhotoStore().listApproved(profileId);
    return covers.map((cover) =>
      profileImageServePath("cover", cover.profileId, cover.generation),
    );
  } catch (error) {
    log("warn", "profile_cover.public_read_failed", {
      profileId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function ownerCoverWriteState(
  profileId: string,
): Promise<"approved" | "hidden" | "unavailable"> {
  try {
    const profile = await profileStore().getById(profileId);
    return profile && profileOwnerImageWriteBlocked(profile, "cover")
      ? "hidden"
      : "approved";
  } catch {
    return "unavailable";
  }
}

// ── In-memory implementation ─────────────────────────────────────────────────
// Resets on restart, which is right for dev, demo and test; production uses
// Supabase.
const byId = new Map<string, ProfileCoverPhoto>();

function memoryRowsFor(profileId: string): ProfileCoverPhoto[] {
  return [...byId.values()].filter((row) => row.profileId === profileId);
}

export const memoryProfileCoverPhotoStore: ProfileCoverPhotoStore = {
  async create(fields, now = Date.now()) {
    const stateBefore = await ownerCoverWriteState(fields.profileId);
    if (stateBefore === "unavailable") {
      throw new ProfileCoverGuardUnavailableError();
    }
    if (stateBefore === "hidden") {
      throw new ProfileCoverUploadBlockedError();
    }
    const held = memoryRowsFor(fields.profileId);
    if (held.length >= PROFILE_COVER_PHOTO_CAP) {
      throw new ProfileCoverCapReachedError();
    }
    const photo: ProfileCoverPhoto = {
      ...fields,
      position: nextCoverPosition(held),
      moderationState: "approved",
      createdAt: new Date(now).toISOString(),
    };
    byId.set(photo.id, photo);
    const stateAfter = await ownerCoverWriteState(fields.profileId);
    if (stateAfter === "unavailable") {
      byId.delete(photo.id);
      throw new ProfileCoverGuardUnavailableError();
    }
    if (stateAfter === "hidden") {
      await this.moderateAllForProfile(fields.profileId, "hidden");
      byId.delete(photo.id);
      throw new ProfileCoverUploadBlockedError();
    }
    return photo;
  },

  async listApproved(profileId) {
    return memoryRowsFor(profileId)
      .filter((row) => row.moderationState === "approved")
      .sort(byCoverPosition);
  },

  async countForProfile(profileId) {
    return memoryRowsFor(profileId).length;
  },

  async getById(id) {
    return byId.get(id) ?? null;
  },

  async approvedObjectKey(profileId, generation) {
    for (const row of memoryRowsFor(profileId)) {
      if (row.generation !== generation) continue;
      if (row.moderationState !== "approved") return null;
      return row.objectKey === profileImageServingKey("cover", profileId, generation)
        ? row.objectKey
        : null;
    }
    return null;
  },

  async remove(id, profileId) {
    const hit = byId.get(id);
    if (!hit || hit.profileId !== profileId) return null;
    byId.delete(id);
    return hit;
  },

  async reorder(profileId, orderedIds) {
    const stateBefore = await ownerCoverWriteState(profileId);
    if (stateBefore === "unavailable") {
      throw new ProfileCoverGuardUnavailableError();
    }
    if (stateBefore === "hidden") {
      await this.moderateAllForProfile(profileId, "hidden");
      return [];
    }
    const held = memoryRowsFor(profileId).map((row) => ({
      id: row.id,
      position: row.position,
    }));
    for (const { id, position } of coverPositionsFor(orderedIds)) {
      const row = byId.get(id);
      if (row && row.profileId === profileId) row.position = position;
    }
    const stateAfter = await ownerCoverWriteState(profileId);
    if (stateAfter === "unavailable") {
      await this.moderateAllForProfile(profileId, "hidden");
      for (const { id, position } of held) {
        const row = byId.get(id);
        if (row && row.profileId === profileId) row.position = position;
      }
      throw new ProfileCoverGuardUnavailableError();
    }
    if (stateAfter === "hidden") {
      await this.moderateAllForProfile(profileId, "hidden");
      return [];
    }
    return this.listApproved(profileId);
  },

  async report(id, reason, actorHash) {
    const hit = byId.get(id);
    if (!hit || hit.moderationState !== "approved") return false;
    const actors = hit.reportActors ?? [];
    if (actors.includes(actorHash)) return true;
    const nextActors = [...actors, actorHash];
    hit.reportActors = nextActors;
    hit.reportCount = nextActors.length;
    hit.reportedAt = new Date().toISOString();
    if (reason) hit.reportReason = reason;
    // A flag AFTER a decision re-opens a still-visible row: a moderator who
    // kept a cover must still hear the next reader who objects.
    hit.moderatedAt = undefined;
    return true;
  },

  async moderate(id, state, note) {
    const hit = byId.get(id);
    if (!hit) return false;
    hit.moderationState = state;
    hit.moderatedAt = new Date().toISOString();
    if (note) hit.moderatorNote = note;
    return true;
  },

  async moderateAllForProfile(profileId, state, note) {
    const rows = memoryRowsFor(profileId);
    for (const row of rows) {
      row.moderationState = state;
      row.moderatedAt = new Date().toISOString();
      if (note) row.moderatorNote = note;
    }
    return rows.length;
  },

  async listForReview() {
    return [...byId.values()]
      .filter((row) => (row.reportCount ?? 0) > 0 && !row.moderatedAt)
      .sort((a, b) => (b.reportedAt ?? b.createdAt).localeCompare(a.reportedAt ?? a.createdAt));
  },

  async listHidden() {
    return [...byId.values()]
      .filter((row) => row.moderationState === "hidden")
      .sort((a, b) => (b.moderatedAt ?? b.createdAt).localeCompare(a.moderatedAt ?? a.createdAt));
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, isSchemaMiss, resetWarnings } = createFailSoftGuard({
  tag: "profile-cover-photos",
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

function admin() {
  return requireSupabaseAdmin();
}

/**
 * Owner reorder upserts positions only: never replay moderation fields, or a
 * reorder would put a moderator-hidden cover back on the rotation.
 */
function toReorderRow(photo: Pick<ProfileCoverPhoto, "id" | "profileId" | "position">) {
  return {
    id: photo.id,
    profile_id: photo.profileId,
    position: photo.position,
  };
}

function toRow(photo: ProfileCoverPhoto) {
  return {
    id: photo.id,
    profile_id: photo.profileId,
    position: photo.position,
    generation: photo.generation,
    object_key: photo.objectKey,
    moderation_state: photo.moderationState,
    report_count: photo.reportCount ?? 0,
    report_actors: photo.reportActors ?? [],
    reported_at: photo.reportedAt ?? null,
    report_reason: photo.reportReason ?? null,
    moderated_at: photo.moderatedAt ?? null,
    moderator_note: photo.moderatorNote ?? null,
    created_at: photo.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): ProfileCoverPhoto {
  const actors = Array.isArray(row.report_actors)
    ? (row.report_actors as unknown[]).filter((a): a is string => typeof a === "string")
    : [];
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    position: Number(row.position) || 1,
    generation: String(row.generation),
    objectKey: String(row.object_key),
    // Re-coerce on the way out: a hand-edited row cannot smuggle an off-set
    // state onto a public card.
    moderationState: isProfileCoverModerationState(row.moderation_state)
      ? row.moderation_state
      : "needs_review",
    createdAt: String(row.created_at),
    reportCount: row.report_count == null ? undefined : Number(row.report_count),
    reportActors: actors.length ? actors : undefined,
    reportedAt: row.reported_at ? String(row.reported_at) : undefined,
    reportReason: row.report_reason ? String(row.report_reason) : undefined,
    moderatedAt: row.moderated_at ? String(row.moderated_at) : undefined,
    moderatorNote: row.moderator_note ? String(row.moderator_note) : undefined,
  };
}

async function listStoredProfileCovers(
  profileId: string,
): Promise<ProfileCoverPhoto[]> {
  const { data, error } = await admin()
    .from(TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(PROFILE_COVER_PHOTO_CAP);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
}

export const supabaseProfileCoverPhotoStore: ProfileCoverPhotoStore = {
  async create(fields, now = Date.now()) {
    return guard<ProfileCoverPhoto>({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "profile-cover-photos",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryProfileCoverPhotoStore.create(fields, now),
        }),
      // No onError: a hard write failure THROWS so the route answers 503.
      run: async () => {
        const stateBefore = await ownerCoverWriteState(fields.profileId);
        if (stateBefore === "unavailable") {
          throw new ProfileCoverGuardUnavailableError();
        }
        if (stateBefore === "hidden") {
          throw new ProfileCoverUploadBlockedError();
        }
        const held = await listStoredProfileCovers(fields.profileId);
        if (held.length >= PROFILE_COVER_PHOTO_CAP) {
          throw new ProfileCoverCapReachedError();
        }
        const photo: ProfileCoverPhoto = {
          ...fields,
          position: nextCoverPosition(held),
          moderationState: "approved",
          createdAt: new Date(now).toISOString(),
        };
        const { error } = await admin().from(TABLE).insert(toRow(photo));
        if (error) throw new Error(error.message);
        const stateAfter = await ownerCoverWriteState(fields.profileId);
        if (stateAfter === "unavailable") {
          await supabaseProfileCoverPhotoStore.remove(photo.id, fields.profileId);
          throw new ProfileCoverGuardUnavailableError();
        }
        if (stateAfter === "hidden") {
          await supabaseProfileCoverPhotoStore.moderateAllForProfile(
            fields.profileId,
            "hidden",
          );
          await supabaseProfileCoverPhotoStore.remove(photo.id, fields.profileId);
          throw new ProfileCoverUploadBlockedError();
        }
        return photo;
      },
    });
  },

  async listApproved(profileId) {
    return guard<ProfileCoverPhoto[]>({
      context: "listApproved",
      onSchemaMiss: () => memoryProfileCoverPhotoStore.listApproved(profileId),
      // No onError: an unreadable rotation must not read as a profile with no
      // covers. The caller turns a throw into a `degraded` answer.
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("profile_id", profileId)
          .eq("moderation_state", "approved")
          .order("position", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(PROFILE_COVER_PHOTO_CAP);
        if (error) throw new Error(error.message);
        return (data ?? [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .sort(byCoverPosition);
      },
    });
  },

  async countForProfile(profileId) {
    return guard<number>({
      context: "countForProfile",
      onSchemaMiss: () => memoryProfileCoverPhotoStore.countForProfile(profileId),
      // No onError: a cap that cannot be counted must not read as room to spare.
      run: async () => {
        const { count, error } = await admin()
          .from(TABLE)
          .select("id", { count: "exact", head: true })
          .eq("profile_id", profileId);
        if (error) throw new Error(error.message);
        return typeof count === "number" && count > 0 ? count : 0;
      },
    });
  },

  async getById(id) {
    return guard<ProfileCoverPhoto | null>({
      context: "getById",
      onSchemaMiss: () => memoryProfileCoverPhotoStore.getById(id),
      message: "getById failed",
      onError: () => null,
      run: async () => {
        const { data, error } = await admin().from(TABLE).select("*").eq("id", id).maybeSingle();
        if (error) throw new Error(error.message);
        return data ? fromRow(data as Record<string, unknown>) : null;
      },
    });
  },

  async approvedObjectKey(profileId, generation) {
    return guard<string | null>({
      context: "approvedObjectKey",
      onSchemaMiss: () =>
        memoryProfileCoverPhotoStore.approvedObjectKey(profileId, generation),
      message: "approvedObjectKey failed",
      onError: () => null,
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("object_key, moderation_state")
          .eq("profile_id", profileId)
          .eq("generation", generation)
          .eq("moderation_state", "approved")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const objectKey = String((data as Record<string, unknown>).object_key ?? "");
        return objectKey === profileImageServingKey("cover", profileId, generation)
          ? objectKey
          : null;
      },
    });
  },

  async remove(id, profileId) {
    return guard<ProfileCoverPhoto | null>({
      context: "remove",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "profile-cover-photos",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryProfileCoverPhotoStore.remove(id, profileId),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .delete()
          .eq("id", id)
          .eq("profile_id", profileId)
          .select("*");
        if (error) throw new Error(error.message);
        const row = (data ?? [])[0];
        return row ? fromRow(row as Record<string, unknown>) : null;
      },
    });
  },

  async reorder(profileId, orderedIds) {
    return guard<ProfileCoverPhoto[]>({
      context: "reorder",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "profile-cover-photos",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryProfileCoverPhotoStore.reorder(profileId, orderedIds),
        }),
      run: async () => {
        const held = await supabaseProfileCoverPhotoStore.listApproved(profileId);
        const stateBefore = await ownerCoverWriteState(profileId);
        if (stateBefore === "unavailable") {
          throw new ProfileCoverGuardUnavailableError();
        }
        if (stateBefore === "hidden") {
          await supabaseProfileCoverPhotoStore.moderateAllForProfile(
            profileId,
            "hidden",
          );
          return [];
        }
        const byRowId = new Map(held.map((row) => [row.id, row]));
        // ONE statement, so the deferred (profile_id, position) uniqueness is
        // checked at commit rather than half way through a swap.
        const rows = coverPositionsFor(orderedIds)
          .map(({ id, position }) => {
            const row = byRowId.get(id);
            return row ? toReorderRow({ id: row.id, profileId: row.profileId, position }) : null;
          })
          .filter((row): row is ReturnType<typeof toReorderRow> => row !== null);
        if (rows.length === 0) return held;
        const { error } = await admin().from(TABLE).upsert(rows, { onConflict: "id" });
        if (error) throw new Error(error.message);
        const stateAfter = await ownerCoverWriteState(profileId);
        if (stateAfter === "unavailable") {
          await supabaseProfileCoverPhotoStore.moderateAllForProfile(
            profileId,
            "hidden",
          );
          throw new ProfileCoverGuardUnavailableError();
        }
        if (stateAfter === "hidden") {
          await supabaseProfileCoverPhotoStore.moderateAllForProfile(
            profileId,
            "hidden",
          );
          return [];
        }
        return supabaseProfileCoverPhotoStore.listApproved(profileId);
      },
    });
  },

  async report(id, reason, actorHash) {
    return guard<boolean>({
      context: "report",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "profile-cover-photos",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryProfileCoverPhotoStore.report(id, reason, actorHash),
        }),
      run: async () => {
        const { data, error } = await admin().rpc(REPORT_ACTOR_APPEND_RPC, {
          p_id: id,
          p_actor: actorHash,
          p_reason: reason ?? null,
        });
        if (error) throw new Error(error.message);
        return data === true;
      },
    });
  },

  async moderate(id, state, note) {
    return guard<boolean>({
      context: "moderate",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "profile-cover-photos",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryProfileCoverPhotoStore.moderate(id, state, note),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({
            moderation_state: state,
            moderated_at: new Date().toISOString(),
            ...(note ? { moderator_note: note } : {}),
          })
          .eq("id", id)
          .select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
    });
  },

  async moderateAllForProfile(profileId, state, note) {
    return guard<number>({
      context: "moderateAllForProfile",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "profile-cover-photos",
          migrationHint: MIGRATION_HINT,
          fallback: () =>
            memoryProfileCoverPhotoStore.moderateAllForProfile(profileId, state, note),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({
            moderation_state: state,
            moderated_at: new Date().toISOString(),
            ...(note ? { moderator_note: note } : {}),
          })
          .eq("profile_id", profileId)
          .select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length;
      },
    });
  },

  async listForReview() {
    return guard<ProfileCoverPhoto[]>({
      context: "listForReview",
      onSchemaMiss: () => memoryProfileCoverPhotoStore.listForReview(),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .gt("report_count", 0)
          .is("moderated_at", null)
          .order("reported_at", { ascending: false })
          .limit(REVIEW_LIMIT);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
      },
    });
  },

  async listHidden() {
    return guard<ProfileCoverPhoto[]>({
      context: "listHidden",
      onSchemaMiss: () => memoryProfileCoverPhotoStore.listHidden(),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("moderation_state", "hidden")
          .order("moderated_at", { ascending: false })
          .limit(REVIEW_LIMIT);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
      },
    });
  },
};

/** The single backend selection point (mirrors every other store). */
export function profileCoverPhotoStore(): ProfileCoverPhotoStore {
  return selectStore(memoryProfileCoverPhotoStore, supabaseProfileCoverPhotoStore);
}

/** Durable profile-mirror and rotation moderation in one PostgreSQL transaction. */
export async function moderateDurableProfileCoverAcrossStores(
  handle: string,
  state: ProfileCoverModerationState,
  note?: string,
): Promise<boolean | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await admin().rpc("moderate_profile_cover_across_stores", {
    p_handle: handle,
    p_state: state,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export const isProfileCoverPhotoSchemaMiss = isSchemaMiss;

/** The captain's number, re-exported so a caller reads one constant. */
export { PROFILE_COVER_PHOTO_CAP };

/** Test-only: clear in-memory state + warn dedupe between cases. */
export function __resetProfileCoverPhotos(): void {
  byId.clear();
  resetWarnings();
}
