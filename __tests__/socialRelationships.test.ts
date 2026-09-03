import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; input: Record<string, unknown> }>,
  data: "mutual" as unknown,
  error: null as { message: string } | null,
}));

vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => ({
    rpc: async (name: string, input: Record<string, unknown>) => {
      supabase.calls.push({ name, input });
      return { data: supabase.data, error: supabase.error };
    },
  }),
}));

import {
  socialRelationshipBetweenProfiles,
  type SocialRelationshipServerDependencies,
} from "@/lib/socialRelationships.server";

const ALICE_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const BOB_PROFILE_ID = "22222222-2222-4222-8222-222222222222";

function graphDependencies(input: {
  follows?: ReadonlyArray<readonly [string, string]>;
  blocks?: ReadonlyArray<readonly [string, string]>;
}): SocialRelationshipServerDependencies {
  const follows = new Set(
    (input.follows ?? []).map(([follower, followed]) => `${follower}:${followed}`),
  );
  const blocks = new Set(
    (input.blocks ?? []).map(([blocker, blocked]) => `${blocker}:${blocked}`),
  );
  return {
    queryRelationship: async (firstProfileId, secondProfileId) => {
      if (
        blocks.has(`${firstProfileId}:${secondProfileId}`) ||
        blocks.has(`${secondProfileId}:${firstProfileId}`)
      ) {
        return "blocked";
      }
      return follows.has(`${firstProfileId}:${secondProfileId}`) &&
        follows.has(`${secondProfileId}:${firstProfileId}`)
        ? "mutual"
        : "not_mutual";
    },
  };
}

beforeEach(() => {
  supabase.calls = [];
  supabase.data = "mutual";
  supabase.error = null;
});

describe("stable Social relationships", () => {
  it("recognises reciprocal profile follows as mutual", async () => {
    const dependencies = graphDependencies({
      follows: [
        [ALICE_PROFILE_ID, BOB_PROFILE_ID],
        [BOB_PROFILE_ID, ALICE_PROFILE_ID],
      ],
    });

    await expect(
      socialRelationshipBetweenProfiles(
        ALICE_PROFILE_ID,
        BOB_PROFILE_ID,
        dependencies,
      ),
    ).resolves.toBe("mutual");
  });

  it("does not promote a one-way profile follow to mutual", async () => {
    const dependencies = graphDependencies({
      follows: [[ALICE_PROFILE_ID, BOB_PROFILE_ID]],
    });

    await expect(
      socialRelationshipBetweenProfiles(
        ALICE_PROFILE_ID,
        BOB_PROFILE_ID,
        dependencies,
      ),
    ).resolves.toBe("not_mutual");
  });

  it.each([
    { blocks: [[ALICE_PROFILE_ID, BOB_PROFILE_ID]] as const },
    { blocks: [[BOB_PROFILE_ID, ALICE_PROFILE_ID]] as const },
  ])("treats a block in either profile direction as blocked", async ({ blocks }) => {
    const dependencies = graphDependencies({
      follows: [
        [ALICE_PROFILE_ID, BOB_PROFILE_ID],
        [BOB_PROFILE_ID, ALICE_PROFILE_ID],
      ],
      blocks,
    });

    await expect(
      socialRelationshipBetweenProfiles(
        ALICE_PROFILE_ID,
        BOB_PROFILE_ID,
        dependencies,
      ),
    ).resolves.toBe("blocked");
  });

  it("resolves one profile as self without consulting storage", async () => {
    const dependencies: SocialRelationshipServerDependencies = {
      queryRelationship: async () => {
        throw new Error("must not run");
      },
    };

    await expect(
      socialRelationshipBetweenProfiles(
        ALICE_PROFILE_ID,
        ALICE_PROFILE_ID,
        dependencies,
      ),
    ).resolves.toBe("self");
  });

  it.each([
    ["", ""],
    ["alice", "alice"],
    ["alice", BOB_PROFILE_ID],
    [ALICE_PROFILE_ID, "bob"],
  ])(
    "rejects malformed profile IDs before self or storage authority",
    async (firstProfileId, secondProfileId) => {
      const queryRelationship = vi.fn(async () => "mutual");

      await expect(
        socialRelationshipBetweenProfiles(firstProfileId, secondProfileId, {
          queryRelationship,
        }),
      ).resolves.toBe("unavailable");
      expect(queryRelationship).not.toHaveBeenCalled();
    },
  );

  it("rejects self authority from an adapter for distinct profiles", async () => {
    const dependencies: SocialRelationshipServerDependencies = {
      queryRelationship: async () => "self",
    };

    await expect(
      socialRelationshipBetweenProfiles(
        ALICE_PROFILE_ID,
        BOB_PROFILE_ID,
        dependencies,
      ),
    ).resolves.toBe("unavailable");
  });

  it("returns unavailable when relationship storage fails", async () => {
    const dependencies: SocialRelationshipServerDependencies = {
      queryRelationship: async () => {
        throw new Error("offline");
      },
    };

    await expect(
      socialRelationshipBetweenProfiles(
        ALICE_PROFILE_ID,
        BOB_PROFILE_ID,
        dependencies,
      ),
    ).resolves.toBe("unavailable");
  });

  it("accepts only closed relationship results", async () => {
    const dependencies: SocialRelationshipServerDependencies = {
      queryRelationship: async () => "friends",
    };

    await expect(
      socialRelationshipBetweenProfiles(
        ALICE_PROFILE_ID,
        BOB_PROFILE_ID,
        dependencies,
      ),
    ).resolves.toBe("unavailable");
  });

  it("uses one scalar admin RPC with stable profile IDs", async () => {
    await expect(
      socialRelationshipBetweenProfiles(ALICE_PROFILE_ID, BOB_PROFILE_ID),
    ).resolves.toBe("mutual");
    expect(supabase.calls).toEqual([
      {
        name: "social_relationship_between_profiles",
        input: {
          p_first_profile_id: ALICE_PROFILE_ID,
          p_second_profile_id: BOB_PROFILE_ID,
        },
      },
    ]);
  });

  it("rejects self authority from the scalar RPC for distinct profiles", async () => {
    supabase.data = "self";

    await expect(
      socialRelationshipBetweenProfiles(ALICE_PROFILE_ID, BOB_PROFILE_ID),
    ).resolves.toBe("unavailable");
  });

  it("fails closed when the scalar RPC reports an error", async () => {
    supabase.error = { message: "relationship unavailable" };

    await expect(
      socialRelationshipBetweenProfiles(ALICE_PROFILE_ID, BOB_PROFILE_ID),
    ).resolves.toBe("unavailable");
  });
});
