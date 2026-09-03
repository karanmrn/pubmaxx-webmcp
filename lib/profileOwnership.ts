// Profile ownership decision — pure helpers + shared route gate (user story 31).
//
// THE MODEL (as actually enforced in this codebase): all profile writes go
// through the service-role admin client, which bypasses RLS. So RLS is not the
// gate for the app's own writes — the gate is this server-side decision at the
// API seam. Given the handle being written and (a) whether that handle's stored
// profile is already LINKED to an auth user and (b) the caller's VERIFIED auth
// uid (from a validated JWT, or null when the request is anonymous), decide
// whether the write may proceed.
//
// Rules:
//   • An existing unlinked legacy profile is frozen against account ownership.
//     It keeps the anonymous demo path, but an authenticated write cannot claim
//     it. A genuinely new handle can still be created and linked.
//   • Linked handle (rowUserId set): allowed ONLY when the caller is
//     authenticated AND their uid matches. A non-owner — anonymous OR a different
//     signed-in user — is rejected. This is the security win: once a handle is
//     claimed by an account, it can't be hijacked by a self-asserted handle.
//   • Concurrent creation of the same new handle returns 409.

import { callerUserId } from "@/lib/authServer";
import { assessPubmaxxHandle } from "@/lib/pubmaxxIdentity";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";

export type OwnershipDecision =
  | { allowed: true; reason: "unlinked" | "owner" }
  | { allowed: false; reason: "not-owner"; status: 403 };

export type HandleActionGate =
  | { allowed: true; callerUserId: string | null; handle: string }
  | { allowed: false; status: number; error: string };

export type HandleActionIntent = "read" | "write" | "delete";

/** One owner for deciding whether a route action may claim an unlinked handle. */
export function handleActionIntent(method: string): HandleActionIntent {
  const normalized = method.toUpperCase();
  if (normalized === "GET" || normalized === "HEAD") return "read";
  if (normalized === "DELETE") return "delete";
  return "write";
}

/**
 * Decide whether a caller may write to `handle`'s profile.
 *
 * @param rowUserId    profiles.user_id for the target handle, or null when the
 *                     handle has no row yet OR the row is unlinked (demo).
 * @param callerUserId the caller's VERIFIED auth uid, or null when the request
 *                     carries no valid session (anonymous).
 */
export function decideProfileWrite(
  rowUserId: string | null | undefined,
  callerUserId: string | null | undefined,
): OwnershipDecision {
  const linkedTo = typeof rowUserId === "string" && rowUserId ? rowUserId : null;
  const caller = typeof callerUserId === "string" && callerUserId ? callerUserId : null;

  // Unlinked / no row yet → anyone may write (demo path unchanged).
  if (!linkedTo) return { allowed: true, reason: "unlinked" };

  // Linked → only the matching, authenticated owner.
  if (caller && caller === linkedTo) return { allowed: true, reason: "owner" };

  return { allowed: false, reason: "not-owner", status: 403 };
}

/**
 * Shared ownership gate for handle-keyed private/destructive API routes.
 *
 * Resolves the caller's verified JWT identity, looks up whether `handle` is
 * already linked to a `profiles.user_id`, and applies {@link decideProfileWrite}.
 * Existing unlinked profiles remain frozen against account ownership. Their
 * anonymous demo path remains, but an authenticated write may only create and
 * link a genuinely new handle. Reads and deletes never claim ownership.
 *
 * Unlinked, non-reserved handles keep the demo path. Linked handles require the
 * matching signed-in owner. Fail-closed on store errors so an outage cannot open
 * a linked handle to anonymous writes.
 *
 * A route that already verified the bearer passes `verifiedUserId` so the JWT
 * is checked once per request rather than once per gate. Omitting it keeps the
 * old behaviour; passing `null` states the caller is anonymous.
 */
export async function gateHandleAction(
  request: Request,
  handle: string,
  verifiedUserId?: string | null,
): Promise<HandleActionGate> {
  const key = normalizeHandle(handle);
  if (!key) {
    return {
      allowed: false,
      status: 400,
      error: "Add a handle.",
    };
  }

  const caller =
    verifiedUserId === undefined ? await callerUserId(request) : verifiedUserId;

  try {
    const store = profileStore();
    // Generic profile creation never grants account ownership. An authenticated
    // mutation may create an absent handle already owned, but cannot inherit an
    // existing unowned row.
    const existing = await store.getByHandle(key);
    const rowUserId = existing?.userId ?? null;
    const callerOwnsHandle = Boolean(
      caller && rowUserId && caller === rowUserId,
    );
    // Reserved contributor handles stay blocked for new claims and hijacks, but
    // a signed-in owner saving their own current handle must succeed idempotently.
    // A linked handle taken by someone else is a 403, not a reserved 409.
    if (!callerOwnsHandle && !rowUserId) {
      const assessment = assessPubmaxxHandle(key);
      if (!assessment.ok && assessment.reason === "reserved") {
        return {
          allowed: false,
          status: 409,
          error: assessment.error,
        };
      }
    }
    const linkNewHandle = handleActionIntent(request.method) === "write";
    if (
      existing &&
      !rowUserId &&
      caller &&
      linkNewHandle
    ) {
      return {
        allowed: false,
        status: 409,
        error: "That legacy handle is frozen. Choose a new handle for this account.",
      };
    }
    const decision = decideProfileWrite(rowUserId, caller);
    if (!decision.allowed) {
      return {
        allowed: false,
        status: decision.status,
        error:
          "This handle belongs to a signed-in account. Sign in as its owner to continue.",
      };
    }

    if (linkNewHandle && !existing && caller) {
      try {
        await store.createOwned(key, caller);
      } catch (err) {
        // Concurrent creation of the same new handle surfaces as 409 so the
        // client can re-auth / pick another handle instead of a generic 503.
        const message = err instanceof Error ? err.message : String(err);
        if (/already has a handle/i.test(message)) {
          return {
            allowed: false,
            status: 409,
            error: "This account already has a handle. Use that handle, or rename it first.",
          };
        }
        if (/not available/i.test(message)) {
          return {
            allowed: false,
            status: 409,
            error: "That handle is not available.",
          };
        }
        throw err;
      }
    }

    return { allowed: true, callerUserId: caller, handle: key };
  } catch {
    return {
      allowed: false,
      status: 503,
      error: "Profile storage is unavailable.",
    };
  }
}
