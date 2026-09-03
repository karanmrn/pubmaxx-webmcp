// Handle-free RSVP on a plan's public invite page (Partiful-style: name +
// Going/Maybe, no account). POST is open to anyone holding the invite link.
// Host removal of a guest row lives under /api/plans/[id]/invite-rsvp so the
// path-scoped HttpOnly member cookie can authorize after a hard invite open.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { GUEST_DISPLAY_NAME_MAX, isRsvpStatus } from "@/lib/planInvite";
import { resolveClassicInvitePlan } from "@/lib/planInviteResolve";
import { PlanCrewFullError, RsvpCapExceededError, UnknownPlanError, rsvpStore } from "@/lib/planInviteRsvpStore";
import { attachPlanMemberSession } from "@/lib/planMemberCapability";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { cleanText, readString } from "@/lib/textClean";

const RSVP_LIMIT = 8;
const RSVP_WINDOW_MS = 60_000;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const limiterKey = `plan-invite-rsvp:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { token } = await params;
  const resolved = await resolveClassicInvitePlan(token);
  if ("response" in resolved) return resolved.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const displayName = cleanText(readString(body.displayName), GUEST_DISPLAY_NAME_MAX);
  const status = body.status;
  if (!displayName) return publicApiError("Add a name to RSVP.", "INVALID_REQUEST", 400);
  if (!isRsvpStatus(status)) return publicApiError("Choose Going or Maybe.", "INVALID_REQUEST", 400);

  const submitterId = readString(body.submitterId);
  if (!submitterId) return publicApiError("Couldn't save that RSVP.", "INVALID_REQUEST", 400);
  const submitterHash = hashActor(submitterId);
  const tokenHash = hashActor(token);
  // Per-device and per-invite budgets: rotating submitterId alone must not flood one guest list.
  if (
    (await isLimited(`invite-rsvp:${submitterHash}`, `invite-rsvp:${submitterHash}`, RSVP_LIMIT, RSVP_WINDOW_MS)) ||
    (await isLimited(`invite-rsvp-token:${tokenHash}`, `invite-rsvp-token:${tokenHash}`, RSVP_LIMIT * 4, RSVP_WINDOW_MS))
  ) {
    return publicApiError("Too many RSVPs, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  try {
    const { summary, isUpdate, membership } = await rsvpStore().upsert(
      resolved.planId,
      submitterHash,
      displayName,
      status,
    );
    const response = jsonNoStore(
      {
        summary,
        isUpdate,
        ...(membership ?? {}),
      },
      { status: 200 },
    );
    return membership
      ? attachPlanMemberSession(response, request, resolved.planId, membership.memberToken)
      : response;
  } catch (err) {
    if (err instanceof UnknownPlanError) {
      return publicApiError("This invite link isn't valid.", "NOT_FOUND", 404);
    }
    if (err instanceof RsvpCapExceededError) {
      return publicApiError("This guest list is full.", "CONFLICT", 409);
    }
    if (err instanceof PlanCrewFullError) {
      return publicApiError("This Plan's crew is full.", "PLAN_CREW_FULL", 409);
    }
    console.error("[invite-rsvp] POST failed:", err instanceof Error ? err.stack || err.message : err);
    return publicApiError("RSVPs are unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
}
