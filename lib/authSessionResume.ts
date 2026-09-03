// Durable sign-in resume cookie — shared shapes and pure helpers.
//
// WHY THIS EXISTS: the Supabase browser session lives in localStorage
// (lib/authClient.ts). iOS Safari treats localStorage as evictable
// script-writable storage (ITP caps it at seven days without interaction and
// WebKit drops it under storage pressure), and an email magic link opened in
// an in-app browser signs in a storage context the user's real browser never
// sees. Either way a signed-in user comes back to a cold sign-in form.
//
// The resume cookie is the durable, HttpOnly mirror of the REFRESH token plus
// the account email. It is set only by the server (/api/auth/session), so
// Safari does not cap its lifetime the way it caps JS-set state. When the
// browser boots with no local session, AuthProvider asks the server to redeem
// the cookie against Supabase Auth; on success the session is re-established
// silently. When the refresh token is dead, the email hint powers a
// "Welcome back — continue as <masked email>" one-tap re-auth instead of a
// cold form. Sign-out deletes the cookie.
//
// The cookie value is NOT readable by page script (HttpOnly) and never
// travels in a URL. Only the short-lived session tokens cross to the browser,
// exactly as they already do on every existing sign-in and refresh.

export const AUTH_RESUME_COOKIE = "pubmax_session_resume";

/** Durable window: 30 days, re-extended on every sign-in, refresh and redeem. */
export const AUTH_RESUME_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type AuthResumeCookiePayload = {
  /** Supabase refresh token, absent once a redeem proved it dead. */
  refreshToken: string | null;
  /** Account email for the welcome-back hint and one-tap resume. */
  email: string | null;
  /**
   * Which account the email belongs to. A second account signing in on the
   * same browser rewrites this cookie, and without the id a persist that could
   * not read its own email would inherit the PREVIOUS account's - so the
   * welcome-back line offered to resume as somebody else.
   */
  userId?: string | null;
};

const COOKIE_VERSION = 1;
const MAX_TOKEN_LENGTH = 2048;
const MAX_EMAIL_LENGTH = 320;

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function isPlausibleRefreshToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= MAX_TOKEN_LENGTH &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

function isPlausibleEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_EMAIL_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

/** Serialise the payload for the cookie value. */
export function encodeAuthResumeCookie(payload: AuthResumeCookiePayload): string {
  return base64UrlEncode(
    JSON.stringify({
      v: COOKIE_VERSION,
      rt: payload.refreshToken ?? undefined,
      em: payload.email ?? undefined,
      uid: payload.userId ?? undefined,
    }),
  );
}

/** Parse a cookie value; anything malformed reads as no payload. */
export function decodeAuthResumeCookie(
  raw: string | null | undefined,
): AuthResumeCookiePayload | null {
  if (!raw) return null;
  const decoded = base64UrlDecode(raw);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (parsed.v !== COOKIE_VERSION) return null;
    const refreshToken = isPlausibleRefreshToken(parsed.rt) ? parsed.rt : null;
    const email = isPlausibleEmail(parsed.em) ? parsed.em : null;
    const userId =
      typeof parsed.uid === "string" && parsed.uid ? parsed.uid : null;
    if (!refreshToken && !email) return null;
    return { refreshToken, email, userId };
  } catch {
    return null;
  }
}

/**
 * Extract the resume cookie value from a Cookie request header.
 *
 * ANYTHING MALFORMED READS AS ABSENT, which is the contract `decodeAuthResumeCookie`
 * already keeps. A value carrying an invalid percent-escape (`%zz`, a lone `%`,
 * a truncated write) makes `decodeURIComponent` throw, and this helper is called
 * OUTSIDE the try in `verifySupabaseSessionFromRequest`, so a junk cookie in a
 * caller's own browser turned a clean "not signed in" into an unhandled 500 on
 * every Social read. The sibling reader `lib/planMemberCapability.ts` already
 * guards the identical call.
 */
export function authResumeCookieFromHeader(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== AUTH_RESUME_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Display form of an email that identifies the account to its owner without
 * printing the full address on a signed-out surface: first character of the
 * local part, then the domain.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 1) return null;
  return `${email[0]}…@${email.slice(at + 1)}`;
}

/**
 * What a persist may carry over from the cookie already on the device.
 *
 * An email is a claim about WHO this device remembers, so it may only survive a
 * rewrite that is provably about the same account: a matching account id, or -
 * when the server could not verify the caller at all - the very same refresh
 * token being re-persisted. Anything else drops the email rather than risk
 * offering a second account a one-tap return to the first one's inbox. A cookie
 * written before account ids were stored carries none, so it never matches.
 */
export function inheritedResumeEmail(
  existing: AuthResumeCookiePayload | null,
  next: { userId: string | null; refreshToken: string },
): string | null {
  if (!existing?.email) return null;
  if (next.userId) return existing.userId === next.userId ? existing.email : null;
  return existing.refreshToken === next.refreshToken ? existing.email : null;
}

/** Outcome of a resume-cookie redeem, as returned to the browser. */
export type AuthResumeRedeemOutcome =
  | {
      status: "restored";
      session: {
        access_token: string;
        refresh_token: string;
        expires_in?: number;
        expires_at?: number;
        token_type?: string;
      };
    }
  | { status: "expired"; maskedEmail: string | null }
  | { status: "none" }
  | { status: "unavailable" };
