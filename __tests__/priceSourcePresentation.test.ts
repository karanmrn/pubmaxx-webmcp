import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import DrinkMenu from "@/components/drinks/DrinkMenu";
import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { Drink } from "@/lib/drinks";
import { venueDrinkMenu } from "@/lib/drinkMenu";
import type { PricedVenue } from "@/lib/priceUpdates";
import type { Venue, VenuePrice } from "@/lib/venues";

vi.mock("@/components/visits/VisitReportPanel", () => ({
  default: () => createElement("div", { "data-testid": "visit-report-peek" }),
}));

const noop = () => {};
const OBSERVED = "2026-07-01T12:00:00.000Z";

function drink(source: string, sourceUrl?: string, observedAt = OBSERVED): Drink {
  return {
    id: `beer-${source}`,
    category: "beer",
    name: "Test Lager",
    priceGbp: 6.4,
    provenance: {
      source,
      sourceUrl,
      licence: "first-party",
      observedAt,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

function price(pubUrl: string): VenuePrice {
  return {
    app_price_id: "price-1",
    pub_name: "The Test Arms",
    pint_name: "Test Lager",
    price_gbp: 6.4,
    price_text: "£6.40",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: pubUrl,
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
    has_visible_borough_row: false,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
  };
}

function venue(pubUrl: string): Venue {
  return {
    id: "venue-test",
    name: "The Test Arms",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [price(pubUrl)],
    cheapestPrice: 6.4,
    cheapestPint: "Test Lager",
    averagePrice: 6.4,
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
  };
}

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

function renderOverview(
  pubUrl: string,
  sourcedPrice: PricedVenue["sourcedPrice"] = null,
): string {
  const currentVenue: PricedVenue = {
    ...venue(pubUrl),
    sourcedPrice,
  };
  return renderToStaticMarkup(
    createElement(VenueOverviewTab, {
      venue: currentVenue,
      tab: "overview",
      cityId: "london",
      mode: "suggest",
      inCrawl: false,
      latestContributorPrice: null,
      communityPrices: communityPrices(currentVenue.id),
      experienceLens: "all",
      onToggleStop: noop,
      presenceState: "idle",
      markPresenceHere: noop,
      userLocation: null,
      locationRequestStatus: "idle",
      onRequestLocation: noop,
      onClearLocation: noop,
      onLogTonightPrice: noop,
      onStartFirstDrop: noop,
      onOpenVisitReports: noop,
      priceEntryAllowed: false,
      priceSignInRequested: false,
      priceAuthLoading: false,
      priceFocusRequest: 0,
    }),
  );
}

describe("baseline price-source presentation", () => {
  it("labels an unattributed drink price beside the figure", () => {
    const html = renderToStaticMarkup(
      createElement(DrinkMenu, {
        drinks: [drink("app-dataset")],
        venueName: "The Test Arms",
      }),
    );

    expect(html).toContain("£6.40");
    expect(html).toContain("Publisher not recorded");
    expect(html).toContain(
      "the price is on record but its publisher was not captured",
    );
    expect(html).not.toContain(">On record<");
  });

  it("keeps a named publisher linked without an unattributed label", () => {
    const sourceUrl = "https://www.pint-prices.com/pub/the-test-arms";
    const html = renderToStaticMarkup(
      createElement(DrinkMenu, {
        drinks: [drink("Pint Prices", sourceUrl)],
        venueName: "The Test Arms",
      }),
    );

    expect(html).toContain(`href="${sourceUrl}"`);
    expect(html).toContain(">Pint Prices</a>");
    expect(html).not.toContain("Publisher not recorded");
  });

  it("shows a sourced menu price's publisher and formatted observation date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
    const sourceUrl = "https://www.pint-prices.com/pub/the-test-arms";
    const observedAt = "2026-08-01T12:00:00.000Z";
    const html = renderToStaticMarkup(
      createElement(DrinkMenu, {
        drinks: [drink("Pint Prices", sourceUrl, observedAt)],
        venueName: "The Test Arms",
      }),
    );

    expect(html).toContain(">Pint Prices</a>");
    expect(html).toContain("Seen");
    expect(html).toContain(
      `<time dateTime="${observedAt}">1 Aug 2026</time>`,
    );
  });

  it("labels a sourced menu price beyond the freshness budget as last seen", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
    const observedAt = "2026-07-21T12:00:00.000Z";
    const html = renderToStaticMarkup(
      createElement(DrinkMenu, {
        drinks: [
          drink(
            "Pint Prices",
            "https://www.pint-prices.com/pub/the-test-arms",
            observedAt,
          ),
        ],
        venueName: "The Test Arms",
      }),
    );

    expect(html).toContain("Last seen");
    expect(html).toContain(
      `<time dateTime="${observedAt}">21 Jul 2026</time>`,
    );
    expect(html).not.toMatch(/\b(current|tonight)\b/i);
  });

  it("uses the dataset lane's 3 July collection stamp and 90-day freshness budget", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
    const html = renderToStaticMarkup(
      createElement(DrinkMenu, {
        drinks: venueDrinkMenu("venue-test", [price("")], () => []),
        venueName: "The Test Arms",
      }),
    );

    expect(html).toContain("Seen");
    expect(html).not.toContain("Last seen");
    expect(html).toContain(
      '<time dateTime="2026-07-03T12:00:00.000Z">3 Jul 2026</time>',
    );
  });

  it("formats a late UTC observation on its Europe/London calendar day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
    const observedAt = "2026-08-01T23:30:00.000Z";
    const html = renderToStaticMarkup(
      createElement(DrinkMenu, {
        drinks: [
          drink(
            "Pint Prices",
            "https://www.pint-prices.com/pub/the-test-arms",
            observedAt,
          ),
        ],
        venueName: "The Test Arms",
      }),
    );

    expect(html).toContain(
      `<time dateTime="${observedAt}">2 Aug 2026</time>`,
    );
  });

  it("states the missing publisher beside an Overview baseline price", () => {
    const html = renderOverview("");

    expect(html).toContain("£6.40");
    expect(html).toContain(
      "Price on record. Publisher not recorded for this price.",
    );
    expect(html).not.toContain("Source not named in record");
  });

  it("keeps the Overview publisher link when the price record names one", () => {
    const sourceUrl = "https://www.pint-prices.com/pub/the-test-arms";
    const html = renderOverview(sourceUrl);

    expect(html).toContain(`href="${sourceUrl}"`);
    expect(html).toContain(">Pint Prices</a>");
    expect(html).not.toContain("Publisher not recorded for this price");
  });

  it("links the publisher that supplied a winning refresh-file price", () => {
    const sourceUrl = "https://example.com/menu/test-arms";
    const html = renderOverview("", {
      provenance: "sourced",
      sourceLabel: "The Test Arms menu",
      sourceUrl,
      observedAt: OBSERVED,
    });

    expect(html).toContain("Sourced price");
    expect(html).toContain(`href="${sourceUrl}"`);
    expect(html).toContain(">The Test Arms menu</a>");
  });
});
