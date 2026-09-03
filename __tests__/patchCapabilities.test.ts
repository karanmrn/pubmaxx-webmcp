import { describe, expect, it } from "vitest";

import type { CapabilityAvailability } from "@/lib/cityCapabilities";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import {
  availabilityForCount,
  countPatchEvidence,
  derivePatchCapabilities,
  derivePatchProfile,
  derivePatchProfileFromCounts,
  PATCH_EVIDENCE_FLOORS,
  PATCH_FOOTPRINT_KM,
  patchIsLimited,
  patchTierLabel,
  summarisePatchEvidence,
  type PatchCapabilityKey,
  type PatchEvidenceCounts,
  type PatchPricedInput,
} from "@/lib/patchCapabilities";

const SOHO = NIGHT_PATCHES[0]; // 51.5136, -0.1365
const ASOF = "2026-07-03";

/** N priced venues sitting exactly on a patch centre (distance 0, always in). */
function pricedAt(
  patch: { lat: number; lng: number },
  n: number,
  extra: Partial<PatchPricedInput> = {},
): PatchPricedInput[] {
  return Array.from({ length: n }, () => ({
    lat: patch.lat,
    lng: patch.lng,
    cheapestPrice: 5.5,
    ...extra,
  }));
}

function counts(over: Partial<PatchEvidenceCounts> = {}): PatchEvidenceCounts {
  return { pricedVenues: 0, whatsOnRows: 0, foodVenues: 0, transportAnchors: 0, ...over };
}

describe("availabilityForCount — the evidence floor is the only gate", () => {
  const floors = { available: 10, limited: 1 };
  it("is available only at or above the available floor", () => {
    expect(availabilityForCount(10, floors)).toBe("available");
    expect(availabilityForCount(11, floors)).toBe("available");
  });
  it("is limited between the limited floor and one below available", () => {
    expect(availabilityForCount(1, floors)).toBe("limited");
    expect(availabilityForCount(9, floors)).toBe("limited");
  });
  it("is unavailable below the limited floor", () => {
    expect(availabilityForCount(0, floors)).toBe("unavailable");
  });
});

describe("countPatchEvidence — hermetic counts from fixture data", () => {
  it("counts only priced venues inside the footprint", () => {
    const near = pricedAt(SOHO, 3);
    const far: PatchPricedInput = { lat: 55.9, lng: -3.19, cheapestPrice: 4 }; // Edinburgh
    const unpriced: PatchPricedInput = { lat: SOHO.lat, lng: SOHO.lng, cheapestPrice: null };
    const out = countPatchEvidence(SOHO, { venues: [...near, far, unpriced] });
    expect(out.pricedVenues).toBe(3);
  });

  it("counts food/transport only for priced venues that carry the signal", () => {
    const out = countPatchEvidence(SOHO, {
      venues: [
        ...pricedAt(SOHO, 2, { filterHints: { amenities: { food: true } }, zone: 1 }),
        ...pricedAt(SOHO, 1, { filterHints: { amenities: { food: false } } }),
        // unpriced-with-food must NOT count toward food (needs a real price first)
        { lat: SOHO.lat, lng: SOHO.lng, cheapestPrice: null, filterHints: { amenities: { food: true } } },
      ],
    });
    expect(out.pricedVenues).toBe(3);
    expect(out.foodVenues).toBe(2);
    expect(out.transportAnchors).toBe(2);
  });

  it("excludes non-pub anchors from all pint evidence counts", () => {
    const out = countPatchEvidence(SOHO, {
      venues: [
        ...pricedAt(SOHO, 1),
        ...pricedAt(SOHO, 1, {
          kind: "pub",
          filterHints: { amenities: { food: true } },
          zone: 1,
        }),
        ...pricedAt(SOHO, 1, {
          kind: "bar",
          filterHints: { amenities: { food: true } },
          zone: 1,
        }),
        ...pricedAt(SOHO, 1, {
          kind: "food",
          filterHints: { amenities: { food: true } },
          zone: 1,
        }),
      ],
    });

    expect(out).toEqual({
      pricedVenues: 2,
      whatsOnRows: 0,
      foodVenues: 1,
      transportAnchors: 1,
    });
  });

  it("counts only coordinate-pinned listings inside the footprint (coordless never count)", () => {
    const out = countPatchEvidence(SOHO, {
      listings: [
        { lat: SOHO.lat, lng: SOHO.lng },
        { lat: SOHO.lat, lng: SOHO.lng },
        {}, // city-wide / coordless — not patch evidence
        { lat: 55.9, lng: -3.19 }, // far away
      ],
    });
    expect(out.whatsOnRows).toBe(2);
  });

  it("respects the footprint radius boundary", () => {
    // A point ~ PATCH_FOOTPRINT_KM north of the centre: ~0.0108 deg lat/km.
    const justInside = { lat: SOHO.lat + (PATCH_FOOTPRINT_KM - 0.05) / 111, lng: SOHO.lng };
    const justOutside = { lat: SOHO.lat + (PATCH_FOOTPRINT_KM + 0.2) / 111, lng: SOHO.lng };
    const out = countPatchEvidence(SOHO, {
      venues: [
        { ...justInside, cheapestPrice: 5 },
        { ...justOutside, cheapestPrice: 5 },
      ],
    });
    expect(out.pricedVenues).toBe(1);
  });
});

describe("derivePatchProfileFromCounts — threshold boundaries", () => {
  const F = PATCH_EVIDENCE_FLOORS;

  it("prices: at the floor is available, one below is limited, zero is unavailable", () => {
    expect(
      derivePatchProfileFromCounts("soho", "Soho", counts({ pricedVenues: F.prices.available }))
        .prices.availability,
    ).toBe("available");
    expect(
      derivePatchProfileFromCounts("soho", "Soho", counts({ pricedVenues: F.prices.available - 1 }))
        .prices.availability,
    ).toBe("limited");
    expect(
      derivePatchProfileFromCounts("soho", "Soho", counts({ pricedVenues: 0 })).prices.availability,
    ).toBe("unavailable");
  });

  it("release tier is core only when prices clear the available floor", () => {
    expect(
      derivePatchProfileFromCounts("soho", "Soho", counts({ pricedVenues: F.prices.available }))
        .releaseTier,
    ).toBe("core");
    expect(
      derivePatchProfileFromCounts("soho", "Soho", counts({ pricedVenues: F.prices.available - 1 }))
        .releaseTier,
    ).toBe("preview");
  });

  it("each capability crosses at exactly its own floor", () => {
    const keys: PatchCapabilityKey[] = ["prices", "whatsOn", "food", "transport"];
    const countField: Record<PatchCapabilityKey, keyof PatchEvidenceCounts> = {
      prices: "pricedVenues",
      whatsOn: "whatsOnRows",
      food: "foodVenues",
      transport: "transportAnchors",
    };
    for (const key of keys) {
      const atFloor = derivePatchProfileFromCounts(
        "x",
        "X",
        counts({ [countField[key]]: F[key].available } as Partial<PatchEvidenceCounts>),
      );
      const below = derivePatchProfileFromCounts(
        "x",
        "X",
        counts({ [countField[key]]: F[key].available - 1 } as Partial<PatchEvidenceCounts>),
      );
      expect(atFloor[key].availability).toBe("available");
      expect(below[key].availability).not.toBe("available");
    }
  });

  it("stamps dated evidence only when there is evidence", () => {
    const withData = derivePatchProfileFromCounts(
      "soho",
      "Soho",
      counts({ pricedVenues: 12 }),
      { asOf: ASOF },
    );
    expect(withData.prices.asOf).toBe(ASOF);
    const empty = derivePatchProfileFromCounts("soho", "Soho", counts({ pricedVenues: 0 }), {
      asOf: ASOF,
    });
    expect(empty.prices.asOf).toBeNull();
  });
});

describe("FENCE — no capability renders available without meeting its evidence floor", () => {
  it("holds across a wide count sweep for every patch and capability", () => {
    const keys: PatchCapabilityKey[] = ["prices", "whatsOn", "food", "transport"];
    const countField: Record<PatchCapabilityKey, keyof PatchEvidenceCounts> = {
      prices: "pricedVenues",
      whatsOn: "whatsOnRows",
      food: "foodVenues",
      transport: "transportAnchors",
    };
    for (let c = 0; c <= 40; c += 1) {
      for (const key of keys) {
        const profile = derivePatchProfileFromCounts(
          "p",
          "P",
          counts({ [countField[key]]: c } as Partial<PatchEvidenceCounts>),
        );
        const availability: CapabilityAvailability = profile[key].availability;
        if (availability === "available") {
          expect(c).toBeGreaterThanOrEqual(PATCH_EVIDENCE_FLOORS[key].available);
        }
      }
    }
  });

  it("derived-from-data profiles never claim available under the floor", () => {
    // 9 priced pubs (one below the prices floor of 10): must read limited, never
    // available, and the patch must be flagged limited.
    const profile = derivePatchProfile(SOHO, { venues: pricedAt(SOHO, 9) }, { asOf: ASOF });
    expect(profile.prices.availability).toBe("limited");
    expect(patchIsLimited(profile)).toBe(true);
  });
});

describe("derivePatchCapabilities — the whole coverage map", () => {
  it("derives a profile for every night patch", () => {
    const map = derivePatchCapabilities({ venues: pricedAt(SOHO, 12) });
    expect(Object.keys(map).sort()).toEqual(NIGHT_PATCHES.map((p) => p.id).sort());
    // Only Soho has the priced venues stacked on it; the rest are unmapped.
    expect(map.soho.releaseTier).toBe("core");
    expect(map.hackney.prices.availability).toBe("unavailable");
  });

  it("does NOT paint uniform coverage — patches differ by real data", () => {
    const map = derivePatchCapabilities({
      venues: [...pricedAt(NIGHT_PATCHES[0], 12), ...pricedAt(NIGHT_PATCHES[1], 3)],
    });
    expect(map[NIGHT_PATCHES[0].id].releaseTier).toBe("core");
    expect(map[NIGHT_PATCHES[1].id].releaseTier).toBe("preview");
    expect(map[NIGHT_PATCHES[2].id].prices.availability).toBe("unavailable");
  });
});

describe("summarisePatchEvidence — honest, plain, no em dashes", () => {
  it("leads with the real priced-pub count for a core patch", () => {
    const profile = derivePatchProfileFromCounts("soho", "Soho", counts({ pricedVenues: 12 }));
    const line = summarisePatchEvidence(profile);
    expect(line).toBe("12 priced pubs around Soho.");
  });

  it("names thin coverage honestly for a limited patch", () => {
    const profile = derivePatchProfileFromCounts("hackney", "Hackney", counts({ pricedVenues: 4 }));
    expect(summarisePatchEvidence(profile)).toBe("Only 4 priced pubs logged around Hackney yet.");
  });

  it("says nothing false when a patch is unmapped", () => {
    const profile = derivePatchProfileFromCounts("peckham", "Peckham", counts({ pricedVenues: 0 }));
    expect(summarisePatchEvidence(profile)).toBe("No priced pubs logged around Peckham yet.");
  });

  it("adds a listings/food clause only when asked and measured", () => {
    const profile = derivePatchProfileFromCounts(
      "soho",
      "Soho",
      counts({ pricedVenues: 12, whatsOnRows: 2, foodVenues: 9 }),
    );
    expect(summarisePatchEvidence(profile, { includeListings: true })).toBe(
      "12 priced pubs around Soho, thin on listings.",
    );
    expect(summarisePatchEvidence(profile, { includeFood: true })).toBe(
      "12 priced pubs around Soho, 9 with food.",
    );
  });

  it("never emits an em dash", () => {
    for (const n of [0, 1, 4, 10, 12]) {
      const profile = derivePatchProfileFromCounts("soho", "Soho", counts({ pricedVenues: n }));
      expect(summarisePatchEvidence(profile, { includeListings: true, includeFood: true })).not.toContain("—");
    }
  });
});

describe("tier helpers", () => {
  it("labels core vs lightly covered", () => {
    const core = derivePatchProfileFromCounts("soho", "Soho", counts({ pricedVenues: 12 }));
    const thin = derivePatchProfileFromCounts("soho", "Soho", counts({ pricedVenues: 3 }));
    expect(patchTierLabel(core)).toBe("Well covered");
    expect(patchTierLabel(thin)).toBe("Lightly covered");
    expect(patchIsLimited(core)).toBe(false);
    expect(patchIsLimited(thin)).toBe(true);
  });
});
