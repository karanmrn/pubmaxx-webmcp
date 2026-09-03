import "server-only";

import { requireSupabaseAdmin } from "@/lib/supabase";

export type SocialRelationshipState =
  | "self"
  | "mutual"
  | "not_mutual"
  | "blocked";

export type SocialRelationshipResolution =
  | SocialRelationshipState
  | "unavailable";

type StoredSocialRelationshipState = Exclude<
  SocialRelationshipState,
  "self"
>;

export type SocialRelationshipServerDependencies = {
  queryRelationship: (
    firstProfileId: string,
    secondProfileId: string,
  ) => Promise<unknown>;
};

const defaultDependencies: SocialRelationshipServerDependencies = {
  async queryRelationship(firstProfileId, secondProfileId) {
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
};

function isProfileId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isStoredSocialRelationshipState(
  value: unknown,
): value is StoredSocialRelationshipState {
  return (
    value === "mutual" ||
    value === "not_mutual" ||
    value === "blocked"
  );
}

export async function socialRelationshipBetweenProfiles(
  firstProfileId: string,
  secondProfileId: string,
  dependencies: SocialRelationshipServerDependencies = defaultDependencies,
): Promise<SocialRelationshipResolution> {
  if (!isProfileId(firstProfileId) || !isProfileId(secondProfileId)) {
    return "unavailable";
  }
  if (firstProfileId === secondProfileId) return "self";
  try {
    const relationship = await dependencies.queryRelationship(
      firstProfileId,
      secondProfileId,
    );
    return isStoredSocialRelationshipState(relationship)
      ? relationship
      : "unavailable";
  } catch {
    return "unavailable";
  }
}
