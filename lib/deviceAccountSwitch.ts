// Making a remembered account the ACTIVE one, and nothing else.
//
// THE LAW THIS KEEPS: one account owns the device artifacts at a time, and the
// binding happens in exactly one place - `AuthProvider.updateSession`, on the
// ordinary auth event. So a switch does the smallest possible thing: it mints a
// session from the stored refresh token (lib/deviceAccountSessions.ts) and hands
// it to `supabase.auth.setSession`. That fires SIGNED_IN through the provider's
// own subscription, which binds the new owner, drops the previous account's
// whole artifact set in one pass, re-reads the canonical handle, and re-persists
// the durable resume cookie for the account that is now active. Nothing here
// writes `pubmax_handle`, stamps an owner, or touches the resume cookie: a
// second copy of that binding is a second chance to bind the wrong person.
//
// WHY THE MINT IS A PLAIN GOTRUE CALL rather than `auth.refreshSession`: a
// refresh that FAILS inside the live client can tear the live session down with
// it, so a dead token on the account you are switching TO would sign you out of
// the account you are switching FROM. A bare token exchange cannot touch the
// live session at all, and only its success reaches `setSession`. It is the same
// exchange the durable resume cookie already redeems server-side
// (app/api/auth/session, action "redeem"), against the same endpoint.
//
// AN OUTCOME IS THREE-WAY, never a boolean. "GoTrue refused this token" and "we
// could not ask" are different findings: the first retires the token and offers
// the owner a sign-in, the second keeps the token because a network fault is not
// evidence a credential died.

import { ensureSupabaseBrowser } from "@/lib/authClient";
import {
  markDeviceAccountNeedsSignIn,
  readDeviceAccounts,
  rememberDeviceAccount,
} from "@/lib/deviceAccountSessions";
import { discardBody } from "@/lib/responseBody";

const MINT_TIMEOUT_MS = 10_000;

type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The short-lived pair a mint returns. Exactly what `setSession` accepts. */
export type MintedSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
};

export type MintOutcome =
  | { status: "minted"; session: MintedSession }
  /** GoTrue answered that this token is dead. Retire it. */
  | { status: "refused" }
  /** We could not ask, or could not understand the answer. Keep the token. */
  | { status: "unavailable" };

export type DeviceAccountSwitchOutcome =
  | { status: "switched"; userId: string }
  | { status: "needs_sign_in"; userId: string }
  | { status: "unavailable" };

export type DeviceAccountSwitchDeps = {
  storage: WritableStorage | null;
  fetchImpl: typeof fetch;
  authConfig: { url: string; key: string } | null;
  /** Install the minted session on the live client. The auth event does the rest. */
  setSession: (session: MintedSession) => Promise<{ ok: boolean }>;
};

function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(MINT_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

/**
 * A GoTrue token answer, or null. Both tokens must be present: an answer
 * carrying only an access token would install a session with no way to renew.
 */
export function parseMintedSession(body: unknown): MintedSession | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (typeof row.access_token !== "string" || !row.access_token) return null;
  if (typeof row.refresh_token !== "string" || !row.refresh_token) return null;
  return {
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    ...(typeof row.expires_in === "number" ? { expires_in: row.expires_in } : {}),
    ...(typeof row.expires_at === "number" ? { expires_at: row.expires_at } : {}),
    ...(typeof row.token_type === "string" ? { token_type: row.token_type } : {}),
  };
}

/** Exchange a stored refresh token for a live session, touching nothing. */
export async function mintSessionFromRefreshToken(
  refreshToken: string,
  deps: Pick<DeviceAccountSwitchDeps, "fetchImpl" | "authConfig">,
): Promise<MintOutcome> {
  if (!deps.authConfig) return { status: "unavailable" };
  const signal = timeoutSignal();
  let response: Response;
  try {
    response = await deps.fetchImpl(
      new URL(
        "/auth/v1/token?grant_type=refresh_token",
        deps.authConfig.url,
      ).toString(),
      {
        method: "POST",
        headers: {
          apikey: deps.authConfig.key,
          "content-type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: "no-store",
        ...(signal ? { signal } : {}),
      },
    );
  } catch {
    // Network trouble is not evidence the token died.
    return { status: "unavailable" };
  }
  if (!response.ok) {
    const refused = response.status >= 400 && response.status < 500;
    discardBody(response);
    return refused ? { status: "refused" } : { status: "unavailable" };
  }
  const body = await response.json().catch(() => null);
  const session = parseMintedSession(body);
  return session ? { status: "minted", session } : { status: "unavailable" };
}

/**
 * Make a remembered account active.
 *
 * The rotated refresh token is written to the row BEFORE the session is
 * installed, because GoTrue spends a refresh token on use: a crash between the
 * two would otherwise leave this device holding a token that can never work
 * again. Writing first costs nothing, since a minted-but-uninstalled token is
 * still good for the next attempt.
 */
export async function activateDeviceAccount(
  userId: string,
  deps: DeviceAccountSwitchDeps,
): Promise<DeviceAccountSwitchOutcome> {
  const row = readDeviceAccounts(deps.storage).find(
    (account) => account.userId === userId,
  );
  if (!row) return { status: "needs_sign_in", userId };
  if (!row.refreshToken) return { status: "needs_sign_in", userId };

  const minted = await mintSessionFromRefreshToken(row.refreshToken, deps);
  if (minted.status === "refused") {
    markDeviceAccountNeedsSignIn(deps.storage, userId);
    return { status: "needs_sign_in", userId };
  }
  if (minted.status === "unavailable") return { status: "unavailable" };

  rememberDeviceAccount(
    deps.storage,
    { userId, refreshToken: minted.session.refresh_token },
    row.lastActiveAt,
  );
  const installed = await deps.setSession(minted.session);
  if (!installed.ok) return { status: "unavailable" };
  return { status: "switched", userId };
}

function browserLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The public Supabase browser env, or null on a keyless build. */
export function browserAuthConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/** The real browser wiring. One place, so a caller cannot assemble its own. */
export function browserDeviceAccountSwitchDeps(): DeviceAccountSwitchDeps {
  return {
    storage: browserLocalStorage(),
    fetchImpl: (...args) => fetch(...args),
    authConfig: browserAuthConfig(),
    async setSession(session) {
      const supabase = await ensureSupabaseBrowser().catch(() => null);
      if (!supabase) return { ok: false };
      const { error } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      return { ok: !error };
    },
  };
}

/** Switch this device to a remembered account. */
export async function switchToDeviceAccount(
  userId: string,
): Promise<DeviceAccountSwitchOutcome> {
  return activateDeviceAccount(userId, browserDeviceAccountSwitchDeps());
}
