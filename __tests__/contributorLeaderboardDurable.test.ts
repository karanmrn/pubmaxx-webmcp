import { beforeEach, describe, expect, it, vi } from "vitest";

const durable = vi.hoisted(() => ({
  data: [] as unknown[],
  error: null as { message: string } | null,
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({
      rpc: async () => ({ data: durable.data, error: durable.error }),
    }),
  };
});

import { readContributorLeaderboard } from "@/lib/contributorLeaderboardStore";

beforeEach(() => {
  durable.data = [];
  durable.error = null;
});

describe("durable contributor leaderboard", () => {
  it("accepts exact typed aggregates and gives equal totals equal rank", async () => {
    durable.data = [
      {
        handle: "sam",
        prices: 1,
        reviews: 1,
        recommendations: 0,
        total: 2,
      },
      {
        handle: "alex",
        prices: "0",
        reviews: "1",
        recommendations: "1",
        total: "2",
      },
    ];

    expect(await readContributorLeaderboard()).toMatchObject({
      status: "ready",
      entries: [
        { handle: "alex", rank: 1, total: 2 },
        { handle: "sam", rank: 1, total: 2 },
      ],
    });
  });

  it("degrades instead of publishing a partial malformed aggregate", async () => {
    durable.data = [
      {
        handle: "sam",
        prices: "not-a-count",
        reviews: 1,
        recommendations: 0,
        total: 1,
      },
    ];

    expect(await readContributorLeaderboard()).toMatchObject({
      status: "degraded",
      window: {
        kind: "unavailable",
        label: "All-time record unavailable",
      },
      entries: [],
    });
  });
});
