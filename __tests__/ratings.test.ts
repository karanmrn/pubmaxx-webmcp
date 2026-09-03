import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRIOR_MEAN,
  MIN_VOTES_TO_SHOW,
  PRIOR_WEIGHT,
  RATING_VALUES,
  aggregateRatings,
  isRatingValue,
  parseRating,
  percentileFrame,
  type RatingRecord,
} from "@/lib/ratings";

// A fixed injected clock — lib/ratings.ts never calls Date.now() (repo rule).
const NOW = Date.parse("2026-07-07T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function votes(values: number[], createdAt = "2026-07-07T00:00:00.000Z"): RatingRecord[] {
  return values.map((rating) => ({ rating, createdAt }));
}

describe("isRatingValue / parseRating — 1–5 at 0.5 granularity", () => {
  it("accepts every legal half-star value", () => {
    for (const value of RATING_VALUES) expect(isRatingValue(value)).toBe(true);
  });

  it.each([0, 0.5, 5.5, 6, 3.2, 3.25, -1, NaN, Infinity])(
    "rejects %s",
    (value) => {
      expect(isRatingValue(value)).toBe(false);
    },
  );

  it("rejects non-numbers", () => {
    expect(isRatingValue("4")).toBe(false);
    expect(isRatingValue(null)).toBe(false);
    expect(isRatingValue(undefined)).toBe(false);
    expect(isRatingValue({})).toBe(false);
  });

  it("parseRating accepts numbers and numeric strings, rejects the rest", () => {
    expect(parseRating(4.5)).toBe(4.5);
    expect(parseRating("4.5")).toBe(4.5);
    expect(parseRating("5")).toBe(5);
    expect(parseRating("")).toBe(null);
    expect(parseRating("  ")).toBe(null);
    expect(parseRating("4.2")).toBe(null);
    expect(parseRating("abc")).toBe(null);
    expect(parseRating(true)).toBe(null);
    expect(parseRating(null)).toBe(null);
  });
});

describe("aggregateRatings", () => {
  it("zero votes → honestly blank (null, never zero stars)", () => {
    expect(aggregateRatings([], { now: NOW })).toEqual({
      average: null,
      bayesian: null,
      count: 0,
      shown: false,
    });
  });

  it("computes the plain mean and the exact Bayesian formula", () => {
    // 20 fives: average 5; bayesian = (10×3.5 + 100) / (10 + 20) = 4.5.
    const summary = aggregateRatings(votes(Array(20).fill(5)), { now: NOW });
    expect(summary.average).toBe(5);
    expect(summary.bayesian).toBe(4.5);
    expect(summary.count).toBe(20);
    expect(summary.shown).toBe(true);
  });

  it("pulls a tiny sample hard toward the prior (one 5-star vote can't top a list)", () => {
    const one = aggregateRatings(votes([5]), { now: NOW });
    // (10×3.5 + 5) / 11 = 3.64 — near the prior, not near 5.
    expect(one.average).toBe(5);
    expect(one.bayesian).toBeCloseTo(
      (PRIOR_WEIGHT * DEFAULT_PRIOR_MEAN + 5) / (PRIOR_WEIGHT + 1),
      2,
    );
    expect(one.bayesian).toBeLessThan(3.7);
  });

  it("respects an injected priorMean / priorWeight (the measured site mean)", () => {
    const summary = aggregateRatings(votes([5, 5]), {
      now: NOW,
      priorMean: 4,
      priorWeight: 2,
    });
    // (2×4 + 10) / 4 = 4.5
    expect(summary.bayesian).toBe(4.5);
  });

  it("hides under the vote floor and shows at exactly the floor", () => {
    const nine = aggregateRatings(votes(Array(MIN_VOTES_TO_SHOW - 1).fill(4)), { now: NOW });
    expect(nine.shown).toBe(false);
    expect(nine.average).toBe(4); // the value exists; only DISPLAY is gated
    const ten = aggregateRatings(votes(Array(MIN_VOTES_TO_SHOW).fill(4)), { now: NOW });
    expect(ten.shown).toBe(true);
  });

  it("honours a custom minVotes", () => {
    expect(aggregateRatings(votes([4, 4]), { now: NOW, minVotes: 2 }).shown).toBe(true);
  });

  it("skips rows with an illegal stored star value", () => {
    const summary = aggregateRatings(
      [...votes([4, 4]), { rating: 9, createdAt: "2026-07-07T00:00:00.000Z" }],
      { now: NOW },
    );
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(4);
  });

  it("recency window: only votes inside the trailing window count", () => {
    const recent = votes([5, 5], new Date(NOW - 2 * DAY_MS).toISOString());
    const stale = votes([1, 1, 1], new Date(NOW - 40 * DAY_MS).toISOString());
    const summary = aggregateRatings([...recent, ...stale], {
      now: NOW,
      recencyWindowDays: 30,
    });
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(5);
  });

  it("recency window: future-dated and unparseable timestamps are excluded", () => {
    const summary = aggregateRatings(
      [
        { rating: 5, createdAt: new Date(NOW + DAY_MS).toISOString() },
        { rating: 5, createdAt: "not-a-date" },
        { rating: 3, createdAt: new Date(NOW - DAY_MS).toISOString() },
      ],
      { now: NOW, recencyWindowDays: 30 },
    );
    expect(summary.count).toBe(1);
    expect(summary.average).toBe(3);
  });

  it("without a window, timestamps are not filtered", () => {
    const summary = aggregateRatings(
      [{ rating: 4, createdAt: "not-a-date" }],
      { now: NOW },
    );
    expect(summary.count).toBe(1);
  });

  it("accepts a Date for now", () => {
    const summary = aggregateRatings(votes([4]), {
      now: new Date(NOW),
      recencyWindowDays: 30,
    });
    expect(summary.count).toBe(1);
  });

  it("rounds average and bayesian to 2 decimals", () => {
    const summary = aggregateRatings(votes([4, 4, 5]), { now: NOW });
    expect(summary.average).toBe(4.33);
    // (35 + 13) / 13 = 3.6923…
    expect(summary.bayesian).toBe(3.69);
  });
});

describe("percentileFrame", () => {
  it("frames the beaten share with 'Beats N%' copy", () => {
    const frame = percentileFrame(4.2, [3.0, 3.5, 4.0, 4.5]);
    expect(frame).toEqual({ percent: 75, label: "Beats 75% of rated pubs" });
  });

  it("supports a custom noun", () => {
    expect(percentileFrame(5, [1], "stouts")?.label).toBe("Beats 100% of stouts");
  });

  it("beats nothing when lowest; equal scores are not 'beaten'", () => {
    expect(percentileFrame(3, [3, 4, 5])?.percent).toBe(0);
  });

  it("null score or empty distribution → null (no fabricated standing)", () => {
    expect(percentileFrame(null, [1, 2, 3])).toBe(null);
    expect(percentileFrame(4, [])).toBe(null);
  });
});
