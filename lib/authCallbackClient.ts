import type { AuthCallbackTokens } from "@/lib/authRedirect";

export type AuthSessionEstablishClient<SessionValue> = {
  setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<{
    data: { session: SessionValue | null };
    error: unknown;
  }>;
};

export type AuthCallbackSessionResult<SessionValue> = {
  session: SessionValue | null;
  failed: boolean;
};

/**
 * Establish the session from implicit-flow callback tokens. Normalizes both
 * Supabase errors and network failures for the UI, exactly like the PKCE
 * exchange this replaced.
 */
export async function establishAuthCallbackSession<SessionValue>(
  auth: AuthSessionEstablishClient<SessionValue>,
  tokens: AuthCallbackTokens,
): Promise<AuthCallbackSessionResult<SessionValue>> {
  try {
    const { data, error } = await auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    return { session: data.session ?? null, failed: Boolean(error) };
  } catch {
    return { session: null, failed: true };
  }
}

const PKCE_VERIFIER_KEY_SUFFIX = "-auth-token-code-verifier";

/**
 * Remove code-verifier keys left behind by the PKCE flow this app used before
 * the implicit flow. supabase-js stores them as sb-<ref>-auth-token-code-verifier
 * and the implicit flow never reads or clears them, so a browser that started a
 * PKCE attempt keeps a dead one-time secret in localStorage until this runs.
 * The stored session key (sb-<ref>-auth-token) is live state and is kept.
 */
export function clearLegacyPkceVerifiers(
  storage: Pick<Storage, "length" | "key" | "removeItem"> | null,
): void {
  if (!storage) return;
  try {
    const staleKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith("sb-") && key.endsWith(PKCE_VERIFIER_KEY_SUFFIX)) {
        staleKeys.push(key);
      }
    }
    for (const key of staleKeys) storage.removeItem(key);
  } catch {
    // Best-effort cleanup; a leftover verifier is inert under the implicit flow.
  }
}
