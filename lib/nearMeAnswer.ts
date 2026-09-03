import { haversineKm } from "@/lib/haversine";
import { WALK_KMH } from "@/lib/routeLegs";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";

// Pure ranking core for the "Near me now" instant answer (Cycle 3, Lane 1).
//
// The persona: a 9-to-5 Londoner leaving the office at 6pm who wants the
// cheapest good pint NEAR THEM, tonight. This module turns "my location + the
// slim priced index" into 3–5 answer cards — no map, no maplibre, no network
// beyond the ~570 KB slim index the map already caches. Every function here is
// pure and deterministic so it unit-tests against tiny fixtures.
//
// Honesty contract (PRD §3): "quality" is NOT a made-up score. A pub qualifies
// iff it carries a real price observation (cheapestPrice is a finite number).
// The slim index has no per-venue "closed" flag, so a priced pub is the whole
// of the quality bar here; when a closed flag lands, extend `qualifies`.

// Unhurried city walking pace, derived from the same shared pace routeLegs
// uses everywhere else, so a change to the pace can't drift between surfaces.
export const WALK_METRES_PER_MIN = (WALK_KMH * 1000) / 60;

// ~12 min walk ≈ 960 m. The "walkable right now" ring the persona actually
// cares about. Kept as 1 km so the arithmetic reads cleanly and a card at the
// edge still quotes ~12–13 min.
export const WALKABLE_RADIUS_KM = 1;

// When fewer than MIN_ANSWERS priced pubs sit inside the walkable ring we widen
// honestly (labelled "a bit further") rather than showing a hollow one-card
// answer or a dead end.
export const WIDENED_RADIUS_KM = 2.5;

export const MIN_ANSWERS = 3;
export const MAX_ANSWERS = 5;

/**
 * The one sentence the near-me answer names itself with.
 *
 * It moves with the answer: a widened ring is not "near you", and a picked
 * borough or patch is not near the reader at all. It lives here, pure, because
 * a HOST that frames this answer (the map's near-me sheet, whose chrome prints
 * the sheet's only heading) must be able to check that its own title never
 * restates this line. Two stacked headings saying the same thing was the
 * defect; a chrome title that contradicts this line would be worse.
 */
export function nearMeAnswerHeadline(input: {
  scope: NearMeScope;
  borough?: string | null;
  patchLabel?: string | null;
}): string {
  if (input.borough) return `Cheapest listed in ${input.borough}`;
  if (input.patchLabel) return `Cheapest listed around ${input.patchLabel}`;
  return input.scope === "widened"
    ? "Nearest priced pubs"
    : "Cheapest listed near you";
}

/** Whole walking minutes for a distance, floored at 1 so nothing reads "0 min". */
export function walkMinutesFromKm(km: number): number {
  if (!Number.isFinite(km) || km <= 0) return 1;
  return Math.max(1, Math.round((km * 1000) / WALK_METRES_PER_MIN));
}

/** Under this, a rounded kilometre figure stops being a measurement. */
export const RIGHT_HERE_MAX_KM = 0.1;

/**
 * The distance a row prints, or null when there is no fix.
 *
 * A tenth-of-a-kilometre figure runs out of resolution before the walk does:
 * anything under 100 m rounds to "0.0 km", which reads as a measured zero
 * rather than as "you are standing at it" (design judgement 2026-08-01,
 * finding 2.13). Inside that ring the row says so in words instead.
 */
export function formatNearDistance(km: number | undefined | null): string | null {
  if (typeof km !== "number" || !Number.isFinite(km) || km < 0) return null;
  if (km < RIGHT_HERE_MAX_KM) return "right here";
  return `${km.toFixed(1)} km`;
}

// The minimal venue shape the ranker needs — SlimVenue satisfies it directly,
// so the answer surface feeds the slim index straight in without a mapping pass.
export type PricedPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  borough: string;
  kind?: VenueKind;
};

export type NearMeCard = {
  id: string;
  name: string;
  borough: string;
  /** Always a finite number — a card only exists for a priced pub. */
  cheapestPrice: number;
  /** Great-circle km from the user. Absent in borough-picker mode (no fix). */
  distanceKm?: number;
  /** Walking minutes derived from distanceKm. Absent in borough-picker mode. */
  walkMinutes?: number;
};

export type NearMeScope = "walkable" | "widened" | "none";

export type NearMeAnswer = {
  cards: NearMeCard[];
  /**
   * "walkable"  — every card is inside the ~12 min ring (cheapest first).
   * "widened"   — too few priced pubs nearby; these are the nearest priced,
   *               "a bit further". The surface must say so.
   * "none"      — no priced pub anywhere in range; fall back to the borough
   *               picker rather than pretend.
   */
  scope: NearMeScope;
  /** The ring actually answered from (km) — furthest card for widened scope. */
  radiusKm: number;
  /** How many priced pubs sit inside the walkable ring (for honest copy). */
  qualifyingWithinWalk: number;
};

export type RankNearMeOptions = {
  minAnswers?: number;
  maxAnswers?: number;
  walkableRadiusKm?: number;
  widenedRadiusKm?: number;
};

function qualifies(point: PricedPoint): boolean {
  return (
    isPubVenueKind(point.kind) &&
    typeof point.cheapestPrice === "number" &&
    Number.isFinite(point.cheapestPrice) &&
    point.cheapestPrice > 0 &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng)
  );
}

type Measured = { point: PricedPoint; km: number };

function toCard(entry: Measured): NearMeCard {
  return {
    id: entry.point.id,
    name: entry.point.name,
    borough: entry.point.borough,
    cheapestPrice: entry.point.cheapestPrice as number,
    distanceKm: entry.km,
    walkMinutes: walkMinutesFromKm(entry.km),
  };
}

// Cheapest first, distance as the tie-break — the persona asked for "cheapest",
// and among equally cheap pubs the closer one wins.
function byPriceThenDistance(a: NearMeCard, b: NearMeCard): number {
  if (a.cheapestPrice !== b.cheapestPrice) return a.cheapestPrice - b.cheapestPrice;
  return (a.distanceKm ?? 0) - (b.distanceKm ?? 0);
}

/**
 * The instant answer: the cheapest priced pubs within a ~12 min walk, cheapest
 * first. If too few qualify nearby, widen once to the nearest priced pubs and
 * flag it. Pure and deterministic; safe on empty input.
 */
export function rankNearMe(
  lat: number,
  lng: number,
  venues: PricedPoint[],
  options: RankNearMeOptions = {},
): NearMeAnswer {
  const min = Math.max(1, Math.floor(options.minAnswers ?? MIN_ANSWERS));
  const max = Math.max(min, Math.floor(options.maxAnswers ?? MAX_ANSWERS));
  const walkRadius = Math.max(0.1, options.walkableRadiusKm ?? WALKABLE_RADIUS_KM);
  const wideRadius = Math.max(walkRadius, options.widenedRadiusKm ?? WIDENED_RADIUS_KM);

  const measured: Measured[] = venues
    .filter(qualifies)
    .map((point) => ({ point, km: haversineKm([lng, lat], [point.lng, point.lat]) }))
    .sort((a, b) => a.km - b.km);

  const walkable = measured.filter((entry) => entry.km <= walkRadius);

  // Enough cheap pints within the walk — the happy path.
  if (walkable.length >= min) {
    const cards = walkable.map(toCard).sort(byPriceThenDistance).slice(0, max);
    return {
      cards,
      scope: "walkable",
      radiusKm: walkRadius,
      qualifyingWithinWalk: walkable.length,
    };
  }

  // Too thin nearby. Widen to the nearest priced pubs (up to max), cheapest
  // first among them, and let the surface label it honestly.
  const widened = measured.filter((entry) => entry.km <= wideRadius);
  const pool = widened.length > 0 ? widened : measured;
  if (pool.length === 0) {
    return { cards: [], scope: "none", radiusKm: wideRadius, qualifyingWithinWalk: 0 };
  }
  const nearest = pool.slice(0, max);
  const cards = nearest.map(toCard).sort(byPriceThenDistance);
  const radiusKm = cards.reduce((furthest, card) => Math.max(furthest, card.distanceKm ?? 0), 0);
  return {
    cards,
    scope: "widened",
    radiusKm: radiusKm > 0 ? radiusKm : wideRadius,
    qualifyingWithinWalk: walkable.length,
  };
}

/**
 * Borough-picker fallback (denied/unavailable geolocation): the cheapest priced
 * pubs in a chosen borough, cheapest first. No distance — there is no user fix —
 * so cards carry price only. Borough match is case-insensitive on the slim
 * `borough` field. Pure and deterministic.
 */
export function rankBoroughCheapest(
  venues: PricedPoint[],
  borough: string,
  max: number = MAX_ANSWERS,
): NearMeCard[] {
  const target = borough.trim().toLowerCase();
  if (!target) return [];
  const take = Math.max(1, Math.floor(max));
  return venues
    .filter((point) => qualifies(point) && point.borough.trim().toLowerCase() === target)
    .map(toCheapestCard)
    .sort((a, b) => a.cheapestPrice - b.cheapestPrice)
    .slice(0, take);
}

export function rankCityCheapest(
  venues: PricedPoint[],
  max: number = MAX_ANSWERS,
): NearMeCard[] {
  const take = Math.max(1, Math.floor(max));
  return venues
    .filter(qualifies)
    .map(toCheapestCard)
    .sort((a, b) => a.cheapestPrice - b.cheapestPrice)
    .slice(0, take);
}

function toCheapestCard(point: PricedPoint): NearMeCard {
  return {
    id: point.id,
    name: point.name,
    borough: point.borough,
    cheapestPrice: point.cheapestPrice as number,
  };
}

/** Boroughs (from the slim index) that actually have at least one priced pub,
 * alphabetical — so the fallback picker never offers an empty borough. */
export function boroughsWithPrices(venues: PricedPoint[]): string[] {
  const seen = new Set<string>();
  for (const point of venues) {
    if (qualifies(point) && point.borough.trim()) seen.add(point.borough.trim());
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
