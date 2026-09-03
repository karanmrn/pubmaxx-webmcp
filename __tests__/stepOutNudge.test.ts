import { describe, expect, it } from "vitest";

import {
  canSendStepOutNudge,
  composeDealEndingNudge,
  composeSoftPlanOpenNudge,
  composeWantedNearbyNudge,
  isAllowedStepOutNudgeCopy,
  selectStepOutNudge,
  STEP_OUT_NUDGE_WEEK_MS,
} from "@/lib/stepOutNudge";

describe("stepOutNudge payload builders", () => {
  it("builds a Wanted nearby body with coarse you-ish wording", () => {
    expect(
      composeWantedNearbyNudge({
        venueName: "The Anchor",
        walkMinutes: 12,
        venueId: "venue-anchor",
      }),
    ).toEqual({
      kind: "wanted_nearby",
      title: "Step out",
      body: "Your Wanted The Anchor is a 12-min walk from you-ish.",
      url: "/map?sel=venue-anchor",
    });
  });

  it("refuses Wanted payloads outside the walk budget", () => {
    expect(
      composeWantedNearbyNudge({ venueName: "Far Pub", walkMinutes: 40 }),
    ).toBeNull();
  });

  it("builds the Soft Plan open body", () => {
    expect(composeSoftPlanOpenNudge({ planId: "plan-1" })).toEqual({
      kind: "soft_plan_open",
      title: "Step out",
      body: "Your Soft Plan for tonight is still open.",
      url: "/plan/plan-1",
    });
  });

  it("builds a deal ending body with first-party source", () => {
    expect(
      composeDealEndingNudge({
        dealTitle: "2-for-1 pints",
        placeName: "The Crown",
        endsAt: "2026-08-08T20:00:00.000Z",
        sourceLabel: "Greene King",
        venueId: "venue-crown",
      }),
    ).toMatchObject({
      kind: "deal_ending",
      title: "Step out",
      sourceLabel: "Greene King",
      url: "/map?sel=venue-crown",
    });
    const payload = composeDealEndingNudge({
      dealTitle: "2-for-1 pints",
      placeName: "The Crown",
      endsAt: "2026-08-08T20:00:00.000Z",
      sourceLabel: "Greene King",
    });
    expect(payload?.body).toMatch(/2-for-1 pints at The Crown ends \d{2}:\d{2}\. Source: Greene King\./);
  });

  it("selects Wanted over Soft Plan over deal", () => {
    const wanted = composeWantedNearbyNudge({
      venueName: "The Anchor",
      walkMinutes: 8,
    });
    const soft = composeSoftPlanOpenNudge();
    const deal = composeDealEndingNudge({
      dealTitle: "Quiz deal",
      placeName: "The Crown",
      endsAt: "2026-08-08T20:00:00.000Z",
      sourceLabel: "Venue site",
    });
    expect(selectStepOutNudge([deal, soft, wanted])?.kind).toBe("wanted_nearby");
    expect(selectStepOutNudge([deal, soft])?.kind).toBe("soft_plan_open");
    expect(selectStepOutNudge([deal])?.kind).toBe("deal_ending");
    expect(selectStepOutNudge([])).toBeNull();
  });

  it("never allows streak or drink-more pressure copy", () => {
    expect(isAllowedStepOutNudgeCopy("You haven't been out in 5 days")).toBe(false);
    expect(isAllowedStepOutNudgeCopy("Keep your streak going")).toBe(false);
    expect(isAllowedStepOutNudgeCopy("Drink more tonight")).toBe(false);
    expect(
      isAllowedStepOutNudgeCopy("Your Wanted The Anchor is a 12-min walk from you-ish."),
    ).toBe(true);
  });
});

describe("stepOutNudge frequency cap", () => {
  it("allows a first send and blocks inside the week window", () => {
    const now = Date.parse("2026-08-08T12:00:00.000Z");
    expect(canSendStepOutNudge(null, now)).toBe(true);
    expect(canSendStepOutNudge("2026-08-08T10:00:00.000Z", now)).toBe(false);
    expect(
      canSendStepOutNudge(
        new Date(now - STEP_OUT_NUDGE_WEEK_MS).toISOString(),
        now,
      ),
    ).toBe(true);
  });
});
