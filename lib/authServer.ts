import "server-only";

// Server-side identity resolution for API routes.
//
// Writes in this app route through the SERVICE-ROLE admin client, which bypasses
// RLS — so ownership can't be enforced by RLS on those writes. Instead a route
// resolves the caller's VERIFIED identity here and enforces ownership itself
// (see lib/profileOwnership.ts + app/api/profiles/[handle]/route.ts).
//
// A request proves identity by sending its Supabase access token as
// `Authorization: Bearer <jwt>`. We verify it by asking Supabase who it belongs
// to (auth.getUser(jwt)) using the admin client — this validates the signature +
// expiry server-side, so a forged/expired token yields null (anonymous), never a
// trusted uid. NEVER trust a uid sent in the body/query; only a verified token.

import { getSupabaseAdmin } from "@/lib/supabase";

/** Extract a bearer token from an Authorization header, or null when absent. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export type CallerAuthIdentity = {
  id: string;
  /** Verified email from the JWT user, or null when absent. */
  email: string | null;
  /** Supabase Auth account creation time, used for signup-only attribution. */
  createdAt: string | null;
};

export type CallerAuthVerification =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "verified"; identity: CallerAuthIdentity };

const INVALID_BEARER_CODES = new Set([
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
  "session_expired",
  "session_not_found",
  "unexpected_audience",
  "user_banned",
  "user_not_found",
]);

const INVALID_BEARER_ERROR_NAMES = new Set([
  "AuthInvalidJwtError",
  "AuthSessionMissingError",
]);

function isInvalidBearerError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
  };
  if (candidate.status === 401) return true;
  if (
    typeof candidate.name === "string" &&
    INVALID_BEARER_ERROR_NAMES.has(candidate.name)
  ) {
    return true;
  }
  return (
    typeof candidate.code === "string" &&
    INVALID_BEARER_CODES.has(candidate.code)
  );
}

export async function verifyCallerAuth(
  request: Request,
): Promise<CallerAuthVerification> {
  const token = bearerToken(request);
  if (!token) return { status: "absent" };

  const admin = getSupabaseAdmin();
  if (!admin) return { status: "unavailable" };

  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error) {
      return {
        status: isInvalidBearerError(error) ? "invalid" : "unavailable",
      };
    }
    const id = data.user?.id;
    if (typeof id !== "string" || !id) return { status: "invalid" };
    const email = typeof data.user?.email === "string" ? data.user.email : null;
    const createdAt =
      typeof data.user?.created_at === "string" ? data.user.created_at : null;
    return {
      status: "verified",
      identity: { id, email, createdAt },
    };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Resolve the caller's authenticated user id from their request, or null when
 * the request is anonymous / the token is invalid / auth is unconfigured.
 *
 * Fail-CLOSED for identity: any doubt (no token, bad token, no admin client, a
 * verification error) resolves to null. A null caller can still take the
 * anonymous demo path for an UNLINKED handle, but can never satisfy the owner
 * check for a LINKED one — so an invalid token can't impersonate an owner.
 */
export async function callerUserId(request: Request): Promise<string | null> {
  const identity = await callerAuthIdentity(request);
  return identity?.id ?? null;
}

/**
 * Resolve the caller's verified id, email, and account creation time from their
 * bearer JWT, or null when anonymous / invalid / unconfigured. Same fail-closed
 * rules as callerUserId. Prefer this when a route needs JWT-owned account
 * metadata rather than a client-supplied proxy.
 */
export async function callerAuthIdentity(
  request: Request,
): Promise<CallerAuthIdentity | null> {
  const verification = await verifyCallerAuth(request);
  return verification.status === "verified"
    ? verification.identity
    : null;
}
