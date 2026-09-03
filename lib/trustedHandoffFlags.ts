export const TRUSTED_HANDOFF_FLAG_KEYS = [
  "mapRouteTransfer",
  "tonightGrouping",
  "palHandoff",
  "friendMemberRehydrationV2",
  "socialFriendsLaunch",
] as const;

export type TrustedHandoffFlagKey = (typeof TRUSTED_HANDOFF_FLAG_KEYS)[number];

export type TrustedHandoffFlagsDTO = Readonly<Record<TrustedHandoffFlagKey, boolean>>;

export const TRUSTED_HANDOFF_FLAGS_OFF: TrustedHandoffFlagsDTO = Object.freeze({
  mapRouteTransfer: false,
  tonightGrouping: false,
  palHandoff: false,
  friendMemberRehydrationV2: false,
  socialFriendsLaunch: false,
});

export function createTrustedHandoffFlagsDTO(
  values: Record<TrustedHandoffFlagKey, boolean>,
): TrustedHandoffFlagsDTO {
  return Object.freeze({
    mapRouteTransfer: values.mapRouteTransfer,
    tonightGrouping: values.tonightGrouping,
    palHandoff: values.palHandoff,
    friendMemberRehydrationV2: values.friendMemberRehydrationV2,
    socialFriendsLaunch: values.socialFriendsLaunch,
  });
}

export function isTrustedHandoffFlagKey(value: string): value is TrustedHandoffFlagKey {
  return (TRUSTED_HANDOFF_FLAG_KEYS as readonly string[]).includes(value);
}

export function trustedHandoffFlagEnabled(
  flags: TrustedHandoffFlagsDTO,
  key: string,
): boolean {
  return isTrustedHandoffFlagKey(key) ? flags[key] : false;
}
