import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

// Moderator gate — shared by app/api/admin/comments/route.ts and the moderator
// branches of app/api/pint-drops/route.ts. The token may arrive via the
// `x-admin-token` header (backwards compat during transition) OR an httpOnly
// session cookie set by POST /api/admin/session. Query-string tokens are never
// accepted — those leak through history/logs/Referer. When ADMIN_TOKEN is set the
// credential must match it (constant-time compare). When it is unset we DENY
// everywhere except local dev + the test runner, so a preview deploy is never
// wide open.

export const ADMIN_SESSION_COOKIE = "pubmax_admin_session";
export const SOCIAL_MODERATOR_STAFF_ROLE_ID_ENV = "SOCIAL_MODERATOR_STAFF_ROLE_ID";

// 24h — long enough for a moderation shift, short enough to limit stolen-cookie
// exposure. Refreshed on each successful POST /api/admin/session.
export const ADMIN_SESSION_MAX_AGE_SEC = 60 * 60 * 24;

// Constant-time compare: sha256 both sides so lengths always match, then
// timingSafeEqual — a plain === leaks match length/prefix via timing.
function safeTokenEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Hex digest stored in the session cookie — never the raw ADMIN_TOKEN. */
export function hashAdminSession(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// The two credentials are read off a header list, never off a whole Request:
// the moderator document gate is handed Next's own sealed header adapter, and
// only `get` is part of that contract.
type ModeratorHeaders = Pick<Headers, "get">;

function readAdminSessionCookie(headerList: ModeratorHeaders): string | undefined {
  const raw = headerList.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${ADMIN_SESSION_COOKIE}=`)) {
      return decodeURIComponent(trimmed.slice(ADMIN_SESSION_COOKIE.length + 1));
    }
  }
  return undefined;
}

/**
 * Whether GET /admin may render the moderator console. Same credential as the
 * API gate: a missing session is a refusal, never a 200 shell.
 */
export function canOpenAdminDocument(headerList: ModeratorHeaders): boolean {
  return hasModeratorCredential(headerList);
}

export function isModerator(request: Request): boolean {
  return hasModeratorCredential(request.headers);
}

/**
 * Resolve the named Social moderator bound to the existing admin credential.
 * The role id is deployment configuration, never client input. The migration
 * checks that this role is still active and has moderator role before any
 * queue read or moderation write.
 */
export function moderatorStaffRoleId(request: Request): string | null {
  if (!isModerator(request)) return null;
  const roleId = process.env[SOCIAL_MODERATOR_STAFF_ROLE_ID_ENV]?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roleId)
    ? roleId
    : null;
}

function hasModeratorCredential(headerList: ModeratorHeaders): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  }

  const headerToken = headerList.get("x-admin-token") ?? undefined;
  if (headerToken && safeTokenEqual(headerToken, expected)) return true;

  const sessionValue = readAdminSessionCookie(headerList);
  if (sessionValue && safeTokenEqual(sessionValue, hashAdminSession(expected))) return true;

  return false;
}

export function verifyAdminToken(token: string): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  }
  return safeTokenEqual(token, expected);
}
