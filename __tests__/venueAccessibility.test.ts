import { describe, expect, it } from "vitest";

import {
  ACCESSIBILITY_FACET_LABELS,
  accessibilityChipLabels,
  accessibilityFilterSummary,
  anyAccessibilityFilterActive,
  EMPTY_ACCESSIBILITY_FILTERS,
  hasKnownAccessibility,
  hasQuietHours,
  isKnownAccessibleToilet,
  isKnownSeatedService,
  isKnownStepFree,
  knownAccessibilityFacets,
  matchesAccessibilityFilters,
  quietHoursLabel,
  type VenueAccessibility,
} from "@/lib/venueAccessibility";
import { groupVenuePrices, type Venue } from "@/lib/venues";
import {
  ACCESSIBILITY_SEED_COUNT,
  getVenueAccessibility,
} from "@/lib/venueAccessibilitySeeds";

// Minimal Venue factory: only the `accessibility` block matters to these units.
function venueWith(accessibility?: VenueAccessibility): Venue {
  return { accessibility } as unknown as Venue;
}

describe("accessibility predicates (unknown is never a yes)", () => {
  it("treats an absent accessibility block as UNKNOWN, not false-yes", () => {
    const v = venueWith(undefined);
    expect(isKnownStepFree(v)).toBe(false);
    expect(isKnownAccessibleToilet(v)).toBe(false);
    expect(isKnownSeatedService(v)).toBe(false);
    expect(hasKnownAccessibility(v)).toBe(false);
  });

  it("only reports a facet KNOWN true", () => {
    expect(isKnownStepFree(venueWith({ stepFree: true }))).toBe(true);
    // A documented NEGATIVE is known-false — still not a step-free yes.
    expect(isKnownStepFree(venueWith({ stepFree: false }))).toBe(false);
    // An undefined facet is unknown — not a yes.
    expect(isKnownStepFree(venueWith({ accessibleToilet: true }))).toBe(false);
  });

  it("hasQuietHours only for a non-empty published note", () => {
    expect(hasQuietHours(venueWith({ quietHours: "Quieter before 5pm" }))).toBe(true);
    expect(hasQuietHours(venueWith({ quietHours: "   " }))).toBe(false);
    expect(hasQuietHours(venueWith({}))).toBe(false);
  });
});

describe("matchesAccessibilityFilters — unknown FAILS a positive filter", () => {
  it("all-off is a no-op (every venue passes)", () => {
    expect(matchesAccessibilityFilters(venueWith(undefined), EMPTY_ACCESSIBILITY_FILTERS)).toBe(
      true,
    );
  });

  it("step-free filter shows only pubs KNOWN step-free", () => {
    const filters = { ...EMPTY_ACCESSIBILITY_FILTERS, stepFree: true };
    expect(matchesAccessibilityFilters(venueWith({ stepFree: true }), filters)).toBe(true);
    // Unknown fails.
    expect(matchesAccessibilityFilters(venueWith(undefined), filters)).toBe(false);
    // Documented-false fails (never optimistically included).
    expect(matchesAccessibilityFilters(venueWith({ stepFree: false }), filters)).toBe(false);
  });

  it("combines filters with AND — must know ALL active facets", () => {
    const filters = { stepFree: true, accessibleToilet: true, seatedService: false };
    expect(
      matchesAccessibilityFilters(venueWith({ stepFree: true, accessibleToilet: true }), filters),
    ).toBe(true);
    // Missing one of the two required facts → excluded.
    expect(matchesAccessibilityFilters(venueWith({ stepFree: true }), filters)).toBe(false);
  });
});

describe("display helpers", () => {
  it("chip labels list only known-true facets, in order", () => {
    const v = venueWith({ stepFree: true, accessibleToilet: false, seatedService: true });
    expect(knownAccessibilityFacets(v)).toEqual(["stepFree", "seatedService"]);
    expect(accessibilityChipLabels(v)).toEqual([
      ACCESSIBILITY_FACET_LABELS.stepFree,
      ACCESSIBILITY_FACET_LABELS.seatedService,
    ]);
  });

  it("never emits a chip for an unknown or documented-false facet", () => {
    expect(accessibilityChipLabels(venueWith({ stepFree: false }))).toEqual([]);
    expect(accessibilityChipLabels(venueWith(undefined))).toEqual([]);
  });

  it("quietHoursLabel trims and returns null when absent", () => {
    expect(quietHoursLabel(venueWith({ quietHours: " Quieter before 5pm " }))).toBe(
      "Quieter before 5pm",
    );
    expect(quietHoursLabel(venueWith({}))).toBeNull();
  });
});

describe("accessibilityFilterSummary — honest, non-broken framing", () => {
  it("returns null when no filter is active", () => {
    expect(accessibilityFilterSummary(EMPTY_ACCESSIBILITY_FILTERS, 0)).toBeNull();
    expect(anyAccessibilityFilterActive(EMPTY_ACCESSIBILITY_FILTERS)).toBe(false);
  });

  it("frames a small count as 'help by spilling', not an error", () => {
    const summary = accessibilityFilterSummary(
      { ...EMPTY_ACCESSIBILITY_FILTERS, stepFree: true },
      3,
    );
    expect(summary).toContain("confirmed step-free entry");
    expect(summary).toContain("3 confirmed so far");
    expect(summary).toContain("help by spilling what you know");
  });

  it("lists multiple active facets grammatically", () => {
    const summary = accessibilityFilterSummary(
      { stepFree: true, accessibleToilet: true, seatedService: true },
      0,
    );
    expect(summary).toContain(
      "step-free entry, accessible toilet and seated service",
    );
  });
});

describe("curated seed — honest, sourced, lands on the real dataset", () => {
  it("keeps a small curated seed (community model, not fabricated at scale)", () => {
    // A handful of documented pubs — never hundreds of guessed ones.
    expect(ACCESSIBILITY_SEED_COUNT).toBeGreaterThan(0);
    expect(ACCESSIBILITY_SEED_COUNT).toBeLessThanOrEqual(15);
  });

  it("returns undefined (UNKNOWN) for a pub not in the seed", () => {
    expect(getVenueAccessibility("Some Unseeded Tavern", "Camden")).toBeUndefined();
  });

  it("The Crosse Keys is documented NOT step-free (honest negative)", () => {
    const facts = getVenueAccessibility("The Crosse Keys", "City of London");
    expect(facts?.stepFree).toBe(false);
    expect(facts?.accessibleToilet).toBe(true);
  });

  it("The Ice Wharf is documented step-free", () => {
    const facts = getVenueAccessibility("The Ice Wharf - JD Wetherspoon", "Camden");
    expect(facts?.stepFree).toBe(true);
    // accessible toilet was only weakly sourced → deliberately left UNKNOWN.
    expect(facts?.accessibleToilet).toBeUndefined();
  });

  it("borough guard keeps a pinned seed off the wrong-borough pub", () => {
    // The Coronet seed is pinned to Islington.
    expect(getVenueAccessibility("The Coronet", "Islington")?.stepFree).toBe(true);
    expect(getVenueAccessibility("The Coronet", "Westminster")).toBeUndefined();
  });
});

describe("integration: groupVenuePrices attaches only seeded accessibility", () => {
  const baseRow = {
    app_price_id: "p1",
    pint_name: "Lager",
    price_gbp: 5,
    price_text: "£5",
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: "",
    food: "",
    cocktails: "",
    beer_garden: "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    source_datasets: "",
    source_row_count: 1,
    has_visible_borough_row: true,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
  };

  it("a seeded pub gets its documented facts; an unseeded one stays unknown", () => {
    const [seeded] = groupVenuePrices([
      {
        ...baseRow,
        pub_name: "The Ice Wharf - JD Wetherspoon",
        address: "28A Jamestown Rd",
        latitude: 51.54,
        longitude: -0.14,
        primary_borough: "Camden",
      },
    ]);
    expect(seeded.accessibility?.stepFree).toBe(true);

    const [unseeded] = groupVenuePrices([
      {
        ...baseRow,
        pub_name: "The Totally Made Up Arms",
        address: "1 Nowhere St",
        latitude: 51.5,
        longitude: -0.1,
        primary_borough: "Camden",
      },
    ]);
    expect(unseeded.accessibility).toBeUndefined();
  });
});
