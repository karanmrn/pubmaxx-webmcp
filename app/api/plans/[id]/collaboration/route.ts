import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { isPlanId } from "@/lib/plan";
import { collaborationErrorResponse } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const result = await planCollaborationStore().list(id, planMemberCapability(request, undefined));
  if (!result.ok) return collaborationErrorResponse(result.error);
  return jsonNoStore(result);
}
