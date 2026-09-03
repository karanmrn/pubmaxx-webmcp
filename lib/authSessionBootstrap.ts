import type { Session } from "@supabase/supabase-js";

import {
  fetchResumeHint,
  redeemPersistedSession,
  type RedeemResult,
  type ResumeHintReadOutcome,
} from "@/lib/authSessionResumeClient";

export type BrowserAuthSession = {
  getSession: () => Promise<{ data: { session: Session | null } }>;
  setSession: (session: {
    access_token: string;
    refresh_token: string;
  }) => Promise<{ error: unknown | null }>;
};

export type AuthSessionBootstrapOutcome =
  | { status: "local"; session: Session }
  | {
      status: "restored";
      session: { access_token: string; refresh_token: string };
    }
  | { status: "expired"; maskedEmail: string | null }
  | { status: "none" }
  | { status: "unavailable" };

export type AuthSessionBootstrapDeps = {
  readHint?: () => Promise<ResumeHintReadOutcome>;
  redeem?: () => Promise<RedeemResult>;
};

/** Two bounded same-origin resume calls can run on a slow mobile connection. */
export const AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS = 20_000;

/**
 * Resolve browser auth before the provider publishes a signed-out state.
 *
 * The local Supabase session is the fast path. A missing local session is not
 * proof of sign-out because iOS Safari and browser storage pressure can evict
 * it. Probe local storage for one microtask, then read the durable hint in
 * parallel with any slower local lookup. A missing hint is a truthful fast
 * anonymous answer; a present hint still waits for recovery before settling.
 */
export async function bootstrapAuthSession(
  auth: BrowserAuthSession,
  deps: AuthSessionBootstrapDeps = {},
): Promise<AuthSessionBootstrapOutcome> {
  let localSettled = false;
  let localSession: Session | null = null;
  let localReadFailed = false;
  let localSessionPromise: Promise<Session | null>;
  try {
    localSessionPromise = auth
      .getSession()
      .then(({ data }) => {
        localSettled = true;
        localSession = data.session ?? null;
        return localSession;
      })
      .catch(() => {
        localSettled = true;
        localReadFailed = true;
        localSession = null;
        return null;
      });
  } catch {
    localSettled = true;
    localReadFailed = true;
    localSessionPromise = Promise.resolve(null);
  }

  // Preserve the no-cookie fast path for a normal local session without
  // starting a resume request that cannot be needed. A slow local lookup does
  // not get to hold anonymous visitors behind the recovery ceiling.
  await Promise.resolve();
  if (localSettled && localReadFailed) return { status: "unavailable" };
  if (localSettled && localSession) return { status: "local", session: localSession };

  const readHint = deps.readHint ?? fetchResumeHint;
  const redeem = deps.redeem ?? redeemPersistedSession;
  let hint: ResumeHintReadOutcome;
  try {
    hint = await readHint();
  } catch {
    return { status: "unavailable" };
  }
  if (hint.status === "unavailable") return { status: "unavailable" };
  if (hint.status === "absent") {
    return localReadFailed ? { status: "unavailable" } : { status: "none" };
  }

  const resolvedLocalSession = await localSessionPromise;
  if (localReadFailed) return { status: "unavailable" };
  if (resolvedLocalSession) return { status: "local", session: resolvedLocalSession };

  let restored: RedeemResult;
  try {
    restored = await redeem();
  } catch {
    return { status: "unavailable" };
  }
  if (restored.status !== "restored") return restored;

  try {
    const result = await auth.setSession(restored.session);
    if (result.error) return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
  return { status: "restored", session: restored.session };
}
