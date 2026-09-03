import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { isPlanId } from "@/lib/plan";
import { collaborationErrorResponse, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";

type Context = { params: Promise<{ id: string; inviteId: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-invite-revoke:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id, inviteId } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch { /* DELETE may use headers only. */ }
  const result = await planCollaborationStore().revokeInvite(id, planMemberCapability(request, body.memberToken), inviteId, collaborationIdempotencyKey(request, body));
  if (!result.ok) return collaborationErrorResponse(result.error);
  return jsonNoStore(result);
}
