import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import { GET, POST } from "@/app/api/saved-pubs/list-follows/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";
import {
  __resetMemorySavedListFollows,
  __resetMemorySavedPubs,
  savedListFollowsStore,
  savedPubsStore,
} from "@/lib/savedPubsStore";
import { getVenueIndex } from "@/lib/venueIndex";

const URL_BASE = "http://localhost/api/saved-pubs/list-follows";

let REAL_VENUE_ID = "";

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetPintDrops();
  __resetMemoryProfiles();
  __resetMemorySavedPubs();
  __resetMemorySavedListFollows();

  const index = await getVenueIndex();
  REAL_VENUE_ID = [...index.keys()][0] ?? "";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function get(query: string): Promise<Response> {
  return GET(new Request(`${URL_BASE}?${query}`));
}

function post(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return POST(
    new Request(URL_BASE, { method: "POST", body: JSON.stringify(body), headers }),
  );
}

describe("GET /api/saved-pubs/list-follows", () => {
  it("returns explicit Social preview during emergency rollback", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");

    const read = await get("follower=ken");
    const write = await post({ follower: "ken", owner: "sam", listType: "Date Night" });

    expect(read.status).toBe(503);
    expect(write.status).toBe(503);
    expect(await read.json()).toMatchObject({
      code: "SOCIAL_PREVIEW",
      retryable: false,
    });
    expect(await write.json()).toMatchObject({
      code: "SOCIAL_PREVIEW",
      retryable: false,
    });
  });

  it("returns a follower's followed lists with author attribution and counts", async () => {
    await savedPubsStore().toggleSaved({
      handle: "Sam",
      venueId: REAL_VENUE_ID,
      listType: "Date Night",
    });
    await post({ follower: "Ken", owner: "Sam", listType: "Date Night" });

    const res = await get("follower=@Ken");
    expect(res.status).toBe(200);
    expectNoStore(res);
    const { followedLists } = await res.json();
    expect(followedLists).toHaveLength(1);
    expect(followedLists[0]).toMatchObject({
      ownerHandle: "sam",
      ownerProfileUrl: "/u/sam",
      listType: "Date Night",
      listUrl: "/u/sam/lists/Date%20Night",
      savedCount: 1,
      followerCount: 1,
    });
  });

  it("returns follow state and public counts for one authored list", async () => {
    await savedPubsStore().toggleSaved({
      handle: "Sam",
      venueId: REAL_VENUE_ID,
      listType: "Date Night",
    });
    await post({ follower: "Ken", owner: "Sam", listType: "Date Night" });

    const res = await get("follower=ken&owner=sam&listType=Date%20Night");
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({
      following: true,
      counts: { followers: 1, savedPubs: 1 },
    });
  });

  it("marks list counts unavailable when the follow store cannot answer", async () => {
    const counts = vi
      .spyOn(savedListFollowsStore(), "counts")
      .mockRejectedValueOnce(new Error("database unavailable"));

    const res = await get("follower=ken&owner=sam&listType=Date%20Night");

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({
      status: "unavailable",
      following: null,
      counts: { followers: null, savedPubs: null },
    });
    counts.mockRestore();
  });
});

describe("POST /api/saved-pubs/list-follows", () => {
  it("follows then unfollows another handle's named list", async () => {
    const follow = await post({ follower: "Ken", owner: "Sam", listType: "Date Night" });
    expect(follow.status).toBe(200);
    expectNoStore(follow);
    expect(await follow.json()).toEqual({
      following: true,
      counts: { followers: 1, savedPubs: 0 },
    });

    const unfollow = await post({
      follower: "Ken",
      owner: "Sam",
      listType: "Date Night",
      action: "unfollow",
    });
    expect(unfollow.status).toBe(200);
    expect(await unfollow.json()).toEqual({
      following: false,
      counts: { followers: 0, savedPubs: 0 },
    });
  });

  it("rejects following your own list after handle normalization", async () => {
    const res = await post({ follower: "@Sam", owner: "sam", listType: "Date Night" });
    expect(res.status).toBe(400);
    expectNoStore(res);
    expect(await res.json()).toEqual({ error: "You can't follow your own list.", code: "INVALID_REQUEST", retryable: false });
  });

  it("400s malformed or incomplete write bodies", async () => {
    const malformed = await POST(new Request(URL_BASE, { method: "POST", body: "{nope" }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Malformed request body.", code: "MALFORMED_REQUEST", retryable: false });

    const missingFollower = await post({ owner: "sam", listType: "Date Night" });
    expect(missingFollower.status).toBe(400);
    expect(await missingFollower.json()).toEqual({
      error: "Choose a handle in your account first.",
      code: "INVALID_REQUEST",
      retryable: false,
    });

    const missingOwner = await post({ follower: "ken", listType: "Date Night" });
    expect(missingOwner.status).toBe(400);
    expect(await missingOwner.json()).toEqual({ error: "Missing list author.", code: "INVALID_REQUEST", retryable: false });

    const missingList = await post({ follower: "ken", owner: "sam", listType: "   " });
    expect(missingList.status).toBe(400);
    expect(await missingList.json()).toEqual({ error: "Add a list name.", code: "INVALID_REQUEST", retryable: false });
  });

  it("429s once one follower floods list-follow changes", async () => {
    const headers = { "x-forwarded-for": "192.0.2.99" };
    let last: Response | undefined;
    for (let i = 0; i < 9; i++) {
      last = await post(
        { follower: "flooder", owner: `author${i}`, listType: "Date Night" },
        headers,
      );
    }
    expect(last!.status).toBe(429);
    expect(await last!.json()).toEqual({ error: "Too many list follows, slow down.", code: "RATE_LIMITED", retryable: true });
  });

  it("403s when the follower handle is linked and the caller is anonymous", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    const res = await post({ follower: "ken", owner: "sam", listType: "Date Night" });
    expect(res.status).toBe(403);
    expectNoStore(res);
    expect(await res.json()).toMatchObject({
      error: "This handle belongs to a signed-in account. Sign in as its owner to continue.",
    });
  });
});
