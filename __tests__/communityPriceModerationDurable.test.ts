import { beforeEach, describe, expect, it, vi } from "vitest";

const durable = vi.hoisted(() => ({
  changed: true,
  selects: [] as string[],
}));

vi.mock("@/lib/supabase", () => {
  const signalRow = { id: "signal-1", drink_category: null };
  const query = {
    update: () => query,
    select: (columns: string) => {
      durable.selects.push(columns);
      return query;
    },
    eq: () => query,
    is: async () => ({
      data: durable.changed ? [signalRow] : [],
      error: null,
    }),
    not: async () => ({
      data: durable.changed ? [signalRow] : [],
      error: null,
    }),
    limit: async () => ({ data: [signalRow], error: null }),
  };
  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ from: () => query }),
  };
});

import { moderateCommunityPriceWithState } from "@/lib/communityPriceStore";

describe("durable community observation moderation", () => {
  beforeEach(() => {
    durable.changed = true;
    durable.selects = [];
  });

  it("returns the Venue signal kind when moderation changes the row", async () => {
    await expect(
      moderateCommunityPriceWithState("signal-1", true),
    ).resolves.toEqual({
      status: "ok",
      changed: true,
      kind: "signal",
    });
    expect(durable.selects).toEqual(["id, drink_category"]);
  });

  it("returns the Venue signal kind for an unchanged retry", async () => {
    durable.changed = false;

    await expect(
      moderateCommunityPriceWithState("signal-1", true),
    ).resolves.toEqual({
      status: "ok",
      changed: false,
      kind: "signal",
    });
    expect(durable.selects).toEqual([
      "id, drink_category",
      "id, drink_category",
    ]);
  });
});
