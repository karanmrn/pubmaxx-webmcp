import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CULTURE_CRAWL_CHIPS, CULTURE_CRAWL_MISSION } from "@/lib/cultureCrawl";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

describe("Culture Crawl on the describe-first entry surface", () => {
  const source = read("components/plan/PlanDescribeFirst.tsx");

  it("renders the chips from the closed set, never a hand-typed copy", () => {
    expect(source).toContain("CULTURE_CRAWL_CHIPS.map");
    // Plan stop-count support routes chip taps through submitChip so the
    // inferred count reaches the composer with the closed query set.
    expect(source).toContain("onClick={() => submitChip(chip.query)}");
    expect(source).toContain("{chip.label}");
    for (const chip of CULTURE_CRAWL_CHIPS) {
      expect(source).not.toContain(chip.query);
      expect(source).not.toContain(`>${chip.label}<`);
    }
  });

  it("leads the lane with the mission and keeps the plain examples beside it", () => {
    expect(source).toContain("CULTURE_CRAWL_MISSION");
    expect(source).toContain("DESCRIBE_FIRST_CHIPS.map");
    expect(CULTURE_CRAWL_MISSION).not.toMatch(/free/i);
  });
});

describe("Culture Crawl on Tonight", () => {
  const source = read("app/tonight/TonightSoftPlansModule.tsx");

  it("links each chip by its closed id, not by pasted query text", () => {
    expect(source).toContain("CULTURE_CRAWL_CHIPS.map");
    expect(source).toContain('planOccasionHref(chip.id, { src: "tonight-culture" })');
    for (const chip of CULTURE_CRAWL_CHIPS) {
      expect(source).not.toContain(chip.query);
    }
  });

  it("keeps the soft occasions it already shipped", () => {
    expect(source).toContain("TONIGHT_SOFT_PLAN_CHIPS.map");
  });
});

describe("Culture Crawl opener in the route preview", () => {
  const composer = read("components/plan/PlanComposer.tsx");
  const opener = read("components/plan/PlanCultureOpener.tsx");

  it("reads the opener through the shared guard before rendering it", () => {
    expect(composer).toContain("cleanCultureOpener(body.cultureOpener)");
    expect(composer).toContain("<PlanCultureOpener opener={cultureOpener} />");
  });

  it("prints only the name, the category and the distance", () => {
    expect(opener).toContain("opener.waypoint.name");
    expect(opener).toContain("opener.waypoint.categoryLabel");
    expect(opener).toContain("opener.waypoint.distanceKm");
    expect(opener).toContain("{opener.note}");
  });

  it("never numbers the waypoint as a fourth Stop", () => {
    expect(opener).not.toContain("planComposer__number");
    expect(opener).not.toContain("planComposer__swap");
    expect(opener).not.toContain("planComposer__remove");
    // No figure of any kind rides beside a waypoint except its distance.
    expect(opener).not.toMatch(/£|Pence|pricePence/);
    // The one line this component owns outright. The dash ban is tree-wide
    // (__tests__/emDashLaw.test.ts); the exclamation ban is per copy string.
    expect(opener).toContain(">Before the first pint<");
    expect(opener).not.toMatch(/>[^<>{}\n]*![^<>{}\n]*</);
  });
});
