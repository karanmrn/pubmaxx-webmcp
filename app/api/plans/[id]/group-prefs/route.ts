import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { parseGroupPrefWriteInput } from "@/lib/groupPrefs";
import { isLimited } from "@/lib/pintDrops";
import { isPlanId } from "@/lib/plan";
import { collaborationErrorResponse, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planGroupPrefsStore, type PlanGroupPrefsError } from "@/lib/planGroupPrefsStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { clientIp, hashIp } from "@/lib/supabase";

type Context = { params: Promise<{ id: string }> };

function groupPrefsErrorResponse(error: PlanGroupPrefsError): Response {
  return collaborationErrorResponse(error);
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const result = await planGroupPrefsStore().list(id, planMemberCapability(request, null));
  if (!result.ok) return groupPrefsErrorResponse(result.error);
  return jsonNoStore(result, { status: 200 });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const limiterKey = `plan-group-prefs:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many preference saves, slow down.", "PLAN_GROUP_PREFS_RATE_LIMITED", 429, { retryable: true });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const input = parseGroupPrefWriteInput(body);
  if (!input) {
    return publicApiError("Pick a budget band and a vibe to share.", "PLAN_GROUP_PREFS_INVALID", 400);
  }
  const result = await planGroupPrefsStore().save(
    id,
    planMemberCapability(request, body.memberToken),
    input,
    collaborationIdempotencyKey(request, body),
  );
  if (!result.ok) return groupPrefsErrorResponse(result.error);
  return jsonNoStore(result, { status: 201 });
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const limiterKey = `plan-group-prefs-clear:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many preference clears, slow down.", "PLAN_GROUP_PREFS_RATE_LIMITED", 429, { retryable: true });
  }
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const result = await planGroupPrefsStore().clear(id, planMemberCapability(request, body.memberToken));
  if (!result.ok) return groupPrefsErrorResponse(result.error);
  return jsonNoStore(result, { status: 200 });
}
