import { describe, expect, it } from "vitest";

import {
  CONFIRM_WINDOW_DAYS,
  FRESH_WITHIN_DAYS,
  priceConfidence,
  STALE_AFTER_DAYS,
} from "@/lib/priceConfidence";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // fixed clock — the module never calls Date.now()

describe("priceConfidence", () => {
  it("is FRESH within the fresh window and labels real weekly activity", () => {
    const c = priceConfidence(
      { confirms: 5, lastConfirmedAt: NOW - 2 * DAY, recentConfirms: 3 },
      NOW,
    );
    expect(c.state).toBe("fresh");
    expect(c.label).toBe("×3 this week");
  });

  it("uses the singular wording for exactly one weekly confirm", () => {
    const c = priceConfidence(
      { confirms: 1, lastConfirmedAt: NOW - DAY, recentConfirms: 1 },
      NOW,
    );
    expect(c.label).toBe("vouched this week");
  });

  it("falls back to 'vouched recently' inside the fresh window with no weekly activity", () => {
    const c = priceConfidence(
      { confirms: 2, lastConfirmedAt: NOW - 10 * DAY, recentConfirms: 0 },
      NOW,
    );
    expect(c.state).toBe("fresh");
    expect(c.label).toBe("vouched recently");
  });

  it("boundary: exactly FRESH_WITHIN_DAYS old is still fresh; a ms past is aging", () => {
    const at = NOW - FRESH_WITHIN_DAYS * DAY;
    expect(priceConfidence({ confirms: 1, lastConfirmedAt: at, recentConfirms: 0 }, NOW).state).toBe(
      "fresh",
    );
    expect(
      priceConfidence({ confirms: 1, lastConfirmedAt: at - 1, recentConfirms: 0 }, NOW).state,
    ).toBe("aging");
  });

  it("AGING carries no label — the plaque just goes quiet", () => {
    const c = priceConfidence(
      { confirms: 4, lastConfirmedAt: NOW - 30 * DAY, recentConfirms: 0 },
      NOW,
    );
    expect(c.state).toBe("aging");
    expect(c.label).toBeNull();
  });

  it("STALE past the stale threshold, with the honest invitation", () => {
    const c = priceConfidence(
      { confirms: 2, lastConfirmedAt: NOW - (STALE_AFTER_DAYS + 1) * DAY, recentConfirms: 0 },
      NOW,
    );
    expect(c.state).toBe("stale");
    expect(c.label).toBe("worth a fresh look");
  });

  it("a fresh price OBSERVATION keeps state fresh but earns no community wording", () => {
    const c = priceConfidence(
      { confirms: 0, lastConfirmedAt: null, recentConfirms: 0, priceObservedAt: NOW - DAY },
      NOW,
    );
    expect(c.state).toBe("fresh");
    expect(c.label).toBeNull();
  });

  it("no signal at all is stale — absence is never dressed up as freshness", () => {
    const c = priceConfidence({ confirms: 0, lastConfirmedAt: null, recentConfirms: 0 }, NOW);
    expect(c.state).toBe("stale");
  });

  it("the latest of confirm vs observation wins the age read", () => {
    const c = priceConfidence(
      {
        confirms: 1,
        lastConfirmedAt: NOW - 90 * DAY,
        recentConfirms: 0,
        priceObservedAt: NOW - 3 * DAY,
      },
      NOW,
    );
    expect(c.state).toBe("fresh");
  });

  it("exports a 7-day window constant the store windows on", () => {
    expect(CONFIRM_WINDOW_DAYS).toBe(7);
  });
});
