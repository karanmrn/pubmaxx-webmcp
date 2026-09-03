import "server-only";

// The pub photo wall store - the impure seam. ONE interface, TWO
// implementations (process-memory + Supabase `public.venue_photos`), chosen at
// the single `venuePhotoStore()` seam, exactly like visitReportsStore.
//
// THREE things this store owns that the route must not re-derive.
//
// 1. THE CAP. `countForAuthorAtVenue` is the only place the captain's hundred
//    is counted, and it counts the account's own LIVE rows for that venue.
//    Doing it in the route would mean a second copy of the rule the moment a
//    second writer appears.
//
// 2. THE AUTHOR PROJECTION. A wall prints a handle, a face and a brass mark,
//    and all three come off the ONE public profile projection
//    (`publicProfileFromRecord`), never a second field list. That is the
//    defect #981 fixed: a private copy of the list is what dropped a founding
//    member's number off an image write.
//
// 3. THE MODERATION FILTER. `approved` is the only state a public read returns,
//    so a hidden photo leaves the wall, the pages and the author's cap count
//    together. Hiding never deletes: the row, its bytes and its report trail
//    stay, so the decision is reversible from the surface that made it.

import {
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { isDrinkCategory } from "@/lib/drinks";
import {
  isProfileTombstoned,
  profileStore,
  publicProfileFromRecord,
} from "@/lib/profileStore";
import { requireSupabaseAdmin } from "@/lib/supabase";
import {
  byNewestVenuePhoto,
  cleanVenuePhotoCaption,
  isBeforeVenuePhotoCursor,
  parseVenuePhotoCursor,
  VENUE_PHOTO_CAP_PER_ACCOUNT,
  VENUE_PHOTO_PAGE_SIZE,
  VENUE_PHOTO_PAGE_SIZE_MAX,
  venuePhotoCursor,
  venuePhotoServePath,
  type VenuePhoto,
  type VenuePhotoAuthor,
  type VenuePhotoDTO,
  type VenuePhotoFields,
  type VenuePhotoModerationState,
  type VenuePhotoPage,
} from "@/lib/venuePhotos";

const TABLE = "venue_photos";
const MIGRATION_HINT = "apply migration 0098";

export type VenuePhotoWallQuery = {
  cursor?: string | null;
  limit?: number;
  /** The signed-in account, so a tile can say "yours". Never a body claim. */
  viewerProfileId?: string | null;
};

export type VenuePhotoStore = {
  /**
   * Persist an approved photo. THROWS on a hard storage failure so the route
   * answers 503 rather than telling a drinker their photo is on a wall it never
   * reached.
   */
  create(fields: VenuePhotoFields, now?: number): Promise<VenuePhoto>;
  /** Public wall page, newest first. Status separates empty from unread. */
  listForVenue(venueId: string, query?: VenuePhotoWallQuery): Promise<VenuePhotoPage>;
  /** How many live photos this account already has on this venue's wall. */
  countForAuthorAtVenue(authorProfileId: string, venueId: string): Promise<number>;
  getById(id: string): Promise<VenuePhoto | null>;
  /** Reader flag: per-actor deduped, queues for a human, never hides. */
  report(id: string, reason: string | undefined, actorHash: string): Promise<boolean>;
  /** Moderator decision. Hiding never deletes. */
  moderate(
    id: string,
    state: VenuePhotoModerationState,
    note?: string,
  ): Promise<boolean>;
  /** Moderator queue: flagged and undecided. Fail-soft. */
  listForReview(): Promise<VenuePhoto[]>;
  /** Moderator hidden lane, so a hide stays reversible. Fail-soft. */
  listHidden(): Promise<VenuePhoto[]>;
};

// ── Author projection ────────────────────────────────────────────────────────

/**
 * The three public things a wall tile says about who posted it, taken off the
 * ONE public profile projection. A tombstoned account leaves the wall with its
 * photos, so it never reaches here.
 */
async function authorsByProfileId(
  profileIds: readonly string[],
): Promise<Map<string, VenuePhotoAuthor>> {
  const unique = [...new Set(profileIds)];
  const store = profileStore();
  const entries = await Promise.all(
    unique.map(async (id) => {
      try {
        const record = await store.getById(id);
        if (!record || isProfileTombstoned(record)) return null;
        const profile = publicProfileFromRecord(record);
        if (!profile) return null;
        const author: VenuePhotoAuthor = {
          handle: profile.handle,
          ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
          ...(profile.foundingMemberNumber !== undefined
            ? { foundingMemberNumber: profile.foundingMemberNumber }
            : {}),
        };
        return [id, author] as const;
      } catch {
        return null;
      }
    }),
  );
  return new Map(entries.filter((entry): entry is [string, VenuePhotoAuthor] => entry !== null));
}

async function toPage(
  rows: VenuePhoto[],
  limit: number,
  viewerProfileId: string | null | undefined,
): Promise<VenuePhotoPage> {
  const window = rows.slice(0, limit);
  const authors = await authorsByProfileId(window.map((row) => row.authorProfileId));
  const photos: VenuePhotoDTO[] = [];
  for (const row of window) {
    const author = authors.get(row.authorProfileId);
    // A row whose author is gone is not shown. The tombstone path deletes both,
    // so this is the window between the two rather than a second policy.
    if (!author) continue;
    photos.push({
      id: row.id,
      venueId: row.venueId,
      url: venuePhotoServePath(row.venueId, row.id),
      drinkCategory: row.drinkCategory,
      caption: row.caption,
      width: row.width,
      height: row.height,
      createdAt: row.createdAt,
      author,
      ownedByViewer: Boolean(viewerProfileId) && row.authorProfileId === viewerProfileId,
    });
  }
  const last = window[window.length - 1];
  return {
    status: "ready",
    photos,
    nextCursor: rows.length > limit && last ? venuePhotoCursor(last) : null,
  };
}

function boundedLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit) || Number(limit) < 1) return VENUE_PHOTO_PAGE_SIZE;
  return Math.min(Number(limit), VENUE_PHOTO_PAGE_SIZE_MAX);
}

// ── In-memory implementation ─────────────────────────────────────────────────
// Resets on restart, which is right for dev, demo and test; production uses
// Supabase.
const byId = new Map<string, VenuePhoto>();

export const memoryVenuePhotoStore: VenuePhotoStore = {
  async create(fields, now = Date.now()) {
    const photo: VenuePhoto = {
      ...fields,
      moderationState: "approved",
      createdAt: new Date(now).toISOString(),
    };
    byId.set(photo.id, photo);
    return photo;
  },

  async listForVenue(venueId, query = {}) {
    const limit = boundedLimit(query.limit);
    const cursor = parseVenuePhotoCursor(query.cursor);
    const rows = [...byId.values()]
      .filter((row) => row.venueId === venueId && row.moderationState === "approved")
      .filter((row) => (cursor ? isBeforeVenuePhotoCursor(row, cursor) : true))
      .sort(byNewestVenuePhoto)
      .slice(0, limit + 1);
    return toPage(rows, limit, query.viewerProfileId);
  },

  async countForAuthorAtVenue(authorProfileId, venueId) {
    let count = 0;
    for (const row of byId.values()) {
      if (
        row.authorProfileId === authorProfileId &&
        row.venueId === venueId &&
        row.moderationState === "approved"
      ) {
        count += 1;
      }
    }
    return count;
  },

  async getById(id) {
    return byId.get(id) ?? null;
  },

  async report(id, reason, actorHash) {
    const hit = byId.get(id);
    if (!hit) return false;
    const actors = hit.reportActors ?? [];
    if (actors.includes(actorHash)) return true;
    const nextActors = [...actors, actorHash];
    hit.reportActors = nextActors;
    hit.reportCount = nextActors.length;
    hit.reportedAt = new Date().toISOString();
    if (reason) hit.reportReason = reason;
    // A flag AFTER a decision re-opens a still-visible row: a moderator who
    // kept a photo must still hear the next reader who objects. A hidden row
    // stays decided.
    if (hit.moderationState === "approved") hit.moderatedAt = undefined;
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
  tag: "venue-photos",
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

function admin() {
  return requireSupabaseAdmin();
}

function toRow(photo: VenuePhoto) {
  return {
    id: photo.id,
    venue_id: photo.venueId,
    author_actor: photo.authorActor,
    author_profile_id: photo.authorProfileId,
    object_key: photo.objectKey,
    drink_category: photo.drinkCategory,
    caption: photo.caption,
    width: photo.width,
    height: photo.height,
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

function fromRow(row: Record<string, unknown>): VenuePhoto {
  const actors = Array.isArray(row.report_actors)
    ? (row.report_actors as unknown[]).filter((a): a is string => typeof a === "string")
    : [];
  const state = row.moderation_state;
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    authorActor: String(row.author_actor),
    authorProfileId: String(row.author_profile_id),
    objectKey: String(row.object_key),
    // Re-coerce on the way out (defence in depth): a hand-edited row cannot
    // smuggle an off-taxonomy tag onto a public wall.
    drinkCategory: isDrinkCategory(row.drink_category) ? row.drink_category : null,
    caption: cleanVenuePhotoCaption(row.caption),
    width: Number(row.width) || 0,
    height: Number(row.height) || 0,
    moderationState:
      state === "hidden" ? "hidden" : state === "needs_review" ? "needs_review" : "approved",
    createdAt: String(row.created_at),
    reportCount: row.report_count == null ? undefined : Number(row.report_count),
    reportActors: actors.length ? actors : undefined,
    reportedAt: row.reported_at ? String(row.reported_at) : undefined,
    reportReason: row.report_reason ? String(row.report_reason) : undefined,
    moderatedAt: row.moderated_at ? String(row.moderated_at) : undefined,
    moderatorNote: row.moderator_note ? String(row.moderator_note) : undefined,
  };
}

export const supabaseVenuePhotoStore: VenuePhotoStore = {
  async create(fields, now = Date.now()) {
    const photo: VenuePhoto = {
      ...fields,
      moderationState: "approved",
      createdAt: new Date(now).toISOString(),
    };
    return guard<VenuePhoto>({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "venue-photos",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryVenuePhotoStore.create(fields, now),
        }),
      // No onError: a hard write failure THROWS so the route answers 503.
      run: async () => {
        const { error } = await admin().from(TABLE).insert(toRow(photo));
        if (error) throw new Error(error.message);
        return photo;
      },
    });
  },

  async listForVenue(venueId, query = {}) {
    const limit = boundedLimit(query.limit);
    const cursor = parseVenuePhotoCursor(query.cursor);
    return guard<VenuePhotoPage>({
      context: "listForVenue",
      onSchemaMiss: async () => ({
        ...(await memoryVenuePhotoStore.listForVenue(venueId, query)),
        status: "degraded",
      }),
      message: "listForVenue failed - returning no photos",
      onError: () => ({ status: "degraded", photos: [], nextCursor: null }),
      run: async () => {
        let request = admin()
          .from(TABLE)
          .select("*")
          .eq("venue_id", venueId)
          .eq("moderation_state", "approved")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit + 1);
        if (cursor) {
          // Keyset, not offset: a photo posted mid-scroll must not shift a page
          // boundary and repeat or skip a tile.
          request = request.or(
            `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
          );
        }
        const { data, error } = await request;
        if (error) throw new Error(error.message);
        return toPage(
          (data ?? []).map((row) => fromRow(row as Record<string, unknown>)),
          limit,
          query.viewerProfileId,
        );
      },
    });
  },

  async countForAuthorAtVenue(authorProfileId, venueId) {
    return guard<number>({
      context: "countForAuthorAtVenue",
      onSchemaMiss: () =>
        memoryVenuePhotoStore.countForAuthorAtVenue(authorProfileId, venueId),
      // No onError: a cap that cannot be counted must not read as room to spare.
      run: async () => {
        const { count, error } = await admin()
          .from(TABLE)
          .select("id", { count: "exact", head: true })
          .eq("author_profile_id", authorProfileId)
          .eq("venue_id", venueId)
          .eq("moderation_state", "approved");
        if (error) throw new Error(error.message);
        return typeof count === "number" && count > 0 ? count : 0;
      },
    });
  },

  async getById(id) {
    return guard<VenuePhoto | null>({
      context: "getById",
      onSchemaMiss: () => memoryVenuePhotoStore.getById(id),
      message: "getById failed",
      onError: () => null,
      run: async () => {
        const { data, error } = await admin().from(TABLE).select("*").eq("id", id).maybeSingle();
        if (error) throw new Error(error.message);
        return data ? fromRow(data as Record<string, unknown>) : null;
      },
    });
  },

  async report(id, reason, actorHash) {
    return guard<boolean>({
      context: "report",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "venue-photos",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryVenuePhotoStore.report(id, reason, actorHash),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("id, moderation_state, report_count, report_actors")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return false;
        const row = data as Record<string, unknown>;
        const actors = Array.isArray(row.report_actors)
          ? (row.report_actors as unknown[]).filter((a): a is string => typeof a === "string")
          : [];
        if (actors.includes(actorHash)) return true;
        const nextActors = [...actors, actorHash];
        const { error: updateError } = await admin()
          .from(TABLE)
          .update({
            report_actors: nextActors,
            report_count: nextActors.length,
            reported_at: new Date().toISOString(),
            ...(reason ? { report_reason: reason } : {}),
            ...(row.moderation_state === "approved" ? { moderated_at: null } : {}),
          })
          .eq("id", id);
        if (updateError) throw new Error(updateError.message);
        return true;
      },
    });
  },

  async moderate(id, state, note) {
    return guard<boolean>({
      context: "moderate",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "venue-photos",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryVenuePhotoStore.moderate(id, state, note),
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

  async listForReview() {
    return guard<VenuePhoto[]>({
      context: "listForReview",
      onSchemaMiss: () => memoryVenuePhotoStore.listForReview(),
      message: "listForReview failed - returning empty queue",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .gt("report_count", 0)
          .is("moderated_at", null)
          .order("reported_at", { ascending: false })
          .limit(200);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
      },
    });
  },

  async listHidden() {
    return guard<VenuePhoto[]>({
      context: "listHidden",
      onSchemaMiss: () => memoryVenuePhotoStore.listHidden(),
      message: "listHidden failed - returning empty lane",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("moderation_state", "hidden")
          .order("moderated_at", { ascending: false })
          .limit(200);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
      },
    });
  },
};

/** The single backend selection point (mirrors every other store). */
export function venuePhotoStore(): VenuePhotoStore {
  return selectStore(memoryVenuePhotoStore, supabaseVenuePhotoStore);
}

export const isVenuePhotoSchemaMiss = isSchemaMiss;

/** The captain's number, re-exported so a caller reads one constant. */
export { VENUE_PHOTO_CAP_PER_ACCOUNT };

/** Test-only: clear in-memory state + warn dedupe between cases. */
export function __resetVenuePhotos(): void {
  byId.clear();
  resetWarnings();
}
