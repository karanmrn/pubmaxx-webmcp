// Auth callback landing. Supabase Auth (Google / Apple / email magic link)
// redirects here after the user approves, carrying the implicit-flow session
// tokens in the URL FRAGMENT. The fragment never reaches this server; the
// browser carries it across our redirect below, and AuthProvider establishes
// the session from it on the landing page (see lib/authClient.ts and
// components/auth/AuthProvider.tsx).
//
// Why implicit rather than PKCE: the PKCE code-verifier lives in the
// REQUESTING browser's localStorage, so an email magic link opened in a
// different browser (Gmail app opening Safari) could never complete the
// exchange — Supabase verified the link, then the sign-in died client-side.
// Cross-browser email links matter more than keeping tokens out of the URL
// fragment, so that trade-off was reversed deliberately. This app depends only
// on @supabase/supabase-js (no @supabase/ssr cookie adapter), so a server-side
// exchange is not available either.
//
// Because the tokens are invisible here, this route cannot tell success from
// failure. It forwards every valid attempt to the safe target with the
// callback marker; the client decides. Only a query-visible provider error or
// a missing attempt id earns the authError flag, so the app can explain the
// failure without blocking browsing.

import { NextResponse } from "next/server";
import {
  AUTH_ATTEMPT_PARAM,
  AUTH_CALLBACK_MARKER,
  REFERRAL_SIGNUP_PROOF_PARAM,
  isAuthAttemptId,
  safeAuthNext,
} from "@/lib/authRedirect";
import { verifyReferralSignupProof } from "@/lib/referralSignupProof.server";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  const next = safeAuthNext(url.searchParams.get("next"), url.origin);
  const rawAttemptId = url.searchParams.get(AUTH_ATTEMPT_PARAM);
  const attemptId = isAuthAttemptId(rawAttemptId) ? rawAttemptId : null;
  const rawSignupProof = url.searchParams.get(REFERRAL_SIGNUP_PROOF_PARAM);
  const signupProof = attemptId
    ? verifyReferralSignupProof(rawSignupProof, attemptId)
    : null;

  // Google/Supabase reported a query-visible failure, or the attempt id is
  // missing → land on the app with a flag the UI renders, rather than a dead
  // callback page. Preserve the safe return path so a cancelled/expired
  // attempt does not lose user context.
  if (oauthError || !attemptId) {
    const dest = new URL(next, url.origin);
    dest.searchParams.set(AUTH_CALLBACK_MARKER, "1");
    if (attemptId) dest.searchParams.set(AUTH_ATTEMPT_PARAM, attemptId);
    dest.searchParams.set("authError", "1");
    return NextResponse.redirect(dest);
  }

  // Forward to the target path with the callback marker. The browser carries
  // the token (or error) fragment across this redirect; AuthProvider
  // establishes the session explicitly, then removes the one-time parameters
  // and the fragment from the URL.
  const dest = new URL(next, url.origin);
  dest.searchParams.set(AUTH_CALLBACK_MARKER, "1");
  dest.searchParams.set(AUTH_ATTEMPT_PARAM, attemptId);
  if (signupProof && rawSignupProof) {
    dest.searchParams.set(REFERRAL_SIGNUP_PROOF_PARAM, rawSignupProof);
  }
  // A fragment on Location would replace the token fragment the browser is
  // carrying. Legitimate callbacks never send one (buildAuthCallbackUrl strips
  // it); drop a crafted one rather than lose the session.
  dest.hash = "";
  return NextResponse.redirect(dest);
}
