import { beforeEach, describe, expect, it } from "vitest";

// Exercise the in-memory follow store directly — no live Supabase, no env keys.
// It is the backend the route uses when Supabase is unconfigured and shares the
// isSelfFollow / normalizeHandle trust boundary with the Supabase path.
//
// FORCE the in-memory path: on Vercel vitest runs with the project's env set —
// if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are present the store would try to
// reach Supabase and these cases would fail only in CI. Clearing them in
// beforeEach pins the store to memory everywhere. We also reset the shared
// memory follow edges + handle index AND the memory profile map (follow/ensure
// writes profiles) so cases can't leak state into each other.
import {
  isSelfFollow,
  memoryFollowStore,
  __resetMemoryFollows,
} from "@/lib/followStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryFollows();
  __resetMemoryProfiles();
});

describe("isSelfFollow — normalized self-follow guard", () => {
  it("flags a handle following itself, even across surface differences", () => {
    expect(isSelfFollow("ken", "ken")).toBe(true);
    // Normalization: leading @, case, and junk chars collapse to one identity.
    expect(isSelfFollow("@Ken", "ken")).toBe(true);
    expect(isSelfFollow("KEN!!", "ken")).toBe(true);
  });

  it("does not flag two distinct handles", () => {
    expect(isSelfFollow("ken", "sam")).toBe(false);
  });

  it("does not flag when a handle normalizes to empty (nothing to self-follow)", () => {
    // Both collapse to "" — but an empty identity is not a real self-follow.
    expect(isSelfFollow("", "")).toBe(false);
    expect(isSelfFollow("@@@", "!!!")).toBe(false);
  });
});

describe("follow / unfollow — toggle state + counts", () => {
  it("follow then unfollow toggles isFollowing and both sides' counts", async () => {
    expect(await memoryFollowStore.isFollowing("ken", "sam")).toBe(false);

    const followed = await memoryFollowStore.follow("ken", "sam");
    expect(followed).toBe(true);
    expect(await memoryFollowStore.isFollowing("ken", "sam")).toBe(true);
    // ken now follows 1; sam now has 1 follower.
    expect(await memoryFollowStore.counts("ken")).toEqual({ followers: 0, following: 1 });
    expect(await memoryFollowStore.counts("sam")).toEqual({ followers: 1, following: 0 });

    const unfollowed = await memoryFollowStore.unfollow("ken", "sam");
    expect(unfollowed).toBe(true);
    expect(await memoryFollowStore.isFollowing("ken", "sam")).toBe(false);
    expect(await memoryFollowStore.counts("ken")).toEqual({ followers: 0, following: 0 });
    expect(await memoryFollowStore.counts("sam")).toEqual({ followers: 0, following: 0 });
  });

  it("follow is idempotent — re-following never inflates the count", async () => {
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("ken", "sam");
    expect(await memoryFollowStore.counts("ken")).toEqual({ followers: 0, following: 1 });
    expect(await memoryFollowStore.counts("sam")).toEqual({ followers: 1, following: 0 });
  });

  it("normalizes handles so @Sam and sam are the same edge", async () => {
    await memoryFollowStore.follow("@Ken", "@Sam");
    expect(await memoryFollowStore.isFollowing("ken", "sam")).toBe(true);
    expect(await memoryFollowStore.isFollowing("KEN", "SAM")).toBe(true);
  });
});

describe("self-follow is rejected", () => {
  it("follow returns false and records no edge for a self-follow", async () => {
    const result = await memoryFollowStore.follow("ken", "ken");
    expect(result).toBe(false);
    expect(await memoryFollowStore.isFollowing("ken", "ken")).toBe(false);
    // No phantom following count from the rejected edge.
    expect(await memoryFollowStore.counts("ken")).toEqual({ followers: 0, following: 0 });
  });

  it("rejects a self-follow that only matches after normalization", async () => {
    expect(await memoryFollowStore.follow("@Ken", "ken")).toBe(false);
    expect(await memoryFollowStore.counts("ken")).toEqual({ followers: 0, following: 0 });
  });
});

describe("counts are derived, not stored", () => {
  it("aggregates followers and following across multiple edges", async () => {
    // sam is followed by ken and lee; sam follows lee.
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("lee", "sam");
    await memoryFollowStore.follow("sam", "lee");

    expect(await memoryFollowStore.counts("sam")).toEqual({ followers: 2, following: 1 });
    expect(await memoryFollowStore.counts("lee")).toEqual({ followers: 1, following: 1 });
    expect(await memoryFollowStore.counts("ken")).toEqual({ followers: 0, following: 1 });
  });

  it("returns 0/0 for an unknown handle that has no profile yet", async () => {
    expect(await memoryFollowStore.counts("nobody")).toEqual({ followers: 0, following: 0 });
  });
});

describe("listFollowing — resolves followee handles", () => {
  it("returns the normalized handles a handle follows", async () => {
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("ken", "lee");

    const following = await memoryFollowStore.listFollowing("ken");
    expect(new Set(following)).toEqual(new Set(["sam", "lee"]));
    // Normalized, never raw ids.
    for (const h of following) expect(h).toMatch(/^[a-z0-9_]+$/);
  });

  it("returns [] for a handle that follows nobody", async () => {
    // Give ken a profile (as a followee) but no outgoing edges.
    await memoryFollowStore.follow("sam", "ken");
    expect(await memoryFollowStore.listFollowing("ken")).toEqual([]);
  });

  it("returns [] for an unknown handle with no profile at all", async () => {
    expect(await memoryFollowStore.listFollowing("ghost")).toEqual([]);
  });

  it("normalizes the queried handle before resolving its followees", async () => {
    await memoryFollowStore.follow("ken", "sam");
    expect(await memoryFollowStore.listFollowing("@Ken")).toEqual(["sam"]);
  });
});

describe("isolation across followers", () => {
  it("one follower's edges never leak into another's following/list", async () => {
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("lee", "zoe");

    expect(await memoryFollowStore.listFollowing("ken")).toEqual(["sam"]);
    expect(await memoryFollowStore.listFollowing("lee")).toEqual(["zoe"]);
    // ken does not follow zoe just because lee does.
    expect(await memoryFollowStore.isFollowing("ken", "zoe")).toBe(false);
    expect(await memoryFollowStore.counts("ken")).toEqual({ followers: 0, following: 1 });
    expect(await memoryFollowStore.counts("lee")).toEqual({ followers: 0, following: 1 });
  });

  it("unfollowing one edge leaves an unrelated follower's edge intact", async () => {
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("lee", "sam");

    await memoryFollowStore.unfollow("ken", "sam");
    expect(await memoryFollowStore.isFollowing("ken", "sam")).toBe(false);
    expect(await memoryFollowStore.isFollowing("lee", "sam")).toBe(true);
    expect(await memoryFollowStore.counts("sam")).toEqual({ followers: 1, following: 0 });
  });

  it("unfollow is idempotent + safe for handles that never had a profile", async () => {
    // Neither side has a profile → nothing to remove, still an idempotent success.
    expect(await memoryFollowStore.unfollow("ken", "sam")).toBe(true);
    expect(await memoryFollowStore.isFollowing("ken", "sam")).toBe(false);
  });
});
