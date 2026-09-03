import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DrinkLanePicker from "@/components/map/DrinkLanePicker";
import VenueDrinkPrices from "@/components/map/VenueDrinkPrices";
import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";
import { MAP_DRINK_LANES } from "@/lib/drinkLanes";
import { CATEGORY_META, type DrinkCategory } from "@/lib/drinks";
import type { VenuePriceReadStatus } from "@/lib/mapExperienceLens";

const authState = vi.hoisted(() => ({
  current: { user: { id: "acct-1" }, loading: false } as Record<string, unknown>,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

const communityPrices = {
  byVenueId: new Map(),
  signalsByVenueId: new Map(),
  freshestByVenueId: new Map(),
  venuePriceStatus: new Map(),
  loadVenue: vi.fn(),
  submit: vi.fn(),
  submitVenueSignal: vi.fn(),
  submitting: false,
  reportPrice: vi.fn(),
  reportedIds: new Set<string>(),
} as unknown as CommunityPricesState;

function price(
  drinkCategory: DrinkCategory,
  priceGbp: number,
  submittedAt: number,
): CommunityPrice {
  return {
    id: `obs-${drinkCategory}`,
    venueId: "the-crown",
    drinkCategory,
    priceGbp,
    submittedAt,
    source: "community",
    corroborations: 2,
  };
}

const NOW = Date.parse("2026-08-10T19:00:00Z");

function renderVenuePrices({
  rows,
  activeLane,
  laneNoun,
  readStatus = "ready",
  canLog = true,
}: {
  rows: CommunityPrice[] | undefined;
  activeLane: DrinkCategory;
  laneNoun: string;
  readStatus?: VenuePriceReadStatus;
  canLog?: boolean;
}) {
  return renderToStaticMarkup(
    createElement(VenueDrinkPrices, {
      venueId: "the-crown",
      venueName: "The Crown",
      rows,
      activeLane,
      laneNoun,
      readStatus,
      communityPrices,
      onLogPrice: vi.fn(),
      canLog,
    }),
  );
}

describe("DrinkLanePicker", () => {
  it("puts every lane on screen at once rather than inside a menu", () => {
    const html = renderToStaticMarkup(
      createElement(DrinkLanePicker, { lane: "beer", onChange: vi.fn() }),
    );
    expect(html).not.toContain("<select");
    for (const lane of MAP_DRINK_LANES) {
      expect(html).toContain(`>${lane.label}</button>`);
    }
    expect(html).toContain("Pints");
  });

  it("does not offer Other as a map lane", () => {
    // Other stays submittable (a liqueur, a cider), but a pin reading
    // "£6 Other" over a pint glass would label a figure with no drink name.
    const html = renderToStaticMarkup(
      createElement(DrinkLanePicker, { lane: "beer", onChange: vi.fn() }),
    );
    expect(html).not.toContain(`>${CATEGORY_META.other.label}</button>`);
  });

  it("marks the lane the map is actually under", () => {
    const html = renderToStaticMarkup(
      createElement(DrinkLanePicker, { lane: "cocktail", onChange: vi.fn() }),
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>Cocktails</);
    expect(html).not.toMatch(/aria-pressed="true"[^>]*>Pints</);
  });

  it("says a non-pint lane colours pins only where drinkers confirmed that drink", () => {
    const html = renderToStaticMarkup(
      createElement(DrinkLanePicker, { lane: "cocktail", onChange: vi.fn() }),
    );
    expect(html).toContain("confirmed cocktail prices");
    expect(html).toContain("stay unknown");
  });

  it("never words a lane it could not read as a lane with no prices", () => {
    const html = renderToStaticMarkup(
      createElement(DrinkLanePicker, {
        lane: "cocktail",
        status: "degraded",
        onChange: vi.fn(),
      }),
    );
    expect(html).toContain("could not read the cocktail prices");
    const loading = renderToStaticMarkup(
      createElement(DrinkLanePicker, {
        lane: "cocktail",
        status: "loading",
        onChange: vi.fn(),
      }),
    );
    expect(loading).toContain("Checking cocktail prices");
  });

  it("lets the phone sheet chrome own the one heading", () => {
    const sheet = renderToStaticMarkup(
      createElement(DrinkLanePicker, {
        lane: "beer",
        variant: "sheet",
        onChange: vi.fn(),
      }),
    );
    expect(sheet).not.toContain("What are you drinking?");
    expect(sheet).toContain("Pints");
  });
});

describe("VenueDrinkPrices", () => {
  it("leads with the lane the reader is under, not the last drink logged", () => {
    const html = renderVenuePrices({
      rows: [price("coffee", 3.4, NOW), price("cocktail", 12, NOW - 5_000)],
      activeLane: "cocktail",
      laneNoun: "cocktail",
    });
    expect(html.indexOf("£12.00")).toBeLessThan(html.indexOf("£3.40"));
  });

  it("never merges two drinks into one figure", () => {
    // Each row prints its own tag beside its own figure, so a cocktail map
    // cannot make a coffee price read as the cocktail price.
    const html = renderVenuePrices({
      rows: [price("beer", 6.2, NOW), price("cocktail", 12, NOW - 5_000)],
      activeLane: "cocktail",
      laneNoun: "cocktail",
    });
    expect(html).toContain("£12.00");
    expect(html).toContain("£6.20");
    expect(html).toContain(CATEGORY_META.cocktail.label);
    expect(html).toContain(CATEGORY_META.beer.label);
    // One row per drink, and no combined or averaged figure anywhere.
    expect(html.match(/£12\.00/g)).toHaveLength(1);
    expect(html.match(/£6\.20/g)).toHaveLength(1);
  });

  it("says an empty lane is empty, and invites a price for that drink", () => {
    const html = renderVenuePrices({
      rows: [price("beer", 6.2, NOW)],
      activeLane: "cocktail",
      laneNoun: "cocktail",
    });
    expect(html).toContain("No cocktail price logged here yet.");
    expect(html).toContain("Log a cocktail price");
    // The pub's real beer row is still there: an empty lane hides nothing.
    expect(html).toContain("£6.20");
  });

  it("does not invite a price off the back of a read that failed", () => {
    const html = renderVenuePrices({
      rows: [],
      activeLane: "cocktail",
      laneNoun: "cocktail",
      readStatus: "degraded",
    });
    expect(html).toContain("We could not read this pub");
    expect(html).toContain("cocktail prices just now");
    expect(html).not.toContain("Log a cocktail price");
  });

  it("does not invite a price at a venue that takes none", () => {
    const html = renderVenuePrices({
      rows: [],
      activeLane: "cocktail",
      laneNoun: "cocktail",
      canLog: false,
    });
    expect(html).not.toContain("Log a cocktail price");
  });
});

describe("VenuePriceSubmit", () => {
  function renderComposer(laneCategory: DrinkCategory) {
    return renderToStaticMarkup(
      createElement(VenuePriceSubmit, {
        venueId: "the-crown",
        venueName: "The Crown",
        communityPrices,
        laneCategory,
      }),
    );
  }

  it("opens on the drink the map is under", () => {
    const html = renderComposer("cocktail");
    expect(html).toMatch(
      new RegExp(`aria-checked="true"[^>]*>${CATEGORY_META.cocktail.label}<`),
    );
  });

  it("offers a lane that is not on the shortcut row", () => {
    // A gin map used to open the composer on beer with no gin chip in sight.
    const html = renderComposer("gin");
    expect(html).toContain(`>${CATEGORY_META.gin.label}<`);
    expect(html).toMatch(
      new RegExp(`aria-checked="true"[^>]*>${CATEGORY_META.gin.label}<`),
    );
  });

  it("names the drink in the singular where a sentence needs it", () => {
    // The chips are menu-section names, so lowercasing one read out to a
    // screen reader as "price of a cocktails".
    expect(renderComposer("cocktail")).toContain(
      'aria-label="Price of a cocktail at The Crown, in pounds"',
    );
    expect(renderComposer("soft-drink")).toContain(
      'aria-label="Price of a soft drink at The Crown, in pounds"',
    );
  });

  it("still opens on beer where no lane is passed", () => {
    const html = renderToStaticMarkup(
      createElement(VenuePriceSubmit, {
        venueId: "the-crown",
        venueName: "The Crown",
        communityPrices,
      }),
    );
    expect(html).toMatch(
      new RegExp(`aria-checked="true"[^>]*>${CATEGORY_META.beer.label}<`),
    );
  });
});
