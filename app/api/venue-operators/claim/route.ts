// Venue operator claims (Wayfinder 3.5) — the claim + verification seam.
//
//   POST { venueId, evidenceKind, evidenceNote }              → 201 { claim } (signed-in)
//   POST { action: "verify"|"reject"|"revoke", id, note? }    → 200 { ok }    (moderator)
//   GET  ?venueId=…                                           → 200 { claim } (signed-in, own)
//   GET  ?state=pending|verified|rejected|revoked             → 200 { claims }(moderator)
//
// One VenueOperatorStore interface, two implementations (lib/venueOperatorsStore):
// Supabase (public.venue_operators) when env keys exist, process-memory otherwise,
// with local/preview memory degradation until migration 0048 lands. Production
// schema misses fail closed with 503.
//
// Boundaries (write-surface certification): the CREATE path is ACCOUNT-bound —
// account_id is the VERIFIED Supabase uid from the bearer JWT (callerAuthIdentity),
// never a body value; it is durably RATE LIMITED per account + hashed IP
// (rate_limit class). The verify/reject/revoke actions require the admin token
// (isModerator — moderator class). A hard durable write failure answers 503, never
// a fake success.
//
// NOT under the solo-operator SOCIAL freeze: an operator claim is venue-business
// content (a landlord asking to be verified), not a social post — see the PR body
// for the exemption stance. The freeze seam is deliberately not wired here.

import { isModerator } from "@/lib/adminAuth";
import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerAuthIdentity } from "@/lib/authServer";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import {
  isOperatorVerificationState,
  toOperatorClaimDTO,
  validateOperatorClaim,
  type OperatorVerificationState,
} from "@/lib/venueOperators";
import { venueOperatorsStore } from "@/lib/venueOperatorsStore";

assertServerEnv();

// A genuine operator files a handful of claims (they might run a few pubs); more
// from one origin in the window is abuse. Durable per-account + hashed IP.
const CLAIM_LIMIT = 10;

// Moderator action → the verification state it sets.
const ACTION_STATE: Record<string, OperatorVerificationState> = {
  verify: "verified",
  reject: "rejected",
  revoke: "revoked",
};

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request);
  if (!body) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // ── Moderator decisions (verify / reject / revoke) ──────────────────────────
  const action = readString(body.action);
  if (action && ACTION_STATE[action]) {
    if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
    const id = readString(body.id);
    if (!id) return publicApiError("Claim not found.", "NOT_FOUND", 404);
    try {
      const done = await venueOperatorsStore().setState(
        id,
        ACTION_STATE[action],
        readString(body.note),
      );
      return done
        ? jsonNoStore({ ok: true }, { status: 200 })
        : publicApiError("Claim not found.", "NOT_FOUND", 404);
    } catch (err) {
      log("error", "venue_operators.set_state_failed", {
        route: "POST /api/venue-operators/claim",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
  }

  // ── Create a claim (signed-in only) ─────────────────────────────────────────
  const identity = await callerAuthIdentity(request);
  if (!identity) {
    return publicApiError("Sign in to run a pub.", "UNAUTHENTICATED", 401);
  }

  const result = validateOperatorClaim(body, identity.id);
  if (!result.ok) {
    return publicApiError(result.error, "INVALID_CLAIM", 400);
  }

  // Durable per-account + hashed-IP rate limit (the certification boundary).
  const ipHash = hashIp(clientIp(request));
  const key = `venue-operator-claim:${identity.id}:${ipHash}`;
  if (await isLimited(key, key, CLAIM_LIMIT)) {
    return publicApiError("Too many claims, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  try {
    const claim = await venueOperatorsStore().claim(result.fields);
    return jsonNoStore({ claim }, { status: 201 });
  } catch (err) {
    log("error", "venue_operators.claim_failed", {
      route: "POST /api/venue-operators/claim",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  // Moderator review queue: ?state=pending (default pending when omitted+moderator).
  const state = params.get("state");
  if (state) {
    if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
    if (!isOperatorVerificationState(state)) {
      return publicApiError("Unknown state.", "INVALID_REQUEST", 400);
    }
    try {
      const claims = await venueOperatorsStore().listForReview(state);
      return jsonNoStore({ claims }, { status: 200 });
    } catch (err) {
      log("error", "venue_operators.list_review_failed", {
        route: "GET /api/venue-operators/claim",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
  }

  // Signed-in caller's OWN claim for a venue (drives the pending-state UI).
  const venueId = readString(params.get("venueId"));
  if (!venueId) {
    return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);
  }
  const identity = await callerAuthIdentity(request);
  if (!identity) {
    return publicApiError("Sign in to view your claim.", "UNAUTHENTICATED", 401);
  }
  const claim = await venueOperatorsStore().getForAccountVenue(identity.id, venueId);
  return jsonNoStore({ claim: claim ? toOperatorClaimDTO(claim) : null }, { status: 200 });
}
