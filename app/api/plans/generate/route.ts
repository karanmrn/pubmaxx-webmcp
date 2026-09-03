import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { DEFAULT_CITY_ID, parseCityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { planCultureOpenerFields } from "@/lib/cultureCrawl.server";
import type { PlanningConfidence, PlanRouteTotals } from "@/lib/planIntelligence";
import { estimatePlanWalking, estimateStraightLinePlanWalking } from "@/lib/walkRouteLegs";
import { planGenerationEndings } from "@/lib/planGenerationEndings.server";
import {
	buildPlanGenerationStops,
	planBudgetSummary,
	planRouteTimingDisclosure,
} from "@/lib/planGenerationDto";
import {
	loadPlanGenerationBaselineWhatsOn,
	preparePlanGeneration,
	runAnchoredGeneration,
} from "@/lib/planGeneration.server";
import { planEvidenceWarning, planGenerationEvidenceGaps } from "@/lib/planGenerationRanking";
import { selectPlanGenerationCandidates } from "@/lib/planGenerationSelection.server";
import type { PlanConstraintReport, SelectedGroundedPlanStop } from "@/lib/planRouteOptimizer";
import type { PlanningIntentSource } from "@/lib/planningIntent";
import { mintPlanGroundingProof, mintPlanGroundingProofV2 } from "@/lib/planGrounding.server";
import { planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
import { normalizePlanStopCount } from "@/lib/planStopCount";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

/**
 * Best-effort planning warmup. It loads only the stable public venue index and
 * never creates a plan, records a location, or consumes a generation budget.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cityId = parseCityId(url.searchParams.get("cityId") ?? "") ?? DEFAULT_CITY_ID;
  await loadConciergeVenues(cityId);
  await loadPlanGenerationBaselineWhatsOn(Date.now()).catch((error) => {
    console.warn(
      "[plans/generate] What's-On warmup degraded:",
      error instanceof Error ? error.message : String(error),
    );
  });
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
	const preparation = await preparePlanGeneration(request);
	if ("response" in preparation) return preparation.response;
	const {
		requestNow,
		operationKey,
		query,
		intake,
		context,
		reconciled,
		cityId,
		area,
		routeReady,
		coverage,
		planningWeather,
		reviewedSignalClaims,
		naLensPrices,
		candidates,
		anchor: anchorRequest,
	} = preparation.prepared;
	type Candidate = (typeof candidates)[number];
	let groundedStops: readonly SelectedGroundedPlanStop<Candidate>[] | null = null;
	let groundedAlternatives: readonly (readonly SelectedGroundedPlanStop<Candidate>[])[] | null = null;
	let constraintReport: PlanConstraintReport | null = null;
	let groundedTiming: { straightLineWalkingKm: number; walkingMinutes: number; transferUncertaintyMinutes: number; scheduledRouteMinutes: number } | null = null;
	let accessibilityEnforced = false;
	let anchorContext: { anchorVenueId: string; anchorSource: PlanningIntentSource } | null = null;
	let chosen: Candidate[];
	// An accepted Venue is always authoritative for anchored generation. Requests
	// without one retain the generic, unanchored selection path.
	if (anchorRequest) {
		const anchored = await runAnchoredGeneration({
			cityId, anchor: anchorRequest, candidates, context, intake, requestNow, operationKey, area, coverage,
		});
		if ("done" in anchored) return anchored.done;
		chosen = anchored.route.chosen;
		groundedStops = anchored.route.groundedStops;
		groundedAlternatives = anchored.route.groundedAlternatives;
		groundedTiming = anchored.route.groundedTiming;
		constraintReport = anchored.route.constraintReport;
		accessibilityEnforced = anchored.route.accessibilityEnforced;
		anchorContext = anchored.route.anchorContext;
	} else {
		const generatedSelection = await selectPlanGenerationCandidates(candidates, context, intake, requestNow);
		if (!generatedSelection.ok) {
			return publicApiError(
				`No ${normalizePlanStopCount(context.stopCount)}-stop route in ${area.name} meets every must-have need with the information available.`,
				"GROUNDED_CONSTRAINTS_UNSATISFIED",
				422,
				{ details: { nightArea: area.slug, availableVenueCount: candidates.length, ...generatedSelection.selection } },
			);
		}
		chosen = generatedSelection.chosen;
		if (!generatedSelection.legacy) {
			groundedStops = generatedSelection.selection.stops;
			groundedAlternatives = generatedSelection.selection.alternatives;
			groundedTiming = generatedSelection.selection.timing;
			constraintReport = generatedSelection.selection.constraintReport;
			accessibilityEnforced = generatedSelection.accessibilityEnforced;
		}
	}
	const requestedStopCount = normalizePlanStopCount(context.stopCount);
	if (chosen.length < requestedStopCount) return publicApiError(`Not enough listed pubs in ${area.name} to build a ${requestedStopCount}-stop route yet.`, "GROUNDED_VENUES_INSUFFICIENT", 422, { details: { nightArea: area.slug, availableVenueCount: chosen.length, requestedStopCount } });
	const pricePence = chosen.map(({ venue }, position) => groundedStops
		? groundedStops[position].price.pence
		: venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100));
	const hasCompletePriceEvidence = pricePence.every((price): price is number => price !== null);
	const { contextEvidenceGaps, operationalEvidenceGaps } = planGenerationEvidenceGaps({
		context,
		accessibilityEnforced,
		hasDatedWindow: Boolean(intake?.routeWindow),
		allOpeningListed: Boolean(groundedStops?.every((stop) => stop.opening.state === "listed_open")),
		hasCompletePriceEvidence,
		allZeroProofConfirmed: chosen.every(({ venue }) => naLensPrices.has(venue.id) || venue.amenities.nonAlcoholic === true),
		hasTonightEvidence: chosen.some(({ tonightEvents }) => tonightEvents.length > 0),
		hasWeatherEvidence: Boolean(planningWeather),
	});
	const missingEvidence = [...new Set([...area.missingEvidence, ...contextEvidenceGaps, ...operationalEvidenceGaps])];
	const confidenceScore = Math.max(0, Math.min(1, Math.min(reconciled.confidence, coverage.coverageScore / 100)));
	const planningConfidence: PlanningConfidence = {
		level: routeReady ? (missingEvidence.length ? "medium" : "high") : "low",
		score: Number(confidenceScore.toFixed(2)),
		routeReady,
		missingEvidence,
		warnings: missingEvidence.map(planEvidenceWarning),
		provenance: [
			{ kind: "venue_dataset", label: "PUBMAXX Venue Dataset" },
			{ kind: "night_area_review", label: `${area.name} route review`, asOf: area.lastReviewedAt },
			...(planningWeather ? [{
				kind: "night_signal" as const,
				label: `${planningWeather.source.publisher}: ${planningWeather.condition}`,
				asOf: planningWeather.observedAt,
			}] : []),
		],
	};
	const budgetSummary = planBudgetSummary(context, pricePence);
	// Per-stop walking minutes (Sol S3). Fail-soft: keyless keeps the straight-
	// line estimate; a routing failure never blocks generation. When the ORS key
	// is present AND the global daily budget allows the call (lib/walkRouteLegs
	// routes every provider call through consumeOrsBudget), routed leg durations
	// upgrade the totals to a "routed" basis.
	const chosenWalkingStops = chosen.map(({ venue }) => ({ lat: venue.lat, lng: venue.lng }));
	const walkingEstimate = await estimatePlanWalking(chosenWalkingStops).catch(() =>
		estimateStraightLinePlanWalking(chosenWalkingStops),
	);
	const routeTotals: PlanRouteTotals = {
		stopCount: chosen.length,
		straightLineWalkingKm: Number(walkingEstimate.straightLineWalkingKm.toFixed(2)),
		estimatedWalkingMinutes: walkingEstimate.estimatedWalkingMinutes,
		distanceBasis: walkingEstimate.distanceBasis,
	};
	const endingRecommendations = planGenerationEndings({
		chosen,
		candidates,
		groundedAlternatives,
		hasIntake: Boolean(intake),
		context,
		areaSlug: area.slug,
		transportAnchor: area.transportAnchors[0] ?? area.name,
		now: requestNow,
	});
	const nightArea = { id: area.slug, ...coverage };
	// Culture Crawl opener: a free-standing thing to see before the first pint,
	// drawn from the ambient POI layer alone. It is never a Stop, never priced,
	// and never enters the grounding proof below, because the proof commits to
	// venue records and a POI is not one.
	const cultureOpenerFields = planCultureOpenerFields({
		query,
		cityId,
		stops: chosenWalkingStops,
	});
	const stops = buildPlanGenerationStops({
		chosen,
		candidates,
		groundedStops,
		groundedAlternatives,
		walkingEstimate,
		area,
		planningWeather,
	});
	// Ground the proof over exactly the venues this response commits to: the
	// three chosen stops plus every alternative id we actually emit above.
	const groundingCandidateIds = [
		...chosen.map(({ venue }) => venue.id),
		...stops.flatMap((stop) => stop.alternatives.map((alternative) => alternative.venueId)),
	];
	let groundingProof: string;
	try {
		groundingProof = anchorContext
			? mintPlanGroundingProofV2({
				// chosen[0] is the anchor: exact server-selected order, anchor first.
				routeVenueIds: chosen.map(({ venue }) => venue.id),
				allowedVenueIds: groundingCandidateIds,
				anchorVenueId: anchorContext.anchorVenueId,
				anchorSource: anchorContext.anchorSource,
				outcome: "route",
				operationKey,
			}, requestNow)
			: mintPlanGroundingProof(groundingCandidateIds, operationKey, requestNow);
	} catch (error) {
		const unavailable = planSigningUnavailableResponse(error);
		if (unavailable) return unavailable;
		throw error;
	}
  return jsonNoStore({
    // This response is assembled exclusively from the reviewed venue dataset
    // above and only exists when the requested canonical venue records were selected.
    // The explicit flag lets clients distinguish server-grounded generation
    // from a manual draft without guessing from unrelated revision metadata.
    grounded: true,
    ...(anchorContext ? {
      outcome: "route" as const,
      anchored: true,
      routeReady: true,
      anchorVenueId: anchorContext.anchorVenueId,
      anchorSource: anchorContext.anchorSource,
    } : {}),
    groundingProof,
    operationKey,
    inferredContext: context,
		contextFieldSources: reconciled.fieldSources,
    confidence: reconciled.confidence,
		planningConfidence,
		budgetSummary,
		routeTotals,
		routeTiming: planRouteTimingDisclosure(groundedTiming),
		endingRecommendations,
		...cultureOpenerFields,
		weatherEvidence: planningWeather,
		nightArea,
		...(constraintReport ? { constraintReport } : {}),
		// Back-compatible alias until every client has moved to Night Area.
		district: nightArea,
		explanations: reconciled.reasons,
		stops,
	    contextEffects: [
	      "budget",
	      "daypart",
	      ...(context.groupSize ? ["groupSize"] : []),
	      ...(context.partyType !== "friends" ? ["partyType"] : []),
	      ...(context.atmosphere.length ? ["atmosphere"] : []),
	      ...(context.foodNeeds.length ? ["foodNeeds"] : []),
			...(context.budgetLimitPence ? ["budgetLimitPence"] : []),
			...(context.zeroProof ? ["zeroProof"] : []),
			...(context.wetherspoonsPreferred ? ["wetherspoonsPreferred"] : []),
			...(planningWeather ? ["weather"] : []),
	    ],
	    missingContextEvidence: contextEvidenceGaps,
	    relevantSignals: area.recentSignals,
		nightSignalClaims: reviewedSignalClaims.filter((claim) =>
			(claim.entity.type === "night_area" && claim.entity.id === area.slug) ||
			chosen.some(({ venue }) => claim.entity.type === "venue" && claim.entity.id === venue.id),
		),
	  });
  } catch (error) {
    console.error("plan_generate.unexpected_error", error);
    return publicApiError("Could not generate a route right now.", "PLAN_GENERATION_FAILED", 503, { retryable: true });
  }
}
