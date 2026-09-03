import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { callerUserId } from "@/lib/authServer";
import { isPlanId } from "@/lib/plan";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planStore } from "@/lib/planStore";
import { resolvePlanProjection } from "@/lib/planPrivacyBoundary.server";
import { assembleMemberRecap } from "@/lib/planRecapView.server";
import { validatePendingPlanRecap } from "@/lib/planRecap";
import { promotePendingPlanRecapToMemory } from "@/lib/planRecapPromote.server";
import { pendingPlanRecapStore } from "@/lib/pendingPlanRecapStore";

type Context = { params: Promise<{ id: string }> };

function error(error: string, code: string, status: number, retryable = false): Response {
  return publicApiError(error, code, status, { retryable });
}

/**
 * §4.10: the full recap (route venue names, pints logged, the user title) is
 * returned ONLY to a viewer whose request carries a valid host/guest capability
 * with member rehydration enabled. Everyone else gets a preview shell with no
 * route, venue, pint, or title — exactly like the main Plan projection.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return error("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const state = await planStore().get(id);
  if (!state) return error("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const projection = await resolvePlanProjection({ request, planId: id, state });
  if (projection.visibility !== "member") {
    return jsonNoStore({ visibility: "preview", stopCount: state.stops.length }, { status: 200 });
  }
  const assembly = await assembleMemberRecap(id);
  if (!assembly) return error("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  return jsonNoStore({ visibility: "member", ...assembly }, { status: 200 });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-recap:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const { id } = await context.params;
  if (!isPlanId(id)) return error("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const ownerId = await callerUserId(request);
  if (!ownerId) return error("Sign in to save this private recap.", "AUTH_REQUIRED", 401);

  let raw: Record<string, unknown>;
  try { raw = await request.json() as Record<string, unknown>; } catch {
    return error("Malformed request body.", "INVALID_JSON", 400);
  }
  const memberToken = planMemberCapability(request, raw.memberToken);
  const recap = validatePendingPlanRecap(raw.recap);
  if (!memberToken || !recap || recap.planId !== id) {
    return error("Add the valid Plan recap and member capability.", "INVALID_RECAP", 400);
  }

  const result = await promotePendingPlanRecapToMemory(ownerId, recap, memberToken);
  if (!result.ok) {
    // Park only retryable failures so a conflict/forbidden draft cannot overwrite
    // a good account copy. Device localStorage remains the other hold.
    if (
      result.error === "member_unavailable" ||
      result.error === "completion_unavailable" ||
      result.error === "save_failed"
    ) {
      await pendingPlanRecapStore().upsert(ownerId, recap);
    }
    if (result.error === "member_forbidden") {
      return error("That member capability cannot save this recap.", "MEMBER_FORBIDDEN", 403);
    }
    if (result.error === "member_unavailable" || result.error === "completion_unavailable") {
      return error(
        result.error === "completion_unavailable"
          ? "The completed Plan is temporarily unavailable."
          : "The Plan member check is temporarily unavailable.",
        result.error === "completion_unavailable"
          ? "COMPLETION_LOOKUP_UNAVAILABLE"
          : "MEMBER_LOOKUP_UNAVAILABLE",
        503,
        true,
      );
    }
    if (result.error === "not_completed") {
      return error("Complete the Plan before saving its recap.", "PLAN_NOT_COMPLETED", 409);
    }
    if (result.error === "conflict" || result.error === "invalid") {
      return error(
        "The completed route changed. Refresh the recap before saving.",
        "RECAP_CONFLICT",
        409,
      );
    }
    return error(
      "That private recap could not be saved. Your local draft is safe.",
      "RECAP_SAVE_FAILED",
      503,
      true,
    );
  }

  await pendingPlanRecapStore().remove(ownerId, recap.completionId);
  return jsonNoStore({ memory: result.memory, moments: result.moments, private: true }, { status: 201 });
}
