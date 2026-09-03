import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { isPlanId } from "@/lib/plan";
import { collaborationErrorResponse, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planCollaborationStore, type PlanConstraintEvidence } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";

type Context = { params: Promise<{ id: string; constraintId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-constraint-resolve:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id, constraintId } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const evidence = body.evidence && typeof body.evidence === "object" ? body.evidence as PlanConstraintEvidence : {} as PlanConstraintEvidence;
  const result = await planCollaborationStore().resolveConstraint(id, planMemberCapability(request, body.memberToken), constraintId, { evidence, idempotencyKey: collaborationIdempotencyKey(request, body) });
  if (!result.ok) return collaborationErrorResponse(result.error);
  return jsonNoStore(result);
}
