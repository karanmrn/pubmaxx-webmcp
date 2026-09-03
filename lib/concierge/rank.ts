import type { WhatsOnKind } from "@/lib/whatsOn";
import { WHATS_ON_KIND_META } from "@/lib/whatsOnBadges";

export const CONCIERGE_MOODS = [
  "balanced",
  "quiet",
  "lively",
  "cosy",
  "garden",
  "riverside",
  "sports",
  "date",
  "food",
  "cocktails",
  "heritage",
] as const;

export type ConciergeMood = (typeof CONCIERGE_MOODS)[number];

export type ConciergeIntent = {
  mood: ConciergeMood[];
  groupSize: number;
  area?: string;
  maxPintPrice?: number;
};

export type ConciergeContext = {
  weather?: "rainy" | "cold" | "warm-dry" | "mild";
  dayType?: "weekday" | "weekend";
  timeOfDay?: "afternoon" | "evening" | "late";
};

export type ConciergeVenue = {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  amenities: {
    beerGarden: boolean;
    cocktails: boolean;
    food: boolean;
    liveSports: boolean;
    liveMusic: boolean;
    nonAlcoholic?: boolean;
  };
  nearWater: boolean;
  hasStory: boolean;
  canonical: boolean;
  /** Server-owned searchable venue text, used only to resolve an area phrase. */
  searchText?: string;
  /** Paid placements are never eligible for concierge results. */
  promoted?: boolean;
};

export type RankedConciergeVenue = {
  venue: ConciergeVenue;
  score: number;
  reasons: string[];
};

type RankingOptions = {
  limit?: number;
  context?: ConciergeContext;
  /**
   * C3 — soft, grounded planner weighting: a venue with a REAL tonight
   * What's-On row whose kind matches the requested occasion mood gets a
   * gentle score bump (never a hard filter, never invented — a venue absent
   * from the map, or with no matching kind, just scores as it always did).
   * Optional and purely additive: omitted entirely (every caller before C3),
   * ranking is byte-for-byte unchanged.
   */
  tonightEventKindsByVenue?: ReadonlyMap<string, ReadonlySet<WhatsOnKind>>;
};

// Which tonight What's-On kind a mood is grounded evidence for, when present.
// Deliberately narrow — only moods with an unambiguous kind mapping get a
// bonus, so this never becomes a second, opaque scoring system layered on
// amenityScore. Moods with no honest mapping (garden, cocktails, heritage,
// …) are left alone.
const MOOD_TONIGHT_KIND: Partial<Record<ConciergeMood, WhatsOnKind>> = {
  sports: "sport",
  lively: "music",
  food: "deal",
};

function normalise(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

function amenityScore(venue: ConciergeVenue, mood: ConciergeMood): number {
  const a = venue.amenities;
  switch (mood) {
    case "quiet":
      return Number(a.food) * 2 + Number(venue.hasStory) * 2 - Number(a.liveSports) * 5 - Number(a.liveMusic) * 5 - Number(a.cocktails) * 2;
    case "lively":
      return Number(a.liveMusic) * 8 + Number(a.liveSports) * 4 + Number(a.cocktails) * 3;
    case "cosy":
      return Number(venue.hasStory) * 6 + Number(a.food) * 3 - Number(a.beerGarden) * 1;
    case "garden":
      return Number(a.beerGarden) * 12;
    case "riverside":
      return Number(venue.nearWater) * 12 + Number(a.beerGarden) * 2;
    case "sports":
      return Number(a.liveSports) * 12;
    case "date":
      return Number(a.cocktails) * 5 + Number(a.food) * 4 + Number(venue.nearWater) * 3 + Number(venue.hasStory) * 2;
    case "food":
      return Number(a.food) * 12;
    case "cocktails":
      return Number(a.cocktails) * 12;
    case "heritage":
      return Number(venue.hasStory) * 12;
    case "balanced":
      return Number(a.food) * 2 + Number(a.beerGarden) * 2 + Number(venue.hasStory) * 2;
  }
}

function scoreOne(
  venue: ConciergeVenue,
  intent: ConciergeIntent,
  context: ConciergeContext,
  tonightEventKindsByVenue?: ReadonlyMap<string, ReadonlySet<WhatsOnKind>>,
): RankedConciergeVenue {
  let score = venue.canonical ? 1 : 0;
  const reasons: string[] = [];

  const requestedArea = normalise(intent.area ?? "");
  const venueArea = normalise(`${venue.area} ${venue.searchText ?? ""}`);
  const cityWideAreaAsk = requestedArea === "london";
  // The area reason joins LAST: a card already prints its area as the place
  // line, so a leading "In Camden" note under a "Camden" place printed the
  // area twice, and the budget or mood reason it displaced says more.
  let areaReason: string | null = null;
  if (requestedArea && !cityWideAreaAsk && venueArea.includes(requestedArea)) {
    // Area is the strongest coordination constraint: a perfect mood match in
    // the wrong part of town is rarely useful for a same-evening plan.
    score += 30;
    areaReason = `In ${intent.area!.trim()}`;
  }

  if (intent.maxPintPrice !== undefined) {
    if (venue.cheapestPrice === null) {
      score -= 2;
    } else if (venue.cheapestPrice <= intent.maxPintPrice) {
      score += 10 + Math.min(3, intent.maxPintPrice - venue.cheapestPrice);
      reasons.push(`£${venue.cheapestPrice.toFixed(2)} is within budget`);
    } else {
      score -= 3 * (venue.cheapestPrice - intent.maxPintPrice);
    }
  } else if (venue.cheapestPrice !== null) {
    score += Math.max(0, 8 - venue.cheapestPrice);
  }

  for (const mood of intent.mood.length ? intent.mood : ["balanced" as const]) {
    const contribution = amenityScore(venue, mood);
    score += contribution;
    if (contribution > 0) {
      const label: Partial<Record<ConciergeMood, string>> = {
        quiet: "A calmer fit",
        lively: "Lively atmosphere",
        cosy: "Cosy character",
        garden: "Beer garden",
        riverside: "Near the water",
        sports: "Shows live sport",
        date: "Good date-night fit",
        food: "Food available",
        cocktails: "Cocktails available",
        heritage: "Venue heritage on record",
      };
      if (label[mood]) reasons.push(label[mood]!);
    }
  }

  if (intent.groupSize >= 6) {
    score += Number(venue.amenities.food) * 2 + Number(venue.amenities.beerGarden) * 2;
  }

  if (context.weather === "warm-dry" && venue.amenities.beerGarden) {
    score += 5;
    reasons.push("Garden weather");
  }
  if ((context.weather === "rainy" || context.weather === "cold") && (venue.amenities.food || venue.hasStory)) {
    score += 4;
    reasons.push("A good fit for the weather");
  }
  if (context.dayType === "weekend" && context.timeOfDay === "late") {
    score += Number(venue.amenities.liveMusic) * 3 + Number(venue.amenities.cocktails) * 2;
  }

  // C3 tonight-event soft weight: a real matching-kind row tonight is
  // grounded evidence beyond the static amenity flag, so it earns its own
  // small, transparent bump — one bonus per venue even if several requested
  // moods would each match (no stacking).
  const tonightKinds = tonightEventKindsByVenue?.get(venue.id);
  if (tonightKinds) {
    for (const mood of intent.mood) {
      const wantedKind = MOOD_TONIGHT_KIND[mood];
      if (wantedKind && tonightKinds.has(wantedKind)) {
        score += 6;
        reasons.push(`${WHATS_ON_KIND_META[wantedKind].badgeLabel} tonight`);
        break;
      }
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  const orderedReasons = areaReason && uniqueReasons.length > 0
    ? [...uniqueReasons.slice(0, 2), areaReason]
    : uniqueReasons.slice(0, 3);
  return { venue, score: Number(score.toFixed(4)), reasons: orderedReasons };
}

/**
 * The venues an asked-for area may answer with, in two tiers.
 *
 * A venue is IN an area first by its own area attribution: the borough the
 * index files it under. The searchable text is only a fallback for a
 * neighbourhood word the borough field cannot answer ("Soho" is Westminster),
 * because that text also carries pub names, addresses and pint names: "Camden
 * Hells" on a Hammersmith tap once put that pub under a Camden ask. So where
 * any venue's own area matches, the loose text match may not widen the answer.
 */
function areaEligibleVenues(
  venues: readonly ConciergeVenue[],
  requestedArea: string,
): ConciergeVenue[] {
  // "London" names the whole pack, not the Square Mile: narrowing it to the
  // City of London, the one borough holding the word, would answer a city ask
  // with the wrong forty pubs.
  if (requestedArea === "london") return [...venues];
  const own = venues.filter((venue) => normalise(venue.area).includes(requestedArea));
  if (own.length > 0) return own;
  return venues.filter((venue) => normalise(`${venue.area} ${venue.searchText ?? ""}`).includes(requestedArea));
}

/** Pure, stable honest ranking. The result never mutates or depends on input order. */
export function rankConciergeVenues(
  venues: readonly ConciergeVenue[],
  intent: ConciergeIntent,
  options: RankingOptions = {},
): RankedConciergeVenue[] {
  const limit = Math.min(10, Math.max(1, Math.trunc(options.limit ?? 3)));
  const organic = venues.filter((venue) => !venue.promoted);
  const requestedArea = normalise(intent.area ?? "");
  const eligible = requestedArea
    ? areaEligibleVenues(organic, requestedArea)
    : organic;
  return eligible
    .map((venue) => scoreOne(venue, intent, options.context ?? {}, options.tonightEventKindsByVenue))
    .sort((left, right) => right.score - left.score || left.venue.id.localeCompare(right.venue.id, "en-GB"))
    .slice(0, limit);
}

export function narrateCrawl(results: readonly RankedConciergeVenue[]): string | undefined {
  if (results.length === 0) return undefined;
  if (results.length === 1) return `Start at ${results[0].venue.name}.`;
  const names = results.map((result) => result.venue.name);
  if (names.length === 2) return `Start at ${names[0]}, then finish at ${names[1]}.`;
  return `Start at ${names[0]}, then head to ${names.slice(1, -1).join(", ")}, and finish at ${names.at(-1)}.`;
}
