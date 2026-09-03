// Ratings math (PRD E3) — the PURE aggregation core for drink AND pub ratings.
// Grounded in docs/research/ (consumer-rating conventions):
//   • 1–5 stars at 0.5 granularity — the scale people already know.
//   • Bayesian aggregation: a small sample is pulled toward a PRIOR so one
//     5-star vote can't top a list. bayesian =
//       (PRIOR_WEIGHT × priorMean + Σ ratings) / (PRIOR_WEIGHT + count)
//     — i.e. PRIOR_WEIGHT phantom votes at the prior mean. The prior mean is
//     the GLOBAL/SITE mean; callers with enough data inject the measured site
//     mean, and DEFAULT_PRIOR_MEAN stands in until one exists (documented on
//     the constant).
//   • A minimum-vote floor: a rating is HIDDEN under MIN_VOTES_TO_SHOW votes
//     (`shown: false`) — an average of 2 votes is noise, not signal.
//   • A recency window for ranked lists when one is applied at read time.
//   • Percentile framing ("beats N% of …") — relative standing communicates
//     more than a raw 4.2.
//   • A rating is DISTINCT from activity: zero votes → average/bayesian are
//     null (honestly blank), never 0 stars.
//
// Duty-of-care: nothing in here counts a PERSON's consumption — inputs are
// per-item vote lists, and every derived surface celebrates the pub/drink,
// never how often anyone drank.
//
// Repo rule: NO Date.now() in pure logic — every time-sensitive function takes
// `now` injected, so tests and callers control the clock.

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const RATING_STEP = 0.5;

export type RatingKind = "drink" | "venue";

export function isRatingKind(value: unknown): value is RatingKind {
  return value === "drink" || value === "venue";
}

/** The closed set of legal star values: 1–5 in half-star steps. */
export const RATING_VALUES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const;
export type RatingValue = (typeof RATING_VALUES)[number];

/** Ratings are hidden (shown: false) under this many votes — a handful of
 *  votes is noise, and showing it would let one enthusiast set a pub's score. */
export const MIN_VOTES_TO_SHOW = 10;

/** The Bayesian prior weight C: the aggregate behaves as if C phantom votes at
 *  the prior mean were already cast. C = 10 matches the vote floor — an item
 *  at the floor is weighted half by its own votes, half by the prior. */
export const PRIOR_WEIGHT = 10;

/** Stand-in for the global/site mean until enough site-wide votes exist to
 *  measure one. 3.5 reflects the well-documented positive skew of consumer
 *  star ratings (people mostly rate things they liked) without flattering:
 *  midpoint 3, nudged up half a star. Callers should inject the MEASURED site
 *  mean via `priorMean` once the corpus supports it. */
export const DEFAULT_PRIOR_MEAN = 3.5;

import { DAY_MS } from "@/lib/dayMs";

/** True for a legal star value: finite number, 1–5, on a 0.5 step. */
export function isRatingValue(value: unknown): value is RatingValue {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= RATING_MIN &&
    value <= RATING_MAX &&
    Number.isInteger(value / RATING_STEP)
  );
}

/** Parse an untrusted value (JSON body, query param) into a RatingValue, or
 *  null. Accepts a numeric string ("4.5") since query params arrive as text. */
export function parseRating(value: unknown): RatingValue | null {
  const num =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return isRatingValue(num) ? num : null;
}

/** One stored vote: the star value plus when it was (re-)cast. */
export type RatingRecord = {
  rating: number;
  /** ISO-8601 timestamp of the vote (a re-rating carries its latest stamp). */
  createdAt: string;
};

export type RatingSummary = {
  /** Plain mean of the counted votes — null when there are none (blank ≠ 0). */
  average: number | null;
  /** Prior-smoothed mean (the ranking key) — null when there are no votes. */
  bayesian: number | null;
  /** How many legal votes were counted (inside the window, when one applies). */
  count: number;
  /** Whether the score should be DISPLAYED: count ≥ minVotes. */
  shown: boolean;
};

export type AggregateOptions = {
  /** The injected clock (Date or epoch ms) — required; no Date.now() here. */
  now: Date | number;
  /** Votes needed before the score is shown. Default MIN_VOTES_TO_SHOW. */
  minVotes?: number;
  /** When set, only votes within the trailing window are counted. */
  recencyWindowDays?: number;
  /** Global/site mean the Bayesian prior pulls toward. */
  priorMean?: number;
  /** Prior weight C (phantom votes at priorMean). */
  priorWeight?: number;
};

function toEpochMs(now: Date | number): number {
  return typeof now === "number" ? now : now.getTime();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Aggregate one item's votes into {average, bayesian, count, shown}.
 * Defensive over stored data: rows with an illegal star value are skipped, and
 * when a recency window applies, rows with an unparseable timestamp are
 * excluded too (they can't prove they're recent).
 */
export function aggregateRatings(
  ratings: RatingRecord[],
  options: AggregateOptions,
): RatingSummary {
  const {
    minVotes = MIN_VOTES_TO_SHOW,
    recencyWindowDays,
    priorMean = DEFAULT_PRIOR_MEAN,
    priorWeight = PRIOR_WEIGHT,
  } = options;
  const nowMs = toEpochMs(options.now);
  const cutoffMs =
    typeof recencyWindowDays === "number"
      ? nowMs - recencyWindowDays * DAY_MS
      : null;

  let count = 0;
  let sum = 0;
  for (const record of ratings) {
    if (!isRatingValue(record.rating)) continue; // never trust stored rows blindly
    if (cutoffMs !== null) {
      const at = Date.parse(record.createdAt);
      if (!Number.isFinite(at) || at < cutoffMs || at > nowMs) continue;
    }
    count += 1;
    sum += record.rating;
  }

  if (count === 0) {
    // Honestly blank: no votes is NOT a zero-star rating.
    return { average: null, bayesian: null, count: 0, shown: false };
  }

  return {
    average: round2(sum / count),
    bayesian: round2((priorWeight * priorMean + sum) / (priorWeight + count)),
    count,
    shown: count >= minVotes,
  };
}

export type PercentileFrame = {
  /** Integer 0–100: the share of the distribution this score strictly beats. */
  percent: number;
  /** Ready-to-render copy, e.g. "Beats 82% of rated pubs". */
  label: string;
};

/**
 * "Beats N% of …" framing: where a Bayesian score sits in a peer distribution
 * (the other items' Bayesian scores). Null when the score is null (unrated)
 * or the distribution is empty — no fabricated standing.
 */
export function percentileFrame(
  bayesian: number | null,
  distribution: number[],
  of = "rated pubs",
): PercentileFrame | null {
  if (bayesian === null || distribution.length === 0) return null;
  const beaten = distribution.filter((score) => score < bayesian).length;
  const percent = Math.round((beaten / distribution.length) * 100);
  return { percent, label: `Beats ${percent}% of ${of}` };
}
