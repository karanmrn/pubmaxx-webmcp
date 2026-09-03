import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESCRIBE_FIRST_CHIPS } from "@/components/plan/PlanDescribeFirst";

// Chips are promises of a priced three-stop route. Shipping an example that
// 422s is a lie. Occasion-field honesty for each label is pinned beside
// inferNightContext in __tests__/nightPlanning.test.ts, not here.

describe("PlanDescribeFirst occasion chips", () => {
  it("keeps at least two classic night chips that already generate", () => {
    expect(DESCRIBE_FIRST_CHIPS).toContain("Quiet in Clapham for 4, not pricey");
    expect(DESCRIBE_FIRST_CHIPS).toContain("cheap pints tonight in Shoreditch");
  });

  it("offers coffee, food, chill and alcohol-free occasions beside the classics", () => {
    expect(DESCRIBE_FIRST_CHIPS).toContain("alcohol-free drinks in Camden for 3");
    expect(DESCRIBE_FIRST_CHIPS).toContain("quiet afternoon in Clapham for 2, soft drinks");
    expect(DESCRIBE_FIRST_CHIPS).toContain("food then a soft drink in Shoreditch for 4");
    expect(DESCRIBE_FIRST_CHIPS).toContain("coffee and a catch-up in Clapham for 2");
    expect(DESCRIBE_FIRST_CHIPS).toContain("chill Wetherspoons in Clapham for 3");
  });

  it("never ships the Zone 2 Spoons chip that 422s without an area", () => {
    expect(DESCRIBE_FIRST_CHIPS.join("\n")).not.toMatch(/Zone 2/i);
  });

  it("adopts a prefill that arrives after mount, but never over typed text", () => {
    // The composer reads `?occasion=` in an effect, so the prefill lands one
    // tick AFTER this component captured initialQuery into its own state. Held
    // as initial state alone, every soft-occasion and Culture Crawl deep link
    // lands on an empty field and reads as a broken destination.
    const source = readFileSync(
      join(process.cwd(), "components/plan/PlanDescribeFirst.tsx"),
      "utf8",
    );
    expect(source).toContain("useEffect");
    expect(source).toContain("appliedPrefill");
    expect(source).toContain("if (touched || initialQuery === appliedPrefill.current) return;");
    expect(source).toContain("setTouched(true);");
  });

  it("stays VOICE-clean on the describe-first surface", () => {
    const source = readFileSync(
      join(process.cwd(), "components/plan/PlanDescribeFirst.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/\u2014|\u2013/);
    for (const chip of DESCRIBE_FIRST_CHIPS) {
      expect(chip).not.toMatch(/\u2014|\u2013/);
      expect(chip).not.toMatch(/!/);
    }
    expect(source).toContain("Describe the outing");
    expect(source).toContain("Make a plan");
    expect(source).toContain("What&rsquo;s the plan?");
  });

  it("keeps the arrival action useful before the visitor types", () => {
    const source = readFileSync(
      join(process.cwd(), "components/plan/PlanDescribeFirst.tsx"),
      "utf8",
    );

    expect(source).not.toContain("disabled={!query.trim()}");
    expect(source).toContain("query.trim() ? submit() : onGuideMeInstead()");
    expect(source).toContain('{query.trim() ? "Make a plan" : "Guide me"}');
  });
});
