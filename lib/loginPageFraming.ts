import type { ArrivalIntent } from "@/lib/arrivalWelcome";

/**
 * What /login says before the live session answers, and what a first-time
 * drinker sees after it does. "Welcome back" is only for a returning session
 * (the welcome-back card or the signed-in card). A cold first paint that
 * borrowed the sign-in door title told first-timers they had been here.
 */

export const LOGIN_FIRST_TIME_TITLE = "Sign in or create your account";
export const LOGIN_FIRST_TIME_LEAD =
  "Use your email, or pick a handle after the link lands.";

export const LOGIN_SIGNED_IN_TITLE = "You are signed in";
export const LOGIN_SIGNED_IN_LEAD =
  "Your account is ready. Jump back into the map, or sign out.";

export const LOGIN_ADD_ACCOUNT_TITLE = "Add another account";
export const LOGIN_ADD_ACCOUNT_LEAD =
  "Sign in to the other account. This device keeps both, and you can switch between them whenever you like.";

/**
 * Whether the sign-in card's shape stands in while the session resolves. A
 * keyless build has no card to arrive, so the not-configured notice is the
 * whole answer there and a skeleton would promise something that never comes.
 */
export function loginPageShowsSkeleton({
  sessionKnown,
  hasAuthSurface,
}: {
  sessionKnown: boolean;
  hasAuthSurface: boolean;
}): boolean {
  return !sessionKnown && hasAuthSurface;
}

export function loginPageHeadCopy({
  sessionKnown,
  adding,
  signedIn,
  returning,
  intent,
  door,
}: {
  sessionKnown: boolean;
  adding: boolean;
  signedIn: boolean;
  returning: boolean;
  intent: ArrivalIntent;
  door: { title: string; lead: string };
}): { title: string; lead: string } {
  if (adding) {
    return { title: LOGIN_ADD_ACCOUNT_TITLE, lead: LOGIN_ADD_ACCOUNT_LEAD };
  }
  if (signedIn) {
    return { title: LOGIN_SIGNED_IN_TITLE, lead: LOGIN_SIGNED_IN_LEAD };
  }
  if (!sessionKnown) {
    return { title: LOGIN_FIRST_TIME_TITLE, lead: LOGIN_FIRST_TIME_LEAD };
  }
  if (returning || intent === "signup") {
    return door;
  }
  return { title: LOGIN_FIRST_TIME_TITLE, lead: LOGIN_FIRST_TIME_LEAD };
}
