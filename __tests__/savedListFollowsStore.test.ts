import { beforeEach, describe, expect, it } from "vitest";

import { __resetMemoryProfiles } from "@/lib/profileStore";
import {
  __resetMemorySavedListFollows,
  __resetMemorySavedPubs,
  savedListFollowsStore,
  savedPubsStore,
} from "@/lib/savedPubsStore";
import { getVenueIndex } from "@/lib/venueIndex";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
  __resetMemorySavedPubs();
  __resetMemorySavedListFollows();
});

async function venueIds(count: number): Promise<string[]> {
  const index = await getVenueIndex();
  return [...index.keys()].slice(0, count);
}

describe("savedListFollowsStore — in-memory list follows", () => {
  it("follows another handle's named list and returns author attribution + counts", async () => {
    const [first, second] = await venueIds(2);
    await savedPubsStore().toggleSaved({
      handle: "Sam",
      venueId: first,
      listType: "Date Night",
    });
    await savedPubsStore().toggleSaved({
      handle: "sam",
      venueId: second,
      listType: "Date Night",
    });

    expect(await savedListFollowsStore().followList("Ken", "Sam", "Date Night")).toBe(true);
    expect(await savedListFollowsStore().isFollowingList("ken", "sam", "Date Night")).toBe(true);

    const followed = await savedListFollowsStore().listFollowedBy("@Ken");
    expect(followed).toHaveLength(1);
    expect(followed[0]).toMatchObject({
      ownerHandle: "sam",
      ownerProfileUrl: "/u/sam",
      listType: "Date Night",
      listUrl: "/u/sam/lists/Date%20Night",
      savedCount: 2,
      followerCount: 1,
    });
    expect(Date.parse(followed[0].followedAt)).not.toBeNaN();
  });

  it("is idempotent and never inflates a list's follower count", async () => {
    const store = savedListFollowsStore();
    await store.followList("ken", "sam", "Date Night");
    await store.followList("KEN", "@Sam", "Date Night");

    expect(await store.counts("sam", "Date Night")).toEqual({
      followers: 1,
      savedPubs: 0,
    });
    expect(await store.listFollowedBy("ken")).toHaveLength(1);
  });

  it("rejects following your own list after handle normalization", async () => {
    const store = savedListFollowsStore();

    expect(await store.followList("@Sam", "sam", "Date Night")).toBe(false);
    expect(await store.isFollowingList("sam", "sam", "Date Night")).toBe(false);
    expect(await store.counts("sam", "Date Night")).toEqual({
      followers: 0,
      savedPubs: 0,
    });
  });

  it("unfollows one followed list without disturbing other followed lists", async () => {
    const store = savedListFollowsStore();
    await store.followList("ken", "sam", "Date Night");
    await store.followList("ken", "lee", "Sunday Roasts");

    expect(await store.unfollowList("ken", "sam", "Date Night")).toBe(true);

    expect(await store.isFollowingList("ken", "sam", "Date Night")).toBe(false);
    expect(await store.isFollowingList("ken", "lee", "Sunday Roasts")).toBe(true);
    expect((await store.listFollowedBy("ken")).map((list) => list.ownerHandle)).toEqual(["lee"]);
  });
});
