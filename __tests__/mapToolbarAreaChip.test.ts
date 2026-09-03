import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { initialFilters } from "@/components/map/ControlRail";
import MapToolbar from "@/components/map/MapToolbar";
import { getCity } from "@/lib/cities";

// "Map area: X" is the one sentence on this control that is literally a claim
// about the area, so once a reader picks one it may not keep naming the city.

function toolbarProps(overrides: Record<string, unknown> = {}) {
  return {
    query: "",
    onQueryChange: vi.fn(),
    searchContent: null,
    favoritePint: null,
    onFavoritePintChange: vi.fn(),
    drinkFiltersActive: false,
    drinkCategory: "",
    drinkBrand: "",
    onDrinkBrandChange: vi.fn(),
    onDrinkLaneChange: vi.fn(),
    drinkLaneStatus: "ready" as const,
    personaId: null,
    onPersonaSelect: vi.fn(),
    personaTonightCategory: null,
    planningOpen: false,
    detailOpen: false,
    desktopLaneActive: false,
    onTogglePlanning: vi.fn(),
    filters: initialFilters,
    onFiltersChange: vi.fn(),
    searchSettled: true,
    filteredVenueCount: 12,
    searchableVenueCount: 12,
    zoneIndex: {
      rows: [],
      ranked: [],
      dearest: null,
      cheapest: null,
      taxGbp: null,
    },
    cityId: "london" as const,
    experienceLens: "all" as const,
    experienceSummary: "Everything",
    onExperienceLensChange: vi.fn(),
    ...overrides,
  };
}

function renderToolbar(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(MapToolbar, toolbarProps(overrides)));
}

describe("the desktop map area chip", () => {
  it("names the city when no area has been chosen", () => {
    const html = renderToolbar();
    const london = getCity("london").displayName;
    expect(html).toContain(`Map area: ${london}. Change city`);
  });

  it("offers the city's three-letter code only for the city itself", () => {
    // citySwitcher.css swaps the full label for this code between 641 and
    // 900px, which is a desktop width. PubMap hands a label down on EVERY
    // render and it falls back to the city's own name, so this is the shape the
    // plain city really arrives in - not an absent prop.
    const html = renderToolbar({ cityLabel: getCity("london").displayName });
    expect(html).toContain("citySwitcherLabelShort");
    expect(html).toContain(">LON<");
    expect(html).not.toContain("citySwitcher--named");
  });

  it("keeps that code when no label is supplied at all", () => {
    const html = renderToolbar();
    expect(html).toContain("citySwitcherLabelShort");
    expect(html).not.toContain("citySwitcher--named");
  });

  it("names the remembered area once one is chosen", () => {
    const html = renderToolbar({ cityLabel: "Camden" });
    expect(html).toContain("Map area: Camden. Change city");
    expect(html).toContain(">Camden<");
    // And it stops making the claim it no longer supports.
    expect(html).not.toContain("Map area: London. Change city");
  });

  it("shows that name at every width rather than the city's code", () => {
    // The regression: the code span survived beside the area name, and CSS
    // showed it at 641-900px, so the chip visibly read LON while announcing
    // "Map area: Camden" - a voice-control reader would say the wrong word.
    const html = renderToolbar({ cityLabel: "Camden" });
    expect(html).not.toContain("citySwitcherLabelShort");
    expect(html).not.toContain(">LON<");
    // And the chip marks itself as naming an area, which is what lets the
    // stylesheet keep the full label at that width.
    expect(html).toContain("citySwitcher--named");
  });

  it("carries a Near me answer's own label the same way", () => {
    const html = renderToolbar({ cityLabel: "Near me" });
    expect(html).toContain("Map area: Near me. Change city");
    expect(html).not.toContain("citySwitcherLabelShort");
  });

  it("treats a blank label as no area at all", () => {
    const html = renderToolbar({ cityLabel: "   " });
    expect(html).toContain(`Map area: ${getCity("london").displayName}. Change city`);
    expect(html).toContain("citySwitcherLabelShort");
    expect(html).not.toContain("citySwitcher--named");
  });

  it("treats the city's own name as no area either, however it arrives", () => {
    // The regression: the chip asked whether a label was SUPPLIED rather than
    // whether it names an area, so the narrow-desktop code was retired on every
    // render and the chip widened in a row built to keep it at 5rem.
    const html = renderToolbar({ cityLabel: `  ${getCity("london").displayName}  ` });
    expect(html).toContain("citySwitcherLabelShort");
    expect(html).not.toContain("citySwitcher--named");
  });
});
