import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { isPlanId, type PlanActionDTO } from "@/lib/plan";
import { planStore } from "@/lib/planStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey } from "@/lib/planMutationHttp";
import { assertServerEnv } from "@/lib/serverEnv";
import { fulfilWantedsAtVenue } from "@/lib/wantedFulfil.server";
import { wantedFulfilledLine } from "@/lib/wanted";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };
const ACTIONS: PlanActionDTO["type"][] = ["arrived", "skipped", "swapped"];

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-actions:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const type = typeof body.type === "string" && ACTIONS.includes(body.type as PlanActionDTO["type"]) ? body.type as PlanActionDTO["type"] : null;
  const stopPosition = typeof body.stopPosition === "number" && Number.isInteger(body.stopPosition) && body.stopPosition >= 0 && body.stopPosition < 8 ? body.stopPosition : undefined;
  if (!type || stopPosition === undefined) return publicApiError("Add a valid stop action.", "PLAN_ACTION_INVALID", 400);
  const idempotencyKey = planMutationIdempotencyKey(request, body);
  if (!idempotencyKey) return publicApiError(PLAN_IDEMPOTENCY_ERROR.error, PLAN_IDEMPOTENCY_ERROR.code, 400);
  const result = await planStore().addAction(id, planMemberCapability(request, body.memberToken), { type, stopPosition, idempotencyKey });
  if (!result.ok) {
    const status = result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : result.error === "error" ? 503 : result.error === "conflict" ? 409 : 400;
    const error = result.error === "forbidden" ? "That member token cannot update this Plan." : result.error === "not_found" ? "That Plan doesn't exist." : result.error === "error" ? "The Plan update is temporarily unavailable." : "Could not record the action.";
    const code = result.error === "forbidden" ? "PLAN_ACTION_FORBIDDEN" : result.error === "not_found" ? "PLAN_NOT_FOUND" : result.error === "error" ? "PLAN_ACTION_UNAVAILABLE" : result.error === "conflict" ? "PLAN_IDEMPOTENCY_CONFLICT" : "PLAN_ACTION_INVALID";
    return publicApiError(error, code, status, { retryable: result.error === "error" });
  }

  // Quiet Wanted fulfilment when a signed-in owner arrives at a saved stop.
  let wantedNote: string | undefined;
  let wantedFulfilled = 0;
  if (type === "arrived") {
    const stop = result.plan.stops.find((row) => row.position === stopPosition);
    if (stop?.venueId) {
      const contributor = await resolveContributionIdentity(request);
      if (contributor.ok) {
        const fulfilled = await fulfilWantedsAtVenue(contributor.actor, stop.venueId);
        wantedFulfilled = fulfilled.length;
        if (fulfilled[0]) wantedNote = wantedFulfilledLine(fulfilled[0].venueName);
      }
    }
  }

  return jsonNoStore(
    {
      ...result.plan,
      ...(wantedFulfilled > 0 ? { wantedFulfilled, wantedNote } : {}),
    },
    { status: 201 },
  );
}
