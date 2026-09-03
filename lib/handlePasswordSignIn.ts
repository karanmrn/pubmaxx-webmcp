import "server-only";

// Server-side password facts. Never import this from a browser module: it
// resolves an account's auth email and speaks to GoTrue with the service role.
//
// The password itself is Supabase auth's to keep. Nothing here writes one, and
// nothing here logs one. Setting a password is the OWNER's own call from a
// signed-in browser (`components/auth/SetAccountPassword.tsx`), because GoTrue
// binds `updateUser` to the caller's own JWT: a service-role write path would
// be able to set anybody's password, and a bug in actor resolution there is
// account takeover.

import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";
import { discardBody } from "@/lib/responseBody";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export type HandlePasswordSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
};

function supabaseAuthConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/** Resolve the auth email for a linked handle. Never expose this to browsers. */
export async function resolveAuthEmailForHandle(handle: string): Promise<string | null> {
  const normalized = normalizeHandle(handle);
  if (!normalized) return null;

  const profile = await profileStore().getByHandle(normalized);
  const userId = profile?.userId;
  if (!userId) return null;

  if (!isSupabaseConfigured()) return null;

  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return null;
  return data.user.email;
}

/**
 * Does this account already have a password?
 *
 * TRI-STATE, for the reason every identity read here is: `null` means we could
 * not tell. `auth.users.encrypted_password` is not reachable over PostgREST, so
 * the answer comes from `public.account_has_password` (migration 0099), which
 * returns a BOOLEAN and never the hash it looked at. Until the captain applies
 * that migration the RPC is missing and this answers
 * `null`, and a surface that has not been told may never say "you have no
 * password yet" - it says nothing about which.
 */
export async function accountHasPassword(
  userId: string,
): Promise<boolean | null> {
  if (!userId || !isSupabaseConfigured()) return null;

  const admin = getSupabaseAdmin();
  if (!admin) return null;

  try {
    const { data, error } = await admin.rpc("account_has_password", {
      p_user_id: userId,
    });
    if (error) return null;
    return typeof data === "boolean" ? data : null;
  } catch {
    return null;
  }
}

/** Server-side password grant. Returns null on any failure (no enumeration). */
export async function signInWithEmailPassword(
  email: string,
  password: string,
): Promise<HandlePasswordSession | null> {
  const config = supabaseAuthConfig();
  if (!config) return null;
  if (!password || password.length < MIN_PASSWORD_LENGTH) return null;

  let response: Response;
  try {
    response = await fetch(
      new URL("/auth/v1/token?grant_type=password", config.url),
      {
        method: "POST",
        headers: {
          apikey: config.key,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, password }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return null;
  }

  if (!response.ok) {
    discardBody(response);
    return null;
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }

  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    return null;
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    ...(typeof body.expires_in === "number" ? { expires_in: body.expires_in } : {}),
    ...(typeof body.expires_at === "number" ? { expires_at: body.expires_at } : {}),
    ...(typeof body.token_type === "string" ? { token_type: body.token_type } : {}),
  };
}
