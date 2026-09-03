import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import {
  __resetCommunityPrices,
  memoryCommunityPriceStore,
} from "@/lib/communityPriceStore";
import {
  __resetVisitReports,
  memoryVisitReportStore,
} from "@/lib/visitReportsStore";
import {
  __resetWeatherRecommendations,
  memoryWeatherRecommendationStore,
} from "@/lib/weatherRecommendationStore";

describe("leaderboard contribution store projections", () => {
  beforeEach(() => {
    __resetCommunityPrices();
    __resetVisitReports();
    __resetWeatherRecommendations();
  });

  it("projects attributed price quality without exposing anonymous actors", async () => {
    const first = await memoryCommunityPriceStore.submit(
      {
        venueId: "v1",
        drinkCategory: "beer",
        priceGbp: 5,
        actor: "actor-a",
        contributorHandle: "sam",
      },
      1_000,
    );
    await memoryCommunityPriceStore.submit(
      {
        venueId: "v1",
        drinkCategory: "beer",
        priceGbp: 5,
        actor: "actor-b",
        contributorHandle: "alex",
      },
      2_000,
    );
    await memoryCommunityPriceStore.submit(
      {
        venueId: "v1",
        drinkCategory: "beer",
        priceGbp: 8,
        actor: "actor-c",
        contributorHandle: "pat",
      },
      3_000,
    );
    await memoryCommunityPriceStore.submit(
      {
        venueId: "v2",
        drinkCategory: "beer",
        priceGbp: 4,
        actor: "private-actor",
      },
      4_000,
    );

    const read = await memoryCommunityPriceStore.listLeaderboardContributions();
    expect(read.status).toBe("ready");
    expect(read.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.price?.id,
          handle: "sam",
          visible: true,
          quality: {
            corroborated: true,
            moderation: "unreviewed",
            contradicted: true,
          },
        }),
        expect.objectContaining({
          handle: "alex",
          quality: expect.objectContaining({
            corroborated: true,
            contradicted: true,
          }),
        }),
        expect.objectContaining({
          handle: "pat",
          quality: expect.objectContaining({
            corroborated: false,
            contradicted: false,
          }),
        }),
      ]),
    );
    expect(read.records).toHaveLength(3);
    expect(JSON.stringify(read)).not.toContain("actor-a");
    expect(JSON.stringify(read)).not.toContain("private-actor");
  });

  it("keeps hidden prices in the quality record but marks them non-counting", async () => {
    const { price } = await memoryCommunityPriceStore.submit(
      {
        venueId: "v1",
        drinkCategory: "beer",
        priceGbp: 5,
        actor: "actor-a",
        contributorHandle: "sam",
      },
      1_000,
    );
    await memoryCommunityPriceStore.moderate(price!.id!, true, "wrong figure");

    expect(await memoryCommunityPriceStore.listLeaderboardContributions()).toMatchObject({
      status: "ready",
      records: [
        {
          handle: "sam",
          visible: false,
          quality: { moderation: "hidden" },
        },
      ],
    });
  });

  it("keeps hidden reviews and Recommendations out of counting projections", async () => {
    const review = await memoryVisitReportStore.create(
      {
        venueId: "v1",
        handle: "sam",
        visitedAt: "2026-07-27",
        busyness: "steady",
        noise: null,
        seating: null,
        serviceWait: null,
        note: "",
      },
      1_000,
    );
    const recommendation = await memoryWeatherRecommendationStore.create(
      {
        venueId: "v1",
        condition: "raining",
        reason: "The covered yard stays properly dry.",
        contributorHandle: "sam",
        actorHash: "actor-a",
      },
      2_000,
    );

    await memoryVisitReportStore.moderate(review.id, "hidden", "removed");
    await memoryWeatherRecommendationStore.moderate(
      recommendation.id,
      "hidden",
      "removed",
    );

    expect(await memoryVisitReportStore.listLeaderboardContributions()).toMatchObject({
      status: "ready",
      records: [
        {
          id: review.id,
          visible: false,
          quality: {
            corroborated: null,
            moderation: "hidden",
            contradicted: null,
          },
        },
      ],
    });
    expect(
      await memoryWeatherRecommendationStore.listLeaderboardContributions(),
    ).toMatchObject({
      status: "ready",
      records: [
        {
          id: recommendation.id,
          visible: false,
          quality: {
            corroborated: null,
            moderation: "hidden",
            contradicted: null,
          },
        },
      ],
    });
    expect(
      (await memoryWeatherRecommendationStore.listForVenue("v1")).recommendations,
    ).toEqual([]);
    expect(
      await memoryWeatherRecommendationStore.countForContributor("sam"),
    ).toEqual({ status: "ready", count: 0 });
  });

  it("filters every hidden durable lane in the exact public aggregation", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260728140000_0059_contributor_leaderboard.sql",
      ),
      "utf8",
    );

    expect(sql).toMatch(
      /from public\.community_prices[\s\S]*?hidden_at is null/,
    );
    expect(sql).toMatch(
      /from public\.structured_visit_reports[\s\S]*?status = 'visible'/,
    );
    expect(sql).toMatch(
      /from public\.weather_recommendations[\s\S]*?status = 'visible'/,
    );
    expect(sql).toMatch(/for price_group in[\s\S]*?set price_pennies = price_pennies/);
    expect(sql).toMatch(
      /canonical_contributions[\s\S]*?\n\s+join public\.profile_handle_aliases[\s\S]*?\n\s+join public\.profiles/,
    );
    expect(sql).not.toMatch(/coalesce\(profile\.handle,\s*contribution\.handle\)/);
  });

  it("stops a handle claim from back-dating pre-claim contributions into the aggregate", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260807010000_0079_handle_claim_no_inheritance.sql",
      ),
      "utf8",
    );

    // Every lane in visible_contributions must carry its own recorded-at
    // timestamp: the trustworthy insertion time, never a user-editable date.
    expect(sql).toMatch(
      /submitted_at as recorded_at[\s\S]*?from public\.community_prices/,
    );
    expect(sql).toMatch(
      /created_at as recorded_at[\s\S]*?from public\.structured_visit_reports/,
    );
    expect(sql).not.toMatch(/visited_at as recorded_at/);
    expect(sql).toMatch(
      /submitted_at as recorded_at[\s\S]*?from public\.weather_recommendations/,
    );

    // The alias join must bound attribution to rows at or after the claim.
    expect(sql).toMatch(
      /join public\.profile_handle_aliases as alias\s+on lower\(alias\.handle\) = lower\(contribution\.handle\)\s+and contribution\.recorded_at >= alias\.claimed_at/,
    );

    // Old rows keep showing their own stored handle: no display column changes.
    expect(sql).not.toMatch(/alter table public\.community_prices[\s\S]*?contributor_handle/);
    expect(sql).not.toMatch(/alter table public\.structured_visit_reports/);
    expect(sql).not.toMatch(/alter table public\.weather_recommendations/);
  });
});
