import { describe, expect, it } from "vitest";

import {
  rankContributors,
  type ContributionLane,
  type ContributionQualitySignals,
  type ContributionRecord,
} from "@/lib/contributorLeaderboard";

function record(
  handle: string,
  lane: ContributionLane,
  quality: Partial<ContributionQualitySignals> = {},
  visible = true,
  id = `${handle}-${lane}`,
): ContributionRecord {
  return {
    id,
    handle,
    lane,
    contributedAt: 1_000,
    visible,
    quality: {
      corroborated: lane === "price" ? false : null,
      moderation: "unreviewed",
      contradicted: lane === "price" ? false : null,
      ...quality,
    },
  };
}

describe("rankContributors", () => {
  it("adds all three visible lanes without weighting quality", () => {
    const board = rankContributors(
      [
        record("sam", "price", { corroborated: false }),
        record("sam", "review"),
        record("alex", "recommendation"),
      ],
      "ready",
    );

    expect(
      board.entries.map(({ handle, total, prices, reviews, recommendations }) => [
        handle,
        total,
        prices,
        reviews,
        recommendations,
      ]),
    ).toEqual([
      ["sam", 2, 1, 1, 0],
      ["alex", 1, 0, 0, 1],
    ]);
  });

  it("drops hidden records and gives equal totals equal rank", () => {
    const board = rankContributors(
      [
        record("sam", "price"),
        record("alex", "review"),
        record("hidden", "recommendation", { moderation: "hidden" }, false),
      ],
      "ready",
    );

    expect(board.entries.map(({ handle, rank }) => [handle, rank])).toEqual([
      ["alex", 1],
      ["sam", 1],
    ]);
  });

  it("uses competition ranks after a tie without inventing a tiebreak", () => {
    const board = rankContributors(
      [
        record("a", "price", {}, true, "a-1"),
        record("a", "review", {}, true, "a-2"),
        record("b", "price", {}, true, "b-1"),
        record("b", "recommendation", {}, true, "b-2"),
        record("c", "review", {}, true, "c-1"),
      ],
      "ready",
    );

    expect(board.entries.map(({ handle, rank, total }) => [handle, rank, total])).toEqual([
      ["a", 1, 2],
      ["b", 1, 2],
      ["c", 3, 1],
    ]);
  });

  it("normalizes handles and refuses a partial board on a degraded read", () => {
    expect(
      rankContributors(
        [
          record("@SAM", "price"),
          record("sam", "review"),
          record("", "recommendation"),
        ],
        "ready",
      ).entries,
    ).toMatchObject([{ handle: "sam", total: 2 }]);

    expect(rankContributors([record("sam", "price")], "degraded")).toMatchObject({
      status: "degraded",
      window: {
        kind: "unavailable",
        label: "All-time record unavailable",
      },
      entries: [],
    });
  });
});
