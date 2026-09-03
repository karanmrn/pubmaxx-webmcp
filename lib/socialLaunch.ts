import { londonCalendarDate } from "@/lib/privateIdentity";
import type { SocialAccessState } from "@/lib/socialAccess";

/** Registry env for the friends-only Social launch switch. */
export const SOCIAL_FRIENDS_LAUNCH_ENV = "PUBMAX_SOCIAL_FRIENDS_LAUNCH";
export const SOCIAL_ROLLBACK_ERROR = "Social is in preview right now.";
export const SOCIAL_ROLLBACK_CODE = "SOCIAL_PREVIEW";

export function isSocialFriendsLaunchEnabled(
  value: string | undefined,
): boolean {
  // Social is live by default. Keep an explicit 0 as an emergency rollback
  // while the first production window settles.
  return value !== "0";
}

/** Search indexing follows the same launch flag the nav already reads. */
export function socialDocumentRobots(friendsLaunchEnabled = true): {
  index: boolean;
  follow: boolean;
} {
  return friendsLaunchEnabled
    ? { index: true, follow: true }
    : { index: false, follow: true };
}

export function socialListedInSitemap(friendsLaunchEnabled = true): boolean {
  return friendsLaunchEnabled;
}

export const SOCIAL_LAUNCH_NAV_LABEL = "Social";
export const SOCIAL_PREVIEW_NAV_LABEL = "Social preview";

/** In-page headings, desktop nav and loading lines use the surface name. */
export function socialSurfaceName(friendsLaunchEnabled = true): string {
  return friendsLaunchEnabled
    ? SOCIAL_LAUNCH_NAV_LABEL
    : SOCIAL_PREVIEW_NAV_LABEL;
}

export function socialLoadingLabel(friendsLaunchEnabled = true): string {
  return `Loading ${socialSurfaceName(friendsLaunchEnabled)}`;
}

export type SocialBoundaryCopyState =
  | Exclude<SocialAccessState, "verified">
  | "unavailable";

/** Empty-state lines for SocialAccessBoundary — surface name follows the launch flag. */
export function socialBoundaryCopy(
  state: SocialBoundaryCopyState,
  friendsLaunchEnabled = true,
): string {
  const surface = socialSurfaceName(friendsLaunchEnabled);
  switch (state) {
    case "preview":
      return `${surface} is invite-only for now. It opens more widely soon.`;
    case "sign_in_required":
      return `Sign in to use ${surface}.`;
    case "age_verification_required":
      return `Adult check needed for ${surface}.`;
    case "suspended":
      return `${surface} access is suspended.`;
    case "unavailable":
      return `${surface} is unavailable right now.`;
  }
}

export function socialInviteMessage(friendsLaunchEnabled = true): string {
  return `Use ${socialSurfaceName(friendsLaunchEnabled)}.`;
}

export function adultSelfAssertionLine(friendsLaunchEnabled = true): string {
  return `${socialSurfaceName(friendsLaunchEnabled)} is for over-18s.`;
}

/** Body dataset written by root layout (`data-social-friends-launch`). */
export function readSocialFriendsLaunchFromDocument(): boolean {
  // A read that cannot answer fails OPEN, the same way an absent document
  // does: the body is not guaranteed to exist when a client component first
  // renders, and throwing here takes the whole surface down over an optional
  // flag.
  if (typeof document === "undefined") return true;
  return document.body?.dataset?.socialFriendsLaunch !== "0";
}

export function subscribeSocialFriendsLaunchFromDocument(): () => void {
  // The flag is env-driven and only changes on a full navigation after deploy.
  return () => {};
}

/**
 * What the product may say when it asks the age question. The line itself is
 * `adultSelfAssertionLine`, because the surface name follows the launch flag;
 * the button is flag-blind and lives here. One place each, because the prompt,
 * the button and the refusal are read together and a second copy of any of
 * them would drift from the others.
 */
export const ADULT_SELF_ASSERTION_ACTION = "I'm 18 or over";

/** Self-asserted 18+ from onboarding date of birth (London calendar day). */
export function isAdultDateOfBirth(
  dateOfBirth: string,
  now: number = Date.now(),
): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth.trim());
  if (!match) return false;
  const birthYear = Number(match[1]);
  const birthMonth = Number(match[2]);
  const birthDay = Number(match[3]);
  const today = londonCalendarDate(now);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  let age = todayYear - birthYear;
  if (todayMonth < birthMonth || (todayMonth === birthMonth && todayDay < birthDay)) {
    age -= 1;
  }
  return age >= 18;
}

/**
 * The two things an account may have said about its own age. Both are
 * optional, and BOTH being absent is a real third answer: nobody has asked yet.
 */
export type AccountAdultEvidence = {
  /** From the private identity row, when the account has one. */
  dateOfBirth?: string | null;
  /** When the account tapped "I'm 18 or over" (migration 0103). */
  adultSelfAssertedAt?: string | null;
};

/** A recorded assertion is a real instant somebody tapped, or it is nothing. */
export function isRecordedAdultAssertion(
  assertedAt: string | null | undefined,
): boolean {
  if (typeof assertedAt !== "string") return false;
  const stamp = assertedAt.trim();
  return stamp !== "" && Number.isFinite(Date.parse(stamp));
}

/**
 * THE ONE adult gate. Captain decision 2026-08-10: an account that says it is
 * 18 or over is taken at its word, so a recorded self-assertion passes.
 *
 * A stored date of birth still DECIDES when there is one, in both directions:
 * an assertion may answer the age question when nobody has answered it, and it
 * may never overturn an answer the account already gave. Otherwise a person who
 * told us they were 15 could tap their way past their own answer.
 */
export function accountIsAdult(
  evidence: AccountAdultEvidence,
  now: number = Date.now(),
): boolean {
  const dateOfBirth = evidence.dateOfBirth?.trim() ?? "";
  if (dateOfBirth) return isAdultDateOfBirth(dateOfBirth, now);
  return isRecordedAdultAssertion(evidence.adultSelfAssertedAt);
}

/**
 * Whether the one-tap prompt is the way through for this account. False once
 * either answer exists, so an account whose stored date of birth says under 18
 * is never offered a tap that would not be honoured, and an account that
 * already tapped is never asked twice.
 */
export function needsAdultSelfAssertion(
  evidence: AccountAdultEvidence,
): boolean {
  const dateOfBirth = evidence.dateOfBirth?.trim() ?? "";
  return !dateOfBirth && !isRecordedAdultAssertion(evidence.adultSelfAssertedAt);
}
