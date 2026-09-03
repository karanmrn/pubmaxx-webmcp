import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { verifyCallerAuth } from "@/lib/authServer";
import { isPlanId } from "@/lib/plan";
import {
  claimPlanMembership,
  planAccountRecoveryToken,
  recoverPlanMembership,
} from "@/lib/planCrewIdentity";
import {
  attachPlanMemberSession,
  planMemberCapability,
  planMemberCookieCapability,
} from "@/lib/planMemberCapability";
import { planMemberIdentityResult } from "@/lib/planStore";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey } from "@/lib/planMutationHttp";

type Context = { params: Promise<{ id: string }> };

const PLAN_ACCOUNT_RECOVERY_PER_PLAN_LIMIT = 20;
const PLAN_ACCOUNT_RECOVERY_PER_IP_LIMIT = 200;

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404, { details: { active: false } });
  const token = planMemberCapability(request, undefined);
  if (!token) return jsonNoStore({ active: false }, { status: 200 });
  const result = await planMemberIdentityResult(id, token);
  if (!result.ok) return publicApiError("Plan session temporarily unavailable.", "PLAN_SESSION_UNAVAILABLE", 503, { retryable: true });
  if (!result.identity) return jsonNoStore({ active: false }, { status: 200 });
  return jsonNoStore({
    active: true,
    role: result.identity.role,
    collaborationAuthorized: result.identity.collaborationAuthorized,
  });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-session:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404, { details: { active: false } });
  const token = planMemberCapability(request, undefined);
  if (!token) return publicApiError("That Plan link is not valid.", "PLAN_SESSION_REQUIRED", 401, { details: { active: false } });
  const result = await planMemberIdentityResult(id, token);
  if (!result.ok) return publicApiError("Plan session temporarily unavailable.", "PLAN_SESSION_UNAVAILABLE", 503, { retryable: true });
  if (!result.identity) return publicApiError("That Plan link is no longer active.", "PLAN_SESSION_FORBIDDEN", 401, { details: { active: false } });
  return attachPlanMemberSession(jsonNoStore({
    active: true,
    role: result.identity.role,
    collaborationAuthorized: result.identity.collaborationAuthorized,
  }), request, id, token);
}

/** Restore a lost Plan capability from the signed-in account's stamped seat. */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) {
    return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  }
  const idempotencyKey = planMutationIdempotencyKey(request, {});
  if (!idempotencyKey) {
    return publicApiError(
      PLAN_IDEMPOTENCY_ERROR.error,
      PLAN_IDEMPOTENCY_ERROR.code,
      400,
    );
  }
  const auth = await verifyCallerAuth(request);
  if (auth.status === "unavailable") {
    return publicApiError(
      "Account verification is temporarily unavailable.",
      "PLAN_ACCOUNT_RECOVERY_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (auth.status !== "verified") {
    return publicApiError(
      "Sign in to restore this Plan.",
      "UNAUTHENTICATED",
      401,
    );
  }
  const requestIp = clientIp(request);
  const globalLimiterKey = `plan-account-recovery:ip:${hashIp(requestIp)}`;
  const planLimiterKey = `plan-account-recovery:plan:${hashIp(`${requestIp}:${auth.identity.id}:${id}`)}`;
  if (
    await isLimited(
      globalLimiterKey,
      globalLimiterKey,
      PLAN_ACCOUNT_RECOVERY_PER_IP_LIMIT,
    ) ||
    await isLimited(
      planLimiterKey,
      planLimiterKey,
      PLAN_ACCOUNT_RECOVERY_PER_PLAN_LIMIT,
    )
  ) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const memberToken = planAccountRecoveryToken(id, auth.identity.id);
  const recovered = await recoverPlanMembership(
    id,
    auth.identity.id,
    memberToken,
  );
  if (!recovered.ok) {
    if (recovered.error === "error") {
      return publicApiError(
        "Plan data is temporarily unavailable.",
        "PLAN_ACCOUNT_RECOVERY_UNAVAILABLE",
        503,
        { retryable: true },
      );
    }
    if (recovered.error === "conflict") {
      return publicApiError(
        "This Plan membership could not be restored.",
        "PLAN_ACCOUNT_RECOVERY_CONFLICT",
        409,
      );
    }
    return publicApiError(
      "No Plan membership was found for this account.",
      "PLAN_ACCOUNT_MEMBERSHIP_NOT_FOUND",
      404,
    );
  }
  return attachPlanMemberSession(
    jsonNoStore({
      active: true,
      role: recovered.identity.role,
      collaborationAuthorized: recovered.identity.collaborationAuthorized,
    }),
    request,
    id,
    memberToken,
  );
}

/** Bind a guest-created Plan to the account that now owns its member session. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-account-claim:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 20)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id } = await context.params;
  if (!isPlanId(id)) {
    return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  }
  const auth = await verifyCallerAuth(request);
  if (auth.status === "unavailable") {
    return publicApiError(
      "Account verification is temporarily unavailable.",
      "PLAN_ACCOUNT_CLAIM_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (auth.status !== "verified") {
    return publicApiError(
      "Sign in to save this Plan to your account.",
      "UNAUTHENTICATED",
      401,
    );
  }
  const token = planMemberCookieCapability(request, id);
  if (!token) {
    return publicApiError(
      "Open this Plan in the browser that created or joined it.",
      "PLAN_ACCOUNT_CLAIM_FORBIDDEN",
      403,
    );
  }
  const member = await planMemberIdentityResult(id, token);
  if (!member.ok) {
    return publicApiError(
      "Plan data is temporarily unavailable.",
      "PLAN_ACCOUNT_CLAIM_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (!member.identity) {
    return publicApiError(
      "That Plan session is no longer active.",
      "PLAN_ACCOUNT_CLAIM_FORBIDDEN",
      403,
    );
  }
  const outcome = await claimPlanMembership(
    id,
    member.identity.memberId,
    auth.identity.id,
  );
  if (outcome === "error") {
    return publicApiError(
      "Plan data is temporarily unavailable.",
      "PLAN_ACCOUNT_CLAIM_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (outcome === "not_found") {
    return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  }
  if (outcome === "conflict") {
    return publicApiError(
      "This Plan membership belongs to a different account.",
      "PLAN_ACCOUNT_CLAIM_CONFLICT",
      409,
    );
  }
  return jsonNoStore({
    claimed: outcome === "claimed",
    role: member.identity.role,
  });
}
