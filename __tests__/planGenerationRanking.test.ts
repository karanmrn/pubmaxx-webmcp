import { describe, expect, it } from "vitest";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { NightContext } from "@/lib/nightPlanning";
import {
  scoreVenueForPlan,
  WETHERSPOONS_DIRECTORY_PREFER_BOOST,
} from "@/lib/planGenerationRanking";

function venue(canonical: boolean, id?: string): ConciergeVenue {
  return {
    id: id ?? (canonical ? "canonical" : "non-canonical"),
    name: canonical ? "Canonical venue" : "Non-canonical venue",
    area: "Camden",
    lat: 51.54,
    lng: -0.14,
    cheapestPrice: null,
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
    },
    nearWater: false,
    hasStory: false,
    canonical,
  };
}

const AFTER_WORK_GROUP: NightContext = {
  nightArea: "camden",
  daypart: "after_work",
  partyType: "friends",
  groupSize: 8,
  budget: "standard",
  budgetLimitPence: null,
  zeroProof: false,
  wetherspoonsPreferred: false,
  atmosphere: [],
  foodNeeds: [],
  accessibility: [],
  transportConstraints: [],
};

describe("Plan generation ranking evidence", () => {
  it("generates the named alcohol-free drink in the route reason", () => {
    const alcoholFreeVenue = venue(true);
    alcoholFreeVenue.amenities.nonAlcoholic = true;

    const result = scoreVenueForPlan(
      alcoholFreeVenue,
      { ...AFTER_WORK_GROUP, zeroProof: true },
      0.5,
      [],
      [],
      null,
    );

    expect(result.reasons).toContain("confirmed alcohol-free option in the Venue Dataset");
    expect(result.reasons.join(" ")).not.toContain("0.0");
  });

  // A corroborated alcohol-free price is the same trust seam as pint pricing
  // (trustedNoAlcoholLensPrices), so zeroProof ranks it above a venue that
  // only carries the name-match amenity guess.
  it("corroborated-NA venue outranks an amenity-only venue under zeroProof", () => {
    const corroborated = venue(true);
    const amenityOnly = venue(false);
    amenityOnly.amenities.nonAlcoholic = true;
    const naLensPrices: ReadonlyMap<string, MapLensPrice> = new Map([
      [
        corroborated.id,
        {
          venueId: corroborated.id,
          category: "alcohol-free",
          categoryLabel: "Alcohol-free",
          priceGbp: 3,
          source: "community",
        },
      ],
    ]);

    const corroboratedResult = scoreVenueForPlan(
      corroborated,
      { ...AFTER_WORK_GROUP, zeroProof: true },
      0.5,
      [],
      [],
      null,
      naLensPrices,
    );
    const amenityOnlyResult = scoreVenueForPlan(
      amenityOnly,
      { ...AFTER_WORK_GROUP, zeroProof: true },
      0.5,
      [],
      [],
      null,
      naLensPrices,
    );

    expect(corroboratedResult.score).toBeGreaterThan(amenityOnlyResult.score);
    expect(corroboratedResult.reasons.join(" ")).toContain("corroborated alcohol-free price");
  });

  it("does not penalise a venue with neither a corroborated NA price nor the amenity signal, versus an evidence-less peer", () => {
    const neither = venue(true);
    const alsoNeither = venue(false);

    const a = scoreVenueForPlan(neither, { ...AFTER_WORK_GROUP, zeroProof: true }, 0.5, [], [], null);
    const b = scoreVenueForPlan(alsoNeither, { ...AFTER_WORK_GROUP, zeroProof: true }, 0.5, [], [], null);

    expect(a.score).toBe(b.score);
  });

  it("does not let canonical status imply after-work reliability or group capacity", () => {
    const canonical = scoreVenueForPlan(venue(true), AFTER_WORK_GROUP, 0.5, [], [], null);
    const nonCanonical = scoreVenueForPlan(venue(false), AFTER_WORK_GROUP, 0.5, [], [], null);

    expect(canonical.score).toBe(nonCanonical.score);
    expect(canonical.reasons).toEqual(nonCanonical.reasons);
    expect(canonical.reasons.join(" ")).not.toMatch(/reliable after-work|safer pick|bigger group|capacity/i);
  });

  it("soft-boosts a directory-matched Spoons when preferred, without inventing a price", () => {
    const matched = venue(true, "ice-wharf");
    const unmatched = venue(false, "local-indie");
    const matchedIds = new Set(["ice-wharf"]);
    const preferred = { ...AFTER_WORK_GROUP, wetherspoonsPreferred: true };

    const boosted = scoreVenueForPlan(matched, preferred, 0.5, [], [], null, undefined, matchedIds);
    const plain = scoreVenueForPlan(unmatched, preferred, 0.5, [], [], null, undefined, matchedIds);

    expect(boosted.score - plain.score).toBe(WETHERSPOONS_DIRECTORY_PREFER_BOOST);
    expect(boosted.reasons).toContain("matched the first-party J D Wetherspoon directory");
    expect(boosted.reasons.join(" ")).not.toMatch(/£|pence|price/i);
    expect(plain.reasons.join(" ")).not.toMatch(/Wetherspoon/i);
  });

  it("does not boost an unmatched venue, or any venue when prefer is off", () => {
    const matched = venue(true, "ice-wharf");
    const matchedIds = new Set(["ice-wharf"]);

    const preferOff = scoreVenueForPlan(
      matched,
      AFTER_WORK_GROUP,
      0.5,
      [],
      [],
      null,
      undefined,
      matchedIds,
    );
    const preferOnUnmatched = scoreVenueForPlan(
      matched,
      { ...AFTER_WORK_GROUP, wetherspoonsPreferred: true },
      0.5,
      [],
      [],
      null,
      undefined,
      new Set(),
    );

    expect(preferOff.score).toBe(preferOnUnmatched.score);
    expect(preferOff.reasons.join(" ")).not.toMatch(/Wetherspoon/i);
    expect(preferOnUnmatched.reasons.join(" ")).not.toMatch(/Wetherspoon/i);
  });
});
