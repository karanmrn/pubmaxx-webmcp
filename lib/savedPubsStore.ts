import "server-only";

// Durable saved-pub LISTS (cc_plan2 §5). ONE store interface, TWO implementations
// (process-memory + Supabase public.saved_pubs), same seam pattern as the other
// stores (reactions/comments/profiles): Supabase when env keys exist,
// process-memory otherwise. Every handler talks to the interface via
// savedPubsStore() so the backend is chosen in exactly one place.
//
// KEYING — the applied saved_pubs schema (migration 0006) has NO actor_hash
// column: it keys saves by `profile_id` (a FK to public.profiles) with a unique
// index on (profile_id, venue_id, list_type). Identity is still the self-asserted
// `handle` (no auth yet), so a handle's saves are made retrievable by bootstrapping
// a profile row for that handle (profileStore.ensure → profile_id) exactly the way
// the follow graph resolves a handle to a profile id. The `actorHash` a caller may
// pass is accepted for parity with the reactions/comments actor model and used as
// the memory-store partition key, but the durable path keys strictly by the
// handle's profile id — no invented columns.
//
// A DTO carries the resolved venue NAME + "open on the map" url (via lib/venueIndex,
// SERVER-side) so the profile never renders a raw "venue-…" id. Every method is
// FAIL-SOFT: a store error yields an empty list / an unchanged toggle rather than
// throwing to the caller, so a saved-pubs outage can never break the profile page.

import { normalizeHandle } from "@/lib/profiles";
import { isBuiltInListType } from "@/lib/savedListPolicy";
import { supabaseProfileStore, type ProfileStore } from "@/lib/profileStore";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { cleanText } from "@/lib/textClean";
import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";

// The list a pub is filed under is now free text (story 33): the seven built-ins
// are the SUGGESTED defaults, but a handle can create its own named lists too.
// `ListType` stays `string` so custom names round-trip; the seven live on as the
// UI's default suggestions + the seed for a handle with no custom lists yet.
export type ListType = string;

// A custom list name is untrusted free text: strip inline HTML / control chars,
// collapse whitespace, cap length. Mirrors cleanNote's trust boundary.
const MAX_LIST_NAME = 60;

/** Clean + validate an untrusted list type/name. Returns "" for anything that
 *  cleans down to empty (rejected by the route, never stored). This is the write
 *  gate now: any non-empty cleaned string — built-in OR custom — is a valid list. */
export function cleanListType(value: unknown): string {
  return cleanText(value, MAX_LIST_NAME);
}

/** Server trust boundary: is `value` a storable list type (built-in or custom)?
 *  True for any value that cleans to a non-empty name. */
export function isListType(value: unknown): value is ListType {
  return cleanListType(value).length > 0;
}

// Cap the note like every other free-text field (mirrors lib/pintDrops clean()).
const MAX_NOTE = 280;

/** Strip inline HTML / control chars, collapse whitespace, cap length. Returns ""
 *  for a non-string or empty note. Delegates to the shared cleanText so the note
 *  trust boundary matches every other write path. */
export function cleanNote(value: unknown): string {
  return cleanText(value, MAX_NOTE);
}

// The public shape the profile renders. Carries the resolved venue NAME + map url
// so no consumer ever needs the raw id as a label. `venueName` falls back to a
// friendly string for an id the dataset no longer carries — never the raw id.
export type SavedPubDTO = {
  venueId: string;
  venueName: string;
  venueMapUrl: string;
  listType: ListType;
  note?: string;
  savedAt: string;
};

// The write payload for a toggle. `handle` is the identity; `actorHash` is the
// optional device-parity key (used only by the memory partition). `venueId` +
// `listType` are the uniqueness key.
export type SaveInput = {
  handle: string;
  actorHash?: string;
  venueId: string;
  listType: ListType;
  note?: string;
};

export type EnsureSavedInput = {
  /** Verified profile UUID. Durable promotion must not trust a body handle. */
  profileId: string;
  /** Current canonical handle, used by the memory backend and DTO reads. */
  handle: string;
  venueId: string;
  listType: ListType;
};

export type EnsureSavedResult = {
  outcome: "saved" | "already_saved" | "unavailable";
};

// A saved row as the store holds it, before DTO enrichment.
type SavedRow = {
  venueId: string;
  listType: ListType;
  note?: string;
  savedAt: string;
};

export type SavedPubsRead =
  | { status: "ready"; rows: SavedPubDTO[] }
  | { status: "unavailable" };

export type SavedPubsStore = {
  /** All of a handle's saves, newest-first, as enriched DTOs. Never throws. */
  listSaved(input: { handle?: string; actorHash?: string }): Promise<SavedPubDTO[]>;
  /**
   * Read several public handle partitions in one bounded store operation.
   * Missing handles are ready empty reads. A shared backend failure marks every
   * requested handle unavailable so discovery cannot turn an outage into an
   * empty public market.
   */
  readSavedByHandles(input: {
    handles: readonly string[];
  }): Promise<ReadonlyMap<string, SavedPubsRead>>;
  /**
   * Same read as listSaved, but a store outage names itself. Profile pages still
   * use listSaved (fail-soft to []). Discovery must not treat that as no lists.
   */
  readSaved(input: { handle?: string; actorHash?: string }): Promise<SavedPubsRead>;
  /** Toggle a save (insert-or-delete on (owner, venue, list)); returns the fresh
   *  full list as DTOs. Never throws — a store error yields the current list. */
  toggleSaved(input: SaveInput): Promise<SavedPubDTO[]>;
  /** Atomically add a public save without toggle semantics. */
  ensureSaved(input: EnsureSavedInput): Promise<EnsureSavedResult>;
};

// ── DTO enrichment (server-side venue-name resolution) ───────────────────────
// Fold raw rows into DTOs, resolving each venue id to its real pub name + map url
// through the bundled index. An id the dataset no longer carries falls back to a
// friendly label — never the raw "venue-…" id. Newest save first.
function dtoFromRow(row: SavedRow, index: Awaited<ReturnType<typeof getVenueIndex>>): SavedPubDTO {
  return {
    venueId: row.venueId,
    venueName: index.get(row.venueId)?.name ?? "A London venue",
    venueMapUrl: venueMapUrl(row.venueId),
    listType: row.listType,
    ...(row.note ? { note: row.note } : {}),
    savedAt: row.savedAt,
  };
}

function enrichRows(
  rows: SavedRow[],
  index: Awaited<ReturnType<typeof getVenueIndex>>,
): SavedPubDTO[] {
  return rows
    .map((row) => dtoFromRow(row, index))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

async function enrich(rows: SavedRow[]): Promise<SavedPubDTO[]> {
  const index = await getVenueIndex();
  return enrichRows(rows, index);
}

// ── Supabase implementation ──────────────────────────────────────────────────
const TABLE = "saved_pubs";
const PROFILE_TABLE = "profiles";

function normalizedHandleKeys(handles: readonly string[]): string[] {
  return [...new Set(handles.map((handle) => normalizeHandle(handle)).filter(Boolean))];
}

function readyBatch(handles: readonly string[]): Map<string, SavedPubsRead> {
  return new Map(normalizedHandleKeys(handles).map((handle) => [
    handle,
    { status: "ready", rows: [] },
  ]));
}

function unavailableBatch(handles: readonly string[]): Map<string, SavedPubsRead> {
  return new Map(normalizedHandleKeys(handles).map((handle) => [
    handle,
    { status: "unavailable" },
  ]));
}

function admin() {
  return requireSupabaseAdmin();
}

// Resolve a handle to its profile id, bootstrapping a row on first save (mirrors
// how the follow graph resolves a handle → profile). Reads never create — only a
// toggle bootstraps, so a read for a handle that has saved nothing is a cheap miss.
async function profileIdForHandle(
  profiles: ProfileStore,
  handle: string,
  create: boolean,
): Promise<string | null> {
  const key = normalizeHandle(handle);
  if (!key) return null;
  if (create) return (await profiles.ensure(key)).id;
  const row = await profiles.getByHandle(key);
  return row?.id ?? null;
}

function rowFrom(raw: Record<string, unknown>): SavedRow | null {
  const venueId = typeof raw.venue_id === "string" ? raw.venue_id : "";
  const listType = raw.list_type;
  if (!venueId || !isListType(listType)) return null;
  return {
    venueId,
    listType,
    note: typeof raw.note === "string" && raw.note ? raw.note : undefined,
    savedAt: typeof raw.created_at === "string" ? raw.created_at : new Date(0).toISOString(),
  };
}

export const supabaseSavedPubsStore: SavedPubsStore = {
  async readSavedByHandles({ handles }) {
    const keys = normalizedHandleKeys(handles);
    if (keys.length === 0) return new Map();

    try {
      // Resolve active, claimed owners in one query. This keeps the public
      // discovery seam from exposing saves belonging to unclaimed or departed
      // profiles, even though the service role bypasses RLS.
      const { data: profiles, error: profileError } = await admin()
        .from(PROFILE_TABLE)
        .select("id, handle")
        .in("handle", keys)
        .not("user_id", "is", null)
        .is("tombstoned_at", null);
      if (profileError) throw new Error(profileError.message);

      const handleByProfileId = new Map<string, string>();
      for (const raw of profiles ?? []) {
        const row = raw as { id?: unknown; handle?: unknown };
        const id = typeof row.id === "string" ? row.id : "";
        const handle = typeof row.handle === "string" ? normalizeHandle(row.handle) : "";
        if (id && handle) handleByProfileId.set(id, handle);
      }

      const result = readyBatch(keys);
      const profileIds = [...handleByProfileId.keys()];
      if (profileIds.length === 0) return result;

      const { data, error } = await admin()
        .from(TABLE)
        .select("profile_id, venue_id, list_type, note, created_at")
        .in("profile_id", profileIds)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);

      const rowsByHandle = new Map<string, SavedRow[]>();
      for (const raw of data ?? []) {
        const record = raw as Record<string, unknown>;
        const profileId = typeof record.profile_id === "string" ? record.profile_id : "";
        const handle = handleByProfileId.get(profileId);
        const row = rowFrom(record);
        if (!handle || !row) continue;
        const rows = rowsByHandle.get(handle) ?? [];
        rows.push(row);
        rowsByHandle.set(handle, rows);
      }

      const index = await getVenueIndex();
      for (const handle of keys) {
        result.set(handle, {
          status: "ready",
          rows: enrichRows(rowsByHandle.get(handle) ?? [], index),
        });
      }
      return result;
    } catch {
      return unavailableBatch(keys);
    }
  },

  async readSaved({ handle }) {
    try {
      const profileId = await profileIdForHandle(supabaseProfileStore, handle ?? "", false);
      if (!profileId) return { status: "ready", rows: [] };
      const { data, error } = await admin()
        .from(TABLE)
        .select("venue_id, list_type, note, created_at")
        .eq("profile_id", profileId);
      if (error) throw new Error(error.message);
      const rows = (data ?? [])
        .map((r) => rowFrom(r as Record<string, unknown>))
        .filter((r): r is SavedRow => r !== null);
      return { status: "ready", rows: await enrich(rows) };
    } catch {
      return { status: "unavailable" };
    }
  },

  async listSaved(input) {
    const read = await this.readSaved(input);
    return read.status === "ready" ? read.rows : [];
  },

  async toggleSaved(input) {
    const listType = cleanListType(input.listType);
    const venueId = input.venueId;
    try {
      const profileId = await profileIdForHandle(supabaseProfileStore, input.handle, true);
      if (!profileId || !venueId || !listType) {
        return this.listSaved({ handle: input.handle });
      }

      // Is (profile, venue, list) already saved? A select decides insert vs delete.
      const { data: existing, error: readError } = await admin()
        .from(TABLE)
        .select("id")
        .eq("profile_id", profileId)
        .eq("venue_id", venueId)
        .eq("list_type", listType)
        .limit(1);
      if (readError) throw new Error(readError.message);

      if ((existing ?? []).length > 0) {
        const { error } = await admin()
          .from(TABLE)
          .delete()
          .eq("profile_id", profileId)
          .eq("venue_id", venueId)
          .eq("list_type", listType);
        if (error) throw new Error(error.message);
      } else {
        const note = cleanNote(input.note);
        const { error } = await admin().from(TABLE).insert({
          profile_id: profileId,
          venue_id: venueId,
          list_type: listType,
          note: note || null,
        });
        if (error) throw new Error(error.message);
      }

      return this.listSaved({ handle: input.handle });
    } catch {
      // A write failure is non-critical — return the current list unchanged so the
      // client can keep its localStorage fallback in play.
      return this.listSaved({ handle: input.handle });
    }
  },

  async ensureSaved(input) {
    const listType = cleanListType(input.listType);
    const venueId = input.venueId;
    const profileId = input.profileId.trim();
    if (!profileId || !normalizeHandle(input.handle) || !venueId || !listType) {
      return { outcome: "unavailable" };
    }
    try {
      const { data, error } = await admin()
        .from(TABLE)
        .upsert(
          {
            profile_id: profileId,
            venue_id: venueId,
            list_type: listType,
            note: null,
          },
          {
            onConflict: "profile_id,venue_id,list_type",
            ignoreDuplicates: true,
          },
        )
        .select("id");
      if (error) throw new Error(error.message);
      return { outcome: (data ?? []).length > 0 ? "saved" : "already_saved" };
    } catch {
      return { outcome: "unavailable" };
    }
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Rows partitioned by an owner key derived from the handle (falling back to the
// actorHash), then keyed within a partition by (venueId, listType) so uniqueness
// matches the durable unique index. Resets on restart — right for dev/demo/test.
const memoryRows = new Map<string, Map<string, SavedRow>>();

// The partition key: a handle when present (identity), else the actorHash (device
// parity), else a shared "anon" bucket. Mirrors the durable "one owner = one
// profile" partitioning without a real profile id in memory.
function ownerKey(handle?: string, actorHash?: string): string {
  const h = normalizeHandle(handle ?? "");
  if (h) return `h:${h}`;
  if (actorHash && actorHash.trim()) return `a:${actorHash.trim()}`;
  return "anon";
}

function rowKey(venueId: string, listType: string): string {
  return `${venueId} ${listType}`;
}

export const memorySavedPubsStore: SavedPubsStore = {
  async readSavedByHandles({ handles }) {
    const keys = normalizedHandleKeys(handles);
    if (keys.length === 0) return new Map();
    const index = await getVenueIndex();
    const result = readyBatch(keys);
    for (const handle of keys) {
      const partition = memoryRows.get(ownerKey(handle));
      result.set(handle, {
        status: "ready",
        rows: enrichRows(partition ? [...partition.values()] : [], index),
      });
    }
    return result;
  },

  async readSaved({ handle, actorHash }) {
    const partition = memoryRows.get(ownerKey(handle, actorHash));
    return {
      status: "ready",
      rows: await enrich(partition ? [...partition.values()] : []),
    };
  },

  async listSaved(input) {
    const read = await this.readSaved(input);
    return read.status === "ready" ? read.rows : [];
  },

  async toggleSaved(input) {
    const owner = ownerKey(input.handle, input.actorHash);
    const listType = cleanListType(input.listType);
    if (!input.venueId || !listType) {
      return this.listSaved({ handle: input.handle, actorHash: input.actorHash });
    }
    const partition = memoryRows.get(owner) ?? new Map<string, SavedRow>();
    const key = rowKey(input.venueId, listType);
    if (partition.has(key)) {
      partition.delete(key);
    } else {
      const note = cleanNote(input.note);
      partition.set(key, {
        venueId: input.venueId,
        listType,
        ...(note ? { note } : {}),
        savedAt: new Date().toISOString(),
      });
    }
    memoryRows.set(owner, partition);
    return this.listSaved({ handle: input.handle, actorHash: input.actorHash });
  },

  async ensureSaved(input) {
    const owner = ownerKey(input.handle);
    const listType = cleanListType(input.listType);
    if (!input.profileId.trim() || !normalizeHandle(input.handle) || !input.venueId || !listType) {
      return { outcome: "unavailable" };
    }
    const partition = memoryRows.get(owner) ?? new Map<string, SavedRow>();
    const key = rowKey(input.venueId, listType);
    if (partition.has(key)) return { outcome: "already_saved" };
    partition.set(key, {
      venueId: input.venueId,
      listType,
      savedAt: new Date().toISOString(),
    });
    memoryRows.set(owner, partition);
    return { outcome: "saved" };
  },
};

// The single seam: Supabase when configured, process-memory otherwise. Note the
// memory store uses the in-memory profile store implicitly (no profile id needed),
// so dev/demo/test never touch the network.
export function savedPubsStore(): SavedPubsStore {
  return isSupabaseConfigured() ? supabaseSavedPubsStore : memorySavedPubsStore;
}

/** Test-only: clear the in-memory saved-pub partitions between cases. */
export function __resetMemorySavedPubs(): void {
  memoryRows.clear();
}

// ── Custom lists registry (story 33) ─────────────────────────────────────────
// Custom names can exist before they have saves, so the picker can offer them.
// Every method is fail-soft: an outage leaves the built-in picker usable.

const LISTS_TABLE = "saved_lists";

export type SavedListsStore = {
  /** A handle's custom list names (built-ins excluded), newest-first. Never throws. */
  listCustom(handle: string): Promise<string[]>;
  /** Register a custom list name for a handle (idempotent). Returns the fresh
   *  custom-list array. A name colliding with a built-in is a no-op (it already
   *  exists as a default). Never throws. */
  createList(handle: string, name: string): Promise<string[]>;
};

export const supabaseSavedListsStore: SavedListsStore = {
  async listCustom(handle) {
    try {
      const profileId = await profileIdForHandle(supabaseProfileStore, handle, false);
      if (!profileId) return [];
      const { data, error } = await admin()
        .from(LISTS_TABLE)
        .select("name, created_at")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((r) => String((r as { name?: unknown }).name ?? ""))
        .filter((name) => name && !isBuiltInListType(name));
    } catch {
      return [];
    }
  },

  async createList(handle, name) {
    const clean = cleanListType(name);
    // A built-in name needs no registry row — it's always offered. Blank → no-op.
    if (!clean || isBuiltInListType(clean)) return this.listCustom(handle);
    try {
      const profileId = await profileIdForHandle(supabaseProfileStore, handle, true);
      if (!profileId) return this.listCustom(handle);
      const { error } = await admin()
        .from(LISTS_TABLE)
        .insert({ profile_id: profileId, name: clean });
      // A duplicate (23505) means the list already exists — idempotent success.
      if (error && error.code !== "23505") throw new Error(error.message);
    } catch {
      // Fail-soft — the caller keeps whatever list menu it already had.
    }
    return this.listCustom(handle);
  },
};

// In-memory: Map<ownerHandle, Set<listName>>, resets on restart.
const memoryLists = new Map<string, Set<string>>();

export const memorySavedListsStore: SavedListsStore = {
  async listCustom(handle) {
    const key = normalizeHandle(handle);
    if (!key) return [];
    return [...(memoryLists.get(key) ?? new Set())]
      .filter((name) => !isBuiltInListType(name))
      .reverse();
  },

  async createList(handle, name) {
    const key = normalizeHandle(handle);
    const clean = cleanListType(name);
    if (key && clean && !isBuiltInListType(clean)) {
      const set = memoryLists.get(key) ?? new Set<string>();
      set.add(clean);
      memoryLists.set(key, set);
    }
    return this.listCustom(handle);
  },
};

export function savedListsStore(): SavedListsStore {
  return isSupabaseConfigured() ? supabaseSavedListsStore : memorySavedListsStore;
}

/** Test-only: clear the in-memory custom-list registry between cases. */
export function __resetMemorySavedLists(): void {
  memoryLists.clear();
}

// ── Followable saved lists (IDEAS B3) ───────────────────────────────────────
// A list follow is "viewer handle follows owner handle's named saved-pub list".
// This deliberately follows the same temporary identity ceiling as profiles,
// follows, crawl authorship, and saved pubs: handles are self-asserted until
// full Supabase Auth ownership is enabled. The public read shape therefore
// exposes only authored public content: owner handle, profile/list links, and
// aggregate counts. Internal profile ids never leave the store.

const LIST_FOLLOWS_TABLE = "saved_list_follows";

export type SavedListFollowCounts = {
  followers: number | null;
  savedPubs: number;
};

export type FollowedSavedListDTO = {
  ownerHandle: string;
  ownerProfileUrl: string;
  listType: ListType;
  listUrl: string;
  savedCount: number;
  followerCount: number;
  followedAt: string;
};

export type SavedListFollowsStore = {
  /** Follow another handle's named list (idempotent). False for invalid/self follows. */
  followList(followerHandle: string, ownerHandle: string, listType: ListType): Promise<boolean>;
  /** Remove a followed-list edge (idempotent). */
  unfollowList(followerHandle: string, ownerHandle: string, listType: ListType): Promise<boolean>;
  /** Does follower currently follow ownerHandle's named list? */
  isFollowingList(
    followerHandle: string,
    ownerHandle: string,
    listType: ListType,
  ): Promise<boolean>;
  /** Public aggregate counts for one authored list. Reads are fail-soft. */
  counts(ownerHandle: string, listType: ListType): Promise<SavedListFollowCounts>;
  /** Lists followed by a handle, with author attribution and counts. Reads are fail-soft. */
  listFollowedBy(followerHandle: string): Promise<FollowedSavedListDTO[]>;
};

function listFollowKey(followerHandle: string, ownerHandle: string, listType: string): string {
  return `${followerHandle}>${ownerHandle}>${listType}`;
}

function isSelfListFollow(followerHandle: string, ownerHandle: string): boolean {
  const follower = normalizeHandle(followerHandle);
  const owner = normalizeHandle(ownerHandle);
  return follower !== "" && follower === owner;
}

function listUrl(ownerHandle: string, listType: string): string {
  return `/u/${encodeURIComponent(ownerHandle)}/lists/${encodeURIComponent(listType)}`;
}

function listSummary(
  ownerHandle: string,
  listType: string,
  savedCount: number,
  followerCount: number,
  followedAt: string,
): FollowedSavedListDTO {
  return {
    ownerHandle,
    ownerProfileUrl: `/u/${encodeURIComponent(ownerHandle)}`,
    listType,
    listUrl: listUrl(ownerHandle, listType),
    savedCount,
    followerCount,
    followedAt,
  };
}

function uniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

async function supabaseSavedCount(profileId: string, listType: string): Promise<number> {
  const res = await admin()
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("list_type", listType);
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

async function supabaseFollowerCount(profileId: string, listType: string): Promise<number> {
  const res = await admin()
    .from(LIST_FOLLOWS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("list_owner_profile_id", profileId)
    .eq("list_name", listType);
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

export const supabaseSavedListFollowsStore: SavedListFollowsStore = {
  async followList(followerHandle, ownerHandle, rawListType) {
    const follower = normalizeHandle(followerHandle);
    const owner = normalizeHandle(ownerHandle);
    const listType = cleanListType(rawListType);
    if (!follower || !owner || !listType || isSelfListFollow(follower, owner)) return false;

    const followerId = await profileIdForHandle(supabaseProfileStore, follower, true);
    const ownerId = await profileIdForHandle(supabaseProfileStore, owner, true);
    if (!followerId || !ownerId) return false;

    const { error } = await admin().from(LIST_FOLLOWS_TABLE).insert({
      follower_profile_id: followerId,
      list_owner_profile_id: ownerId,
      list_name: listType,
    });
    if (error && !uniqueViolation(error)) throw new Error(error.message);
    return true;
  },

  async unfollowList(followerHandle, ownerHandle, rawListType) {
    const followerId = await profileIdForHandle(supabaseProfileStore, followerHandle, false);
    const ownerId = await profileIdForHandle(supabaseProfileStore, ownerHandle, false);
    const listType = cleanListType(rawListType);
    if (!followerId || !ownerId || !listType) return true;

    const { error } = await admin()
      .from(LIST_FOLLOWS_TABLE)
      .delete()
      .eq("follower_profile_id", followerId)
      .eq("list_owner_profile_id", ownerId)
      .eq("list_name", listType);
    if (error) throw new Error(error.message);
    return true;
  },

  async isFollowingList(followerHandle, ownerHandle, rawListType) {
    try {
      const followerId = await profileIdForHandle(supabaseProfileStore, followerHandle, false);
      const ownerId = await profileIdForHandle(supabaseProfileStore, ownerHandle, false);
      const listType = cleanListType(rawListType);
      if (!followerId || !ownerId || !listType) return false;
      const { data, error } = await admin()
        .from(LIST_FOLLOWS_TABLE)
        .select("id")
        .eq("follower_profile_id", followerId)
        .eq("list_owner_profile_id", ownerId)
        .eq("list_name", listType)
        .limit(1);
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    } catch {
      return false;
    }
  },

  async counts(ownerHandle, rawListType) {
    try {
      const ownerId = await profileIdForHandle(supabaseProfileStore, ownerHandle, false);
      const listType = cleanListType(rawListType);
      if (!ownerId || !listType) return { followers: 0, savedPubs: 0 };
      const [followers, savedPubs] = await Promise.all([
        supabaseFollowerCount(ownerId, listType),
        supabaseSavedCount(ownerId, listType),
      ]);
      return { followers, savedPubs };
    } catch {
      return { followers: null, savedPubs: 0 };
    }
  },

  async listFollowedBy(followerHandle) {
    try {
      const followerId = await profileIdForHandle(supabaseProfileStore, followerHandle, false);
      if (!followerId) return [];
      const { data, error } = await admin()
        .from(LIST_FOLLOWS_TABLE)
        .select(
          "list_owner_profile_id, list_name, created_at, owner:profiles!saved_list_follows_list_owner_profile_id_fkey(handle)",
        )
        .eq("follower_profile_id", followerId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);

      const summaries: FollowedSavedListDTO[] = [];
      for (const row of (data ?? []) as {
        list_owner_profile_id?: unknown;
        list_name?: unknown;
        created_at?: unknown;
        owner?: { handle?: unknown } | null;
      }[]) {
        const ownerId = typeof row.list_owner_profile_id === "string" ? row.list_owner_profile_id : "";
        const owner = normalizeHandle(String(row.owner?.handle ?? ""));
        const listType = cleanListType(row.list_name);
        if (!ownerId || !owner || !listType) continue;
        const [followerCount, savedCount] = await Promise.all([
          supabaseFollowerCount(ownerId, listType),
          supabaseSavedCount(ownerId, listType),
        ]);
        summaries.push(
          listSummary(
            owner,
            listType,
            savedCount,
            followerCount,
            typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
          ),
        );
      }
      return summaries;
    } catch {
      return [];
    }
  },
};

type MemoryListFollow = {
  followerHandle: string;
  ownerHandle: string;
  listType: string;
  followedAt: string;
};

const memoryListFollows = new Map<string, MemoryListFollow>();

function memorySavedCount(ownerHandle: string, listType: string): number {
  const partition = memoryRows.get(ownerKey(ownerHandle));
  if (!partition) return 0;
  let count = 0;
  for (const row of partition.values()) {
    if (row.listType === listType) count += 1;
  }
  return count;
}

function memoryFollowerCount(ownerHandle: string, listType: string): number {
  let count = 0;
  for (const row of memoryListFollows.values()) {
    if (row.ownerHandle === ownerHandle && row.listType === listType) count += 1;
  }
  return count;
}

export const memorySavedListFollowsStore: SavedListFollowsStore = {
  async followList(followerHandle, ownerHandle, rawListType) {
    const follower = normalizeHandle(followerHandle);
    const owner = normalizeHandle(ownerHandle);
    const listType = cleanListType(rawListType);
    if (!follower || !owner || !listType || isSelfListFollow(follower, owner)) return false;

    const key = listFollowKey(follower, owner, listType);
    if (!memoryListFollows.has(key)) {
      memoryListFollows.set(key, {
        followerHandle: follower,
        ownerHandle: owner,
        listType,
        followedAt: new Date().toISOString(),
      });
    }
    return true;
  },

  async unfollowList(followerHandle, ownerHandle, rawListType) {
    const follower = normalizeHandle(followerHandle);
    const owner = normalizeHandle(ownerHandle);
    const listType = cleanListType(rawListType);
    if (follower && owner && listType) {
      memoryListFollows.delete(listFollowKey(follower, owner, listType));
    }
    return true;
  },

  async isFollowingList(followerHandle, ownerHandle, rawListType) {
    const follower = normalizeHandle(followerHandle);
    const owner = normalizeHandle(ownerHandle);
    const listType = cleanListType(rawListType);
    return Boolean(follower && owner && listType && memoryListFollows.has(listFollowKey(follower, owner, listType)));
  },

  async counts(ownerHandle, rawListType) {
    const owner = normalizeHandle(ownerHandle);
    const listType = cleanListType(rawListType);
    if (!owner || !listType) return { followers: 0, savedPubs: 0 };
    return {
      followers: memoryFollowerCount(owner, listType),
      savedPubs: memorySavedCount(owner, listType),
    };
  },

  async listFollowedBy(followerHandle) {
    const follower = normalizeHandle(followerHandle);
    if (!follower) return [];
    return [...memoryListFollows.values()]
      .filter((row) => row.followerHandle === follower)
      .sort((a, b) => b.followedAt.localeCompare(a.followedAt))
      .map((row) =>
        listSummary(
          row.ownerHandle,
          row.listType,
          memorySavedCount(row.ownerHandle, row.listType),
          memoryFollowerCount(row.ownerHandle, row.listType),
          row.followedAt,
        ),
      );
  },
};

export function savedListFollowsStore(): SavedListFollowsStore {
  return isSupabaseConfigured() ? supabaseSavedListFollowsStore : memorySavedListFollowsStore;
}

/** Test-only: clear the in-memory saved-list follow edges between cases. */
export function __resetMemorySavedListFollows(): void {
  memoryListFollows.clear();
}
