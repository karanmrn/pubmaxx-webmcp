import "server-only";

import { randomUUID } from "node:crypto";

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { DEFAULT_CITY_ID, parseCityId, type CityId } from "@/lib/cities";
import { NO_ALCOHOL_DRINK_CATEGORIES, type CommunityPrice } from "@/lib/communityPrice";
import { readCommunityPriceCategoryIndex } from "@/lib/communityPriceStore";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { haversineKm } from "@/lib/haversine";
import { trustedNoAlcoholLensPrices } from "@/lib/mapExperienceLens";
import {
	getNightArea,
	isNightAreaRouteReady,
	publicNightAreaCoverage,
	type NightArea,
} from "@/lib/nightAreas";
import type { NightContext } from "@/lib/nightPlanning";
import {
	canAffectRoute,
	claimsForEntity,
} from "@/lib/nightSignalClaims";
import { isLimited } from "@/lib/pintDrops";
import { reconcilePlanContext } from "@/lib/planGenerationContext";
import type { ParsedPlanGenerationIntake } from "@/lib/planGenerationIntake";
import { scoreVenueForPlan } from "@/lib/planGenerationRanking";
import {
	parsePlanGenerationRequest,
	type PlanGenerationAnchor,
} from "@/lib/planGenerationRequest";
import {
	selectAnchoredPlanGenerationCandidates,
	type ScoredPlanCandidate,
} from "@/lib/planGenerationSelection.server";
import { planTemporalEvidence } from "@/lib/planGenerationTemporalEvidence";
import { mintPlanGroundingProofV2 } from "@/lib/planGrounding.server";
import type {
	PlanConstraintReport,
	PlanRouteTiming,
	SelectedGroundedPlanStop,
} from "@/lib/planRouteOptimizer";
import { planSigningPreflightResponse, planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
import { resolvePlanningAnchor } from "@/lib/planningAnchor.server";
import type { PlanningIntentSource } from "@/lib/planningIntent";
import { clientIp, hashIp, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "@/lib/supabase";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { loadServedWhatsOnListings } from "@/lib/whatsOnListings.server";
import { loadBaselineWhatsOn } from "@/lib/whatsOnStore";
import { matchedWetherspoonsVenueIds } from "@/lib/wetherspoonsMatch.server";
import nightSignalSnapshot from "@/public/data/night_signals/latest.json";
import weatherSnapshot from "@/public/data/weather/latest.json";

let bundledWhatsOn: WhatsOnRow[] | null = null;

export async function loadPlanGenerationBaselineWhatsOn(now: number): Promise<WhatsOnRow[]> {
	return loadServedWhatsOnListings({
		bundled: (bundledWhatsOn ??= loadBaselineWhatsOn()),
		now,
	});
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
	return haversineKm([a.lng, a.lat], [b.lng, b.lat]);
}

type AnchoredRouteData<T extends ScoredPlanCandidate> = {
	chosen: T[];
	groundedStops: readonly SelectedGroundedPlanStop<T>[];
	groundedAlternatives: readonly (readonly SelectedGroundedPlanStop<T>[])[];
	groundedTiming: PlanRouteTiming;
	constraintReport: PlanConstraintReport;
	accessibilityEnforced: boolean;
	anchorContext: { anchorVenueId: string; anchorSource: PlanningIntentSource };
};

/**
 * Preflight the accepted anchor and run the anchor-pinned optimizer. Returns a
 * ready Response for the conflict and one-Stop anchor-only outcomes, or the
 * grounded route data for the shared three-Stop response assembly.
 */
export async function runAnchoredGeneration<T extends ScoredPlanCandidate>(params: {
	cityId: CityId;
	anchor: PlanGenerationAnchor;
	candidates: readonly T[];
	context: NightContext;
	intake: ParsedPlanGenerationIntake | null;
	requestNow: number;
	operationKey: string;
	area: NightArea;
	coverage: ReturnType<typeof publicNightAreaCoverage>;
}): Promise<{ done: Response } | { route: AnchoredRouteData<T> }> {
	const { cityId, anchor, candidates, context, intake, requestNow, operationKey, area, coverage } = params;
	const nightArea = { id: area.slug, ...coverage };
	const anchorConflict = (reason: string, message: string): { done: Response } => ({
		done: jsonNoStore({
			grounded: false,
			outcome: "anchor-conflict",
			anchored: true,
			routeReady: false,
			stops: [],
			reason,
			message,
			operationKey,
			nightArea,
		}, { status: 200 }),
	});

	const anchorResolution = await resolvePlanningAnchor({
		cityId,
		venueId: anchor.venueId,
		startsAt: anchor.startsAt,
		acceptedArea: anchor.acceptedArea,
		now: requestNow,
	});
	if (anchorResolution.status === "conflict") {
		return anchorConflict(anchorResolution.code, anchorResolution.message);
	}
	const anchorVenueId = anchorResolution.canonical.venueId;
	const selection = await selectAnchoredPlanGenerationCandidates(
		candidates,
		context,
		intake,
		requestNow,
		anchorVenueId,
	);
	if (!selection.ok) {
		return anchorConflict(
			"ANCHOR_ROUTE_CONFLICT",
			"We could not build a route from that pub right now. Try a different pub.",
		);
	}
	if (selection.outcome === "anchor-only") {
		let anchorOnlyProof: string;
		try {
			anchorOnlyProof = mintPlanGroundingProofV2({
				routeVenueIds: [anchorVenueId],
				allowedVenueIds: [anchorVenueId],
				anchorVenueId,
				anchorSource: anchor.source,
				outcome: "anchor-only",
				operationKey,
			}, requestNow);
		} catch (error) {
			const unavailable = planSigningUnavailableResponse(error);
			if (unavailable) return { done: unavailable };
			throw error;
		}
		const stop = selection.anchor;
		return { done: jsonNoStore({
			// A grounded one-Stop draft: the accepted Venue is kept as Stop 1 and
			// never emits plan_accepted (routeReady stays false until three Stops).
			grounded: true,
			outcome: "anchor-only",
			anchored: true,
			routeReady: false,
			reason: "ANCHOR_COMPANIONS_INSUFFICIENT",
			anchorVenueId,
			anchorSource: anchor.source,
			groundingProof: anchorOnlyProof,
			operationKey,
			inferredContext: context,
			nightArea,
			stops: [{
				venueId: stop.venueId,
				venueName: stop.venueName,
				position: 0,
				estimatedPintPricePence: stop.price.pence,
				priceEvidence: stop.price,
				accessEvidence: stop.access,
				constraintFlags: stop.constraintFlags,
				operationalEvidence: {
					openingAtVisit: stop.opening.state,
					openingSource: stop.opening.source,
					visitWindow: null,
					transportBasis: "compact-straight-line",
				},
				provenance: [
					{ kind: "venue_dataset", label: `PUBMAXX venue record for ${stop.venueName}` },
					{ kind: "night_area_review", label: `${area.name} route review`, asOf: area.lastReviewedAt },
				],
				alternatives: [],
			}],
		}, { status: 200 }) };
	}
	return { route: {
		chosen: selection.chosen,
		groundedStops: selection.selection.stops,
		groundedAlternatives: selection.selection.alternatives,
		groundedTiming: selection.selection.timing,
		constraintReport: selection.selection.constraintReport,
		accessibilityEnforced: selection.accessibilityEnforced,
		anchorContext: { anchorVenueId, anchorSource: anchor.source },
	} };
}

type PlanGenerationCandidate = ScoredPlanCandidate & {
	distance: number;
	tonightEvents: WhatsOnRow[];
	reasons: string[];
};

type PlanGenerationPreparation = {
	requestNow: number;
	operationKey: string;
	query: string;
	intake: ParsedPlanGenerationIntake | null;
	context: NightContext;
	reconciled: ReturnType<typeof reconcilePlanContext>;
	cityId: CityId;
	area: NightArea;
	routeReady: boolean;
	coverage: ReturnType<typeof publicNightAreaCoverage>;
	planningWeather: ReturnType<typeof planTemporalEvidence>["weather"];
	reviewedSignalClaims: ReturnType<typeof planTemporalEvidence>["signalClaims"];
	naLensPrices: ReturnType<typeof trustedNoAlcoholLensPrices>;
	candidates: PlanGenerationCandidate[];
	anchor: PlanGenerationAnchor | null;
};

export async function preparePlanGeneration(
	request: Request,
): Promise<{ response: Response } | { prepared: PlanGenerationPreparation }> {
	const requestNow = Date.now();
	const parsedRequest = await parsePlanGenerationRequest(request, new Date(requestNow));
	if (!parsedRequest.ok) {
		return { response: publicApiError(parsedRequest.message, parsedRequest.code, parsedRequest.status) };
	}
	const { query, context: contextPatch, intake } = parsedRequest.value;
	const signingUnavailable = planSigningPreflightResponse();
	if (signingUnavailable) return { response: signingUnavailable };
	const operationKey = parsedRequest.value.operationKey ?? `create-${randomUUID()}`;
	const limiterKey = `plan-generate:${hashIp(clientIp(request))}`;
	if (await isLimited(limiterKey, limiterKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
		return { response: publicApiError("Too many requests.", "RATE_LIMITED", 429, { retryable: true }) };
	}
	if (intake?.unsupportedPatch) {
		return { response: publicApiError(
			"We cannot plan an exact route for this unmapped patch yet.",
			"NIGHT_PATCH_UNSUPPORTED",
			422,
			{ details: { patchId: intake.unsupportedPatch } },
		) };
	}
	if (!query && !contextPatch && !intake?.exactNightArea) {
		return { response: publicApiError(
			"Describe the outing or add its time, group and area.",
			"NIGHT_CONTEXT_REQUIRED",
			400,
		) };
	}
	const reconciled = reconcilePlanContext(query, contextPatch, intake, new Date(requestNow));
	const context = reconciled.context;
	if (!context.nightArea) {
		return { response: publicApiError("Choose an area.", "NIGHT_AREA_REQUIRED", 422) };
	}
	const cityId = parsedRequest.value.cityId ? parseCityId(parsedRequest.value.cityId) : DEFAULT_CITY_ID;
	if (!cityId) {
		return { response: publicApiError("Choose a listed city.", "CITY_INVALID", 400) };
	}
	const area = getNightArea(context.nightArea);
	if (area.cityId !== cityId) {
		return { response: publicApiError("That area isn't in this city.", "NIGHT_AREA_CITY_MISMATCH", 422) };
	}
	const routeReady = isNightAreaRouteReady(area, new Date(requestNow));
	const coverage = publicNightAreaCoverage(area);
	const temporalEvidence = planTemporalEvidence({
		weatherSnapshot,
		nightSignalSnapshot,
		whatsOnRows: await loadPlanGenerationBaselineWhatsOn(requestNow),
		nightArea: area.slug,
		requestNow,
		routeWindow: intake?.routeWindow,
	});
	const { weather: planningWeather, whatsOn: tonightRows, signalClaims: reviewedSignalClaims } = temporalEvidence;
	if (claimsForEntity(reviewedSignalClaims, "night_area", area.slug)
		.some((claim) => canAffectRoute(claim) && claim.routeEffect === "avoid")) {
		return { response: publicApiError(
			"Something's up in this area tonight, so we can't plan a crawl through it. Pick another area.",
			"NIGHT_AREA_CONSTRAINT_BLOCKED",
			422,
			{ details: { nightArea: area.slug } },
		) };
	}
	const tonightByVenue = new Map<string, WhatsOnRow[]>();
	for (const row of tonightRows) {
		if (!row.venueId) continue;
		const current = tonightByVenue.get(row.venueId) ?? [];
		current.push(row);
		tonightByVenue.set(row.venueId, current);
	}
	const noAlcoholPriceRows = await readCommunityPriceCategoryIndex(
		NO_ALCOHOL_DRINK_CATEGORIES,
		requestNow,
	);
	const noAlcoholRowsByVenue = new Map<string, CommunityPrice[]>();
	for (const row of noAlcoholPriceRows.prices) {
		const current = noAlcoholRowsByVenue.get(row.venueId) ?? [];
		current.push(row);
		noAlcoholRowsByVenue.set(row.venueId, current);
	}
	const naLensPrices = trustedNoAlcoholLensPrices(noAlcoholRowsByVenue, requestNow);
	const venues = await loadConciergeVenues(cityId);
	const wetherspoonsMatchedIds = context.wetherspoonsPreferred
		? await matchedWetherspoonsVenueIds(venues)
		: undefined;
	const candidates = venues
		.map((venue) => {
			const distance = distanceKm(area.centre, venue);
			const tonightEvents = tonightByVenue.get(venue.id) ?? [];
			const signalClaims = claimsForEntity(reviewedSignalClaims, "venue", venue.id);
			const scored = scoreVenueForPlan(
				venue,
				context,
				distance,
				tonightEvents,
				signalClaims,
				planningWeather,
				naLensPrices,
				wetherspoonsMatchedIds,
			);
			return { venue, distance, tonightEvents, signalClaims, ...scored };
		})
		.filter(({ distance, venue, signalClaims }) =>
			distance <= area.radiusKm
			&& venue.promoted !== true
			&& !signalClaims.some((claim) => canAffectRoute(claim) && claim.routeEffect === "avoid"))
		.sort((a, b) => b.score - a.score);
	return { prepared: {
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
		anchor: parsedRequest.value.anchor,
	} };
}
