// "We're out" check-ins — ONE interface (CheckInStore), TWO implementations
// (process-memory + Supabase public.check_ins), chosen at a single seam
// (isSupabaseConfigured), exactly like lib/followStore.ts / lib/pintDropsStore.ts.
//
// A check-in is keyed by the author's self-asserted handle (the same demo trust
// boundary as a pint drop / follow). The Supabase path resolves the handle to a
// profile row (created lazily via ProfileStore.ensure) so `author_id` references
// a real profile and ON DELETE CASCADE cleans up a deleted profile's check-ins.
//
// This store returns rows as stored. The PRIVACY choke — which check-ins reach
// which viewer — lives in lib/socialFeed.ts, the single tested gate. Callers that
// surface check-ins go through there, never straight to this store.

import {
  activeCheckIns,
  expiresAtIso,
  type CheckIn,
  type CheckInVisibility,
  type NormalizedCheckInInput,
} from "@/lib/checkIn";
import type { NightAreaSlug } from "@/lib/nightAreas";
import { normalizeHandle } from "@/lib/profiles";
import {
  memoryProfileStore,
  supabaseProfileStore,
  type ProfileStore,
} from "@/lib/profileStore";
import { admin, selectStore } from "@/lib/storeBackend";

export type CheckInStore = {
  /** Persist a check-in. Stamps createdAt + expiresAt (createdAt + 12h). */
  create(input: NormalizedCheckInInput): Promise<CheckIn>;
  /**
   * Non-expired check-ins authored by any of `handles`, newest-first. The engine
   * of the "your lot" read: the caller (lib/socialFeed.ts) passes the viewer's
   * mutual-follow handles. An empty handle list returns [] (no scan).
   */
  listByHandles(handles: string[], now?: number): Promise<CheckIn[]>;
  /**
   * Non-expired check-ins with a given visibility, newest-first. Powers the
   * area/public reads (visibility 'area') without ever touching friends-only rows.
   */
  listByVisibility(visibility: CheckInVisibility, now?: number): Promise<CheckIn[]>;
  /** Hard-delete every check-in a handle authored (deletion cascade helper). */
  deleteForHandle(handle: string): Promise<void>;
};

const TABLE = "check_ins";

function fromRow(row: Record<string, unknown>): CheckIn {
  return {
    id: String(row.id),
    handle: normalizeHandle(String(row.handle ?? "")),
    areaSlug: row.area_slug ? (String(row.area_slug) as NightAreaSlug) : null,
    venueId: row.venue_id ? String(row.venue_id) : null,
    note: row.note ? String(row.note) : null,
    visibility: (String(row.visibility ?? "friends") as CheckInVisibility),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  };
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseCheckInStore: CheckInStore = {
  async create(input) {
    const author = await supabaseProfileStore.ensure(input.handle);
    const createdAt = new Date().toISOString();
    const expiresAt = expiresAtIso(createdAt);
    const { data, error } = await admin()
      .from(TABLE)
      .insert({
        author_id: author.id,
        handle: input.handle,
        area_slug: input.areaSlug,
        venue_id: input.venueId,
        note: input.note,
        visibility: input.visibility,
        created_at: createdAt,
        expires_at: expiresAt,
      })
      .select("*")
      .limit(1);
    if (error) throw new Error(error.message);
    return fromRow((data ?? [])[0] as Record<string, unknown>);
  },

  async listByHandles(handles, now = Date.now()) {
    const keys = Array.from(
      new Set(handles.map((h) => normalizeHandle(h)).filter((h) => h.length > 0)),
    );
    if (keys.length === 0) return [];
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .in("handle", keys)
      .gt("expires_at", new Date(now).toISOString())
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return activeCheckIns((data ?? []).map((r) => fromRow(r as Record<string, unknown>)), now);
  },

  async listByVisibility(visibility, now = Date.now()) {
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .eq("visibility", visibility)
      .gt("expires_at", new Date(now).toISOString())
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return activeCheckIns((data ?? []).map((r) => fromRow(r as Record<string, unknown>)), now);
  },

  async deleteForHandle(handle) {
    const key = normalizeHandle(handle);
    if (!key) return;
    const { error } = await admin().from(TABLE).delete().eq("handle", key);
    if (error) throw new Error(error.message);
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// A flat list, resets on restart — right for dev/demo/test.
type MemoryRow = CheckIn;
const memoryCheckIns: MemoryRow[] = [];
let memorySeq = 0;

function makeMemoryCheckInStore(profiles: ProfileStore): CheckInStore {
  return {
    async create(input) {
      // Ensure a profile exists so the memory path mirrors the FK-backed Supabase
      // path (and so a later deleteForHandle has a consistent handle to match).
      await profiles.ensure(input.handle);
      const createdAt = new Date().toISOString();
      memorySeq += 1;
      const row: MemoryRow = {
        id: `mem-checkin-${memorySeq}`,
        handle: input.handle,
        areaSlug: input.areaSlug,
        venueId: input.venueId,
        note: input.note,
        visibility: input.visibility,
        createdAt,
        expiresAt: expiresAtIso(createdAt),
      };
      memoryCheckIns.push(row);
      return row;
    },

    async listByHandles(handles, now = Date.now()) {
      const set = new Set(handles.map((h) => normalizeHandle(h)).filter((h) => h.length > 0));
      if (set.size === 0) return [];
      return activeCheckIns(
        memoryCheckIns.filter((c) => set.has(c.handle)),
        now,
      );
    },

    async listByVisibility(visibility, now = Date.now()) {
      return activeCheckIns(
        memoryCheckIns.filter((c) => c.visibility === visibility),
        now,
      );
    },

    async deleteForHandle(handle) {
      const key = normalizeHandle(handle);
      for (let i = memoryCheckIns.length - 1; i >= 0; i -= 1) {
        if (memoryCheckIns[i].handle === key) memoryCheckIns.splice(i, 1);
      }
    },
  };
}

export const memoryCheckInStore: CheckInStore = makeMemoryCheckInStore(memoryProfileStore);

/** The single backend selection point (mirrors the other stores). */
export function checkInStore(): CheckInStore {
  return selectStore(memoryCheckInStore, supabaseCheckInStore);
}

/** Test-only: clear the in-memory check-in list between cases. */
export function __resetMemoryCheckIns(): void {
  memoryCheckIns.length = 0;
  memorySeq = 0;
}
