import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerUserId } from "@/lib/authServer";
import { parseCityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { isLimited } from "@/lib/pintDrops";
import { cleanPlanAnchor } from "@/lib/plan";
import { planStopResolver } from "@/lib/planRoute";
import { claimPlanMembership } from "@/lib/planCrewIdentity";
import { planMemberIdentity, planRequestDigest, planStore } from "@/lib/planStore";
import {
  readPlanGroundingClaimsV2,
  verifyAnchoredPlanGroundingProofV2,
  verifyPlanGroundingProof,
  wasPlanGroundedAtCreation,
  type PlanGroundingRejectionV2,
} from "@/lib/planGrounding.server";
import { planSigningPreflightResponse, planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
import { attachPlanMemberSession } from "@/lib/planMemberCapability";
import { PLAN_IDEMPOTENCY_ERROR, planMutationIdempotencyKey } from "@/lib/planMutationHttp";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { planAcceptedEventTokens, planDraftSavedEventToken, planLoopEventTokens } from "@/lib/verifiedAnalytics.server";

assertServerEnv();

/** Every V2 proof rejection is an explicit 422; the reason drives the code/message. */
function anchorProofError(reason: PlanGroundingRejectionV2): { message: string; code: string } {
  switch (reason) {
    case "missing":
      return { message: "Include the grounding proof from generation.", code: "PLAN_ANCHOR_PROOF_MISSING" };
    case "expired":
      return { message: "The grounding proof expired. Regenerate the Route and lock it in again.", code: "PLAN_ANCHOR_PROOF_EXPIRED" };
    case "route-mismatch":
      return { message: "The submitted Stops do not match the grounded Route.", code: "PLAN_ANCHOR_PROOF_ROUTE_MISMATCH" };
    case "operation-mismatch":
      return { message: "The grounding proof was issued for a different operation.", code: "PLAN_ANCHOR_PROOF_OPERATION_MISMATCH" };
    default:
      return { message: "That saved route could not be checked.", code: "PLAN_ANCHOR_PROOF_INVALID" };
  }
}

function createEventTokens(input: {
  anchor: ReturnType<typeof cleanPlanAnchor>;
  anchorAnchored: boolean;
  createdAt: string;
  grounded: boolean;
  planId: string;
  routeReadyAt: string | null;
  stopCount: number;
}): Record<string, string> {
  if (!input.anchor) {
    return planLoopEventTokens({
      planId: input.planId,
      createdAt: input.createdAt,
      stops: input.stopCount,
      grounded: input.grounded,
    });
  }
  if (input.anchor.outcome === "anchor-only") {
    return {
      planDraftSaved: planDraftSavedEventToken({
        planId: input.planId,
        savedAt: input.createdAt,
        source: input.anchor.source,
      }),
      planAccepted: "",
      meaningfulCoreAction: "",
    };
  }
  return {
    planDraftSaved: "",
    ...planAcceptedEventTokens({
      planId: input.planId,
      acceptedAt: input.routeReadyAt ?? input.createdAt,
      anchored: input.anchorAnchored,
      source: input.anchor.source,
    }),
  };
}

async function claimSignedInPlanCreator(
  request: Request,
  planId: string,
  memberToken: string,
): Promise<void> {
  try {
    const hostUserId = await callerUserId(request);
    if (!hostUserId) return;
    const hostIdentity = await planMemberIdentity(planId, memberToken);
    if (!hostIdentity?.memberId) return;
    await claimPlanMembership(planId, hostIdentity.memberId, hostUserId);
  } catch {
    // Plan creation still succeeds. Account claim retries from ActivePlanMarker.
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const idempotencyKey = planMutationIdempotencyKey(request, body);
  if (!idempotencyKey) return publicApiError(PLAN_IDEMPOTENCY_ERROR.error, PLAN_IDEMPOTENCY_ERROR.code, 400);
  const signingUnavailable = planSigningPreflightResponse();
  if (signingUnavailable) return signingUnavailable;
  const limiterKey = `plan-create:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, undefined, undefined, { failClosed: true })) {
    return publicApiError("Too many Plans, slow down.", "PLAN_CREATE_RATE_LIMITED", 429, { retryable: true });
  }
  const rawCity = typeof body.cityId === "string" ? body.cityId : undefined;
  const cityId = rawCity ? parseCityId(rawCity) : DEFAULT_CITY_ID;
  if (!cityId) return publicApiError("Choose a listed city.", "CITY_INVALID", 400);
  const submittedStops = Array.isArray(body.stops) ? body.stops : [];
  // One rule for what a Stop id may be, shared with route replacement: a listed
  // venue, or a `place:<poi id>` meeting point. Free text resolves to nothing.
  const resolveStop = await planStopResolver(cityId);
  const stops = submittedStops.map((raw) => resolveStop(raw));
  if (stops.some((stop) => stop === null)) {
    return publicApiError("Choose listed venues.", "PLAN_VENUES_INVALID", 400);
  }
  const acceptedVenueIds = stops.flatMap((stop) => stop ? [stop.venueId] : []);
  const groundingProofDigest = typeof body.groundingProof === "string" && body.groundingProof
    ? planRequestDigest(body.groundingProof)
    : undefined;
  // Anchored lock (§3.3): an accepted anchor must carry a valid V2 grounding
  // proof whose exact ordered Stops match this Plan. Every proof failure is an
  // explicit 422; a same-key replay with a changed anchor or proof is resolved
  // to a 409 by the store's idempotency hash below.
  const anchorSupplied = Object.prototype.hasOwnProperty.call(body, "anchor");
  const anchor = cleanPlanAnchor(body.anchor);
  if (anchorSupplied && !anchor) {
    return publicApiError("Include the accepted pub and where it came from.", "PLAN_ANCHOR_INVALID", 422);
  }
  if (!anchor && readPlanGroundingClaimsV2(body.groundingProof)) {
    return publicApiError("Include the accepted pub for this route.", "PLAN_ANCHOR_REQUIRED", 422);
  }
  let anchorAnchored = false;
  if (anchor) {
    const verdict = verifyAnchoredPlanGroundingProofV2(body.groundingProof, acceptedVenueIds, idempotencyKey);
    if (!verdict.ok) {
      const mapped = anchorProofError(verdict.reason);
      return publicApiError(mapped.message, mapped.code, 422);
    }
    if (verdict.outcome !== anchor.outcome) {
      return publicApiError("That saved route does not match this plan.", "PLAN_ANCHOR_OUTCOME_MISMATCH", 422);
    }
    if (verdict.anchorVenueId !== anchor.venueId) {
      return publicApiError("That saved pub does not match this plan.", "PLAN_ANCHOR_VENUE_MISMATCH", 422);
    }
    if (verdict.anchorSource !== anchor.source) {
      return publicApiError("That pub came from somewhere else than this plan says.", "PLAN_ANCHOR_SOURCE_MISMATCH", 422);
    }
    anchorAnchored = verdict.anchored;
  }
  const result = await planStore().create(
    { ...body, stops },
    { idempotencyKey, ...(groundingProofDigest ? { groundingProofDigest } : {}), ...(anchor ? { anchor } : {}) },
  );
  if (!result.ok) {
    return publicApiError(
      result.error === "invalid" ? "Add a start time, your name, and at least one venue."
        : result.error === "conflict" ? "That request key was already used for a different Plan."
          : "Could not create the Plan.",
      result.error === "invalid" ? "PLAN_CREATE_INVALID" : result.error === "conflict" ? "PLAN_IDEMPOTENCY_CONFLICT" : "PLAN_CREATE_UNAVAILABLE",
      result.error === "invalid" ? 400 : result.error === "conflict" ? 409 : 503,
      { retryable: result.error === "error" },
    );
  }
  // An anchored Plan is grounded by its verified V2 proof; legacy creation keeps
  // the V1 candidate-set derivation.
  const grounded = anchor
    ? true
    : result.created
      ? verifyPlanGroundingProof(body.groundingProof, acceptedVenueIds, idempotencyKey)
      : wasPlanGroundedAtCreation(
          body.groundingProof,
          acceptedVenueIds,
          idempotencyKey,
          result.plan.plan.createdAt,
        );
  let eventTokens: Record<string, string>;
  try {
    eventTokens = createEventTokens({
      anchor,
      anchorAnchored,
      createdAt: result.plan.plan.createdAt,
      grounded,
      planId: result.plan.plan.id,
      routeReadyAt: result.plan.plan.routeReadyAt ?? null,
      stopCount: result.plan.stops.length,
    });
  } catch (error) {
    const unavailable = planSigningUnavailableResponse(error);
    if (unavailable) return unavailable;
    throw error;
  }
  // Bind a signed-in creator to the host membership and Plan in one write.
  // A public handle is not required to keep Plan ownership after signup.
  await claimSignedInPlanCreator(request, result.plan.plan.id, result.memberToken);

  return attachPlanMemberSession(
    jsonNoStore({
      plan: result.plan,
      memberToken: result.memberToken,
      role: result.role,
      created: result.created,
      // The signature binds the accepted venue ids to a server-generated
      // candidate set. Client grounding flags and edited proofs are ignored.
      grounded,
      eventTokens,
    }, { status: 201 }),
    request,
    result.plan.plan.id,
    result.memberToken,
  );
}
