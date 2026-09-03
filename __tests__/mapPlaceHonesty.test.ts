import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import AreaSheet from "@/components/map/AreaSheet";
import MobileMapShell from "@/components/mobile/MobileMapShell";
import {
  areaChipClaim,
  areaLabelOrigin,
  type AreaDistanceFrom,
} from "@/lib/areaButton";
import { getNightArea } from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";

// A map that was never told where the reader is may not name their place.
//
// Two surfaces claimed one anyway. The phone Area chip printed a location pin
// beside the Night Area under the map CENTRE, which reads as "you are here".
// The Area sheet's rows said "179 m away", and "away" is a distance from the
// person reading it, while the origin was the map centre. These hold both
// states apart: what the map may say with no location, and what it may say
// once the reader grants one.

const soho = getNightArea("piccadilly-soho");

/** A point inside Soho's own region — a reader standing in the named area. */
const insideSoho = { lat: soho.centre.lat + 0.002, lng: soho.centre.lng + 0.002 };

describe("areaLabelOrigin — who the named area belongs to", () => {
  it("claims nobody when the reader granted no location", () => {
    expect(areaLabelOrigin(soho, null)).toBe("map");
    expect(areaLabelOrigin(soho, undefined)).toBe("map");
  });

  it("claims the reader when their granted location is inside that area", () => {
    expect(areaLabelOrigin(soho, insideSoho)).toBe("reader");
  });

  it("claims nobody when the reader is outside the area they are shown", () => {
    // Brixton is a real Night Area of this city, and it is not Soho.
    const brixton = getNightArea("brixton");
    expect(areaLabelOrigin(soho, { lat: brixton.centre.lat, lng: brixton.centre.lng }))
      .toBe("map");
    // Manchester. areaUnderCentre would answer with the NEAREST London area,
    // so a containment test is the only honest one here.
    expect(areaLabelOrigin(soho, { lat: 53.48, lng: -2.24 })).toBe("map");
  });

  it("claims nobody on an unusable fix or an unresolved area", () => {
    expect(areaLabelOrigin(soho, { lat: Number.NaN, lng: -0.13 })).toBe("map");
    expect(areaLabelOrigin(null, insideSoho)).toBe("map");
  });

  it("words the two claims apart", () => {
    expect(areaChipClaim("map", "King's Cross")).toBe("Area in view: King's Cross");
    expect(areaChipClaim("reader", "Brixton")).toBe("Your area: Brixton");
    expect(areaChipClaim("map", "King's Cross")).not.toContain("Your");
  });
});

/** Priced pubs a few hundred metres from the area centre. */
function venue(index: number): Venue {
  return {
    id: `pub-${index}`,
    name: `Pub number ${index}`,
    latitude: soho.centre.lat + 0.002,
    longitude: soho.centre.lng + 0.002,
    cheapestPrice: 4 + index * 0.1,
    latestContributorPrice: null,
  } as Venue;
}

function renderSheet(distanceFrom: AreaDistanceFrom) {
  return renderToStaticMarkup(
    createElement(AreaSheet, {
      cityId: "london" as const,
      area: soho,
      venues: [venue(0), venue(1)],
      distanceFrom,
      onSelectVenue: vi.fn(),
      onFlyToArea: vi.fn(),
      onClose: vi.fn(),
    }),
  );
}

describe("Area sheet rows — what a distance is measured from", () => {
  it("names the map centre, and says nothing about the reader, with no location", () => {
    const html = renderSheet({
      point: [soho.centre.lng, soho.centre.lat],
      origin: "map",
    });
    expect(html).toContain("from map centre");
    // The defect. Every row said this from a point the reader never gave.
    expect(html).not.toContain("away");
    expect(html).not.toContain("right here");
  });

  it("measures from the reader, and says so, once a location is granted", () => {
    // The reader stands at the area centre; the pubs are a few hundred metres
    // off it, so the row prints a real reader-measured distance.
    const html = renderSheet({
      point: [soho.centre.lng, soho.centre.lat],
      origin: "reader",
    });
    expect(html).toMatch(/\d+ m away/);
    expect(html).not.toContain("map centre");
  });

  it("drops the reader claim when the granted point is unusable", () => {
    // The row falls back to the area centre, which is a map point. It may not
    // keep the wording of a measurement it no longer made.
    const html = renderSheet({ point: [Number.NaN, Number.NaN], origin: "reader" });
    expect(html).toContain("from map centre");
    expect(html).not.toContain("away");
  });
});

/** The phone shell's props, cut to what the top bar needs to render. */
function shellProps(overrides: Record<string, unknown> = {}) {
  return {
    cityLabel: "Camden",
    cityLabelOrigin: "map" as const,
    limitedCoverage: false,
    overlay: "none" as const,
    onOverlayChange: vi.fn(),
    activeQuery: "",
    onClearQuery: vi.fn(),
    onNearMe: vi.fn(),
    nearMeStatus: "idle" as const,
    nearMeError: null,
    onDismissNearMeError: vi.fn(),
    nearbyCount: 0,
    tonightCount: 0,
    tonightNearReader: false,
    tflCount: 0,
    tflStatus: "clear" as const,
    priceLabel: "Any price",
    drinkFiltersActive: false,
    drinkLaneLabel: "Pints",
    drinkLaneSelected: false,
    drinkContent: null,
    priceCapActive: false,
    areaPriceNoun: "pints",
    planOpen: false,
    planActive: false,
    planStopCount: 0,
    planInteractive: true,
    venueListOpen: false,
    bandNoticeOpen: false,
    onPlan: vi.fn(),
    searchContent: null,
    filtersContent: null,
    tflContent: null,
    tonightContent: null,
    layersContent: null,
    palContent: null,
    momentContent: null,
    nearMeContent: null,
    areaContent: null,
    chooseAreaContent: null,
    // The one way out every surface carries (components/ui/surface-nav.tsx).
    backLabel: null,
    onBack: vi.fn(),
    onHome: vi.fn(),
    ...overrides,
  };
}

function renderShell(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(MobileMapShell, shellProps(overrides)));
}

describe("Phone Tonight cold-start chip", () => {
  it("stays off the map when What's On is empty", () => {
    const html = renderShell({ tonightCount: 0 });
    expect(html).not.toContain("mobileMapTonightChip");
    expect(html).not.toContain("On tonight");
  });

  it("opens the Tonight sheet from one labelled chip when listings exist", () => {
    const html = renderShell({ tonightCount: 4 });
    expect(html).toContain("mobileMapTonightChip");
    expect(html).toContain('aria-label="On tonight: 4 listings"');
    expect(html).toContain("On tonight");
    expect(html).toContain(">4<");
  });

  it("claims near you only when the count was fetched with reader location", () => {
    const html = renderShell({ tonightCount: 4, tonightNearReader: true });
    expect(html).toContain('aria-label="On tonight: 4 listings near you"');
  });
});

describe("Phone map area switcher", () => {
  it("labels the current map area and exposes city switching", () => {
    const html = renderShell();
    expect(html).toContain('class="citySwitcherTrigger"');
    expect(html).toContain('aria-label="Map area: Camden. Change city"');
  });

  it("keeps the area name stable when reader location changes", () => {
    const html = renderShell({ cityLabelOrigin: "reader", cityLabel: "Brixton" });
    expect(html).toContain('aria-label="Map area: Brixton. Change city"');
  });

  it("keeps a base-pub arrival in the same switcher", () => {
    const html = renderShell({ limitedCoverage: true, cityLabel: "Bath" });
    expect(html).toContain('aria-label="Map area: Bath. Change city"');
    expect(html).toContain('aria-label="Search the map"');
  });
});
