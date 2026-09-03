import { BADGE_EVENTS, type BadgeEventProgressOptions } from "@/lib/badgeEvents";
import type { BadgeEventOptInState } from "@/lib/badgeEventOptIn";

type ProfileBadgeEventGateInput = {
  isOwnPassport: boolean;
  legacyMode: boolean;
  now: string | null;
  optIns: BadgeEventOptInState;
};

export function buildProfileBadgeEventOptions(
  input: ProfileBadgeEventGateInput,
): BadgeEventProgressOptions | undefined {
  if (!input.isOwnPassport || input.legacyMode || !input.now) return undefined;
  if (input.optIns.optedInEventIds.length === 0) return undefined;

  return {
    events: BADGE_EVENTS,
    now: input.now,
    optedInEventIds: input.optIns.optedInEventIds,
    optedInAtByEventId: input.optIns.optedInAtByEventId,
    legacyMode: false,
  };
}
