import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import AreaSheet from "@/components/map/AreaSheet";
import type {
  CategoryPriceIndexStatus,
  MapLensPrice,
} from "@/lib/mapExperienceLens";
import { getNightArea } from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";

// The sheet lists unpriced pubs beside priced ones, so "no whisky price yet" on
// every row is exactly what a FAILED cross-venue read looks like as well as an
// honestly empty one. These pin the two apart.
const soho = getNightArea("piccadilly-soho");

function venue(id: string): Venue {
  return {
    id,
    name: `Pub ${id}`,
    latitude: soho.centre.lat,
    longitude: soho.centre.lng,
    cheapestPrice: 5.4,
    latestContributorPrice: null,
  } as Venue;
}

function renderSheet(
  lensPrices: ReadonlyMap<string, MapLensPrice> | null,
  lensStatus: CategoryPriceIndexStatus,
) {
  return renderToStaticMarkup(
    createElement(AreaSheet, {
      cityId: "london" as const,
      area: soho,
      venues: [venue("a")],
      lensPrices,
      drinkCategory: "whisky" as const,
      lensStatus,
      distanceFrom: {
        point: [soho.centre.lng, soho.centre.lat] as [number, number],
        origin: "map" as const,
      },
      onSelectVenue: vi.fn(),
      onFlyToArea: vi.fn(),
      onClose: vi.fn(),
    }),
  );
}

describe("AreaSheet under a selected drink lens", () => {
  it("adds nothing when the index answered in full", () => {
    const html = renderSheet(new Map(), "ready");
    expect(html).toContain("Cheapest whisky in Piccadilly");
    expect(html).not.toContain("could not read");
    expect(html).not.toContain("part of the whisky prices");
  });

  it("never presents an unreadable index as no whisky prices here", () => {
    const html = renderSheet(new Map(), "degraded");
    expect(html).toContain("could not read the whisky prices");
    expect(html).not.toContain("No whisky prices in this area yet");
  });

  it("keeps a truncated-but-successful read out of the failure wording", () => {
    const html = renderSheet(new Map(), "partial");
    expect(html).toContain("part of the whisky prices");
    expect(html).not.toContain("could not read");
  });

  it("says the read is still running rather than settling it early", () => {
    const html = renderSheet(new Map(), "loading");
    expect(html).toContain("Checking whisky prices");
    expect(html).not.toContain("No whisky prices in this area yet");
  });

  it("leaves the pint default untouched", () => {
    const html = renderSheet(null, "ready");
    expect(html).toContain("Cheapest pints in Piccadilly");
    expect(html).not.toContain("could not read");
  });
});
