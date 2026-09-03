// Member-bound RSVP updates and host moderation for a public invite guest list.
// Lives under /api/plans/[id]/… so the path-scoped HttpOnly member cookie
// (Path=/api/plans/${planId}) is sent and planMemberCapability can restore
// host authority after a hard navigation to /invite/[token]. The public
// guest write path stays on /api/invite/[token]/rsvp.

import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isPlanId } from "@/lib/plan";
import { GUEST_DISPLAY_NAME_MAX, isRsvpStatus } from "@/lib/planInvite";
import { resolveClassicInvitePlan } from "@/lib/planInviteResolve";
import { attachPlanMemberSession, planMemberCapability } from "@/lib/planMemberCapability";
import { planMemberIdentity, planMemberIdentityResult, planStateResult } from "@/lib/planStore";
import { PlanCrewFullError, PlanInviteMembershipMismatchError, RsvpCapExceededError, UnknownPlanError, rsvpStore } from "@/lib/planInviteRsvpStore";
import { cleanText, readString } from "@/lib/textClean";

type Context = { params: Promise<{ id: string }> };

const RSVP_LIMIT = 8;
const RSVP_WINDOW_MS = 60_000;

export async function POST(request: Request, context: Context): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const limiterKey = `plan-invite-rsvp:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id: planId } = await context.params;
  if (!isPlanId(planId)) {
    return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const inviteToken = readString(body.inviteToken);
  const displayName = cleanText(readString(body.displayName), GUEST_DISPLAY_NAME_MAX);
  const status = body.status;
  const submitterId = readString(body.submitterId);
  if (!inviteToken || !displayName || !submitterId || !isRsvpStatus(status)) {
    return publicApiError("Couldn't save that RSVP.", "INVALID_REQUEST", 400);
  }

  const resolved = await resolveClassicInvitePlan(inviteToken);
  if ("response" in resolved) return resolved.response;
  if (resolved.planId !== planId) {
    return publicApiError("This invite link isn't valid.", "NOT_FOUND", 404);
  }

  const memberToken = planMemberCapability(request, body.memberToken);
  const identityResult = await planMemberIdentityResult(planId, memberToken);
  if (!identityResult.ok) {
    return publicApiError("RSVPs are unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
  const identity = identityResult.identity;
  if (!identity) {
    return publicApiError("This Plan session isn't valid.", "PLAN_MEMBER_SESSION_REVOKED", 403);
  }
  if (identity.role === "host") {
    return publicApiError("Host is already in this Plan.", "PLAN_HOST_CANNOT_RSVP", 409);
  }

  const submitterHash = hashActor(submitterId);
  const tokenHash = hashActor(inviteToken);
  if (
    (await isLimited(`invite-rsvp:${submitterHash}`, `invite-rsvp:${submitterHash}`, RSVP_LIMIT, RSVP_WINDOW_MS))
    || (await isLimited(`invite-rsvp-token:${tokenHash}`, `invite-rsvp-token:${tokenHash}`, RSVP_LIMIT * 4, RSVP_WINDOW_MS))
  ) {
    return publicApiError("Too many RSVPs, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  try {
    const { summary, isUpdate, membership } = await rsvpStore().upsert(
      planId,
      submitterHash,
      displayName,
      status,
      { memberToken: memberToken!, identity },
    );
    const response = jsonNoStore({ summary, isUpdate, ...(membership ?? {}) }, { status: 200 });
    return membership
      ? attachPlanMemberSession(response, request, planId, membership.memberToken)
      : response;
  } catch (error) {
    if (error instanceof PlanInviteMembershipMismatchError) {
      return publicApiError("That RSVP belongs to another Plan member.", "PLAN_INVITE_RSVP_FORBIDDEN", 403);
    }
    if (error instanceof UnknownPlanError) {
      return publicApiError("This invite link isn't valid.", "NOT_FOUND", 404);
    }
    if (error instanceof RsvpCapExceededError) {
      return publicApiError("This guest list is full.", "CONFLICT", 409);
    }
    if (error instanceof PlanCrewFullError) {
      return publicApiError("This Plan's crew is full.", "PLAN_CREW_FULL", 409);
    }
    console.error("[plan-invite-rsvp] POST failed:", error instanceof Error ? error.stack || error.message : error);
    return publicApiError("RSVPs are unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-invite-rsvp:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const { id: planId } = await context.params;
  if (!isPlanId(planId)) {
    return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  }

  const state = await planStateResult(planId);
  if (!state.ok) {
    return publicApiError("Couldn't remove that RSVP.", "PLAN_INVITE_RSVP_UNAVAILABLE", 503, { retryable: true });
  }
  if (!state.plan) {
    return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const rsvpId = readString(body.rsvpId);
  if (!rsvpId) return publicApiError("Missing RSVP id.", "PLAN_INVITE_RSVP_MISSING_ID", 400);

  const memberToken = planMemberCapability(request, body.memberToken);
  const identity = await planMemberIdentity(planId, memberToken);
  if (!identity || identity.role !== "host") {
    return publicApiError("Only the host can remove an RSVP.", "PLAN_INVITE_RSVP_FORBIDDEN", 403);
  }

  try {
    await rsvpStore().remove(planId, rsvpId);
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[plan-invite-rsvp] DELETE failed:", err instanceof Error ? err.stack || err.message : err);
    return publicApiError("Couldn't remove that RSVP.", "PLAN_INVITE_RSVP_UNAVAILABLE", 503, { retryable: true });
  }
}
