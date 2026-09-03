import "server-only";

import {
  createTrustedHandoffFlagsDTO,
  isTrustedHandoffFlagKey,
  type TrustedHandoffFlagKey,
  type TrustedHandoffFlagsDTO,
} from "@/lib/trustedHandoffFlags";
import { isSocialFriendsLaunchEnabled } from "@/lib/socialLaunch";

export type TrustedHandoffFlagDefinition = Readonly<{
  env: string;
  ownerLane: string;
  removalCondition: string;
  offBehavior: string;
}>;

export const TRUSTED_HANDOFF_FLAG_DEFINITIONS = Object.freeze({
  mapRouteTransfer: {
    env: "PUBMAX_MAP_ROUTE_TRANSFER",
    ownerLane: "L12",
    removalCondition: "Remove after Map-to-Plan transfer is the stable default and legacy regeneration fallback retires.",
    offBehavior: "Existing Map preview remains; Plan can use its existing generation path.",
  },
  tonightGrouping: {
    env: "PUBMAX_TONIGHT_GROUPING",
    ownerLane: "L14",
    removalCondition: "Remove after canonical server grouping, locality, and diversity complete the rollback window.",
    offBehavior: "Retain schedule-safe chain duplicate collapse; disable only V2 server locality, diversity, and grouped response behavior.",
  },
  palHandoff: {
    env: "PUBMAX_PAL_HANDOFF",
    ownerLane: "L16",
    removalCondition: "Remove after Pal acceptance handoff is stable and old result navigation is retired.",
    offBehavior: "Existing Pal results remain; Pal does not write PlanningIntent.",
  },
  friendMemberRehydrationV2: {
    env: "PUBMAX_FRIEND_MEMBER_REHYDRATION_V2",
    ownerLane: "L10",
    removalCondition: "Remove after capability-aware member rehydration is the only supported full-state path.",
    offBehavior: "Everyone receives the safe privacy preview; anonymous Route leakage remains impossible.",
  },
  socialFriendsLaunch: {
    env: "PUBMAX_SOCIAL_FRIENDS_LAUNCH",
    ownerLane: "L21",
    removalCondition: "Remove after Social has a stable default and the emergency rollback window closes.",
    offBehavior: "Explicit 0 keeps Social in preview while the launch is rolled back.",
  },
} satisfies Record<TrustedHandoffFlagKey, TrustedHandoffFlagDefinition>);

export function parseTrustedHandoffFlag(value: string | undefined): boolean {
  return value === "1";
}

export function readTrustedHandoffFlags(
  env: Record<string, string | undefined> = process.env,
): TrustedHandoffFlagsDTO {
  return createTrustedHandoffFlagsDTO({
    mapRouteTransfer: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.mapRouteTransfer.env]),
    tonightGrouping: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.tonightGrouping.env]),
    palHandoff: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.palHandoff.env]),
    friendMemberRehydrationV2: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.friendMemberRehydrationV2.env]),
    socialFriendsLaunch: isSocialFriendsLaunchEnabled(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.socialFriendsLaunch.env]),
  });
}

export function readTrustedHandoffFlag(
  key: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!isTrustedHandoffFlagKey(key)) return false;
  if (key === "socialFriendsLaunch") {
    return isSocialFriendsLaunchEnabled(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS[key].env]);
  }
  return parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS[key].env]);
}
