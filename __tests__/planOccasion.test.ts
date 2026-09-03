import { describe, expect, it } from "vitest";

import { laneSourceFromSearch } from "@/lib/analytics";
import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";
import { inferNightContext } from "@/lib/nightPlanning";
import {
  parsePlanDescribeFromSearch,
  parsePlanHandoffQueryFromSearch,
  planOccasionHref,
  planPalRouteHandoffHref,
  shouldAutoGeneratePalHandoffPlan,
  PLAN_QUERY_PARAM,
  SOFT_PLAN_OCCASIONS,
  SOFT_PLAN_OCCASION_IDS,
  TONIGHT_SOFT_PLAN_CHIPS,
} from "@/lib/planOccasion";

/** Fixed London evening so daytime chip language must win over the clock default. */
const EVENING = new Date("2026-08-07T19:30:00.000Z");

describe("soft plan occasion deep links", () => {
  it("maps every closed occasion id to a shipped describe-first chip", () => {
    expect(SOFT_PLAN_OCCASION_IDS).toEqual(["quiet", "af", "coffee", "chill"]);
    for (const id of SOFT_PLAN_OCCASION_IDS) {
      expect(DESCRIBE_FIRST_CHIPS).toContain(SOFT_PLAN_OCCASIONS[id]);
    }
  });

  it.each(SOFT_PLAN_OCCASION_IDS)("builds an occasion href for %s", (id) => {
    expect(planOccasionHref(id, { src: "landing-why" })).toBe(
      `/plan?occasion=${id}&src=landing-why`,
    );
  });

  it("parses occasion params back to the shipped chip text", () => {
    expect(parsePlanDescribeFromSearch("?occasion=coffee")).toBe(
      "coffee and a catch-up in Clapham for 2",
    );
    expect(parsePlanDescribeFromSearch("?occasion=af")).toBe(
      "alcohol-free drinks in Camden for 3",
    );
    expect(parsePlanDescribeFromSearch("?occasion=quiet")).toBe(
      "Quiet in Clapham for 4, not pricey",
    );
    expect(parsePlanDescribeFromSearch("?occasion=chill")).toBe(
      "chill Wetherspoons in Clapham for 3",
    );
  });

  it("accepts describe= only for shipped chip strings", () => {
    const chip = DESCRIBE_FIRST_CHIPS[0]!;
    expect(parsePlanDescribeFromSearch(`?describe=${encodeURIComponent(chip)}`)).toBe(chip);
    expect(parsePlanDescribeFromSearch("?describe=made%20up%20outing")).toBeNull();
    expect(parsePlanDescribeFromSearch("?occasion=party")).toBeNull();
  });

  it("prefers occasion over describe when both are present", () => {
    expect(
      parsePlanDescribeFromSearch(
        `?occasion=coffee&describe=${encodeURIComponent(DESCRIBE_FIRST_CHIPS[0]!)}`,
      ),
    ).toBe("coffee and a catch-up in Clapham for 2");
  });

  it("parses a Pub Pal route handoff query param", () => {
    const ask = "Plan a crawl in Soho for 4";
    expect(parsePlanDescribeFromSearch(`?${PLAN_QUERY_PARAM}=${encodeURIComponent(ask)}`)).toBe(
      ask,
    );
    expect(planPalRouteHandoffHref(ask)).toBe(
      `/plan?${PLAN_QUERY_PARAM}=Plan+a+crawl+in+Soho+for+4`,
    );
    expect(laneSourceFromSearch(new URL(`https://x.test${planPalRouteHandoffHref(ask)}`).search)).toBeNull();
  });

  it("auto-generates only for a Pub Pal query handoff, not chip links", () => {
    expect(shouldAutoGeneratePalHandoffPlan("Plan a crawl in Soho for 4")).toBe(true);
    expect(shouldAutoGeneratePalHandoffPlan("  ")).toBe(false);
    expect(shouldAutoGeneratePalHandoffPlan(null)).toBe(false);
    expect(shouldAutoGeneratePalHandoffPlan(parsePlanHandoffQueryFromSearch("?occasion=quiet"))).toBe(false);
    expect(shouldAutoGeneratePalHandoffPlan(parsePlanHandoffQueryFromSearch(`?query=${encodeURIComponent("Plan a crawl in Soho for 4")}`))).toBe(true);
  });

  it.each([
    ["quiet", { atmosphere: ["quiet"], zeroProof: false }],
    ["af", { zeroProof: true, nightArea: "camden", groupSize: 3 }],
    ["coffee", { daypart: "daytime", groupSize: 2, nightArea: "clapham" }],
    ["chill", { daypart: "daytime", atmosphere: ["quiet"], wetherspoonsPreferred: true }],
  ] as const)("honours the occasion promised by %s", (id, expected) => {
    const query = SOFT_PLAN_OCCASIONS[id];
    expect(inferNightContext(query, EVENING).context).toMatchObject(expected);
  });
});

describe("Tonight soft plan chips", () => {
  it("ships coffee, alcohol-free and chill without duplicating quiet", () => {
    expect(TONIGHT_SOFT_PLAN_CHIPS.map((chip) => chip.id)).toEqual([
      "coffee",
      "af",
      "chill",
    ]);
    expect(TONIGHT_SOFT_PLAN_CHIPS.map((chip) => chip.label)).toEqual([
      "Coffee catch-up",
      "Alcohol-free outing",
      "Chill afternoon",
    ]);
    for (const chip of TONIGHT_SOFT_PLAN_CHIPS) {
      expect(chip.label).not.toMatch(/!/);
      expect(chip.label).not.toMatch(/\u2014|\u2013/);
    }
  });
});
