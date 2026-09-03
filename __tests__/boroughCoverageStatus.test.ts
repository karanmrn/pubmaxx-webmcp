import { describe, expect, it } from "vitest";

import {
  SEED_BOROUGH_CAMPAIGN,
  SEED_BOROUGH_MONTHLY_TARGET,
  boroughCoverageMapHref,
  boroughCoverageStatusCopy,
} from "@/lib/boroughCoverageStatus";

describe("boroughCoverageStatusCopy", () => {
  it("names remaining corroborated pints without gamifying", () => {
    expect(
      boroughCoverageStatusCopy({
        slug: "camden",
        name: "Camden",
        mapQuery: "Camden",
        corroboratedPintCount: 8,
        target: 20,
        status: "ready",
      }),
    ).toBe("Camden needs 12 more corroborated pints this month.");
  });

  it("uses singular pint when one remains", () => {
    expect(
      boroughCoverageStatusCopy({
        slug: "camden",
        name: "Camden",
        mapQuery: "Camden",
        corroboratedPintCount: 19,
        status: "ready",
      }),
    ).toBe("Camden needs 1 more corroborated pint this month.");
  });

  it("says the target is met without inventing a leaderboard", () => {
    expect(
      boroughCoverageStatusCopy({
        slug: "camden",
        name: "Camden",
        mapQuery: "Camden",
        corroboratedPintCount: SEED_BOROUGH_MONTHLY_TARGET,
        status: "ready",
      }),
    ).toBe("Camden has met its 20 corroborated pints for this month.");
  });

  it("never treats a failed read as an empty borough", () => {
    expect(
      boroughCoverageStatusCopy({
        slug: "camden",
        name: "Camden",
        mapQuery: "Camden",
        corroboratedPintCount: 0,
        status: "degraded",
      }),
    ).toBe("Camden: we could not count corroborated pints just now.");
  });

  it("marks truncated scans as a floor", () => {
    expect(
      boroughCoverageStatusCopy({
        slug: "camden",
        name: "Camden",
        mapQuery: "Camden",
        corroboratedPintCount: 3,
        status: "partial",
      }),
    ).toContain("the count may run higher");
  });
});

describe("seed borough campaign", () => {
  it("keeps five soft-launch patches", () => {
    expect(SEED_BOROUGH_CAMPAIGN).toHaveLength(5);
  });

  it("keeps one row per borough slug", () => {
    const slugs = SEED_BOROUGH_CAMPAIGN.map(({ slug }) => slug);

    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("includes the Islington patch and its map destination", () => {
    expect(SEED_BOROUGH_CAMPAIGN).toContainEqual({
      slug: "islington",
      name: "Islington",
      mapQuery: "Islington",
    });
    expect(boroughCoverageMapHref("Islington")).toBe("/map?q=Islington");
  });
});
