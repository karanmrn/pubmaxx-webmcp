import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMemoryRatings,
  isRatingKind,
  memoryRatingsStore,
  ratingsStore,
} from "@/lib/ratingsStore";
import type { RatingValue } from "@/lib/ratings";

// Memory-store contract coverage: upsert semantics and batch summaries.
// Supabase env cleared per convention so ratingsStore() deterministically
// selects the in-memory backend.
beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryRatings();
});

async function cast(ref: string, handle: string, rating: RatingValue, kind: "drink" | "venue" = "venue") {
  return memoryRatingsStore.rate({ kind, ref, handle, rating });
}

describe("isRatingKind", () => {
  it("accepts only the two kinds", () => {
    expect(isRatingKind("drink")).toBe(true);
    expect(isRatingKind("venue")).toBe(true);
    expect(isRatingKind("pub")).toBe(false);
    expect(isRatingKind(undefined)).toBe(false);
  });
});

describe("ratingsStore() seam", () => {
  it("selects the memory store when Supabase is not configured", () => {
    expect(ratingsStore()).toBe(memoryRatingsStore);
  });
});

describe("memory store — rate() upsert semantics", () => {
  it("a handle's re-rating REPLACES its old vote (count stays 1)", async () => {
    await cast("venue-1", "ken", 2);
    const after = await cast("venue-1", "ken", 5);
    expect(after.count).toBe(1);
    expect(after.average).toBe(5); // the latest vote, not a mix of both
  });

  it("normalizes the handle, so '@Ken' and 'ken' are ONE voter", async () => {
    await cast("venue-1", "@Ken", 5);
    const after = await cast("venue-1", "ken", 3);
    expect(after.count).toBe(1);
    expect(after.average).toBe(3);
  });

  it("distinct handles accumulate distinct votes", async () => {
    await cast("venue-1", "a", 4);
    const after = await cast("venue-1", "b", 5);
    expect(after.count).toBe(2);
    expect(after.average).toBe(4.5);
  });

  it("throws on an empty handle (the route 400s first, but the store guards too)", async () => {
    await expect(cast("venue-1", "  ", 4)).rejects.toThrow();
  });

  it("drink and venue votes live in separate namespaces", async () => {
    await cast("shared-ref", "ken", 5, "drink");
    const venueSide = await memoryRatingsStore.summaryFor("venue", ["shared-ref"]);
    expect(venueSide["shared-ref"].count).toBe(0);
  });
});

describe("memory store — summaryFor() batch", () => {
  it("returns a summary per requested ref; unknown refs are honestly blank", async () => {
    await cast("venue-1", "a", 4);
    const out = await memoryRatingsStore.summaryFor("venue", ["venue-1", "ghost"]);
    expect(out["venue-1"].count).toBe(1);
    expect(out.ghost).toEqual({ average: null, bayesian: null, count: 0, shown: false });
  });

  it("hides the score under the 10-vote floor and shows it at the floor", async () => {
    for (let i = 0; i < 9; i++) await cast("venue-1", `h${i}`, 4);
    let out = await memoryRatingsStore.summaryFor("venue", ["venue-1"]);
    expect(out["venue-1"].shown).toBe(false);
    await cast("venue-1", "h9", 4);
    out = await memoryRatingsStore.summaryFor("venue", ["venue-1"]);
    expect(out["venue-1"].shown).toBe(true);
  });

  it("empty refs → empty map", async () => {
    expect(await memoryRatingsStore.summaryFor("venue", [])).toEqual({});
  });
});
