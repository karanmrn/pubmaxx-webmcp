import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import {
  AREA_PRICE_ABOUT_AVERAGE_GBP,
  resolveCompareBorough,
  venueAreaPriceCompare,
  venueAreaPriceCompareLine,
} from "@/lib/venueAreaPriceCompare";
import { overviewDisplayablePintGbp } from "@/lib/overviewDisplayablePint";
import type { CommunityPrice } from "@/lib/communityPrice";
import {
  buildLeagueTable,
  type LeagueRow,
  type PintIndexSnapshot,
} from "@/lib/pintIndex";
import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";
import { MIN_PRICED_VENUES, computeZonePintIndex } from "@/lib/zones";
import type { Venue } from "@/lib/venues";

const ROOT = process.cwd();

const snapshot = (over: Partial<PintIndexSnapshot> = {}): PintIndexSnapshot => ({
  schemaVersion: 1,
  snapshotId: "compare-test-v1",
  status: "published",
  generatedAt: "2026-07-16T12:00:00.000Z",
  observationWindow: {
    start: "2026-07-01T00:00:00.000Z",
    end: "2026-07-15T23:59:59.000Z",
  },
  classification: {
    version: LONDON_BOROUGH_CLASSIFIER_VERSION,
    method: "point_in_polygon",
    sourceArtifact: "data/london_boroughs_simplified.json",
    licence: "OGL v3",
  },
  sources: [
    {
      id: "community-1",
      kind: "confirmed_pint_drop",
      publisher: "PUBMAXX contributor",
      sourceUrl: "https://pubmaxxing.com/evidence/1",
      licence: null,
      confirmationId: "drop-confirmation-1",
      reviewState: "confirmed",
    },
  ],
  observations: [
    {
      venueId: "a",
      pubName: "Cheap A",
      boroughCode: "camden",
      boroughName: "Camden",
      pricePence: 580,
      observedAt: "2026-07-10T12:00:00.000Z",
      sourceId: "community-1",
    },
    {
      venueId: "b",
      pubName: "Cheap B",
      boroughCode: "camden",
      boroughName: "Camden",
      pricePence: 640,
      observedAt: "2026-07-11T12:00:00.000Z",
      sourceId: "community-1",
    },
  ],
  excluded: [],
  ...over,
});

function leagueForCamden(): LeagueRow[] {
  return buildLeagueTable(snapshot());
}

describe("venueAreaPriceCompare helper", () => {
  it("names the borough figure when the pint is not about average", () => {
    const result = venueAreaPriceCompare({
      priceGbp: 5.4,
      primaryBorough: "Camden",
      leagueRows: leagueForCamden(),
    });
    // Camden average from 580 + 640 pence → £6.10
    expect(result).toMatchObject({
      kind: "borough",
      areaLabel: "Camden",
      areaGbp: 6.1,
      priceGbp: 5.4,
    });
    expect(result?.line).toBe("£5.40 here. Camden average £6.10.");
  });

  it("says about average when the pint sits on the patch figure", () => {
    const line = venueAreaPriceCompareLine({
      priceGbp: 6.1,
      primaryBorough: "Camden",
      leagueRows: leagueForCamden(),
    });
    expect(line).toBe("About average for Camden.");
  });

  it("treats a gap within the about-average band as about average", () => {
    const line = venueAreaPriceCompareLine({
      priceGbp: 6.1 - AREA_PRICE_ABOUT_AVERAGE_GBP,
      primaryBorough: "Camden",
      leagueRows: leagueForCamden(),
    });
    expect(line).toBe("About average for Camden.");
  });

  it("builds the league from a snapshot when rows are not precomputed", () => {
    const line = venueAreaPriceCompareLine({
      priceGbp: 5.4,
      primaryBorough: "London Borough of Camden",
      snapshot: snapshot(),
    });
    expect(line).toBe("£5.40 here. Camden average £6.10.");
  });

  it("falls back to a publishable zone median when the league has no borough", () => {
    const zoneVenues = Array.from({ length: MIN_PRICED_VENUES }, () => ({
      zone: 2 as const,
      cheapestPrice: 6.1,
      kind: "pub" as const,
    }));
    const line = venueAreaPriceCompareLine({
      priceGbp: 5.4,
      primaryBorough: "Camden",
      leagueRows: [],
      zone: 2,
      zoneVenues,
    });
    expect(line).toBe("£5.40 here. Zone 2 median £6.10.");
  });

  it("stays silent while the league fetch has not settled", () => {
    const zoneIndex = computeZonePintIndex(
      Array.from({ length: MIN_PRICED_VENUES }, () => ({
        zone: 2,
        cheapestPrice: 6.1,
        kind: "pub" as const,
      })),
    );
    expect(
      venueAreaPriceCompareLine({
        priceGbp: 5.4,
        primaryBorough: "Camden",
        leagueRows: null,
        zone: 2,
        zoneIndex,
      }),
    ).toBeNull();
  });

  it("answers with zone once an empty league has settled", () => {
    const zoneIndex = computeZonePintIndex(
      Array.from({ length: MIN_PRICED_VENUES }, () => ({
        zone: 2,
        cheapestPrice: 6.1,
        kind: "pub" as const,
      })),
    );
    expect(
      venueAreaPriceCompareLine({
        priceGbp: 5.4,
        primaryBorough: "Soho",
        leagueRows: [],
        zone: 2,
        zoneIndex,
      }),
    ).toBe("£5.40 here. Zone 2 median £6.10.");
  });

  it("prefers the borough league over a zone median when both answer", () => {
    const zoneIndex = computeZonePintIndex(
      Array.from({ length: MIN_PRICED_VENUES }, () => ({
        zone: 1,
        cheapestPrice: 8,
        kind: "pub" as const,
      })),
    );
    const result = venueAreaPriceCompare({
      priceGbp: 5.4,
      primaryBorough: "Camden",
      zone: 1,
      leagueRows: leagueForCamden(),
      zoneIndex,
    });
    expect(result?.kind).toBe("borough");
    expect(result?.line).toContain("Camden average");
    expect(result?.line).not.toContain("Zone");
  });

  it("stays silent without a displayable pint", () => {
    expect(
      venueAreaPriceCompareLine({
        priceGbp: null,
        primaryBorough: "Camden",
        leagueRows: leagueForCamden(),
      }),
    ).toBeNull();
    expect(
      venueAreaPriceCompareLine({
        priceGbp: 0,
        primaryBorough: "Camden",
        leagueRows: leagueForCamden(),
      }),
    ).toBeNull();
  });

  it("stays silent when the patch has no publishable yardstick", () => {
    // Thin zone: below MIN_PRICED_VENUES, so computeZonePintIndex refuses a median.
    const thinZone = computeZonePintIndex([
      { zone: 3, cheapestPrice: 5.5, kind: "pub" },
      { zone: 3, cheapestPrice: 5.8, kind: "pub" },
    ]);
    expect(
      venueAreaPriceCompareLine({
        priceGbp: 5.4,
        primaryBorough: "Soho",
        leagueRows: [],
        zone: 3,
        zoneIndex: thinZone,
      }),
    ).toBeNull();
  });

  it("never invents a borough average from a neighbourhood label", () => {
    expect(resolveCompareBorough("Soho")).toBeNull();
    expect(resolveCompareBorough("Camden")).toBe("Camden");
    expect(
      venueAreaPriceCompareLine({
        priceGbp: 5.4,
        primaryBorough: "Soho",
        leagueRows: leagueForCamden(),
      }),
    ).toBeNull();
  });
});

describe("overviewDisplayablePintGbp", () => {
  const NOW = 1_700_000_000_000;

  function beerRow(
    over: Partial<CommunityPrice> & Pick<CommunityPrice, "priceGbp" | "submittedAt">,
  ): CommunityPrice {
    return {
      venueId: "venue-compare",
      drinkCategory: "beer",
      source: "community",
      corroborations: 1,
      ...over,
    };
  }

  it("prefers corroborated community map authority over curated cheapest", () => {
    const price = overviewDisplayablePintGbp({
      cheapestPrice: 5.4,
      latestContributorPrice: null,
      communityRows: [
        beerRow({
          priceGbp: 6.2,
          submittedAt: NOW - 60_000,
          corroborations: 2,
        }),
      ],
      now: NOW,
    });
    expect(price).toBe(6.2);
  });

  it("keeps curated cheapest when community is only sheet-visible", () => {
    const price = overviewDisplayablePintGbp({
      cheapestPrice: 5.4,
      latestContributorPrice: null,
      communityRows: [
        beerRow({
          priceGbp: 6.2,
          submittedAt: NOW - 60_000,
          corroborations: 1,
        }),
      ],
      now: NOW,
    });
    expect(price).toBe(5.4);
  });

  it("lets a newer pint drop outrank corroborated community", () => {
    const dropAt = NOW - 30_000;
    const price = overviewDisplayablePintGbp({
      cheapestPrice: 5.4,
      latestContributorPrice: 5.9,
      latestPintDropAt: dropAt,
      communityRows: [
        beerRow({
          priceGbp: 6.2,
          submittedAt: NOW - 120_000,
          corroborations: 2,
        }),
      ],
      now: NOW,
    });
    expect(price).toBe(5.9);
  });
});

describe("VenueOverviewTab area-price compare mount", () => {
  const overviewSource = readFileSync(
    join(ROOT, "components/map/inspector/VenueOverviewTab.tsx"),
    "utf8",
  );

  const noop = () => {};

  function communityPrices(venueId: string): CommunityPricesState {
    return {
      byVenueId: new Map([[venueId, []]]),
      signalsByVenueId: new Map(),
      freshestByVenueId: new Map(),
      noAlcoholIndexStatus: "idle",
      loadNoAlcoholIndex: noop,
      loadDrinkCategoryIndex: noop,
      drinkCategoryIndexStatus: new Map(),
      provisionalBaseVenueIds: new Set(),
      loadProvisionalBaseVenues: noop,
      loadVenue: noop,
      venuePriceStatus: new Map([[venueId, "ready"]]),
      submit: async () => ({
        ok: true,
        attribution: { status: "anonymous" },
        price: null,
      }),
      submitVenueSignal: async () => ({ ok: true }),
      submitting: false,
      reportPrice: noop,
      reportedIds: new Set(),
    };
  }

  function baseVenue(over: Partial<Venue> = {}): Venue {
    return {
      id: "venue-compare",
      name: "The Compare Arms",
      address: "1 Test Street",
      latitude: 51.5,
      longitude: -0.12,
      primaryBorough: "Camden",
      visibleBoroughs: ["Camden"],
      prices: [],
      cheapestPrice: 5.4,
      cheapestPint: "Lager",
      averagePrice: 5.4,
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
      kind: "pub",
      zone: 2,
      ...over,
    };
  }

  function renderOverview(
    venue: Venue,
    zoneIndex: ReturnType<typeof computeZonePintIndex> | null = null,
    experienceLens: "all" | "no-alcohol" = "all",
  ): string {
    return renderToStaticMarkup(
      createElement(VenueOverviewTab, {
        venue,
        tab: "overview",
        onOpenVisitReports: () => {},
        cityId: "london",
        mode: "suggest",
        inCrawl: false,
        latestContributorPrice: null,
        communityPrices: communityPrices(venue.id),
        experienceLens,
        onToggleStop: noop,
        presenceState: "idle",
        markPresenceHere: noop,
        userLocation: null,
        locationRequestStatus: "idle",
        onRequestLocation: noop,
        onClearLocation: noop,
        onLogTonightPrice: noop,
        onStartFirstDrop: noop,
        priceEntryAllowed: false,
        priceSignInRequested: false,
        priceAuthLoading: false,
        priceFocusRequest: 0,
        zoneIndex,
      }),
    );
  }

  it("mounts VenueAreaPriceCompare under the price block for pubs", () => {
    expect(overviewSource).toContain('from "@/components/map/VenueAreaPriceCompare"');
    const start = overviewSource.indexOf("<VenueAreaPriceCompare");
    expect(start, "Overview must mount the area compare line").toBeGreaterThan(-1);
    const thenStart = overviewSource.indexOf("<VenuePriceThen");
    expect(thenStart).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(thenStart);
    expect(overviewSource).toMatch(/priceGbp=\{overviewPintGbp\}/);
    expect(overviewSource).toContain("overviewDisplayablePintGbp");
    expect(overviewSource).toMatch(/isPubVenue\(venue\)/);
  });

  it("stays silent on first paint until the league fetch settles", () => {
    const zoneIndex = computeZonePintIndex(
      Array.from({ length: MIN_PRICED_VENUES }, () => ({
        zone: 2,
        cheapestPrice: 6.1,
        kind: "pub" as const,
      })),
    );
    const html = renderOverview(baseVenue(), zoneIndex);
    expect(html).not.toContain("venueAreaPriceCompare");
    expect(html).not.toContain("median");
  });

  it("renders nothing when there is no pint and no publishable patch", () => {
    const html = renderOverview(
      baseVenue({ cheapestPrice: null, primaryBorough: "Soho", zone: undefined }),
      null,
    );
    expect(html).not.toContain("venueAreaPriceCompare");
    expect(html).not.toContain("average");
    expect(html).not.toContain("median");
  });

  it("stays off the no-alcohol lens and non-pub sheets", () => {
    const zoneIndex = computeZonePintIndex(
      Array.from({ length: MIN_PRICED_VENUES }, () => ({
        zone: 2,
        cheapestPrice: 6.1,
        kind: "pub" as const,
      })),
    );
    const noAlcohol = renderOverview(baseVenue(), zoneIndex, "no-alcohol");
    expect(noAlcohol).not.toContain("venueAreaPriceCompare");

    const bar = renderOverview(
      baseVenue({ kind: "bar", cheapestPrice: 9.5 }),
      zoneIndex,
    );
    expect(bar).not.toContain("venueAreaPriceCompare");
  });

  it("keeps jokes and salesy punctuation out of the helper copy", () => {
    const line = venueAreaPriceCompareLine({
      priceGbp: 5.4,
      primaryBorough: "Camden",
      leagueRows: leagueForCamden(),
    });
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/!/);
    expect(line).not.toMatch(/—/);
    expect(line).not.toMatch(/ – /);
    expect(line?.toLowerCase()).not.toMatch(/mugged|rip-off|bargain|steal/);
  });
});
