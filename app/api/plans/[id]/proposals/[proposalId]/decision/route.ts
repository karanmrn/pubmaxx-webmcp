import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { isPlanId } from "@/lib/plan";
import { collaborationErrorResponse, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planStore } from "@/lib/planStore";
import { fireAndForgetPush, notifyPlanUpdate } from "@/lib/pushSender";

type Context = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-proposal-decision:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id, proposalId } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const memberToken = planMemberCapability(request, body.memberToken);
  const decision = body.decision === "accepted" ? "accepted" : body.decision === "rejected" ? "rejected" : null;
  if (!decision) return publicApiError("Choose accepted or rejected.", "PLAN_COLLAB_INVALID", 400);
  const result = await planCollaborationStore().decideProposal(id, memberToken, proposalId, decision, collaborationIdempotencyKey(request, body), async (proposal) => {
    const applied = await planStore().update(id, memberToken, { stops: proposal.stops, expectedRouteRevision: proposal.expectedRouteRevision });
    return applied.ok;
  });
  if (!result.ok) return collaborationErrorResponse(result.error);
  // Fire-and-forget: tell the Plan's crew the route changed. Plan-scoped
  // targeting is dormant until push tokens gain identity (see lib/pushSender.ts
  // PLAN-SCOPED SEAM), so this dispatches nothing today — but the moment is
  // wired now and must never block or fail the decision response.
  fireAndForgetPush(() => notifyPlanUpdate({
    planId: id,
    reason: decision === "accepted" ? "proposal_accepted" : "proposal_rejected",
    title: "Plan updated",
    body: decision === "accepted" ? "A new route was accepted." : "A proposed route was turned down.",
  }));
  return jsonNoStore(result);
}
