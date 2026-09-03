import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => {
  const query = {
    select: () => query,
    eq: () => query,
    or: () => query,
    order: () => query,
    limit: async () => ({ data: null, error: { message: "database unavailable" } }),
  };
  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ from: () => query }),
  };
});

import {
  listCommunityPricesForReviewWithStatus,
  readCommunityPricesWithStatus,
} from "@/lib/communityPriceStore";

describe("community price degraded reads", () => {
  it("preserves durable read failure separately from an honest empty", async () => {
    await expect(readCommunityPricesWithStatus("venue-3h52h")).resolves.toEqual({
      prices: [],
      degraded: true,
    });
  });

  it("preserves durable review-queue failure separately from an honest empty", async () => {
    await expect(listCommunityPricesForReviewWithStatus()).resolves.toEqual({
      prices: [],
      degraded: true,
    });
  });
});
