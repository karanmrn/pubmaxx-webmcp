// Directed follow graph over profiles. ONE interface, TWO implementations
// (process-memory + Supabase public.follows), same seam pattern as the other
// stores. A follow edge is keyed by the two self-asserted handles; each is
// resolved to a profile row (created lazily via ProfileStore.ensure) so the edge
// always references real profile ids, matching the follows FKs in migration 0006.
//
// No auth: the "follower" is whoever the client says they are (the localStorage
// handle). That is the same demo trust boundary as pint drops — extended here,
// not weakened.

import { normalizeHandle } from "@/lib/profiles";
import {
  memoryProfileStore,
  supabaseProfileStore,
  type ProfileStore,
} from "@/lib/profileStore";
import { admin, isUniqueViolation, selectStore } from "@/lib/storeBackend";

export type FollowCounts = { followers: number; following: number };

export type FollowStore = {
  /** Follow followee as follower (idempotent). Returns true when now following. */
  follow(followerHandle: string, followeeHandle: string): Promise<boolean>;
  /** Remove the edge (idempotent). Returns true when no longer following. */
  unfollow(followerHandle: string, followeeHandle: string): Promise<boolean>;
  /** Does follower currently follow followee? */
  isFollowing(followerHandle: string, followeeHandle: string): Promise<boolean>;
  /** Follower + following counts for a handle (0/0 for an unknown handle). */
  counts(handle: string): Promise<FollowCounts>;
  /**
   * The HANDLES this handle follows (its followees). Resolves handle → profile →
   * followee edges → followee profile handles. Returns [] for an unknown handle.
   * Powers the Friends feed lane (lib/feed.ts).
   */
  listFollowing(handle: string): Promise<string[]>;
  /**
   * The HANDLES that follow this handle (its followers). The mirror of
   * listFollowing. Returns [] for an unknown handle. Server-only — no follower
   * list is ever surfaced publicly; this feeds the mutual-follow computation.
   */
  listFollowers(handle: string): Promise<string[]>;
  /**
   * The viewer's "lot": handles in a MUTUAL follow with this handle (each side
   * follows the other). The intersection of listFollowing and listFollowers.
   * This — not a one-way follow — is the Social Loop's definition of a friend.
   */
  listMutuals(handle: string): Promise<string[]>;
};

// The mutual set is the intersection of who a handle follows and who follows it.
// Shared by both backends so "your lot" means the same thing everywhere.
function intersectHandles(following: string[], followers: string[]): string[] {
  const followerSet = new Set(followers.map((h) => normalizeHandle(h)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of following) {
    const h = normalizeHandle(raw);
    if (h && followerSet.has(h) && !seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

const TABLE = "follows";

// A self-follow is nonsense (and rejected by follows_no_self_chk). Normalise both
// handles and report when they collapse to the same identity so callers can 400.
export function isSelfFollow(a: string, b: string): boolean {
  const x = normalizeHandle(a);
  const y = normalizeHandle(b);
  return x !== "" && x === y;
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseFollowStore: FollowStore = {
  async follow(followerHandle, followeeHandle) {
    if (isSelfFollow(followerHandle, followeeHandle)) return false;
    const follower = await supabaseProfileStore.ensure(followerHandle);
    const followee = await supabaseProfileStore.ensure(followeeHandle);
    const { error } = await admin()
      .from(TABLE)
      .insert({ follower_id: follower.id, followee_id: followee.id });
    // A duplicate edge means "already following" — an idempotent success, not an
    // error. Every other insert error is real.
    if (error && !isUniqueViolation(error)) throw new Error(error.message);
    return true;
  },

  async unfollow(followerHandle, followeeHandle) {
    const follower = await supabaseProfileStore.getByHandle(followerHandle);
    const followee = await supabaseProfileStore.getByHandle(followeeHandle);
    // If either side has no profile there is nothing to unfollow — idempotent.
    if (!follower || !followee) return true;
    const { error } = await admin()
      .from(TABLE)
      .delete()
      .eq("follower_id", follower.id)
      .eq("followee_id", followee.id);
    if (error) throw new Error(error.message);
    return true;
  },

  async isFollowing(followerHandle, followeeHandle) {
    const follower = await supabaseProfileStore.getByHandle(followerHandle);
    const followee = await supabaseProfileStore.getByHandle(followeeHandle);
    if (!follower || !followee) return false;
    const { data, error } = await admin()
      .from(TABLE)
      .select("id")
      .eq("follower_id", follower.id)
      .eq("followee_id", followee.id)
      .limit(1);
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  },

  async counts(handle) {
    const profile = await supabaseProfileStore.getByHandle(handle);
    if (!profile) return { followers: 0, following: 0 };
    // head:true + count:exact = a COUNT query, no rows shipped back.
    const followers = await admin()
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("followee_id", profile.id);
    if (followers.error) throw new Error(followers.error.message);
    const following = await admin()
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("follower_id", profile.id);
    if (following.error) throw new Error(following.error.message);
    return { followers: followers.count ?? 0, following: following.count ?? 0 };
  },

  async listFollowing(handle) {
    const profile = await supabaseProfileStore.getByHandle(handle);
    if (!profile) return [];
    // One join: the followee rows this profile follows, embedding each followee's
    // handle from public.profiles (the FK follows.followee_id → profiles.id).
    const { data, error } = await admin()
      .from(TABLE)
      .select("followee:followee_id ( handle )")
      .eq("follower_id", profile.id);
    if (error) throw new Error(error.message);
    const handles: string[] = [];
    for (const row of (data ?? []) as { followee?: { handle?: unknown } | null }[]) {
      const h = normalizeHandle(String(row.followee?.handle ?? ""));
      if (h) handles.push(h);
    }
    return handles;
  },

  async listFollowers(handle) {
    const profile = await supabaseProfileStore.getByHandle(handle);
    if (!profile) return [];
    // The mirror join: the follower rows pointing AT this profile, embedding each
    // follower's handle (FK follows.follower_id → profiles.id).
    const { data, error } = await admin()
      .from(TABLE)
      .select("follower:follower_id ( handle )")
      .eq("followee_id", profile.id);
    if (error) throw new Error(error.message);
    const handles: string[] = [];
    for (const row of (data ?? []) as { follower?: { handle?: unknown } | null }[]) {
      const h = normalizeHandle(String(row.follower?.handle ?? ""));
      if (h) handles.push(h);
    }
    return handles;
  },

  async listMutuals(handle) {
    const [following, followers] = await Promise.all([
      this.listFollowing(handle),
      this.listFollowers(handle),
    ]);
    return intersectHandles(following, followers);
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Edges as a Set of "followerId>followeeId" keys. Resets on restart.
const memoryEdges = new Set<string>();
// Reverse index: profile id → normalized handle, so listFollowing can resolve a
// followee id (all the edge set carries) back to a handle without a scan or a
// getById on ProfileStore. Filled from the handles already in scope whenever an
// edge is created (follow ensures both profiles), and never trimmed — an id that
// once had a handle keeps it for the process lifetime.
const memoryHandleById = new Map<string, string>();

function edgeKey(followerId: string, followeeId: string): string {
  return `${followerId}>${followeeId}`;
}

function makeMemoryFollowStore(profiles: ProfileStore): FollowStore {
  return {
    async follow(followerHandle, followeeHandle) {
      if (isSelfFollow(followerHandle, followeeHandle)) return false;
      const follower = await profiles.ensure(followerHandle);
      const followee = await profiles.ensure(followeeHandle);
      memoryEdges.add(edgeKey(follower.id, followee.id));
      // Record both ids' handles so listFollowing can map a followee id → handle.
      memoryHandleById.set(follower.id, normalizeHandle(follower.handle));
      memoryHandleById.set(followee.id, normalizeHandle(followee.handle));
      return true;
    },
    async unfollow(followerHandle, followeeHandle) {
      const follower = await profiles.getByHandle(followerHandle);
      const followee = await profiles.getByHandle(followeeHandle);
      if (follower && followee) memoryEdges.delete(edgeKey(follower.id, followee.id));
      return true;
    },
    async isFollowing(followerHandle, followeeHandle) {
      const follower = await profiles.getByHandle(followerHandle);
      const followee = await profiles.getByHandle(followeeHandle);
      if (!follower || !followee) return false;
      return memoryEdges.has(edgeKey(follower.id, followee.id));
    },
    async counts(handle) {
      const profile = await profiles.getByHandle(handle);
      if (!profile) return { followers: 0, following: 0 };
      let followers = 0;
      let following = 0;
      for (const key of memoryEdges) {
        const [from, to] = key.split(">");
        if (to === profile.id) followers += 1;
        if (from === profile.id) following += 1;
      }
      return { followers, following };
    },
    async listFollowing(handle) {
      const profile = await profiles.getByHandle(handle);
      if (!profile) return [];
      // Collect the followee ids this profile follows, then resolve each back to
      // its handle via the reverse index (the edge set carries ids only).
      const handles: string[] = [];
      for (const key of memoryEdges) {
        const [from, to] = key.split(">");
        if (from !== profile.id) continue;
        const h = memoryHandleById.get(to);
        if (h) handles.push(h);
      }
      return handles;
    },
    async listFollowers(handle) {
      const profile = await profiles.getByHandle(handle);
      if (!profile) return [];
      // The edges pointing AT this profile; resolve each follower id → handle.
      const handles: string[] = [];
      for (const key of memoryEdges) {
        const [from, to] = key.split(">");
        if (to !== profile.id) continue;
        const h = memoryHandleById.get(from);
        if (h) handles.push(h);
      }
      return handles;
    },
    async listMutuals(handle) {
      const [following, followers] = await Promise.all([
        this.listFollowing(handle),
        this.listFollowers(handle),
      ]);
      return intersectHandles(following, followers);
    },
  };
}

export const memoryFollowStore: FollowStore = makeMemoryFollowStore(memoryProfileStore);

/** The single backend selection point (mirrors the other stores). */
export function followStore(): FollowStore {
  return selectStore(memoryFollowStore, supabaseFollowStore);
}

/** Test-only: clear the in-memory edge set + handle index between cases. */
export function __resetMemoryFollows(): void {
  memoryEdges.clear();
  memoryHandleById.clear();
}
