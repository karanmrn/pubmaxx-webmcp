import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  resolvePlanningAnchor,
  type ResolvePlanningAnchorDeps,
  type ResolvePlanningAnchorInput,
} from "@/lib/planningAnchor.server";
import { ANCHOR_CONFLICT_CODES, planningAnchorConflict } from "@/lib/planningAnchor";
import type { Venue } from "@/lib/venues";

const NOW = Date.parse("2026-07-24T18:00:00.000Z");

// Soho coordinates so nearestNightPatch resolves to "soho" and the venue sits
// in a real London Night Area.
function fakeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-soho-anchor",
    name: "The Anchor Tavern",
    address: "1 Dean Street, Soho",
    latitude: 51.5136,
    longitude: -0.1365,
    primaryBorough: "Westminster",
    visibleBoroughs: ["Westminster"],
    prices: [],
    cheapestPrice: 5.2,
    cheapestPint: "Lager",
    averagePrice: 5.8,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...overrides,
  };
}

function baseInput(overrides: Partial<ResolvePlanningAnchorInput> = {}): ResolvePlanningAnchorInput {
  return {
    cityId: "london",
    venueId: "venue-soho-anchor",
    startsAt: "2026-07-24T20:00:00.000Z",
    acceptedArea: { kind: "night-patch", id: "soho" },
    now: NOW,
    ...overrides,
  };
}

function deps(venue: Venue | null, overrides: Partial<ResolvePlanningAnchorDeps> = {}): Partial<ResolvePlanningAnchorDeps> {
  return {
    loadVenue: async () => venue,
    resolveAlias: async (id) => id,
    matchesCity: () => true,
    ...overrides,
  };
}

describe("resolvePlanningAnchor — resolved anchor", () => {
  it("returns a canonical, privacy-safe anchor for an accepted Venue", async () => {
    const result = await resolvePlanningAnchor(baseInput(), deps(fakeVenue()));
    expect(result).toMatchObject({
      status: "resolved",
      display: {
        venueId: "venue-soho-anchor",
        venueName: "The Anchor Tavern",
        areaName: "Soho",
        startLabel: "2026-07-24T20:00:00.000Z",
        priceEvidence: { kind: "price", label: "£5.20", observedAt: null, freshnessKind: "dataset-generated" },
        budgetCompatible: true,
        accessibilityCompatible: true,
      },
      canonical: {
        cityId: "london",
        venueId: "venue-soho-anchor",
        acceptedArea: { kind: "night-patch", id: "soho" },
        coordinates: { lat: 51.5136, lng: -0.1365 },
        startsAt: "2026-07-24T20:00:00.000Z",
        priceFreshnessKind: "dataset-generated",
      },
    });
    if (result.status === "resolved") {
      expect(result.canonical.nightAreaSlug).toEqual(expect.any(String));
      expect(typeof result.display.routeWindowOk).toBe("boolean");
    }
  });

  it("recomputes price from a contributor drop as provider-observed", async () => {
    const venue = fakeVenue({
      latestContributorPrice: 4.9,
      latestContributorAt: "2026-07-23T21:00:00.000Z",
    });
    const result = await resolvePlanningAnchor(baseInput(), deps(venue));
    expect(result.status === "resolved" && result.display.priceEvidence).toMatchObject({
      label: "£4.90",
      observedAt: "2026-07-23T21:00:00.000Z",
      freshnessKind: "provider-observed",
    });
  });

  it("resolves an alias to the canonical Venue id", async () => {
    const result = await resolvePlanningAnchor(
      baseInput({ venueId: "legacy-alias" }),
      deps(fakeVenue({ id: "venue-soho-anchor" }), { resolveAlias: async () => "venue-soho-anchor" }),
    );
    expect(result.status === "resolved" && result.display.venueId).toBe("venue-soho-anchor");
  });

  it("drops the accepted date only when it is not canonical ISO", async () => {
    const result = await resolvePlanningAnchor(baseInput({ startsAt: "not-a-date" }), deps(fakeVenue()));
    expect(result.status === "resolved" && result.display.startLabel).toBeNull();
  });
});

describe("resolvePlanningAnchor — conflicts", () => {
  it("ANCHOR_VENUE_INVALID for a bad id or a missing Venue", async () => {
    expect(await resolvePlanningAnchor(baseInput({ venueId: "bad id!" }), deps(fakeVenue())))
      .toMatchObject({ status: "conflict", code: "ANCHOR_VENUE_INVALID" });
    expect(await resolvePlanningAnchor(baseInput(), deps(null)))
      .toMatchObject({ status: "conflict", code: "ANCHOR_VENUE_INVALID" });
  });

  it("ANCHOR_VENUE_INVALID for non-pub anchors before price checks", async () => {
    const result = await resolvePlanningAnchor(
      baseInput({ budgetPerPersonPence: 100 }),
      deps(fakeVenue({ kind: "bar", cheapestPrice: 20 })),
    );
    expect(result).toMatchObject({ status: "conflict", code: "ANCHOR_VENUE_INVALID" });
  });

  it("ANCHOR_CITY_MISMATCH when the Venue is not in the city", async () => {
    const result = await resolvePlanningAnchor(baseInput(), deps(fakeVenue(), { matchesCity: () => false }));
    expect(result).toMatchObject({ status: "conflict", code: "ANCHOR_CITY_MISMATCH" });
  });

  it("ANCHOR_PROMOTED for seeded demo content", async () => {
    const result = await resolvePlanningAnchor(
      baseInput(),
      deps(fakeVenue({ curation: { provenance: "demo" } })),
    );
    expect(result).toMatchObject({ status: "conflict", code: "ANCHOR_PROMOTED" });
  });

  it("ANCHOR_SAFETY_EXCLUDED when a reviewed exclusion applies", async () => {
    const result = await resolvePlanningAnchor(baseInput(), deps(fakeVenue(), { isSafetyExcluded: () => true }));
    expect(result).toMatchObject({ status: "conflict", code: "ANCHOR_SAFETY_EXCLUDED" });
  });

  it("ANCHOR_AREA_CONFLICT without widening the accepted area", async () => {
    const patchConflict = await resolvePlanningAnchor(
      baseInput({ acceptedArea: { kind: "night-patch", id: "brixton" } }),
      deps(fakeVenue()),
    );
    expect(patchConflict).toMatchObject({ status: "conflict", code: "ANCHOR_AREA_CONFLICT" });

    const boroughConflict = await resolvePlanningAnchor(
      baseInput({ acceptedArea: { kind: "borough", name: "Camden" } }),
      deps(fakeVenue({ primaryBorough: "Westminster", visibleBoroughs: ["Westminster"] })),
    );
    expect(boroughConflict).toMatchObject({ status: "conflict", code: "ANCHOR_AREA_CONFLICT" });
  });

  it("ANCHOR_OPENING_CONFLICT only when opening evidence says closed", async () => {
    const result = await resolvePlanningAnchor(baseInput(), deps(fakeVenue(), { openingForWindow: () => "closed" }));
    expect(result).toMatchObject({ status: "conflict", code: "ANCHOR_OPENING_CONFLICT" });
  });

  it("ANCHOR_BUDGET_CONFLICT when the cheapest known price is over budget", async () => {
    const result = await resolvePlanningAnchor(
      baseInput({ budgetPerPersonPence: 400 }),
      deps(fakeVenue({ cheapestPrice: 5.2 })),
    );
    expect(result).toMatchObject({ status: "conflict", code: "ANCHOR_BUDGET_CONFLICT" });
  });

  it("ANCHOR_ACCESS_CONFLICT when step-free access is required but not known", async () => {
    const result = await resolvePlanningAnchor(
      baseInput({ requiresStepFreeAccess: true }),
      deps(fakeVenue({ accessibility: undefined })),
    );
    expect(result).toMatchObject({ status: "conflict", code: "ANCHOR_ACCESS_CONFLICT" });

    const ok = await resolvePlanningAnchor(
      baseInput({ requiresStepFreeAccess: true }),
      deps(fakeVenue({ accessibility: { stepFree: true } })),
    );
    expect(ok.status).toBe("resolved");
  });

  it("ANCHOR_ROUTE_CONFLICT when no route context can be built", async () => {
    const result = await resolvePlanningAnchor(baseInput(), deps(fakeVenue(), { hasRouteContext: () => false }));
    expect(result).toMatchObject({ status: "conflict", code: "ANCHOR_ROUTE_CONFLICT" });
  });
});

describe("anchor conflict copy", () => {
  // Reader-visible since the composer started printing the server sentence for
  // an anchor conflict answered 200. "Venue", "Route", "Plan" and "Stop" are
  // our own nouns for a row, a derived path, a saved night and a position in
  // it, so a refusal that used them described our data model, not the night.
  it("says pub, plan and route in every conflict sentence", () => {
    for (const code of ANCHOR_CONFLICT_CODES) {
      const { message } = planningAnchorConflict(code);
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/\bVenue\b|\bRoute\b|\bPlan\b|\bStop\b/);
    }
  });
});
