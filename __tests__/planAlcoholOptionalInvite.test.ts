import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PLAN_ALCOHOL_OPTIONAL_INVITE_LINE,
  planAlcoholOptionalInviteLine,
  planReadsAsAlcoholOptional,
} from "@/lib/planAlcoholOptional";
import type { NightContext } from "@/lib/nightPlanning";

const BASE_CONTEXT: NightContext = {
  nightArea: "clapham",
  daypart: "evening",
  partyType: "friends",
  groupSize: 4,
  budget: "standard",
  budgetLimitPence: null,
  zeroProof: false,
  wetherspoonsPreferred: false,
  atmosphere: [],
  foodNeeds: [],
  accessibility: [],
  transportConstraints: [],
};

describe("planReadsAsAlcoholOptional", () => {
  it("reads zeroProof context as alcohol-optional", () => {
    expect(
      planReadsAsAlcoholOptional({
        title: "Friday in Soho",
        context: { ...BASE_CONTEXT, zeroProof: true },
      }),
    ).toBe(true);
  });

  it("reads quiet atmosphere from context", () => {
    expect(
      planReadsAsAlcoholOptional({
        title: "Catch-up",
        context: { ...BASE_CONTEXT, atmosphere: ["quiet"] },
      }),
    ).toBe(true);
  });

  it("reads soft titles when context is missing", () => {
    expect(planReadsAsAlcoholOptional({ title: "Coffee catch-up in Clapham" })).toBe(true);
    expect(planReadsAsAlcoholOptional({ title: "Quiet afternoon" })).toBe(true);
    expect(planReadsAsAlcoholOptional({ title: "Chill Wetherspoons loop" })).toBe(true);
    expect(planReadsAsAlcoholOptional({ title: "Alcohol-free drinks night" })).toBe(true);
  });

  it("stays silent for ordinary pint nights", () => {
    expect(planReadsAsAlcoholOptional({ title: "Friday in Soho", context: BASE_CONTEXT })).toBe(false);
    expect(planReadsAsAlcoholOptional({ title: "Match night" })).toBe(false);
    expect(planAlcoholOptionalInviteLine({ title: "Cheap round tonight" })).toBeNull();
  });
});

describe("planAlcoholOptionalInviteLine", () => {
  it("returns the fixed honest sentence when soft", () => {
    expect(
      planAlcoholOptionalInviteLine({
        title: "Coffee and a catch-up",
        context: null,
      }),
    ).toBe(PLAN_ALCOHOL_OPTIONAL_INVITE_LINE);
  });
});

describe("invite page wiring", () => {
  it("calls planAlcoholOptionalInviteLine on the invite card", () => {
    const page = readFileSync(join(process.cwd(), "app/invite/[token]/page.tsx"), "utf8");
    expect(page).toContain("planAlcoholOptionalInviteLine");
    expect(page).toContain("invite__softNote");
    expect(page).toContain("state.context");
  });
});
