import { describe, it, expect } from "vitest";

import {
  LOCAL_LEGEND_THRESHOLD,
  nextBadgeProgress,
  profileStats,
  REGULAR_THRESHOLD,
  type ProfileDrop,
} from "@/lib/profiles";

// Quest chips (IDEAS B2-lite): nextBadgeProgress is the forward-looking
// companion to computeBadges — same inputs, returns the UNEARNED badges
// nearest-first with honest progress counts.

function drop(overrides: Partial<ProfileDrop> = {}): ProfileDrop {
  return { handle: "someone", priceGbp: 5, venueId: "v1", ...overrides };
}

// Small helper: progress for a drop list via the same stats pipeline the pages use.
function progressFor(drops: ProfileDrop[]) {
  return nextBadgeProgress(drops, profileStats(drops));
}

describe("nextBadgeProgress", () => {
  it("zero stats: returns the full catalogue unearned, First Pint first, all at zero", () => {
    const quests = progressFor([]);
    expect(quests).toHaveLength(5);
    // All ratios are 0, so catalogue order breaks the tie deterministically.
    expect(quests.map((q) => q.badge.id)).toEqual([
      "first-pint",
      "cheap-legend",
      "heritage-walker",
      "regular",
      "local-legend",
    ]);
    expect(quests.every((q) => q.current === 0)).toBe(true);
    expect(quests.every((q) => q.target >= 1)).toBe(true);
    expect(quests.every((q) => !q.badge.earned)).toBe(true);
  });

  it("is null-safe for a null/undefined drop list", () => {
    expect(nextBadgeProgress(null, profileStats(null))).toHaveLength(5);
    expect(nextBadgeProgress(undefined, profileStats(undefined))).toHaveLength(5);
  });

  it("mid-progress: the nearest unearned badge leads with honest counts", () => {
    // 12 pints, one cheap + one heritage drop: first-pint / cheap-legend /
    // heritage-walker are earned; only the pint ladder remains.
    const drops = [
      drop({ priceGbp: 3.5 }),
      drop({ era: "Victorian" }),
      ...Array.from({ length: 10 }, () => drop()),
    ];
    const quests = progressFor(drops);
    expect(quests.map((q) => q.badge.id)).toEqual(["regular", "local-legend"]);
    // Regular is nearer (12/25 > 12/100).
    expect(quests[0]).toMatchObject({ current: 12, target: REGULAR_THRESHOLD });
    expect(quests[0].label).toBe(`12 of ${REGULAR_THRESHOLD} pints to Regular`);
    expect(quests[1]).toMatchObject({ current: 12, target: LOCAL_LEGEND_THRESHOLD });
    expect(quests[1].label).toBe(`12 of ${LOCAL_LEGEND_THRESHOLD} pints to Local Legend`);
  });

  it("binary badges report an honest 0-of-1 action, never a fake percentage", () => {
    const quests = progressFor([drop({ priceGbp: 5 })]); // first-pint earned only
    const cheap = quests.find((q) => q.badge.id === "cheap-legend");
    const heritage = quests.find((q) => q.badge.id === "heritage-walker");
    expect(cheap).toMatchObject({ current: 0, target: 1 });
    expect(cheap!.label).toBe("Find a pint under £4 for Cheap Legend");
    expect(heritage).toMatchObject({ current: 0, target: 1 });
    expect(heritage!.label).toBe("Log an era or passed-down memory for Heritage Walker");
  });

  it("all badges earned: returns an empty array (no invented quests)", () => {
    const legend = [
      drop({ priceGbp: 3.5, era: "Victorian" }),
      ...Array.from({ length: LOCAL_LEGEND_THRESHOLD - 1 }, () => drop()),
    ];
    expect(progressFor(legend)).toEqual([]);
  });

  it("threshold boundary: one short still counts as progress; at threshold the badge drops out", () => {
    const nearly = Array.from({ length: REGULAR_THRESHOLD - 1 }, () => drop());
    const nearlyQuests = progressFor(nearly);
    const nearlyRegular = nearlyQuests.find((q) => q.badge.id === "regular");
    expect(nearlyRegular).toMatchObject({
      current: REGULAR_THRESHOLD - 1,
      target: REGULAR_THRESHOLD,
    });
    // 24/25 beats every other unearned quest, so Regular leads.
    expect(nearlyQuests[0].badge.id).toBe("regular");

    const atThreshold = Array.from({ length: REGULAR_THRESHOLD }, () => drop());
    const atQuests = progressFor(atThreshold);
    expect(atQuests.map((q) => q.badge.id)).not.toContain("regular");
    // Local Legend now carries the pint count forward, capped at its target.
    const legend = atQuests.find((q) => q.badge.id === "local-legend");
    expect(legend).toMatchObject({
      current: REGULAR_THRESHOLD,
      target: LOCAL_LEGEND_THRESHOLD,
    });
  });

  it("is deterministic and does not mutate its inputs", () => {
    const drops = [drop({ priceGbp: 4.4 }), drop()];
    const snapshot = JSON.stringify(drops);
    const stats = profileStats(drops);
    expect(nextBadgeProgress(drops, stats)).toEqual(nextBadgeProgress(drops, stats));
    expect(JSON.stringify(drops)).toBe(snapshot);
  });
});
