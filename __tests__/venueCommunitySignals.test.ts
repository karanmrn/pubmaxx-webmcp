import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VenueCommunitySignals from "@/components/map/VenueCommunitySignals";
import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { COMMUNITY_PRICE_MAX_AGE_MS } from "@/lib/communityPrice";
import type { CommunityVenueSignal } from "@/lib/communityVenueSignals";
import type { Venue } from "@/lib/venues";

const NOW = Date.now();
const noop = () => {};

function render(
  signals: CommunityVenueSignal[] = [],
  readStatus: "idle" | "loading" | "ready" | "degraded" = "ready",
) {
  return renderToStaticMarkup(
    createElement(VenueCommunitySignals, {
      venueId: "venue-xjf3n0",
      venueName: "Arnos Arms",
      signals,
      readStatus,
      submitting: false,
      onSubmit: async () => ({ ok: true as const }),
      canSubmit: true,
      now: NOW,
    }),
  );
}

describe("VenueCommunitySignals", () => {
  it("keeps access visibly unknown in one compact disclosure", () => {
    const html = render();
    expect(html).toContain("<details");
    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("Access unknown");
    expect((html.match(/class=\"venueCommunitySignals\"/g) ?? [])).toHaveLength(1);
  });

  it("distinguishes entrance access from toilet access", () => {
    const html = render();
    expect(html).toContain(">Entrance<");
    expect(html).toContain(">Toilets<");
    expect(html).toContain("Nobody has confirmed step-free entrance access.");
    expect(html).toContain("Nobody has confirmed step-free toilet access.");
  });

  it("offers all five decisions without five new cards", () => {
    const html = render();
    for (const label of ["Character", "Access", "Door", "Eating", "Alcohol-free"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).not.toContain("signalCard");
    expect(html).toContain("Neither character answer is a score.");
  });

  it("gives na-friendly the same reader row and typographic weight as the rest", () => {
    const html = render([
      {
        venueId: "venue-xjf3n0",
        signalKey: "na-friendly",
        signalValue: "good-na-options",
        submittedAt: NOW,
        source: "community",
        corroborations: 1,
      },
    ]);
    expect(html).toContain(">Alcohol-free<");
    expect(html).toContain("One drinker called the alcohol-free options good.");
    expect(html).not.toContain(">NA<");
  });

  it("attributes character to one drinker's judgement", () => {
    const html = render([
      {
        venueId: "venue-xjf3n0",
        signalKey: "character",
        signalValue: "rough",
        submittedAt: NOW,
        source: "community",
        corroborations: 1,
      },
    ]);
    expect(html).toContain("One drinker called it rough.");
    expect(html).not.toContain(">Rough pub<");
  });

  it("shows established wording only after corroboration", () => {
    const html = render([
      {
        venueId: "venue-xjf3n0",
        signalKey: "door-policy",
        signalValue: "trainers",
        submittedAt: NOW,
        source: "community",
        corroborations: 2,
        establishedCandidate: {
          signalValue: "trainers",
          submittedAt: NOW,
          corroborations: 2,
        },
      },
    ]);
    expect(html).toContain("Drinkers reported trainers can be refused.");
    expect(html).toContain("Confirmed by 2 drinkers.");
  });

  it("keeps the collapsed summary unknown when access reports have aged out", () => {
    const stale = NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1;
    const html = render([
      {
        venueId: "venue-xjf3n0",
        signalKey: "step-free-venue",
        signalValue: "step-free",
        submittedAt: stale,
        source: "community",
        corroborations: 1,
      },
      {
        venueId: "venue-xjf3n0",
        signalKey: "step-free-toilets",
        signalValue: "step-free",
        submittedAt: stale,
        source: "community",
        corroborations: 1,
      },
    ]);
    expect(html).toContain("Access unknown");
    expect(html).not.toContain("Access reported");
    expect(html).not.toContain("Entrance unknown");
    expect(html).toContain("Needs a fresh check.");
  });

  it("does not flatten a failed read into unknown access", () => {
    const failed = render([], "degraded");
    expect(failed).toContain("Access unread");
    expect(failed).not.toContain("Access unknown");
    expect(failed).toContain("Unread just now.");
    expect(failed).toContain("We could not read what drinkers have logged.");
    expect(failed).not.toContain("Nobody has confirmed step-free entrance access.");
    expect(failed).not.toContain("Not reported yet.");

    const pending = render([], "loading");
    expect(pending).toContain("Checking access");
    expect(pending).not.toContain("Access unknown");
    expect(pending).toContain("Checking…");
    expect(pending).toContain("Looking up what drinkers have logged.");
    expect(pending).not.toContain("Nobody has confirmed step-free entrance access.");
    expect(pending).not.toContain("Not reported yet.");
  });

  it("labels every phone control and keeps access report targets separate", () => {
    const html = render();
    expect(html).toContain('aria-label="What did you notice?"');
    expect(html).toContain('aria-label="Which access did you check?"');
    expect(html).toContain('value="step-free-venue"');
    expect(html).toContain('value="step-free-toilets"');
    expect(html).toContain('type="submit"');
  });

  it("keeps readings public while withholding the signed-out composer", () => {
    const html = renderToStaticMarkup(
      createElement(VenueCommunitySignals, {
        venueId: "venue-xjf3n0",
        venueName: "Arnos Arms",
        signals: [],
        readStatus: "ready",
        submitting: false,
        onSubmit: async () => ({ ok: true as const }),
        canSubmit: false,
        now: NOW,
      }),
    );

    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("Nobody has confirmed step-free entrance access.");
    expect(html).toContain("Sign in to add what you noticed.");
    expect(html).not.toContain("Add what you noticed");
    expect(html).not.toContain('type="submit"');
  });

  it("read-only mode keeps the readout and withholds the composer", () => {
    const html = renderToStaticMarkup(
      createElement(VenueCommunitySignals, {
        venueId: "venue-xjf3n0",
        venueName: "Arnos Arms",
        signals: [
          {
            venueId: "venue-xjf3n0",
            signalKey: "character",
            signalValue: "rough",
            submittedAt: NOW,
            source: "community",
            corroborations: 1,
          },
        ],
        readStatus: "ready",
        readOnly: true,
        now: NOW,
      }),
    );

    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("One drinker called it rough.");
    expect(html).toContain("Nobody has confirmed step-free entrance access.");
    expect(html).not.toContain("Add what you noticed");
    expect(html).not.toContain("Sign in to add what you noticed.");
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('aria-label="What did you notice?"');
  });
});

describe("VenueOverviewTab community signals", () => {
  const overviewVenue = {
    id: "venue-overview-signals",
    name: "Overview Arms",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: 5.5,
    cheapestPint: "House Lager",
    averagePrice: 5.5,
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
  } as Venue;

  function overviewCommunityPrices(
    status: "ready" | "degraded" = "ready",
  ): CommunityPricesState {
    return {
      byVenueId: new Map([[overviewVenue.id, []]]),
      signalsByVenueId: new Map([
        [
          overviewVenue.id,
          [
            {
              venueId: overviewVenue.id,
              signalKey: "people-eating",
              signalValue: "eating",
              submittedAt: NOW,
              source: "community",
              corroborations: 1,
            },
          ],
        ],
      ]),
      freshestByVenueId: new Map(),
      noAlcoholIndexStatus: "idle",
      loadNoAlcoholIndex: noop,
      loadDrinkCategoryIndex: noop,
      drinkCategoryIndexStatus: new Map(),
      provisionalBaseVenueIds: new Set(),
      loadProvisionalBaseVenues: noop,
      loadVenue: noop,
      venuePriceStatus: new Map([[overviewVenue.id, status]]),
      submit: async () => ({
        ok: true,
        attribution: { status: "anonymous" },
      }),
      submitVenueSignal: vi.fn(async () => ({ ok: true as const })),
      submitting: false,
      reportPrice: noop,
      reportedIds: new Set(),
    } as unknown as CommunityPricesState;
  }

  function renderOverview(status: "ready" | "degraded" = "ready"): string {
    return renderToStaticMarkup(
      createElement(VenueOverviewTab, {
        venue: overviewVenue,
        tab: "overview",
        onOpenVisitReports: () => {},
        cityId: "london",
        mode: "suggest",
        inCrawl: false,
        latestContributorPrice: null,
        communityPrices: overviewCommunityPrices(status),
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
        priceEntryAllowed: false,
        priceSignInRequested: false,
        priceAuthLoading: false,
        priceFocusRequest: 0,
        now: NOW,
      }),
    );
  }

  it("mounts a read-first signals block above the price story", () => {
    const html = renderOverview("ready");
    const signalsAt = html.indexOf("What drinkers noticed");
    const priceStoryAt = html.indexOf("contributorPrice");
    expect(signalsAt, "Overview must show What drinkers noticed").toBeGreaterThan(
      -1,
    );
    expect(priceStoryAt, "Overview must still render a price story").toBeGreaterThan(
      -1,
    );
    expect(signalsAt).toBeLessThan(priceStoryAt);
    expect(html).toContain("One drinker saw people eating.");
    // Price-entry path keeps the authoring surface; Overview's own mount is
    // read-only, so the first block never offers the composer.
    const firstBlock = html.slice(signalsAt, priceStoryAt);
    expect(firstBlock).not.toContain("Add what you noticed");
    expect(firstBlock).not.toContain("Sign in to add what you noticed.");
    expect(
      html.match(/class=\"venueCommunitySignals\"/g) ?? [],
      "Overview must not double-mount VenueCommunitySignals",
    ).toHaveLength(1);
    expect(
      html.match(/What drinkers noticed/g) ?? [],
      "Overview must not repeat the signals heading",
    ).toHaveLength(1);
  });

  it("keeps a degraded Overview read from looking like no signals", () => {
    const html = renderOverview("degraded");
    expect(html).toContain("Access unread");
    expect(html).toContain("Unread just now.");
    expect(html).toContain("We could not read what drinkers have logged.");
    expect(html).not.toContain("Access unknown");
    expect(html).not.toContain("Not reported yet.");
  });
});
