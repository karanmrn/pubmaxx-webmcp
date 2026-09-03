import "server-only";

// Resolve the actor handle for messaging routes.
//
// Dual-backend identity (same stance as profiles):
//   • When a verified Supabase Auth JWT is present AND that user has a linked
//     profile, the linked handle wins — body/query handle is not trusted alone.
//   • When auth is absent / unconfigured / the user has no linked profile, fall
//     back to the self-asserted handle (anonymous/demo path).
//
// Fail-soft: a store lookup error never blocks the demo path; we just use the
// asserted handle. Ownership of LINKED profiles is still enforced elsewhere
// (profile PATCH/DELETE); messaging only needs "who am I claiming to be".

import { callerUserId } from "@/lib/authServer";
import { normalizeHandle } from "@/lib/profiles";
import {
  memoryProfileStore,
  supabaseProfileStore,
  type ProfileStore,
} from "@/lib/profileStore";
import { isSupabaseConfigured } from "@/lib/supabase";

function profileStore(): ProfileStore {
  return isSupabaseConfigured() ? supabaseProfileStore : memoryProfileStore;
}

/**
 * Prefer the auth-linked handle when the request carries a valid JWT whose
 * user owns a profile; otherwise return the normalized asserted handle (or ""
 * when neither is available).
 *
 * Use this on every private write before `gateHandleAction` so a signed-in
 * user cannot POST as a different unlinked handle while their JWT is present.
 *
 * A route that already verified the bearer passes `verifiedUserId` so the JWT
 * is checked once per request rather than once per gate. Omitting it keeps the
 * old behaviour; passing `null` states the caller is anonymous.
 */
export async function resolveMessageHandle(
  request: Request,
  assertedHandle: string | null | undefined,
  verifiedUserId?: string | null,
  options?: { requireLinked?: boolean },
): Promise<string> {
  const asserted = normalizeHandle(assertedHandle ?? "");
  const userId =
    verifiedUserId === undefined ? await callerUserId(request) : verifiedUserId;
  if (!userId) return asserted;

  try {
    const linked = await profileStore().getHandleByUserId(userId);
    if (linked) return linked;
    if (options?.requireLinked) return "";
  } catch {
    // Valid JWT present but profile lookup failed — fail closed. Falling back
    // to the body handle would let a spoofed handle ride a real session during
    // a store outage.
    return "";
  }
  return asserted;
}

export type LinkedActorGate =
  | { ok: true; handle: string; userId: string }
  | { ok: false; status: 400 | 401 | 403; error: string };

/**
 * Wave I2 — DMs require a signed-in user whose profile is linked.
 * Returns the canonical linked handle, or a 401/403 gate response payload.
 */
export async function requireLinkedActor(
  request: Request,
  assertedHandle: string | null | undefined,
): Promise<LinkedActorGate> {
  const userId = await callerUserId(request);
  if (!userId) {
    return {
      ok: false,
      status: 401,
      error: "Sign in to message.",
    };
  }

  let linked = "";
  try {
    linked = (await profileStore().getHandleByUserId(userId)) ?? "";
  } catch {
    linked = "";
  }

  if (!linked) {
    // A new asserted handle can be created by gateHandleAction on POST. If a
    // legacy unlinked row already exists, that gate refuses account ownership.
    const asserted = normalizeHandle(assertedHandle ?? "");
    if (!asserted) {
      return {
        ok: false,
        status: 400,
        error: "Add your handle.",
      };
    }
    return { ok: true, handle: asserted, userId };
  }

  return { ok: true, handle: linked, userId };
}
