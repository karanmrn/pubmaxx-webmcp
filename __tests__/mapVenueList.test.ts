import { describe, it, expect } from "vitest";

import { drinkLensPriceNoun } from "@/lib/mapExperienceLens";
import {
  buildMapVenueListModel,
  buildUkBasePubListModel,
  projectedItemIdsInViewport,
  MAP_VENUE_LIST_LIMIT,
} from "@/lib/mapVenueList";
import type { UkBasePub } from "@/lib/ukBasePubs";
import type { Venue } from "@/lib/venues";

// Minimal Venue factory — only the fields the list model reads matter.
function venue(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Pub ${overrides.id}`,
    latitude: 51.5,
    longitude: -0.12,
    cheapestPrice: null,
    ...overrides,
  } as Venue;
}

describe("buildMapVenueListModel — the list-toggle gate", () => {
  it("is honest-empty on no venues (empty list, no truncation)", () => {
    const model = buildMapVenueListModel([], [-0.12, 51.5]);
    expect(model.rows).toEqual([]);
    expect(model.total).toBe(0);
    expect(model.shown).toBe(0);
    expect(model.truncated).toBe(false);
  });

  it("reports the full on-map total when under the cap", () => {
    const venues = [venue({ id: "a" }), venue({ id: "b" }), venue({ id: "c" })];
    const model = buildMapVenueListModel(venues, null);
    expect(model.total).toBe(3);
    expect(model.shown).toBe(3);
    expect(model.truncated).toBe(false);
  });

  it("keeps every in-view venue keyboard-reachable by default", () => {
    const venues = Array.from({ length: MAP_VENUE_LIST_LIMIT + 5 }, (_, i) =>
      venue({ id: `v${i}` }),
    );
    const model = buildMapVenueListModel(venues, [-0.12, 51.5]);
    expect(model.total).toBe(MAP_VENUE_LIST_LIMIT + 5);
    expect(model.shown).toBe(MAP_VENUE_LIST_LIMIT + 5);
    expect(model.rows).toHaveLength(MAP_VENUE_LIST_LIMIT + 5);
    expect(model.truncated).toBe(false);
  });

  it("honours a custom limit", () => {
    const venues = [venue({ id: "a" }), venue({ id: "b" }), venue({ id: "c" })];
    const model = buildMapVenueListModel(venues, null, 2);
    expect(model.shown).toBe(2);
    expect(model.truncated).toBe(true);
  });
});

describe("projectedItemIdsInViewport", () => {
  it("excludes a geographic bounds corner projected off a pitched, rotated map", () => {
    const rows = [
      { id: "centre", screen: { x: 500, y: 300 } },
      // Inside map.getBounds(), but outside the rendered quadrilateral once
      // pitch and bearing project this north-east corner past the canvas edge.
      { id: "bbox-corner", screen: { x: 1040, y: -35 } },
      { id: "edge", screen: { x: 1000, y: 600 } },
    ];

    expect(
      projectedItemIdsInViewport(
        rows,
        (row) => row.screen,
        { width: 1000, height: 600 },
      ),
    ).toEqual(["centre", "edge"]);
  });

  it("rejects non-finite projection results", () => {
    expect(
      projectedItemIdsInViewport(
        [
          { id: "valid", screen: { x: 1, y: 1 } },
          { id: "invalid", screen: { x: Number.NaN, y: 1 } },
        ],
        (row) => row.screen,
        { width: 10, height: 10 },
      ),
    ).toEqual(["valid"]);
  });

  it("recomputes loaded base-pub membership immediately after a disjoint pan", () => {
    const pubs = [{ id: "old-view" }, { id: "new-view" }];
    const oldProjection = new Map([
      ["old-view", { x: 30, y: 30 }],
      ["new-view", { x: 900, y: 30 }],
    ]);
    const newProjection = new Map([
      ["old-view", { x: -900, y: 30 }],
      ["new-view", { x: 30, y: 30 }],
    ]);
    const viewport = { width: 100, height: 100 };

    expect(
      projectedItemIdsInViewport(
        pubs,
        (pub) => oldProjection.get(pub.id)!,
        viewport,
      ),
    ).toEqual(["old-view"]);
    expect(
      projectedItemIdsInViewport(
        pubs,
        (pub) => newProjection.get(pub.id)!,
        viewport,
      ),
    ).toEqual(["new-view"]);
  });
});

describe("buildMapVenueListModel — ordering (mirrors the eye)", () => {
  it("orders nearest-first to the viewport centre and carries a distance", () => {
    const near = venue({ id: "near", latitude: 51.5, longitude: -0.12 });
    const far = venue({ id: "far", latitude: 51.7, longitude: -0.4 });
    // Input order is far, near — the model must re-sort to near, far.
    const model = buildMapVenueListModel([far, near], [-0.12, 51.5]);
    expect(model.rows.map((r) => r.id)).toEqual(["near", "far"]);
    expect(typeof model.rows[0].distanceKm).toBe("number");
    expect(model.rows[0].distanceKm!).toBeLessThan(model.rows[1].distanceKm!);
  });

  it("preserves filtered map order and omits distance without a viewport fix", () => {
    const model = buildMapVenueListModel(
      [venue({ id: "a" }), venue({ id: "b" })],
      null,
    );
    expect(model.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(model.rows[0].distanceKm).toBeUndefined();
  });

  it("treats a non-finite viewport centre as no fix (no crash, input order)", () => {
    const model = buildMapVenueListModel(
      [venue({ id: "a" }), venue({ id: "b" })],
      [Number.NaN, 51.5],
    );
    expect(model.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(model.rows[0].distanceKm).toBeUndefined();
  });

  it("defaults to nearest even when cheaper pubs sit farther away", () => {
    const nearDear = venue({
      id: "near-dear",
      latitude: 51.5,
      longitude: -0.12,
      cheapestPrice: 7.5,
    });
    const farCheap = venue({
      id: "far-cheap",
      latitude: 51.7,
      longitude: -0.4,
      cheapestPrice: 4.2,
    });
    const model = buildMapVenueListModel(
      [farCheap, nearDear],
      [-0.12, 51.5],
      undefined,
      null,
      "this view",
      "ready",
      "nearest",
    );
    expect(model.rows.map((r) => r.id)).toEqual(["near-dear", "far-cheap"]);
  });

  it("cheapest sort ranks priced pubs ascending and leaves unpriced last", () => {
    const nearDear = venue({
      id: "near-dear",
      name: "Near Dear",
      latitude: 51.5,
      longitude: -0.12,
      cheapestPrice: 7.5,
    });
    const farCheap = venue({
      id: "far-cheap",
      name: "Far Cheap",
      latitude: 51.7,
      longitude: -0.4,
      cheapestPrice: 4.2,
    });
    const midUnpriced = venue({
      id: "mid-unpriced",
      name: "Mid Unpriced",
      latitude: 51.55,
      longitude: -0.2,
      cheapestPrice: null,
    });
    const farUnpriced = venue({
      id: "far-unpriced",
      name: "Far Unpriced",
      latitude: 51.75,
      longitude: -0.45,
      cheapestPrice: null,
    });
    const model = buildMapVenueListModel(
      [nearDear, farUnpriced, midUnpriced, farCheap],
      [-0.12, 51.5],
      undefined,
      null,
      "this view",
      "ready",
      "cheapest",
    );
    expect(model.rows.map((r) => r.id)).toEqual([
      "far-cheap",
      "near-dear",
      "mid-unpriced",
      "far-unpriced",
    ]);
    expect(model.rows.find((r) => r.id === "mid-unpriced")?.priceLabel).toBe(
      "Price TBD",
    );
  });

  it("cheapest sort uses active drink lens prices, not the pint baseline", () => {
    const softCheap = venue({
      id: "soft-cheap",
      latitude: 51.5,
      longitude: -0.12,
      cheapestPrice: 9,
    });
    const softDear = venue({
      id: "soft-dear",
      latitude: 51.51,
      longitude: -0.13,
      cheapestPrice: 3,
    });
    const noSoft = venue({
      id: "no-soft",
      latitude: 51.505,
      longitude: -0.125,
      cheapestPrice: 2,
    });
    const model = buildMapVenueListModel(
      [softDear, noSoft, softCheap],
      [-0.12, 51.5],
      MAP_VENUE_LIST_LIMIT,
      new Map([
        [
          "soft-cheap",
          {
            venueId: "soft-cheap",
            category: "soft-drink",
            categoryLabel: "Soft drink",
            priceGbp: 2.4,
            submittedAt: 2_000,
            source: "community",
          },
        ],
        [
          "soft-dear",
          {
            venueId: "soft-dear",
            category: "soft-drink",
            categoryLabel: "Soft drink",
            priceGbp: 4.8,
            submittedAt: 2_000,
            source: "community",
          },
        ],
      ]),
      "Soft drink",
      "ready",
      "cheapest",
    );
    expect(model.rows.map((r) => r.id)).toEqual([
      "soft-cheap",
      "soft-dear",
      "no-soft",
    ]);
    expect(model.rows[2].priceLabel).toBe("No soft drink price logged");
  });

  it("cheapest sort prefers map-authority contributor price over the baseline", () => {
    const baselineCheap = venue({
      id: "baseline-cheap",
      latitude: 51.5,
      longitude: -0.12,
      cheapestPrice: 4,
      latestContributorPrice: null,
    });
    const contributorCheaper = venue({
      id: "contributor-cheaper",
      latitude: 51.51,
      longitude: -0.13,
      cheapestPrice: 6,
      latestContributorPrice: null,
    });
    const venueSignals = new Map([
      [
        "contributor-cheaper",
        { hasPintDrops: true, latestContributorPrice: 3.5 },
      ],
    ]);
    const model = buildMapVenueListModel(
      [baselineCheap, contributorCheaper],
      [-0.12, 51.5],
      undefined,
      null,
      "this view",
      "ready",
      "cheapest",
      venueSignals,
    );
    expect(model.rows.map((r) => r.id)).toEqual([
      "contributor-cheaper",
      "baseline-cheap",
    ]);
    expect(model.rows[0].priceLabel).toBe("£3.50");
  });

  it("ignores venue.latestContributorPrice when venueSignals is the map authority", () => {
    const staleOnVenue = venue({
      id: "stale-on-venue",
      latitude: 51.5,
      longitude: -0.12,
      cheapestPrice: 5,
      latestContributorPrice: 2.5,
    });
    const model = buildMapVenueListModel(
      [staleOnVenue],
      [-0.12, 51.5],
      undefined,
      null,
      "this view",
      "ready",
      "nearest",
      null,
    );
    expect(model.rows[0].priceLabel).toBe("£5.00");
  });

  it("cheapest sort order matches the visible pint price label from venueSignals", () => {
    const dearBaseline = venue({
      id: "dear-baseline",
      latitude: 51.5,
      longitude: -0.12,
      cheapestPrice: 8,
    });
    const cheapViaSignal = venue({
      id: "cheap-via-signal",
      latitude: 51.51,
      longitude: -0.13,
      cheapestPrice: 7,
    });
    const venueSignals = new Map([
      ["cheap-via-signal", { hasPintDrops: false, latestContributorPrice: 3.2 }],
    ]);
    const model = buildMapVenueListModel(
      [dearBaseline, cheapViaSignal],
      [-0.12, 51.5],
      undefined,
      null,
      "this view",
      "ready",
      "cheapest",
      venueSignals,
    );
    expect(model.rows.map((r) => r.id)).toEqual([
      "cheap-via-signal",
      "dear-baseline",
    ]);
    expect(model.rows[0].priceLabel).toBe("£3.20");
    expect(model.rows[1].priceLabel).toBe("£8.00");
  });
});

describe("buildMapVenueListModel — selection wiring + labels", () => {
  it("carries the real venue id every row's select handler needs", () => {
    const model = buildMapVenueListModel(
      [venue({ id: "abc-123", name: "The Test Arms" })],
      null,
    );
    expect(model.rows[0].id).toBe("abc-123");
    expect(model.rows[0].name).toBe("The Test Arms");
  });

  it("formats an honest price label (known price vs TBD)", () => {
    const model = buildMapVenueListModel(
      [
        venue({ id: "priced", cheapestPrice: 4.5 }),
        venue({ id: "unknown", cheapestPrice: null }),
      ],
      null,
    );
    const byId = new Map(model.rows.map((r) => [r.id, r.priceLabel]));
    expect(byId.get("priced")).toBe("£4.50");
    expect(byId.get("unknown")).toBe("Price TBD");
  });

  it("replaces pint figures with dedicated lens prices or honest silence", () => {
    const model = buildMapVenueListModel(
      [
        venue({ id: "soft", cheapestPrice: 6.2 }),
        venue({ id: "unknown", cheapestPrice: 5.8 }),
      ],
      null,
      MAP_VENUE_LIST_LIMIT,
      new Map([
        ["soft", {
          venueId: "soft",
          category: "soft-drink",
          categoryLabel: "Soft drink",
          priceGbp: 3.2,
          submittedAt: 2_000,
          source: "community",
        }],
      ]),
      "Whisky",
    );
    const byId = new Map(model.rows.map((row) => [row.id, row.priceLabel]));
    expect(byId.get("soft")).toBe("Soft drink · £3.20");
    expect(byId.get("unknown")).toBe("No whisky price logged");
  });

  it("carries venue kind and accessible type labels", () => {
    const model = buildMapVenueListModel(
      [
        venue({ id: "legacy" }),
        venue({ id: "bar", kind: "bar" }),
        venue({ id: "food", kind: "food" }),
      ],
      null,
    );
    const byId = new Map(model.rows.map((row) => [row.id, row]));
    expect(byId.get("legacy")).toMatchObject({ typeLabel: "Pub" });
    expect(byId.get("bar")).toMatchObject({
      kind: "bar",
      typeLabel: "Bar",
    });
    expect(byId.get("food")).toMatchObject({
      kind: "food",
      typeLabel: "Late food",
    });
  });

  it("carries complete non-pub anchor provenance with the compact price", () => {
    const model = buildMapVenueListModel(
      [
        venue({
          id: "bar",
          kind: "bar",
          cheapestPrice: 18,
          anchorLabel: "House cocktail",
          anchorObservedAt: "2025-07-26",
          anchorSourceUrl: "https://www.bar.example/menu",
        }),
      ],
      null,
    );

    expect(model.rows[0]).toMatchObject({
      priceLabel: "£18.00",
      anchor: {
        label: "House cocktail",
        observedLabel: "Jul 2025",
        sourceLabel: "bar.example",
        sourceUrl: "https://www.bar.example/menu",
      },
    });
  });

  it("does not expose a bare non-pub price without complete provenance", () => {
    const model = buildMapVenueListModel(
      [venue({ id: "bar", kind: "bar", cheapestPrice: 18 })],
      null,
    );

    expect(model.rows[0]).toMatchObject({
      priceLabel: "Price TBD",
      anchor: null,
    });
  });
});

describe("buildUkBasePubListModel", () => {
  const basePubs: UkBasePub[] = [
    {
      id: "venue-uk-n-far",
      name: "Far Arms",
      address: "",
      lat: 53.9,
      lng: -1.8,
      curatedVenueId: "",
    },
    {
      id: "venue-uk-n-near",
      name: "Near Arms",
      address: "",
      lat: 53.8008,
      lng: -1.5491,
      curatedVenueId: "",
    },
  ];

  it("keeps rendered base pubs separate, bounded, and nearest-first", () => {
    const model = buildUkBasePubListModel(basePubs, [-1.5491, 53.8008], 1);

    expect(model.total).toBe(2);
    expect(model.shown).toBe(1);
    expect(model.truncated).toBe(true);
    expect(model.rows[0]).toMatchObject({
      id: "venue-uk-n-near",
      name: "Near Arms",
      priceLabel: "Other pub · no listed price",
      pub: basePubs[1],
    });
  });
});

describe("buildMapVenueListModel — the accessible parallel to the pins", () => {
  const lensPrices = new Map();

  it("says nothing extra when the drink index answered in full", () => {
    const model = buildMapVenueListModel(
      [venue({ id: "unknown", cheapestPrice: 5.8 })],
      null,
      MAP_VENUE_LIST_LIMIT,
      lensPrices,
      "Whisky",
      "ready",
    );
    expect(model.coverageNote).toBeNull();
    expect(model.rows[0].priceLabel).toBe("No whisky price logged");
  });

  it("never tells a non-visual reader a failed read was an empty city", () => {
    // The row is often read on its own, so BOTH it and the note have to carry
    // the finding: sighted users get the visible note either way.
    const model = buildMapVenueListModel(
      [venue({ id: "unknown", cheapestPrice: 5.8 })],
      null,
      MAP_VENUE_LIST_LIMIT,
      lensPrices,
      "Whisky",
      "degraded",
    );
    expect(model.coverageNote).toContain("could not read the whisky prices");
    expect(model.rows[0].priceLabel).toBe("Whisky price could not be read");
    expect(model.rows[0].priceLabel).not.toContain("logged");
  });

  it("keeps a truncated-but-successful read out of the failure wording", () => {
    const model = buildMapVenueListModel(
      [venue({ id: "unknown", cheapestPrice: 5.8 })],
      null,
      MAP_VENUE_LIST_LIMIT,
      lensPrices,
      "Whisky",
      "partial",
    );
    expect(model.coverageNote).toContain("part of the whisky prices");
    expect(model.coverageNote).not.toContain("could not");
    expect(model.rows[0].priceLabel).toBe("No whisky price in what we read");
  });

  it("uses a coffee noun for unknown rows and coverage, never pint wording", () => {
    const noun = drinkLensPriceNoun("coffee");
    const model = buildMapVenueListModel(
      [venue({ id: "unknown", cheapestPrice: 5.8 })],
      null,
      MAP_VENUE_LIST_LIMIT,
      new Map(),
      noun,
      "ready",
    );
    expect(model.rows[0].priceLabel).toBe("No coffee price logged");
    expect(model.coverageNote).toBeNull();
    expect(model.rows[0].priceLabel).not.toMatch(/pint|beer|alcohol-free/i);

    const degraded = buildMapVenueListModel(
      [venue({ id: "unknown", cheapestPrice: 5.8 })],
      null,
      MAP_VENUE_LIST_LIMIT,
      new Map(),
      noun,
      "degraded",
    );
    expect(degraded.coverageNote).toContain("coffee prices");
    expect(degraded.rows[0].priceLabel).toBe("Coffee price could not be read");
    expect(JSON.stringify(degraded)).not.toContain("alcohol-free or soft drink");
  });

  it("leaves the pint default with no lens wording at all", () => {
    const model = buildMapVenueListModel(
      [venue({ id: "priced", cheapestPrice: 4.5 })],
      null,
      MAP_VENUE_LIST_LIMIT,
      null,
      "Whisky",
      "degraded",
    );
    expect(model.coverageNote).toBeNull();
    expect(model.rows[0].priceLabel).toBe("£4.50");
  });
});
