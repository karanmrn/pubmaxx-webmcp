// Admin session — exchanges a one-time moderator token for an httpOnly cookie so
// the admin console never persists the raw ADMIN_TOKEN in localStorage.

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SEC,
  hashAdminSession,
  isModerator,
  verifyAdminToken,
} from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

const SESSION_ATTEMPT_LIMIT = 10;
const SESSION_ATTEMPT_WINDOW_MS = 60_000;

// SameSite=Lax, like every other session cookie here. GET /admin is now gated on
// the DOCUMENT, so the top-level navigation itself has to carry this cookie: a
// browser withholds a Strict cookie on a cross-site top-level navigation, which
// met a moderator following an /admin link from Slack or an email with the token
// form despite a live 24h session. Lax sends it on exactly that navigation and
// still withholds it from every cross-site subresource and non-GET request, so
// the CSRF surface the Strict setting was for is unchanged - the route only ever
// mints a session from a token in the body, never from the cookie.
function setSessionCookie(token: string): Headers {
  const headers = new Headers();
  const secure = process.env.NODE_ENV === "production";
  headers.append(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(hashAdminSession(token))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_SESSION_MAX_AGE_SEC}${secure ? "; Secure" : ""}`,
  );
  return headers;
}

function clearSessionCookie(): Headers {
  const headers = new Headers();
  const secure = process.env.NODE_ENV === "production";
  headers.append(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
  );
  return headers;
}

export async function GET(request: Request): Promise<Response> {
  return jsonNoStore({ authenticated: isModerator(request) }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  const ipKey = hashIp(clientIp(request));
  if (
    await isLimited(
      `admin-session:${ipKey}`,
      `admin-session:${ipKey}`,
      SESSION_ATTEMPT_LIMIT,
      SESSION_ATTEMPT_WINDOW_MS,
    )
  ) {
    return publicApiError("Too many attempts, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Invalid JSON.", "INVALID_REQUEST", 400);
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (!token || !verifyAdminToken(token)) {
    return publicApiError("Not authorised.", "FORBIDDEN", 403);
  }

  const headers = setSessionCookie(token);
  return jsonNoStore({ ok: true }, { status: 200, headers });
}

export async function DELETE(): Promise<Response> {
  const headers = clearSessionCookie();
  return jsonNoStore({ ok: true }, { status: 200, headers });
}
