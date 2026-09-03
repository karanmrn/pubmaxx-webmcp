import "server-only";

// Friend-graph byproduct of planning a night together (WP7).
//
// When a signed-in, handle-claimed account joins a classic plan crew, form the
// mutual follow pair with every other claimed committed member already on that
// crew - unless either side blocks the other. Blocks are never downgraded.
// Idempotent: an existing mutual pair is a no-op success.

import {
  followStore,
  isSelfFollow,
  type FollowStore,
} from "@/lib/followStore";
import { normalizeHandle } from "@/lib/profiles";
import {
  isProfileTombstoned,
  profileStore,
  type ProfileRecord,
  type ProfileStore,
} from "@/lib/profileStore";
import {
  linkPlanMemberUser,
  listPlanMemberUserIds,
} from "@/lib/planCrewIdentity";
import {
  socialRelationshipBetweenProfiles,
  type SocialRelationshipServerDependencies,
} from "@/lib/socialRelationships.server";
import { socialMemoryBlocked } from "@/lib/socialBlockMemory";
import { isSupabaseConfigured } from "@/lib/supabase";

export type CrewFriendEdgeOutcome =
  | "created"
  | "already"
  | "blocked"
  | "unclaimed"
  | "self"
  | "unavailable";

export type CrewFriendEdgeFormResult = {
  formed: number;
  skippedBlocked: number;
  skippedUnclaimed: number;
  outcomes: CrewFriendEdgeOutcome[];
};

export type CrewFriendEdgeDependencies = {
  profiles: ProfileStore;
  follows: FollowStore;
  relationship: SocialRelationshipServerDependencies["queryRelationship"];
  linkMember: typeof linkPlanMemberUser;
  listMembers: typeof listPlanMemberUserIds;
  memoryBlocked: (a: string, b: string) => boolean;
  supabaseConfigured: () => boolean;
};

const defaultDependencies = (): CrewFriendEdgeDependencies => ({
  profiles: profileStore(),
  follows: followStore(),
  relationship: async (firstProfileId, secondProfileId) => {
    const { requireSupabaseAdmin } = await import("@/lib/supabase");
    const { data, error } = await requireSupabaseAdmin().rpc(
      "social_relationship_between_profiles",
      {
        p_first_profile_id: firstProfileId,
        p_second_profile_id: secondProfileId,
      },
    );
    if (error) throw new Error(error.message);
    return data;
  },
  linkMember: linkPlanMemberUser,
  listMembers: listPlanMemberUserIds,
  memoryBlocked: socialMemoryBlocked,
  supabaseConfigured: isSupabaseConfigured,
});

function isClaimedLive(profile: ProfileRecord | null): profile is ProfileRecord {
  return Boolean(
    profile &&
      profile.userId &&
      !isProfileTombstoned(profile) &&
      normalizeHandle(profile.handle),
  );
}

async function pairIsBlocked(
  first: ProfileRecord,
  second: ProfileRecord,
  deps: CrewFriendEdgeDependencies,
): Promise<boolean> {
  if (deps.memoryBlocked(first.id, second.id)) return true;
  if (!deps.supabaseConfigured()) return false;
  const relationship = await socialRelationshipBetweenProfiles(
    first.id,
    second.id,
    { queryRelationship: deps.relationship },
  );
  return relationship === "blocked";
}

/**
 * Create the mutual follow pair between two claimed handles when neither
 * blocks the other. Never creates edges for unclaimed or tombstoned profiles.
 */
export async function ensureMutualFollowPair(
  firstHandle: string,
  secondHandle: string,
  dependencies: Partial<CrewFriendEdgeDependencies> = {},
): Promise<CrewFriendEdgeOutcome> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const a = normalizeHandle(firstHandle);
  const b = normalizeHandle(secondHandle);
  if (!a || !b) return "unclaimed";
  if (isSelfFollow(a, b)) return "self";

  let first: ProfileRecord | null;
  let second: ProfileRecord | null;
  try {
    [first, second] = await Promise.all([
      deps.profiles.getByHandle(a),
      deps.profiles.getByHandle(b),
    ]);
  } catch {
    return "unavailable";
  }
  if (!isClaimedLive(first) || !isClaimedLive(second)) return "unclaimed";

  try {
    if (await pairIsBlocked(first, second, deps)) return "blocked";
  } catch {
    return "unavailable";
  }

  try {
    const [aFollowsB, bFollowsA] = await Promise.all([
      deps.follows.isFollowing(a, b),
      deps.follows.isFollowing(b, a),
    ]);
    if (aFollowsB && bFollowsA) return "already";
    await Promise.all([
      aFollowsB ? Promise.resolve(true) : deps.follows.follow(a, b),
      bFollowsA ? Promise.resolve(true) : deps.follows.follow(b, a),
    ]);
    return aFollowsB && bFollowsA ? "already" : "created";
  } catch {
    return "unavailable";
  }
}

/**
 * After a successful plan-crew join: stamp the joiner's auth user on their
 * member row, then form mutuals with every other claimed committed member.
 * Fail-soft: identity or edge failures never fail the join itself.
 */
export async function formFriendEdgesForPlanJoin(input: {
  planId: string;
  joinerUserId: string;
  joinerMemberId: string;
}, dependencies: Partial<CrewFriendEdgeDependencies> = {}): Promise<CrewFriendEdgeFormResult> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const empty: CrewFriendEdgeFormResult = {
    formed: 0,
    skippedBlocked: 0,
    skippedUnclaimed: 0,
    outcomes: [],
  };
  const userId = typeof input.joinerUserId === "string" ? input.joinerUserId.trim() : "";
  if (!userId || !input.planId || !input.joinerMemberId) return empty;

  let joiner: ProfileRecord | null;
  try {
    joiner = await deps.profiles.getByUserId(userId);
  } catch {
    return empty;
  }
  if (!isClaimedLive(joiner)) {
    return { ...empty, skippedUnclaimed: 1, outcomes: ["unclaimed"] };
  }

  try {
    await deps.linkMember(input.planId, input.joinerMemberId, userId);
  } catch {
    // Stamp failure still allows edge formation against already-linked peers.
  }

  let peers: Array<{ memberId: string; userId: string }>;
  try {
    peers = await deps.listMembers(input.planId);
  } catch {
    return empty;
  }

  const outcomes: CrewFriendEdgeOutcome[] = [];
  let formed = 0;
  let skippedBlocked = 0;
  let skippedUnclaimed = 0;

  for (const peer of peers) {
    if (peer.memberId === input.joinerMemberId) continue;
    if (peer.userId === userId) continue;
    let peerProfile: ProfileRecord | null;
    try {
      peerProfile = await deps.profiles.getByUserId(peer.userId);
    } catch {
      outcomes.push("unavailable");
      continue;
    }
    if (!isClaimedLive(peerProfile)) {
      skippedUnclaimed += 1;
      outcomes.push("unclaimed");
      continue;
    }
    const outcome = await ensureMutualFollowPair(
      joiner.handle,
      peerProfile.handle,
      deps,
    );
    outcomes.push(outcome);
    if (outcome === "created") formed += 1;
    else if (outcome === "blocked") skippedBlocked += 1;
    else if (outcome === "unclaimed") skippedUnclaimed += 1;
  }

  return { formed, skippedBlocked, skippedUnclaimed, outcomes };
}
