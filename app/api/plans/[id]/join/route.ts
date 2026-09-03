import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerUserId } from "@/lib/authServer";
import { formFriendEdgesForPlanJoin } from "@/lib/crewFriendEdges";
import { cleanCrewName } from "@/lib/crew";
import { isLimited } from "@/lib/pintDrops";
import { isPlanId, type PlanState } from "@/lib/plan";
import { isClassicPlanInviteToken } from "@/lib/planCrewInviteUrl";
import { planRouteReady } from "@/lib/planPrivacy";
import {
  planMemberIdentity,
  planStateResult,
  planStore,
  resolvePlanIdByInviteToken,
} from "@/lib/planStore";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { collaborationErrorResponse } from "@/lib/planCollaborationHttp";
import { attachPlanMemberSession } from "@/lib/planMemberCapability";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey } from "@/lib/planMutationHttp";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { crewCommittedEventToken } from "@/lib/verifiedAnalytics.server";

/** Best-effort friend-graph byproduct after a committed join. Never fails the join. */
async function maybeFormCrewFriendEdges(
  planId: string,
  memberToken: string,
  userId: string | null,
): Promise<number> {
  try {
    if (!userId) return 0;
    const identity = await planMemberIdentity(planId, memberToken);
    if (!identity?.memberId) return 0;
    const result = await formFriendEdgesForPlanJoin({
      planId,
      joinerUserId: userId,
      joinerMemberId: identity.memberId,
    });
    return result.formed;
  } catch {
    return 0;
  }
}

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

// §4.10: a successful join returns a verified crew_committed delivery token so
// the client can report the north-star Friend proof. The joinId is the new
// member's non-secret crew id — never the member capability. Absent when the
// store returned no plan/crew (nothing to commit).
function crewCommittedToken(plan: PlanState | null): string | undefined {
  const joinId = plan?.crew.at(-1)?.id;
  if (!plan || !joinId) return undefined;
  return crewCommittedEventToken({
    joinId,
    joinedAt: new Date().toISOString(),
    participants: plan.crew.length,
    routeReady: planRouteReady(plan),
  });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const limiterKey = `plan-join:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many joins, slow down.", "PLAN_JOIN_RATE_LIMITED", 429, { retryable: true });
  }
  const name = cleanCrewName(body.name);
  if (!name) return publicApiError("Add your name.", "PLAN_JOIN_NAME_REQUIRED", 400);
  const idempotencyKey = planMutationIdempotencyKey(request, body);
  if (!idempotencyKey) return publicApiError(PLAN_IDEMPOTENCY_ERROR.error, PLAN_IDEMPOTENCY_ERROR.code, 400);
  const lookup = await planStateResult(id);
  if (!lookup.ok) return publicApiError("Plan data is temporarily unavailable.", "PLAN_JOIN_UNAVAILABLE", 503, { retryable: true });
  if (!lookup.plan) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const userId = await callerUserId(request);
  // Invite-only: a bare plan id must never join the crew or return PlanState.
  // Open join was an IDOR (know the UUID → read stops/names and stuff the crew).
  // Two invite shapes are accepted:
  //   - classic multi-use plans.invite_token (WhatsApp / ShareBar #invite=)
  //   - collaboration one-use invite (PlanCollaborationPanel #invite=)
  const inviteToken =
    typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";
  if (!inviteToken) {
    return publicApiError(
      "This Plan needs an invite link to join.",
      "PLAN_INVITE_REQUIRED",
      403,
    );
  }

  if (isClassicPlanInviteToken(inviteToken)) {
    const resolved = await resolvePlanIdByInviteToken(inviteToken);
    if (!resolved.ok) {
      return publicApiError("Plan data is temporarily unavailable.", "PLAN_JOIN_UNAVAILABLE", 503, { retryable: true });
    }
    if (resolved.planId !== id) {
      return publicApiError("That invite link isn't valid for this Plan.", "PLAN_INVITE_INVALID", 403);
    }
    const result = await planStore().join(id, name, {
      collaborationAuthorized: false,
      idempotencyKey,
      userId: userId ?? undefined,
    });
    if (!result.ok) {
      const status = result.error === "invalid" ? 400
        : result.error === "not_found" ? 404
          : result.error === "full" || result.error === "conflict" || result.error === "account_conflict" ? 409
            : 503;
      const error = result.error === "full" ? "This Plan's crew is full."
        : result.error === "invalid" ? "Add your name."
          : result.error === "not_found" ? "That Plan doesn't exist."
            : result.error === "account_conflict" ? "This account is already in the Plan."
            : result.error === "conflict" ? "That request key was already used for a different join."
              : "Could not join the Plan.";
      return publicApiError(
        error,
        result.error === "error" ? "PLAN_JOIN_UNAVAILABLE"
          : result.error === "not_found" ? "PLAN_NOT_FOUND"
            : result.error === "full" ? "PLAN_CREW_FULL"
              : result.error === "account_conflict" ? "PLAN_ACCOUNT_ALREADY_MEMBER"
              : result.error === "conflict" ? "PLAN_IDEMPOTENCY_CONFLICT"
                : "PLAN_JOIN_INVALID",
        status,
        { retryable: result.error === "error" },
      );
    }
    const friendEdgesFormed = await maybeFormCrewFriendEdges(
      id,
      result.memberToken,
      userId,
    );
    return attachPlanMemberSession(
      jsonNoStore(
        {
          plan: result.plan,
          memberToken: result.memberToken,
          role: result.role,
          collaborationAuthorized: result.collaborationAuthorized,
          crewCommitted: crewCommittedToken(result.plan),
          friendEdgesFormed,
        },
        { status: 200 },
      ),
      request,
      id,
      result.memberToken,
    );
  }

  const joined = await planCollaborationStore().redeemInviteAndJoin(
    id,
    inviteToken,
    name,
    new Date(),
    { idempotencyKey, userId: userId ?? undefined },
  );
  if (!joined.ok) {
    if (joined.error === "account_conflict") {
      return publicApiError(
        "This account is already in the Plan.",
        "PLAN_ACCOUNT_ALREADY_MEMBER",
        409,
      );
    }
    if (joined.error === "full") {
      return publicApiError("This Plan's crew is full.", "PLAN_CREW_FULL", 409);
    }
    return collaborationErrorResponse(joined.error);
  }
  const friendEdgesFormed = await maybeFormCrewFriendEdges(
    id,
    joined.memberToken,
    userId,
  );
  return attachPlanMemberSession(
    jsonNoStore(
      {
        ...joined,
        crewCommitted: crewCommittedToken(joined.plan),
        friendEdgesFormed,
      },
      { status: 200 },
    ),
    request,
    id,
    joined.memberToken,
  );
}
