import type { ConciergeVenue } from "@/lib/concierge/rank";
import { canAffectRoute, type NightSignalClaim } from "@/lib/nightSignalClaims";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { NightContext } from "@/lib/nightPlanning";
import type { PlanningWeather } from "@/lib/weatherSnapshots";
import type { WhatsOnRow } from "@/lib/whatsOn";

type ScoreAccumulator = { score: number; reasons: string[] };

function priceAndZeroProof(
  venue: ConciergeVenue,
  context: NightContext,
  naLensPrices: ReadonlyMap<string, MapLensPrice> | undefined,
): ScoreAccumulator {
  const reasons: string[] = [];
  const price = venue.cheapestPrice;
  let score = 0;
  if (context.budget === "value") {
    score += price === null ? 0 : Math.max(0, 7 - price);
    if (price !== null) reasons.push(`pints from £${price.toFixed(2)}`);
  } else if (context.budget === "treat" && (venue.amenities.cocktails || venue.hasStory)) {
    score += 1.5;
    reasons.push("fits a treat-night brief");
  }
  if (context.zeroProof) {
    // A corroborated alcohol-free price is the same trust seam as pint pricing
    // (trustedNoAlcoholLensPrices), so it earns the strong signal. The venue
    // dataset amenity is a name-match guess, so it earns a weaker signal and
    // only when no corroborated price exists. A venue with neither stays
    // neutral - it never scores below a venue this style has no evidence on.
    const naPrice = naLensPrices?.get(venue.id);
    if (naPrice !== undefined) {
      score += 4;
      reasons.push(`corroborated alcohol-free price from £${naPrice.priceGbp.toFixed(2)}`);
    } else if (venue.amenities.nonAlcoholic === true) {
      score += 1.5;
      reasons.push("confirmed alcohol-free option in the Venue Dataset");
    }
  }
  return { score, reasons };
}

/** Soft boost for directory-matched Spoons; never invents a price. */
export const WETHERSPOONS_DIRECTORY_PREFER_BOOST = 4;

function wetherspoonsDirectoryPrefer(
  venue: ConciergeVenue,
  context: NightContext,
  matchedIds: ReadonlySet<string> | undefined,
): ScoreAccumulator {
  if (!context.wetherspoonsPreferred || !matchedIds?.has(venue.id)) {
    return { score: 0, reasons: [] };
  }
  return {
    score: WETHERSPOONS_DIRECTORY_PREFER_BOOST,
    reasons: ["matched the first-party J D Wetherspoon directory"],
  };
}

function occasionFit(venue: ConciergeVenue, context: NightContext): ScoreAccumulator {
  const reasons: string[] = [];
  let score = 0;
  if ((context.daypart === "late_night" || context.daypart === "get_home") && venue.amenities.food) {
    score += 1.5;
    reasons.push("food-aware late stop");
  }
  if (context.partyType === "work" && venue.amenities.food) {
    score += 1;
    reasons.push("works for a group with food backup");
  }
  if (context.foodNeeds.length > 0 && venue.amenities.food) {
    score += 2;
    reasons.push("matched the food need at venue level");
  }
  return { score, reasons };
}

function atmosphereFit(
  venue: ConciergeVenue,
  context: NightContext,
  weather: PlanningWeather | null,
): ScoreAccumulator {
  const reasons: string[] = [];
  let score = 0;
  if (context.atmosphere.includes("historic") && venue.hasStory) {
    score += 2;
    reasons.push("historic character");
  }
  if (context.atmosphere.includes("garden") && venue.amenities.beerGarden) {
    if (weather?.kind === "warm-dry") {
      score += 2;
      reasons.push(`beer garden on record; cached ${weather.source.publisher} weather supports it`);
    } else if (weather?.kind === "rainy" || weather?.kind === "cold") {
      score -= 1.5;
      reasons.push(`beer garden on record; cached weather is ${weather.kind}`);
    } else {
      score += 0.75;
      reasons.push("beer garden on record; weather details are missing or unclear");
    }
  }
  if (context.atmosphere.includes("sports") && venue.amenities.liveSports) {
    score += 1.5;
    reasons.push("sports-friendly");
  }
  if ((context.atmosphere.includes("music") || context.atmosphere.includes("lively")) && venue.amenities.liveMusic) {
    score += 1.25;
    reasons.push("livelier atmosphere signal");
  }
  if (context.atmosphere.includes("quiet") && (venue.amenities.liveMusic || venue.amenities.liveSports)) score -= 2;
  return { score, reasons };
}

function liveSignals(
  context: NightContext,
  tonightEvents: readonly WhatsOnRow[],
  signalClaims: readonly NightSignalClaim[],
): ScoreAccumulator {
  const reasons: string[] = [];
  let score = 0;
  for (const event of tonightEvents) {
    const matchesBrief = (event.kind === "music" && (context.atmosphere.includes("music") || context.atmosphere.includes("lively")))
      || (event.kind === "sport" && context.atmosphere.includes("sports"));
    score += matchesBrief ? 2 : 0.5;
    reasons.push(`Tonight: ${event.title} (${event.confidence})`);
  }
  for (const signal of signalClaims) {
    if (canAffectRoute(signal)) score += signal.routeEffect === "boost" ? 2 : -3;
    reasons.push(`Reviewed signal: ${signal.claim}`);
  }
  return { score, reasons };
}

export function scoreVenueForPlan(
  venue: ConciergeVenue,
  context: NightContext,
  distance: number,
  tonightEvents: readonly WhatsOnRow[],
  signalClaims: readonly NightSignalClaim[],
  weather: PlanningWeather | null,
  naLensPrices?: ReadonlyMap<string, MapLensPrice>,
  wetherspoonsMatchedIds?: ReadonlySet<string>,
): { score: number; reasons: string[] } {
  const pieces = [
    priceAndZeroProof(venue, context, naLensPrices),
    wetherspoonsDirectoryPrefer(venue, context, wetherspoonsMatchedIds),
    occasionFit(venue, context),
    atmosphereFit(venue, context, weather),
    liveSignals(context, tonightEvents, signalClaims),
  ];
  return {
    score: pieces.reduce((sum, piece) => sum + piece.score, 0)
      - distance * (context.daypart === "late_night" || context.daypart === "get_home" ? 3 : 2),
    reasons: pieces.flatMap((piece) => piece.reasons),
  };
}

export function missingPlanContextEvidence(context: NightContext): string[] {
  const missing = new Set<string>();
  if (context.accessibility.length > 0) missing.add("venue_accessibility");
  if (context.transportConstraints.length > 0) missing.add("per_venue_transport");
  if (context.zeroProof) missing.add("zero_proof_options");
  if (context.foodNeeds.some((need) => ["kebab", "halal", "vegan", "vegetarian"].includes(need))) {
    missing.add("food_terminal_specificity");
  }
  return [...missing];
}

export function planGenerationEvidenceGaps(input: {
  context: NightContext;
  accessibilityEnforced: boolean;
  hasDatedWindow: boolean;
  allOpeningListed: boolean;
  hasCompletePriceEvidence: boolean;
  allZeroProofConfirmed: boolean;
  hasTonightEvidence: boolean;
  hasWeatherEvidence: boolean;
}): { contextEvidenceGaps: string[]; operationalEvidenceGaps: string[] } {
  const contextEvidenceGaps = missingPlanContextEvidence(input.context);
  if (input.accessibilityEnforced) {
    const index = contextEvidenceGaps.indexOf("venue_accessibility");
    if (index >= 0) contextEvidenceGaps.splice(index, 1);
  }
  if ((input.context.budgetLimitPence !== null || input.context.budget === "value") && !input.hasCompletePriceEvidence) {
    contextEvidenceGaps.push("price_evidence");
  }
  if (input.context.zeroProof && input.allZeroProofConfirmed) {
    const index = contextEvidenceGaps.indexOf("zero_proof_options");
    if (index >= 0) contextEvidenceGaps.splice(index, 1);
  }
  const operationalEvidenceGaps = input.hasDatedWindow && input.allOpeningListed
    ? []
    : ["current_opening_hours"];
  if ((input.context.groupSize ?? 1) > 1) operationalEvidenceGaps.push("get_in_estimates");
  if (input.context.atmosphere.some((value) => ["lively", "music", "sports"].includes(value))
    && !input.hasTonightEvidence) operationalEvidenceGaps.push("tonight_event_evidence");
  if (input.context.atmosphere.includes("garden") && !input.hasWeatherEvidence) operationalEvidenceGaps.push("live_weather");
  return { contextEvidenceGaps, operationalEvidenceGaps };
}

export function planEvidenceWarning(code: string): string {
  return `Check ${code.replaceAll("_", " ")} before relying on this route.`;
}
