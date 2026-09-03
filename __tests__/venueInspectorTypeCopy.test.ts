import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LandlordPanel from "@/components/LandlordPanel";
import MenuCategoryGrid from "@/components/drinks/MenuCategoryGrid";
import VenueInspectorHeader from "@/components/map/inspector/VenueInspectorHeader";
import VenueGettingHomeTab from "@/components/map/inspector/VenueGettingHomeTab";
import VenueStoryTab from "@/components/map/inspector/VenueStoryTab";
import type { Venue } from "@/lib/venues";

function venue(kind: Venue["kind"]): Venue {
  return {
    id: `venue-${kind}`,
    name: "Fixture Venue",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: kind === "food",
      cocktails: kind === "bar",
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
    kind,
  };
}

describe("shared inspector venue copy", () => {
  it("gives late-food photos a kind-honest accessible name", () => {
    const html = renderToStaticMarkup(
      createElement(VenueInspectorHeader, {
        venue: venue("food"),
        TABS: [],
        tab: "overview",
        tabRefs: {
          current: {
            overview: null,
            photos: null,
            pints: null,
            menu: null,
            story: null,
            ask: null,
            "getting-home": null,
          },
        },
        selectTab: () => {},
        onTabKeyDown: () => {},
      }),
    );

    expect(html).toContain(
      'aria-label="Fixture Venue exterior or late-food venue interior photo"',
    );
    expect(html).not.toContain("bar photo");
  });

  it("gives late-food Ask actions kind-honest accessible copy", () => {
    const html = renderToStaticMarkup(
      createElement(LandlordPanel, {
        venueId: "venue-food",
        venueName: "Fixture Venue",
        venueKind: "food",
      }),
    );

    expect(html).toContain("Tell me about this late-food venue");
    expect(html).toContain('aria-label="Ask about this late-food venue"');
    expect(html).not.toContain("this pub");
  });

  it("gives late-food menu guidance kind-honest copy", () => {
    const html = renderToStaticMarkup(
      createElement(MenuCategoryGrid, {
        tiles: [
          {
            id: "food",
            kind: "food-external",
            label: "Food menu",
            href: "https://food.example/menu",
          },
        ],
        venueKind: "food",
        onOpenDrinks: () => {},
      }),
    );

    expect(html).toContain("late-food venue");
    expect(html).not.toContain("pub");
  });

  it("does not invite Pint Drops or call late-food lore a pub", () => {
    const html = renderToStaticMarkup(
      createElement(VenueStoryTab, {
        venue: venue("food"),
        tab: "story",
        drops: [],
        cityId: "london",
        cityLandmarks: [],
        cityStoryBands: [],
      }),
    );

    expect(html).toContain("late-food venue");
    expect(html).not.toContain("this pub");
    expect(html).not.toContain("Pint Drop");
  });

  it("keeps late-food last-ride transport useful without pint branding", () => {
    const html = renderToStaticMarkup(
      createElement(VenueGettingHomeTab, {
        venue: venue("food"),
        tab: "getting-home",
        cityId: "london",
        onDecision: () => {},
      }),
    );

    expect(html).toContain('aria-label="Last train"');
    expect(html).toContain("Checking live trains");
    expect(html).toContain("Buses nearby");
    expect(html).toContain('aria-label="Look after each other"');
    expect(html).not.toContain("Last Pint");
  });

  it("keeps TfL buses on London getting-home sheets only", () => {
    const html = renderToStaticMarkup(
      createElement(VenueGettingHomeTab, {
        venue: venue("pub"),
        tab: "getting-home",
        cityId: "manchester",
        onDecision: () => {},
      }),
    );

    expect(html).not.toContain("Buses nearby");
  });
});
