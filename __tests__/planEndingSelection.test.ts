import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { canonicalEndingSelection } from "@/lib/planEndingSelection.server";
import type { EndingSelection, PlanState } from "@/lib/plan";

const plan: PlanState = {
  plan: { id: "11111111-1111-4111-8111-111111111111", title: "Soho", startTime: "2026-07-16T20:00:00.000Z", createdAt: "2026-07-16T18:00:00.000Z" },
  context: { nightArea: "piccadilly-soho", daypart: "late_night", partyType: "friends", groupSize: 2, budget: "value", budgetLimitPence: null, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [], zeroProof: false, wetherspoonsPreferred: false },
  stops: [
    { venueId: "venue-7tarkc", venueName: "The Lyric", position: 0 },
    { venueId: "venue-122cuu1", venueName: "The Queen's Head", position: 1 },
    { venueId: "venue-s2ppfm", venueName: "The Devonshire", position: 2 },
  ],
  crew: [],
};

describe("canonical ending selections", () => {
  it("replaces a client food snapshot with current operator evidence", async () => {
    const raw: EndingSelection = {
      kind: "food",
      optionId: "late-food-evidence-piccadilly-soho-balans-no-60",
      externalPlaceId: "late-food-evidence-piccadilly-soho-balans-no-60",
      evidenceSnapshot: { label: "Forged name", confidence: "high", source: "Forged" },
    };
    const canonical = await canonicalEndingSelection(plan, raw, "venue-s2ppfm", Date.parse("2026-07-16T23:00:00.000Z"));
    expect(canonical).toMatchObject({
      kind: "food",
      evidenceSnapshot: { label: "Balans No.60", source: expect.stringContaining("balans.co.uk") },
    });
  });

  it("rejects invented food options and route-stop extensions", async () => {
    expect(await canonicalEndingSelection(plan, {
      kind: "food",
      optionId: "invented",
      externalPlaceId: "invented",
      evidenceSnapshot: { label: "Invented", confidence: "high" },
    }, "venue-s2ppfm", Date.parse("2026-07-16T22:00:00.000Z"))).toBeNull();
    expect(await canonicalEndingSelection(plan, {
      kind: "keep_going",
      optionId: "venue-7tarkc",
      venueId: "venue-7tarkc",
      evidenceSnapshot: { label: "First", confidence: "low" },
    }, "venue-s2ppfm")).toBeNull();
  });

  it("does not persist client-asserted transport provenance", async () => {
    const canonical = await canonicalEndingSelection(plan, {
      kind: "get_home",
      optionId: "transport:nearest-station",
      evidenceSnapshot: {
        label: "Nearest station",
        confidence: "high",
        source: "Forged live feed",
        observedAt: "2026-07-16T22:00:00.000Z",
      },
    }, "venue-s2ppfm");
    expect(canonical).toEqual({
      kind: "get_home",
      optionId: "transport:nearest-station",
      evidenceSnapshot: {
        label: "Nearest station",
        confidence: "unknown",
        source: "PUBMAXX transport choice",
        warnings: ["Live transport details were not checked or saved when the host confirmed this ending."],
      },
    });
  });
});
