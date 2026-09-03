// GET /api/plans/[id]/getin — per-stop "can the crew get in?" estimate for a
// Plan. Read-only, link-visible (no auth), same 404 shape as GET
// /api/plans/[id]. Wraps lib/planGetIn's pure mapping around the real Plan
// state and venue detail lookup so every field stays an honest estimate —
// never a guarantee of entry.
//
// Push note: a get-in "update" is a plan-scoped notification event, but this
// route is READ-ONLY (GET) — a get-in estimate has no server write moment to
// hook, and firing on every read would spam. The get-in-changed push therefore
// rides the plan mutation that caused the shift (see the decision route's
// notifyPlanUpdate call) rather than this endpoint. Both use the same dormant
// plan-scoped seam in lib/pushSender.ts (no identity on tokens yet).

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { planGetInReport } from "@/lib/planGetIn";
import { isPlanId } from "@/lib/plan";
import { resolvePlanProjection } from "@/lib/planPrivacyBoundary.server";
import { planStateResult } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { getVenueDetail } from "@/lib/venueDetailIndex";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const lookup = await planStateResult(id);
  if (!lookup.ok) return publicApiError("Plan data is temporarily unavailable.", "PLAN_STORE_UNAVAILABLE", 503, { retryable: true });
  if (!lookup.plan) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  // The get-in report names every Venue on the route, so it is member-only.
  // Uninvited viewers get a preview marker, never the per-stop venue data.
  const projection = await resolvePlanProjection({ request, planId: id, state: lookup.plan });
  if (projection.visibility !== "member") {
    return jsonNoStore({ visibility: "preview" }, { status: 200 });
  }
  const report = await planGetInReport(lookup.plan, getVenueDetail);
  return jsonNoStore(report, { status: 200 });
}
