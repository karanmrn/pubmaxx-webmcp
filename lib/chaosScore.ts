// Chaos Score — a pure, tongue-in-cheek 0-100 rating for a crawl/night, built
// from real signals already on a crawl (issue #30, PRD "The Spill" § The
// Lock-In). It is deliberately playful but honest: the copy stays dry/witty
// (no emoji), the math is boring and deterministic, and nobody who doesn't
// open this card ever sees it (PRD: "a Boomer never sees it").
//
// Inputs are plain, already-public numbers/strings a crawl story or feed card
// already has — this module does not reach into pintDrops/crawlStoryStore
// itself, so it stays a pure function with zero I/O and is trivially unit
// testable.

import { clamp } from "@/lib/mathClamp";

// A frozen band table doubles as the rubric and the "oneLiner" copy. Ordered
// low → high; `computeChaosScore` picks the last band whose `min` the score
// clears. Exported so a UI can render the same rubric as a legend if wanted.
export type ChaosGrade = "Quiet" | "Steady" | "Lively" | "Saga" | "Legendary";

export type ChaosBand = {
  min: number; // inclusive lower bound
  grade: ChaosGrade;
  oneLiner: string;
};

export const CHAOS_BANDS: readonly ChaosBand[] = [
  { min: 0, grade: "Quiet", oneLiner: "A quiet one." },
  { min: 30, grade: "Steady", oneLiner: "A perfectly reasonable night." },
  { min: 55, grade: "Lively", oneLiner: "Started sensible, didn't stay that way." },
  { min: 75, grade: "Saga", oneLiner: "You took the scenic route." },
  { min: 90, grade: "Legendary", oneLiner: "One for the group chat." },
] as const;

export type ChaosScoreInputs = {
  // Number of stops on the crawl. More stops = more chaos, with diminishing
  // returns (capped contribution).
  stopCount: number;
  // Prices paid at each stop, in GBP. Spread (max - min) is a chaos signal —
  // a night that goes from a £4 Wetherspoons pint to a £9 cocktail has main
  // character energy. Missing/invalid prices are ignored, not zeroed.
  prices?: Array<number | null | undefined>;
  // Vibe tags drawn from the night's Pint Drops (lib/pintDrops VIBE_TAGS is
  // the source of truth; this module just reads whatever strings it's
  // handed and scores the ones it recognises as "chaos-flavoured").
  vibeTags?: string[];
  // Hour of day (0-23, local/venue time) the last drop of the night landed.
  // Late nights push the score up; an early last-orders pulls it down.
  lastDropHour?: number | null;
  // Distinct boroughs visited. Hopping boroughs takes effort/momentum.
  boroughHops?: number;
};

export type ChaosScoreResult = {
  score: number; // 0-100, integer
  grade: ChaosGrade;
  oneLiner: string;
};

const CHAOS_VIBE_TAGS: ReadonlySet<string> = new Set(["chaotic", "last train", "date night"]);

// Stops: 0 stops contributes nothing; each stop is worth 6 points, capped at
// 30 (i.e. a 5-stop crawl already maxes this component out).
function stopsScore(stopCount: number): number {
  const n = Number.isFinite(stopCount) ? Math.max(0, Math.trunc(stopCount)) : 0;
  return clamp(n * 6, 0, 30);
}

// Price spread: £1 of spread = 2.5 points, capped at 20 (an £8 spread maxes
// it). A crawl with one or zero priced stops has no spread to speak of.
function priceSpreadScore(prices: Array<number | null | undefined> | undefined): number {
  const valid = (prices ?? []).filter(
    (p): p is number => typeof p === "number" && Number.isFinite(p) && p >= 0,
  );
  if (valid.length < 2) return 0;
  const spread = Math.max(...valid) - Math.min(...valid);
  return clamp(spread * 2.5, 0, 20);
}

// Vibe tags: each recognised "chaos-flavoured" tag is worth 7 points, capped
// at 20 (roughly 3 tags maxes it — the drop composer caps a drop at 4 tags
// total anyway).
function vibeTagScore(vibeTags: string[] | undefined): number {
  const hits = (vibeTags ?? []).filter((tag) => CHAOS_VIBE_TAGS.has(tag)).length;
  return clamp(hits * 7, 0, 20);
}

// Lateness: scored on a 0-16 curve keyed to the hour of the last drop.
// Midnight-4am is maximum chaos; a last drop before 8pm barely registers.
function latenessScore(lastDropHour: number | null | undefined): number {
  if (lastDropHour == null || !Number.isFinite(lastDropHour)) return 0;
  const hour = ((Math.trunc(lastDropHour) % 24) + 24) % 24; // normalise to 0-23
  // Distance-from-8pm-ish curve: hours 0-4 (post-midnight) score highest,
  // tapering down through the evening and bottoming out mid-afternoon.
  if (hour >= 0 && hour < 5) return 16; // small hours
  if (hour >= 22) return 13; // late night
  if (hour >= 20) return 9; // prime time
  if (hour >= 17) return 4; // early evening
  return 0; // afternoon or earlier
}

// Borough hops: each hop beyond the first borough is worth 7 points, capped
// at 14 (three-borough-plus nights are rare and already deep in "Saga").
function boroughHopScore(boroughHops: number | undefined): number {
  const n = Number.isFinite(boroughHops) ? Math.max(0, Math.trunc(boroughHops ?? 0)) : 0;
  return clamp(n * 7, 0, 14);
}

function bandFor(score: number): ChaosBand {
  let current = CHAOS_BANDS[0];
  for (const band of CHAOS_BANDS) {
    if (score >= band.min) current = band;
  }
  return current;
}

/**
 * Compute a deterministic 0-100 Chaos Score for a crawl/night from real,
 * already-public signals. Pure — same inputs always produce the same output,
 * no randomness, no clock reads, no I/O. Any malformed/missing input is
 * treated as "no signal" (contributes 0) rather than thrown.
 */
export function computeChaosScore(inputs: ChaosScoreInputs): ChaosScoreResult {
  const raw =
    stopsScore(inputs.stopCount) +
    priceSpreadScore(inputs.prices) +
    vibeTagScore(inputs.vibeTags) +
    latenessScore(inputs.lastDropHour) +
    boroughHopScore(inputs.boroughHops);

  const score = Math.round(clamp(raw, 0, 100));
  const band = bandFor(score);
  return { score, grade: band.grade, oneLiner: band.oneLiner };
}
