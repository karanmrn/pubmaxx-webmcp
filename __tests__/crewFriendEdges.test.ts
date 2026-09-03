// WP7: mutual follow edges form as a byproduct of classic plan-crew join.
// Blocks are never downgraded; unclaimed handles never get edges; re-join is
// idempotent.

import { beforeEach, describe, expect, it } from "vitest";

import {
  ensureMutualFollowPair,
  formFriendEdgesForPlanJoin,
} from "@/lib/crewFriendEdges";
import {
  memoryFollowStore,
  __resetMemoryFollows,
} from "@/lib/followStore";
import {
  memoryProfileStore,
  __resetMemoryProfiles,
} from "@/lib/profileStore";
import {
  clearSocialMemoryBlocks,
  setSocialMemoryBlock,
} from "@/lib/socialBlockMemory";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryFollows();
  __resetMemoryProfiles();
  clearSocialMemoryBlocks();
});

async function claimed(handle: string, userId: string) {
  return memoryProfileStore.createOwned(handle, userId);
}

describe("ensureMutualFollowPair", () => {
  it("creates both directions between claimed handles", async () => {
    await claimed("host", "user-host");
    await claimed("guest", "user-guest");

    const outcome = await ensureMutualFollowPair("host", "guest", {
      profiles: memoryProfileStore,
      follows: memoryFollowStore,
      supabaseConfigured: () => false,
      memoryBlocked: () => false,
    });

    expect(outcome).toBe("created");
    expect(await memoryFollowStore.isFollowing("host", "guest")).toBe(true);
    expect(await memoryFollowStore.isFollowing("guest", "host")).toBe(true);
  });

  it("is idempotent when the mutual pair already exists", async () => {
    await claimed("host", "user-host");
    await claimed("guest", "user-guest");
    await memoryFollowStore.follow("host", "guest");
    await memoryFollowStore.follow("guest", "host");

    const outcome = await ensureMutualFollowPair("host", "guest", {
      profiles: memoryProfileStore,
      follows: memoryFollowStore,
      supabaseConfigured: () => false,
      memoryBlocked: () => false,
    });

    expect(outcome).toBe("already");
    expect(await memoryFollowStore.counts("host")).toEqual({
      followers: 1,
      following: 1,
    });
  });

  it("never creates edges across a memory block", async () => {
    const host = await claimed("host", "user-host");
    const guest = await claimed("guest", "user-guest");
    setSocialMemoryBlock(host.id, guest.id, true);

    const outcome = await ensureMutualFollowPair("host", "guest", {
      profiles: memoryProfileStore,
      follows: memoryFollowStore,
      supabaseConfigured: () => false,
      // Use the real memory block map.
    });

    expect(outcome).toBe("blocked");
    expect(await memoryFollowStore.isFollowing("host", "guest")).toBe(false);
    expect(await memoryFollowStore.isFollowing("guest", "host")).toBe(false);
  });

  it("skips unclaimed handles", async () => {
    await claimed("host", "user-host");
    await memoryProfileStore.ensure("ghost");

    const outcome = await ensureMutualFollowPair("host", "ghost", {
      profiles: memoryProfileStore,
      follows: memoryFollowStore,
      supabaseConfigured: () => false,
      memoryBlocked: () => false,
    });

    expect(outcome).toBe("unclaimed");
    expect(await memoryFollowStore.isFollowing("host", "ghost")).toBe(false);
  });
});

describe("formFriendEdgesForPlanJoin", () => {
  it("forms mutuals with every other claimed stamped member", async () => {
    await claimed("host", "user-host");
    await claimed("mate", "user-mate");
    await claimed("guest", "user-guest");

    const result = await formFriendEdgesForPlanJoin(
      {
        planId: "plan_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        joinerUserId: "user-guest",
        joinerMemberId: "mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        profiles: memoryProfileStore,
        follows: memoryFollowStore,
        supabaseConfigured: () => false,
        memoryBlocked: () => false,
        linkMember: async () => true,
        listMembers: async () => [
          { memberId: "mem_hosthosthosthosthosthosthosthost", userId: "user-host" },
          { memberId: "mem_matematematematematematematemate", userId: "user-mate" },
          {
            memberId: "mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            userId: "user-guest",
          },
        ],
      },
    );

    expect(result.formed).toBe(2);
    expect(await memoryFollowStore.isFollowing("guest", "host")).toBe(true);
    expect(await memoryFollowStore.isFollowing("host", "guest")).toBe(true);
    expect(await memoryFollowStore.isFollowing("guest", "mate")).toBe(true);
    expect(await memoryFollowStore.isFollowing("mate", "guest")).toBe(true);
  });

  it("respects blocks and still forms with unblocked peers", async () => {
    const host = await claimed("host", "user-host");
    const mate = await claimed("mate", "user-mate");
    const guest = await claimed("guest", "user-guest");
    setSocialMemoryBlock(host.id, guest.id, true);

    const result = await formFriendEdgesForPlanJoin(
      {
        planId: "plan_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        joinerUserId: "user-guest",
        joinerMemberId: "mem_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      {
        profiles: memoryProfileStore,
        follows: memoryFollowStore,
        supabaseConfigured: () => false,
        linkMember: async () => true,
        listMembers: async () => [
          { memberId: "mem_hosthosthosthosthosthosthosthost", userId: "user-host" },
          { memberId: "mem_matematematematematematematemate", userId: "user-mate" },
          {
            memberId: "mem_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            userId: "user-guest",
          },
        ],
      },
    );

    expect(result.skippedBlocked).toBe(1);
    expect(result.formed).toBe(1);
    expect(await memoryFollowStore.isFollowing("guest", "host")).toBe(false);
    expect(await memoryFollowStore.isFollowing("guest", "mate")).toBe(true);
    expect(await memoryFollowStore.isFollowing("mate", "guest")).toBe(true);
    // Block must still stand - no half edge either way.
    expect(await memoryFollowStore.isFollowing("host", "guest")).toBe(false);
    void mate;
  });

  it("second join against the same peers reports already, not a second create", async () => {
    await claimed("host", "user-host");
    await claimed("guest", "user-guest");
    const deps = {
      profiles: memoryProfileStore,
      follows: memoryFollowStore,
      supabaseConfigured: () => false,
      memoryBlocked: () => false,
      linkMember: async () => true,
      listMembers: async () => [
        { memberId: "mem_hosthosthosthosthosthosthosthost", userId: "user-host" },
        {
          memberId: "mem_cccccccccccccccccccccccccccccccc",
          userId: "user-guest",
        },
      ],
    };

    const first = await formFriendEdgesForPlanJoin(
      {
        planId: "plan_cccccccccccccccccccccccccccccccc",
        joinerUserId: "user-guest",
        joinerMemberId: "mem_cccccccccccccccccccccccccccccccc",
      },
      deps,
    );
    expect(first.formed).toBe(1);

    const second = await formFriendEdgesForPlanJoin(
      {
        planId: "plan_cccccccccccccccccccccccccccccccc",
        joinerUserId: "user-guest",
        joinerMemberId: "mem_cccccccccccccccccccccccccccccccc",
      },
      deps,
    );
    expect(second.formed).toBe(0);
    expect(second.outcomes).toContain("already");
    expect(await memoryFollowStore.counts("guest")).toEqual({
      followers: 1,
      following: 1,
    });
  });

  it("skips when the joiner has no claimed handle", async () => {
    await claimed("host", "user-host");

    const result = await formFriendEdgesForPlanJoin(
      {
        planId: "plan_dddddddddddddddddddddddddddddddd",
        joinerUserId: "user-nobody",
        joinerMemberId: "mem_dddddddddddddddddddddddddddddddd",
      },
      {
        profiles: memoryProfileStore,
        follows: memoryFollowStore,
        supabaseConfigured: () => false,
        linkMember: async () => true,
        listMembers: async () => [
          { memberId: "mem_hosthosthosthosthosthosthosthost", userId: "user-host" },
        ],
      },
    );

    expect(result.skippedUnclaimed).toBe(1);
    expect(result.formed).toBe(0);
  });
});
