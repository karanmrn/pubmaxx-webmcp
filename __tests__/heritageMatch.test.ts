import { describe, expect, it } from "vitest";

// The matcher is a plain .mjs build-lib (no .d.ts, matching the repo's other
// scripts/*.mjs); import it with types suppressed. Same pattern as the other
// .mjs-in-test imports (see historicIndex.test.ts).
// prettier-ignore
// @ts-expect-error -- untyped .mjs module (resolves fine at runtime under vitest)
import { evaluateMatch, bestMatch, coreTokens, normaliseName, buildFactText, buildingTypeWord, titleCaseName, hasPubMarker, haversineMeters, STRONG_MATCH_M, CONTAIN_MATCH_M } from "../scripts/lib/heritageMatch.mjs";

// A listed point sitting exactly on the pub, unless overridden.
const at = (name: string, grade: string, over: Record<string, unknown> = {}) => ({
  listEntry: 1000,
  name,
  grade,
  listDate: 0,
  lat: 51.5072,
  lng: -0.0511,
  ...over,
});
const PUB = { name: "The Prospect of Whitby", lat: 51.5071, lng: -0.0511 };

describe("normaliseName / coreTokens", () => {
  it("lowercases, drops apostrophes, brackets and punctuation", () => {
    expect(normaliseName("Druid's Head (Public House)")).toBe("druids head");
  });

  it("strips only generic tokens, keeping distinctive ones", () => {
    expect(coreTokens("THE DOVE PUBLIC HOUSE")).toEqual(["dove"]);
    // "arms" / "tavern" are distinctive and must survive.
    expect(coreTokens("The Freemasons Arms")).toEqual(["freemasons", "arms"]);
    expect(coreTokens("Wells Tavern")).toEqual(["wells", "tavern"]);
  });
});

describe("buildFactText / buildingTypeWord", () => {
  it("echoes only a building type named in the official listing", () => {
    expect(buildingTypeWord("THE GLOBE PUBLIC HOUSE")).toBe("public house");
    expect(buildingTypeWord("WELLS TAVERN")).toBe("tavern");
    expect(buildingTypeWord("THE GEORGE INN")).toBe("inn");
    // No type named -> honest generic "building", never invented.
    expect(buildingTypeWord("YE OLDE CHESHIRE CHEESE")).toBe("building");
  });

  it("builds a plain grade line with no em dash", () => {
    const fact = buildFactText("II", "THE GLOBE PUBLIC HOUSE");
    expect(fact).toBe("Grade II listed public house.");
    expect(fact).not.toContain("—");
  });

  it("returns null without a grade (no badge without data)", () => {
    expect(buildFactText("", "THE GLOBE PUBLIC HOUSE")).toBeNull();
    expect(buildFactText(null, "X")).toBeNull();
  });
});

describe("titleCaseName", () => {
  it("title-cases but preserves apostrophe-s and O'Nails", () => {
    expect(titleCaseName("DRUID'S HEAD PUBLIC HOUSE")).toBe("Druid's Head Public House");
    expect(titleCaseName("BAG O'NAILS PUBLIC HOUSE")).toBe("Bag O'nails Public House");
  });
});

describe("evaluateMatch — exact tier", () => {
  it("matches identical core names within the strong gate", () => {
    const r = evaluateMatch(PUB, at("PROSPECT OF WHITBY PUBLIC HOUSE", "II"));
    expect(r.matched).toBe(true);
    expect(r.tier).toBe("exact");
  });

  it("rejects an identical name beyond the strong distance gate", () => {
    // ~200 m north of the pub — past STRONG_MATCH_M.
    const far = at("PROSPECT OF WHITBY PUBLIC HOUSE", "II", { lat: 51.5090, lng: -0.0511 });
    expect(haversineMeters(PUB.lat, PUB.lng, far.lat, far.lng)).toBeGreaterThan(STRONG_MATCH_M);
    expect(evaluateMatch(PUB, far).matched).toBe(false);
  });

  it("never matches a listing with no grade", () => {
    expect(evaluateMatch(PUB, at("PROSPECT OF WHITBY PUBLIC HOUSE", "")).matched).toBe(false);
  });
});

describe("evaluateMatch — contained tier + guards", () => {
  // Two-token pub: the contained tier deliberately ignores single-token pub
  // names (too collision-prone), so the guard needs a >=2-token core.
  const pub = { name: "The Old Windmill", lat: 51.5, lng: -0.1 };

  it("accepts a pub-named subset of a longer pub listing when close", () => {
    const listing = at("THE OLD WINDMILL PUBLIC HOUSE AND RESTAURANT", "II", { lat: 51.5, lng: -0.1 });
    const r = evaluateMatch(pub, listing);
    expect(r.matched).toBe(true);
    expect(r.tier).toBe("contained");
  });

  it("rejects the contained tier past its tighter gate", () => {
    // ~80 m away — inside the strong gate but past CONTAIN_MATCH_M.
    const listing = at("THE OLD WINDMILL PUBLIC HOUSE AND RESTAURANT", "II", { lat: 51.50072, lng: -0.1 });
    expect(haversineMeters(pub.lat, pub.lng, listing.lat, listing.lng)).toBeGreaterThan(CONTAIN_MATCH_M);
    expect(evaluateMatch(pub, listing).matched).toBe(false);
  });

  it("rejects a subset match with no pub marker (a monument, not the pub)", () => {
    // "The High Cross" pub vs the "Tottenham High Cross" monument — real
    // false-positive this guard prevents.
    const highCross = { name: "The High Cross", lat: 51.6, lng: -0.07 };
    const monument = at("TOTTENHAM HIGH CROSS", "II", { lat: 51.6, lng: -0.07 });
    expect(hasPubMarker("TOTTENHAM HIGH CROSS")).toBe(false);
    expect(evaluateMatch(highCross, monument).matched).toBe(false);
  });
});

describe("evaluateMatch — structure denylist", () => {
  it("rejects the stables/gateway of a same-named pub", () => {
    const pub = { name: "The Duke of Hamilton", lat: 51.55, lng: -0.18 };
    const stables = at(
      "STABLES IN REAR YARD OF THE DUKE OF HAMILTON PUBLIC HOUSE (PUBLIC HOUSE NOT INCLUDED)",
      "II",
      { lat: 51.55, lng: -0.18 },
    );
    expect(evaluateMatch(pub, stables).matched).toBe(false);
  });

  it("still matches when the deny word is part of the pub's own name", () => {
    // "The Gate" pub vs "THE GATE PUBLIC HOUSE" — "gate" is the pub, not extra.
    const pub = { name: "The Gate", lat: 51.5, lng: -0.1 };
    const listing = at("THE GATE PUBLIC HOUSE", "II", { lat: 51.5, lng: -0.1 });
    expect(evaluateMatch(pub, listing).matched).toBe(true);
  });
});

describe("bestMatch", () => {
  it("picks the closest passing listing and ignores non-matches", () => {
    const pub = { name: "The Crown", lat: 51.5, lng: -0.1 };
    const near = at("THE CROWN PUBLIC HOUSE", "II", { listEntry: 2, lat: 51.50009, lng: -0.1 });
    const onIt = at("THE CROWN PUBLIC HOUSE", "II*", { listEntry: 1, lat: 51.5, lng: -0.1 });
    const other = at("THE ANCHOR PUBLIC HOUSE", "II", { listEntry: 3, lat: 51.5, lng: -0.1 });
    const best = bestMatch(pub, [near, other, onIt]);
    expect(best.listing.listEntry).toBe(1);
    expect(best.listing.grade).toBe("II*");
  });

  it("returns null when nothing matches", () => {
    const pub = { name: "The Nowhere", lat: 51.5, lng: -0.1 };
    expect(bestMatch(pub, [at("SOMETHING ELSE", "II")])).toBeNull();
  });
});
