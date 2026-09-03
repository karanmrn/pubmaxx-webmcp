import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for the GET of
// app/api/profiles/[handle]/following/route.ts — the read that powers the
// Friends feed lane (lib/feed.ts fetches the viewer's followees, then keeps only
// drops authored by a handle in the returned set).
//
// The route's whole contract is "a pure read that MUST NEVER 500": a bad handle
// or a backend hiccup degrades to `{ following: [] }` so the feed still renders.
// We pin the process-memory backend so every case is deterministic and touches
// no network — on Vercel vitest inherits the project env, so SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY are cleared in beforeEach to force the memory path
// everywhere (otherwise the store would try to reach Supabase and only CI would
// fail). We also reset the shared memory follow edges + handle index AND the
// memory profile map (follow/ensure writes profiles) so cases can't leak state.
//
// We seed follows through the memory followStore's PUBLIC api (follow(...)) — the
// same seam the route reads from — never by reaching into store internals.

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { GET } from "@/app/api/profiles/[handle]/following/route";
import { memoryFollowStore, __resetMemoryFollows } from "@/lib/followStore";
import {
  memoryProfileStore,
  __resetMemoryProfiles,
  __seedMemoryOwnedProfile,
  __tombstoneMemoryProfile,
} from "@/lib/profileStore";
import { profileImageServingKey } from "@/lib/profileImageSlots";

const URL_BASE = "http://localhost/api/profiles";
const AVATAR_GENERATION = "11111111-1111-1111-8111-111111111111";

function followEntry(handle: string, extra?: { displayName?: string; avatarUrl?: string }) {
  return { handle, ...extra };
}

function followingHandles(body: { following: Array<{ handle: string }> }): Set<string> {
  return new Set(body.following.map((row) => row.handle));
}

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

// The route's second arg is `{ params: Promise<{ handle }> }` (Next 15 async
// params). Build a real resolved Promise so we exercise the exact signature.
function following(handle: string): Promise<Response> {
  const request = new Request(`${URL_BASE}/${encodeURIComponent(handle)}/following`);
  return GET(request, { params: Promise.resolve({ handle }) });
}

beforeEach(() => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryFollows();
  __resetMemoryProfiles();
});

describe("GET /api/profiles/[handle]/following", () => {
  it("returns no follow graph during the full Social rollback", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";
    await memoryFollowStore.follow("ken", "sam");

    const res = await following("ken");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Social is in preview right now.",
      code: "SOCIAL_PREVIEW",
      retryable: false,
    });
  });

  it("returns enriched rows for handles a profile follows", async () => {
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("ken", "lee");

    const res = await following("ken");
    expect(res.status).toBe(200);
    expectNoStore(res);
    const body = await res.json();
    expect(followingHandles(body)).toEqual(new Set(["sam", "lee"]));
    for (const row of body.following) {
      expect(row).toMatchObject({ handle: expect.stringMatching(/^[a-z0-9_]+$/) });
    }
  });

  it("projects an owned avatar onto a followee when one exists", async () => {
    // An owned avatar only exists on a CLAIMED handle - the upload is bound to
    // the owner's own session - so the followee is seeded linked, the way the
    // rest of the public avatar reads already require.
    __seedMemoryOwnedProfile("sam", "user-sam");
    await memoryFollowStore.follow("ken", "sam");
    const profile = await memoryProfileStore.getByHandle("sam");
    await memoryProfileStore.setOwnedImage("sam", "avatar", {
      objectKey: profileImageServingKey("avatar", profile!.id, AVATAR_GENERATION),
      generation: AVATAR_GENERATION,
      moderationState: "approved",
    });

    const body = await (await following("ken")).json();
    expect(body.following).toEqual([
      followEntry("sam", {
        avatarUrl: `/api/avatar/${profile!.id}/${AVATAR_GENERATION}`,
      }),
    ]);
  });

  it("returns { following: [] } for a handle that follows nobody", async () => {
    await memoryFollowStore.follow("sam", "ken");

    const res = await following("ken");
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ following: [] });
  });

  it("returns { following: [] } for an unknown handle with no profile at all", async () => {
    const res = await following("ghost");
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ following: [] });
  });

  it("normalizes the queried handle before resolving its followees", async () => {
    await memoryFollowStore.follow("ken", "sam");

    const atKen = await following("@Ken");
    expect(await atKen.json()).toEqual({ following: [followEntry("sam")] });

    const upperKen = await following("KEN");
    expect(await upperKen.json()).toEqual({ following: [followEntry("sam")] });
  });

  it("never 500s on an empty handle — returns { following: [] }, not a 400/500", async () => {
    const res = await following("");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: [] });
  });

  it("never 500s on a blank / junk handle that normalizes to empty", async () => {
    for (const junk of ["   ", "@", "@@@", "!!!", "###"]) {
      const res = await following(junk);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ following: [] });
    }
  });

  it("isolates one follower's followees from another's", async () => {
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("lee", "zoe");

    expect(await (await following("ken")).json()).toEqual({
      following: [followEntry("sam")],
    });
    expect(await (await following("lee")).json()).toEqual({
      following: [followEntry("zoe")],
    });
  });

  it("reflects an unfollow — the dropped followee leaves the list", async () => {
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("ken", "lee");
    await memoryFollowStore.unfollow("ken", "sam");

    const res = await following("ken");
    expect(await res.json()).toEqual({ following: [followEntry("lee")] });
  });

  it("returns a JSON body of exactly { following } and leaks no profile_id / actor_hash / raw id", async () => {
    await memoryFollowStore.follow("ken", "sam");

    const res = await following("ken");
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["following"]);

    const blob = JSON.stringify(body);
    expect(blob).not.toMatch(/mem-profile-/i);
    expect(blob).not.toMatch(/profile_?id/i);
    expect(blob).not.toMatch(/follower_?id/i);
    expect(blob).not.toMatch(/followee_?id/i);
    expect(blob).not.toMatch(/actor_?hash/i);
  });

  it("reads every followee in ONE store round trip, not one per handle", async () => {
    // The route is public, unpaginated and unauthenticated, so a point read per
    // follower fans out one backend call per row on a well-followed profile.
    for (const followee of ["sam", "lee", "zoe", "ash"]) {
      await memoryFollowStore.follow("ken", followee);
    }
    const batch = vi.spyOn(memoryProfileStore, "getPublicCardsByHandles");
    const point = vi.spyOn(memoryProfileStore, "getByHandle");

    const body = await (await following("ken")).json();
    expect(followingHandles(body)).toEqual(new Set(["sam", "lee", "zoe", "ash"]));
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(
      expect.arrayContaining(["sam", "lee", "zoe", "ash"]),
    );
    // The follow store resolves the FOLLOWER itself; no followee is point-read.
    const pointReads = point.mock.calls.map(([handle]) => handle);
    expect(pointReads).not.toContain("sam");
    expect(pointReads).not.toContain("lee");
    expect(pointReads).not.toContain("zoe");
    expect(pointReads).not.toContain("ash");
    batch.mockRestore();
    point.mockRestore();
  });

  it("keeps the whole list when the profile read for its names and faces fails", async () => {
    // Enrichment is decoration. A failed profile read used to reject the whole
    // projection, and the route's catch then answered { following: [] } — which
    // the Friends feed lane and the followers page read as "you follow nobody".
    await memoryFollowStore.follow("ken", "sam");
    await memoryFollowStore.follow("ken", "lee");
    const batch = vi
      .spyOn(memoryProfileStore, "getPublicCardsByHandles")
      .mockRejectedValue(new Error("profile store down"));

    const res = await following("ken");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(followingHandles(body)).toEqual(new Set(["sam", "lee"]));
    for (const row of body.following) {
      expect(row).toEqual({ handle: row.handle });
    }
    batch.mockRestore();
  });

  it("never names a departed account, though its handle stays on the list", async () => {
    // The auth-deletion trigger nulls the images and leaves `display_name`, so a
    // card projection without a tombstone gate printed a departed person's real
    // name beside their handle to any anonymous caller of this public route.
    __seedMemoryOwnedProfile("gone", "user-gone");
    await memoryFollowStore.follow("ken", "gone");
    await memoryProfileStore.update("gone", { displayName: "Departed Person" });
    const profile = await memoryProfileStore.getByHandle("gone");
    await memoryProfileStore.setOwnedImage("gone", "avatar", {
      objectKey: profileImageServingKey("avatar", profile!.id, AVATAR_GENERATION),
      generation: AVATAR_GENERATION,
      moderationState: "approved",
    });
    __tombstoneMemoryProfile("gone");

    const body = await (await following("ken")).json();
    expect(body.following).toEqual([followEntry("gone")]);
    const blob = JSON.stringify(body);
    expect(blob).not.toContain("Departed Person");
    expect(blob).not.toContain("/api/avatar/");
  });

  it("advertises a JSON response and never a non-200 status", async () => {
    await memoryFollowStore.follow("ken", "sam");
    const res = await following("ken");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
  });
});
