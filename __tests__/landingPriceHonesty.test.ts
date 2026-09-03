import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The landing page may not promise per-price DATES (F1).
//
// The counts it renders (`stats.pintPricesObserved`) come from the CURATED
// venue index, whose priced rows carry a SOURCE but no per-row observation
// date - the whole dataset shares one hand-maintained freshness stamp. Only two
// lanes are genuinely dated per row: community submissions (each stamped by the
// server clock at submit time) and the first-party drink_price_updates feed.
//
// Publisher attribution is narrower than "the row came from a dataset": some
// baseline rows have no publisher recorded. Landing copy must name that state
// instead of claiming that every figure names a publisher. Dating language
// remains scoped to the people-logged lane.

const LANDING = path.join(__dirname, "..", "components", "landing", "LandingPage.tsx");

/** Visible copy only - comments explain the rule and must not trip it. */
function landingCopy(): string {
  return readFileSync(LANDING, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
}

describe("landing price-provenance copy", () => {
  const copy = landingCopy();

  it("makes no blanket claim that prices are dated", () => {
    for (const untrue of [
      "each dated",
      "dated prices",
      "Every one dated",
      "every price has a date",
      "a source and a date",
      "a source and the date",
    ]) {
      expect(copy.toLowerCase()).not.toContain(untrue.toLowerCase());
    }
  });

  it("names publisher presence and absence without a blanket source claim", () => {
    const flat = copy.replace(/\s+/g, " ");
    expect(flat).toContain(
      "When a price record names a publisher, we name and link it.",
    );
    expect(flat).toContain(
      "When no publisher is recorded, the price says so.",
    );
    expect(copy).toContain('label: "prices on record"');
    expect(copy).toContain('label: "recorded prices"');
    expect(copy).not.toContain("Every price names where it came from");
    expect(copy).not.toContain("each sourced");
    expect(copy).not.toContain("sourced prices");
  });

  it("scopes what dating language remains to the people-logged lane", () => {
    // The two places the page still talks about a date now name WHO logged the
    // price in the same breath - the only lane where a per-row date exists.
    // (Rewrite the wording as you like; keep the scoping.)
    const flat = copy.replace(/\s+/g, " ");
    const lower = flat.toLowerCase();
    expect(lower).toContain("the ones logged by drinkers carry the day they were seen");
    expect(lower).toContain("the ones drinkers log come with the day they were seen");
  });
});

describe("landing outing beat (Wave S4)", () => {
  const copy = landingCopy();
  const flat = copy.replace(/\s+/g, " ");

  it("keeps one #why beat that names coffee, food, quiet Spoons, and AF jobs", () => {
    expect(copy).toContain('id="why"');
    expect(flat).toContain("Built for the bit before you set off.");
    expect(flat).toContain("Coffee and a quiet Spoons when the afternoon is the outing.");
    expect(flat).toContain("Food before the last train.");
    expect(flat).toContain(
      "Soft drink or alcohol-free with mates who are not drinking.",
    );
    expect(flat).toContain("We would rather leave a gap than invent a figure.");
    // One human beat, not a second mission statement stacked beside it.
    expect(copy.match(/id="why"/g)?.length).toBe(1);
    expect(copy.match(/lpWhySection/g)?.length).toBe(1);
  });

  it("links map, plan, and story from #why without fighting the hero CTA stack", () => {
    const whyBlock = copy.match(
      /id="why"[\s\S]*?lpWhyActions[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/,
    )?.[0];
    expect(whyBlock, "#why actions present").toBeTruthy();
    expect(whyBlock).toContain("Open the map");
    expect(whyBlock).toContain('href="/plan"');
    expect(whyBlock).toContain("Plan an outing");
    expect(whyBlock).toContain('planOccasionHref("coffee", { src: "landing-why" })');
    expect(whyBlock).toContain('planOccasionHref("af", { src: "landing-why" })');
    expect(whyBlock).toContain('planOccasionHref("chill", { src: "landing-why" })');
    expect(whyBlock).toContain('href="/about"');
    expect(whyBlock).toContain("Our story");
    // Hero stays map-first; #why must not promote a second primary button.
    expect(whyBlock).not.toMatch(/lpButtonPrimary/);
  });

  it("widens the memory beat to outings without fake counts or banned words", () => {
    const memoryBlock = copy.match(
      /id="memory-title"[\s\S]*?<\/section>/,
    )?.[0];
    expect(memoryBlock, "memory section present").toBeTruthy();
    const memoryFlat = String(memoryBlock).replace(/\s+/g, " ");
    expect(memoryFlat).toContain(
      "Plan the outing. Keep the parts that mattered.",
    );
    expect(memoryFlat).toContain(
      "Your outing stays private until you say otherwise.",
    );
    const whyBlock = flat.match(/id="why"[\s\S]*?<\/section>/)?.[0] ?? "";
    const voiceSurface = `${whyBlock} ${memoryFlat}`;
    expect(voiceSurface).not.toMatch(
      /\b(journey|unlock|seamless|curated|elevate|empower)\b/iu,
    );
    // Product-copy ban: no exclamation marks in the outing beats.
    expect(voiceSurface).not.toContain("!");
    expect(voiceSurface).not.toMatch(/thousands of|Discord|co-founder/iu);
  });
});

describe("ThamesHero drink pins stay category invites, not price claims", () => {
  const hero = readFileSync(
    path.join(__dirname, "..", "components", "landing", "ThamesHero.tsx"),
    "utf8",
  );

  it("prints no pound figure or price-lane field on a pin", () => {
    expect(hero).not.toMatch(/£\d/);
    expect(hero).not.toMatch(/\b(priceGbp|cheapestPrice|priceBand)\b/);
  });

  it("never opens a pin as a cheapest-first map arrival", () => {
    expect(hero).not.toMatch(/style:\s*["']cheapest["']/);
  });

  it("still invites beer as a category, not a ranked arrival", () => {
    expect(hero).toMatch(/query:\s*\{\s*drink:\s*"beer"\s*\}/);
  });
});

