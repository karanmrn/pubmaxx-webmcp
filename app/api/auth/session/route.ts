// Durable sign-in resume cookie (lib/authSessionResume.ts owns the why).
//
//   GET     → { hint: { maskedEmail } | null }   welcome-back hint, no secrets
//   POST    { action: "persist", refreshToken }  store the caller's refresh
//             token + verified email in the HttpOnly cookie (bearer-verified)
//   POST    { action: "redeem" }                 exchange the cookie's refresh
//             token at Supabase Auth for a fresh session; rotates the cookie
//   POST    { action: "resume", callbackUrl }    send a magic link to the
//             cookie's email without the user retyping it
//   DELETE  → clears the cookie (sign-out)
//
// The refresh token only ever moves between this route's HttpOnly cookie and
// Supabase Auth. It is never in a URL and never readable by page script. The
// short-lived session tokens returned by "redeem" cross to the browser the
// same way every existing sign-in and token refresh already delivers them.
//
// Cross-site requests cannot reach the actions: the cookie is SameSite=Lax
// and mutating methods additionally require a same-origin/same-site
// Sec-Fetch-Site (or a matching Origin header on older engines).

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { verifyCallerAuth } from "@/lib/authServer";
import {
  AUTH_RESUME_COOKIE,
  AUTH_RESUME_MAX_AGE_SECONDS,
  authResumeCookieFromHeader,
  decodeAuthResumeCookie,
  encodeAuthResumeCookie,
  inheritedResumeEmail,
  isPlausibleRefreshToken,
  maskEmail,
  type AuthResumeCookiePayload,
} from "@/lib/authSessionResume";
import { requestMagicLink } from "@/lib/passwordlessAuth";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { isCrossSiteRequest } from "@/lib/crossSiteRequest";

assertServerEnv();

const REDEEM_LIMIT = 60;
const PERSIST_LIMIT = 60;
const LIMIT_WINDOW_MS = 60 * 60 * 1000;
// Resume sends an email, so its budget mirrors a manual magic-link form.
const RESUME_LIMIT = 6;
const RESUME_WINDOW_MS = 15 * 60 * 1000;

const GOTRUE_TIMEOUT_MS = 10_000;

function supabaseAuthConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

function cookiePayload(request: Request): AuthResumeCookiePayload | null {
  return decodeAuthResumeCookie(
    authResumeCookieFromHeader(request.headers.get("cookie")),
  );
}

function setCookieHeaders(payload: AuthResumeCookiePayload | null): Headers {
  const headers = new Headers();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = payload ? encodeURIComponent(encodeAuthResumeCookie(payload)) : "";
  const maxAge = payload ? AUTH_RESUME_MAX_AGE_SECONDS : 0;
  headers.append(
    "Set-Cookie",
    `${AUTH_RESUME_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
  return headers;
}

async function limited(
  request: Request,
  action: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const key = `auth-session:${action}:${hashIp(clientIp(request))}`;
  return isLimited(key, key, limit, windowMs);
}

export async function GET(request: Request): Promise<Response> {
  // A hint exists whenever a resume cookie exists at all: a token stored
  // before the email was known (keyless dev, verification outage) must still
  // be redeemable after storage loss. maskedEmail stays null in that case.
  const payload = cookiePayload(request);
  return jsonNoStore({
    hint: payload ? { maskedEmail: maskEmail(payload.email) } : null,
  });
}

export async function POST(request: Request): Promise<Response> {
  if (isCrossSiteRequest(request)) {
    return publicApiError("Cross-site requests are not accepted.", "FORBIDDEN", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "persist") return persist(request, body);
  if (action === "redeem") return redeem(request);
  if (action === "resume") return resume(request, body);
  return publicApiError("Unknown action.", "INVALID_REQUEST", 400);
}

export async function DELETE(request: Request): Promise<Response> {
  if (isCrossSiteRequest(request)) {
    return publicApiError("Cross-site requests are not accepted.", "FORBIDDEN", 403);
  }
  if (await limited(request, "clear", PERSIST_LIMIT, LIMIT_WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  return jsonNoStore({ ok: true }, { headers: setCookieHeaders(null) });
}

async function persist(
  request: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  if (await limited(request, "persist", PERSIST_LIMIT, LIMIT_WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  if (!supabaseAuthConfig()) {
    return publicApiError("Sign-in is not configured.", "UNAVAILABLE", 503);
  }
  const refreshToken = body.refreshToken;
  if (!isPlausibleRefreshToken(refreshToken)) {
    return publicApiError("A refresh token is required.", "INVALID_REQUEST", 400);
  }

  // The bearer token proves who the refresh token is being stored FOR, and
  // supplies the verified email for the welcome-back hint. When verification
  // itself is unavailable (keyless dev — no admin client), the same-origin
  // guard above still stands and the cookie stays useful; a token that FAILS
  // verification is refused outright.
  const verification = await verifyCallerAuth(request);
  if (verification.status === "invalid" || verification.status === "absent") {
    return publicApiError("Sign in to do this.", "UNAUTHENTICATED", 401);
  }
  // A refresh-driven persist may not learn the email (verification outage,
  // keyless dev). Never let it erase a hint the cookie already carries - and
  // never let it INHERIT one it cannot prove belongs to the account being
  // stored, which is how a second account on the same browser ended up with the
  // first one's welcome-back address.
  const existing = cookiePayload(request);
  const userId =
    verification.status === "verified" ? verification.identity.id : null;
  const email =
    verification.status === "verified" && verification.identity.email
      ? verification.identity.email
      : inheritedResumeEmail(existing, { userId, refreshToken });
  const headers = setCookieHeaders({
    refreshToken: refreshToken,
    email,
    userId,
  });
  return jsonNoStore({ ok: true }, { headers });
}

async function redeem(request: Request): Promise<Response> {
  if (await limited(request, "redeem", REDEEM_LIMIT, LIMIT_WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  const payload = cookiePayload(request);
  if (!payload?.refreshToken) {
    const masked = maskEmail(payload?.email);
    return jsonNoStore(
      masked ? { status: "expired", maskedEmail: masked } : { status: "none" },
    );
  }
  const config = supabaseAuthConfig();
  if (!config) return jsonNoStore({ status: "unavailable" });

  let response: Response;
  try {
    response = await fetch(
      new URL("/auth/v1/token?grant_type=refresh_token", config.url),
      {
        method: "POST",
        headers: {
          apikey: config.key,
          "content-type": "application/json",
        },
        body: JSON.stringify({ refresh_token: payload.refreshToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(GOTRUE_TIMEOUT_MS),
      },
    );
  } catch {
    // Network trouble is not evidence the token died — keep the cookie whole.
    return jsonNoStore({ status: "unavailable" });
  }

  if (response.ok) {
    let session: Record<string, unknown>;
    try {
      session = (await response.json()) as Record<string, unknown>;
    } catch {
      return jsonNoStore({ status: "unavailable" });
    }
    const accessToken = session.access_token;
    const nextRefreshToken = session.refresh_token;
    if (
      typeof accessToken !== "string" ||
      !isPlausibleRefreshToken(nextRefreshToken)
    ) {
      return jsonNoStore({ status: "unavailable" });
    }
    const sessionEmail =
      typeof session.user === "object" && session.user !== null
        ? (session.user as Record<string, unknown>).email
        : null;
    const sessionUserId =
      typeof session.user === "object" && session.user !== null
        ? (session.user as Record<string, unknown>).id
        : null;
    const headers = setCookieHeaders({
      refreshToken: nextRefreshToken,
      email: typeof sessionEmail === "string" ? sessionEmail : payload.email,
      userId:
        typeof sessionUserId === "string" ? sessionUserId : payload.userId ?? null,
    });
    return jsonNoStore(
      {
        status: "restored",
        session: {
          access_token: accessToken,
          refresh_token: nextRefreshToken,
          expires_in: session.expires_in,
          expires_at: session.expires_at,
          token_type: session.token_type,
        },
      },
      { headers },
    );
  }

  if (response.status >= 400 && response.status < 500) {
    // The token is dead (rotated away, revoked, or the account is gone). Keep
    // the email so the sign-in page can offer one-tap resume instead of a
    // cold form.
    const headers = setCookieHeaders(
      payload.email
        ? {
            refreshToken: null,
            email: payload.email,
            userId: payload.userId ?? null,
          }
        : null,
    );
    return jsonNoStore(
      { status: "expired", maskedEmail: maskEmail(payload.email) },
      { headers },
    );
  }
  return jsonNoStore({ status: "unavailable" });
}

async function resume(
  request: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  if (await limited(request, "resume", RESUME_LIMIT, RESUME_WINDOW_MS)) {
    return publicApiError(
      "Too many sign-in attempts. Wait a few minutes, then try again.",
      "RATE_LIMITED",
      429,
      { retryable: true },
    );
  }
  const config = supabaseAuthConfig();
  if (!config) {
    return publicApiError("Sign-in is not configured.", "UNAVAILABLE", 503);
  }
  const payload = cookiePayload(request);
  if (!payload?.email) {
    return publicApiError("No saved sign-in on this device.", "NOT_FOUND", 404);
  }

  // The callback URL is client-built (it carries the attempt id) but may only
  // point at this origin's auth callback.
  const rawCallbackUrl = typeof body.callbackUrl === "string" ? body.callbackUrl : "";
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(rawCallbackUrl);
  } catch {
    return publicApiError("A callback URL is required.", "INVALID_REQUEST", 400);
  }
  if (
    callbackUrl.origin !== new URL(request.url).origin ||
    callbackUrl.pathname !== "/auth/callback"
  ) {
    return publicApiError("The callback URL is not allowed.", "INVALID_REQUEST", 400);
  }

  const email = payload.email;
  const result = await requestMagicLink(
    {
      signInWithOtp: async ({ email: address, options }) => {
        try {
          const target = new URL("/auth/v1/otp", config.url);
          target.searchParams.set("redirect_to", options.emailRedirectTo);
          const response = await fetch(target, {
            method: "POST",
            headers: {
              apikey: config.key,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              email: address,
              create_user: options.shouldCreateUser,
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(GOTRUE_TIMEOUT_MS),
          });
          if (response.ok) return { error: null };
          const detail = (await response.json().catch(() => ({}))) as {
            error_code?: string;
            code?: unknown;
            msg?: string;
          };
          return {
            error: {
              status: response.status,
              code:
                typeof detail.error_code === "string"
                  ? detail.error_code
                  : undefined,
              message: typeof detail.msg === "string" ? detail.msg : undefined,
            },
          };
        } catch {
          return { error: { status: 500, message: "request failed" } };
        }
      },
    },
    email,
    callbackUrl.toString(),
  );
  const status =
    result.status === "sent" ? 200 : result.status === "rate_limited" ? 429 : 502;
  if (status !== 200) {
    return publicApiError(
      result.message,
      status === 429 ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE",
      status,
      { retryable: true, compatibilityFields: { status: result.status } },
    );
  }
  return jsonNoStore(result);
}
