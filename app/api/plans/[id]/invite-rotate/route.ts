// Host-only rotation of a plan's public invite token. Mints a fresh token,
// invalidating the old /invite/[token] link immediately. Lives under
// /api/plans/[id]/… so the path-scoped HttpOnly member cookie
// (Path=/api/plans/${planId}) is sent and planMemberCapability can restore
// host authority. Mirrors invite-rsvp/route.ts's fencing order.

import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isPlanId } from "@/lib/plan";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planMemberIdentity, planStateResult, rotateInviteToken } from "@/lib/planStore";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-invite-rotate:${hashIp(clientIp(request))}`;
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
    return publicApiError("Couldn't make a new link.", "PLAN_INVITE_ROTATE_UNAVAILABLE", 503, { retryable: true });
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

  const memberToken = planMemberCapability(request, body.memberToken);
  const identity = await planMemberIdentity(planId, memberToken);
  if (!identity || identity.role !== "host") {
    return publicApiError("Only the host can make a new link.", "PLAN_INVITE_ROTATE_FORBIDDEN", 403);
  }

  try {
    const result = await rotateInviteToken(planId);
    if (!result.ok || !result.inviteToken) {
      return publicApiError("Couldn't make a new link.", "PLAN_INVITE_ROTATE_UNAVAILABLE", 503, { retryable: true });
    }
    return jsonNoStore({ ok: true, inviteToken: result.inviteToken }, { status: 200 });
  } catch (err) {
    console.error("[plan-invite-rotate] POST failed:", err instanceof Error ? err.stack || err.message : err);
    return publicApiError("Couldn't make a new link.", "PLAN_INVITE_ROTATE_UNAVAILABLE", 503, { retryable: true });
  }
}
