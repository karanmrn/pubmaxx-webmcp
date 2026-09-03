import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { isPlanId } from "@/lib/plan";
import { canonicalPlanRoute } from "@/lib/planRoute";
import { collaborationErrorResponse, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-proposals:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const stops = await canonicalPlanRoute(body.stops);
  const result = await planCollaborationStore().createProposal(id, planMemberCapability(request, body.memberToken), {
    reason: typeof body.reason === "string" ? body.reason : "",
    expectedRouteRevision: typeof body.expectedRouteRevision === "number" ? body.expectedRouteRevision : 0,
    stops: stops ?? [],
    resolvedConstraintIds: Array.isArray(body.resolvedConstraintIds) ? body.resolvedConstraintIds.filter((value): value is string => typeof value === "string") : [],
    idempotencyKey: collaborationIdempotencyKey(request, body),
  });
  if (!result.ok) return collaborationErrorResponse(result.error);
  return jsonNoStore(result, { status: 201 });
}
