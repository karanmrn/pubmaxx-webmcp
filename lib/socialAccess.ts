import { accountIsAdult } from "@/lib/socialLaunch";

export type SocialAccessState =
  | "preview"
  | "sign_in_required"
  | "age_verification_required"
  | "verified"
  | "suspended";

export type SocialProductAccount = {
  id: string;
  ownershipState: "active" | "suspended";
};

export type FriendsLaunchSocialAccessInput = {
  friendsLaunchEnabled: boolean;
  supabaseUserId: string | null;
  claimedHandle: string | null;
  dateOfBirth: string | null;
  /** When the account tapped "I'm 18 or over" (migration 0103), or null. */
  adultSelfAssertedAt?: string | null;
  ownershipState: "active" | "suspended" | null;
  now: string | Date;
};

export function decideFriendsLaunchSocialAccess(
  input: FriendsLaunchSocialAccessInput,
): SocialAccessState {
  if (!input.friendsLaunchEnabled) return "preview";
  if (!input.supabaseUserId) return "sign_in_required";
  if (input.ownershipState === "suspended") return "suspended";
  const handle = input.claimedHandle?.trim() ?? "";
  if (!handle) return "age_verification_required";
  const now =
    input.now instanceof Date ? input.now.getTime() : Date.parse(input.now);
  if (!Number.isFinite(now)) return "age_verification_required";
  // ONE gate for the age question: a stored adult date of birth or a recorded
  // one-tap self-assertion. `lib/socialLaunch.ts` owns which of them decides.
  if (
    !accountIsAdult(
      {
        dateOfBirth: input.dateOfBirth,
        adultSelfAssertedAt: input.adultSelfAssertedAt ?? null,
      },
      now,
    )
  ) {
    return "age_verification_required";
  }
  return "verified";
}
