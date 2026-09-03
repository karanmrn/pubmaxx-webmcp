import { describe, expect, it } from "vitest";

import {
  bestCorroboratedRow,
  countCorroborations,
  COMMUNITY_PRICE_MAX_AGE_MS,
  type CommunityPriceAgreementRow,
} from "@/lib/communityPrice";
import { firstQualifyingCluster, type TrustObservation } from "@/lib/priceTrustEvents";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

function priceRow(overrides: Partial<CommunityPriceAgreementRow>): CommunityPriceAgreementRow {
  return {
    drinkCategory: "beer",
    priceGbp: 4.2,
    submittedAt: NOW - 1_000,
    actor: "profile:fresh",
    ...overrides,
  };
}

function trustRow(overrides: Partial<TrustObservation>): TrustObservation {
  return {
    id: "fresh",
    venueId: "venue-one",
    drinkCategory: "beer",
    priceGbp: 4.2,
    submittedAt: NOW - 1_000,
    actor: "profile:fresh",
    hidden: false,
    ...overrides,
  };
}

describe("issue #1098 freshness boundary", () => {
  it("does not count a stale corroborator for a fresh candidate", () => {
    const rows = [
      priceRow({
        submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
        actor: "profile:stale",
      }),
      priceRow({ submittedAt: NOW - 1_000, actor: "profile:fresh" }),
    ];

    expect(countCorroborations(rows, rows[1], NOW)).toBe(1);
    expect(bestCorroboratedRow(rows, NOW)).toEqual({ row: rows[1], corroborations: 1 });
  });

  it("does not credit a durable trust cluster with a stale corroborator", () => {
    const rows = [
      trustRow({
        id: "stale",
        submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
        actor: "profile:stale",
      }),
      trustRow({ id: "fresh", submittedAt: NOW - 1_000, actor: "profile:fresh" }),
    ];

    expect(firstQualifyingCluster(rows, NOW)).toBeNull();
  });
});
