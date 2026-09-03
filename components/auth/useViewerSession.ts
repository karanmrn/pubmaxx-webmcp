"use client";

// Whether the viewer is signed in, and whether we have been told yet.
//
// ONE owner, because the rule was got wrong on every surface that offers a
// sign-in door. A signed-in drinker browsed Social and their own profile and
// met "Sign in to use Social", "Sign in to follow" and a "Continue with email"
// form: each surface had read `user === null` from the auth context and taken
// that for a settled answer. A null user is not proof of sign-out - the browser
// Supabase client loads lazily, durable resume may still restore an account,
// and a chunk that will not load has told us nothing at all.
//
// #1239 taught the landing header this rule. This module is that rule as one
// seam so a page cannot learn it separately, or forget it.
//
// The authority is `providerAuthState` (lib/authProviderRevision.ts), which is
// already provider-neutral and already tri-state. A user in context outranks
// it: an account is signed in the moment its session is known, even while the
// rest of bootstrap finishes.

import { useAuth } from "@/components/auth/authContext";
import { providerHasAnswered } from "@/lib/authProviderRevision";

/** Three answers, never two. `unresolved` is "we have not been told". */
export type ViewerSessionPhase = "unresolved" | "signed-in" | "signed-out";

export type ViewerSession = {
  phase: ViewerSessionPhase;
  /** The live session has answered, and it named an account. */
  signedIn: boolean;
  /**
   * The live session has answered, and it named nobody. ONLY this may paint a
   * sign-in invitation: it is a claim about the viewer, and a claim needs an
   * answer behind it.
   */
  signedOut: boolean;
  /** No answer yet. A surface that names or routes the viewer stays neutral. */
  unresolved: boolean;
};

/** The viewer's session phase, from the one provider-neutral authority. */
export function useViewerSessionPhase(): ViewerSessionPhase {
  const { user, providerAuthState } = useAuth();
  if (user) return "signed-in";
  if (!providerHasAnswered(providerAuthState)) {
    return "unresolved";
  }
  return "signed-out";
}

/** The viewer's session phase, with the three predicates a surface reads. */
export function useViewerSession(): ViewerSession {
  const phase = useViewerSessionPhase();
  return {
    phase,
    signedIn: phase === "signed-in",
    signedOut: phase === "signed-out",
    unresolved: phase === "unresolved",
  };
}
