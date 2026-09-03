import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MapKey from "@/components/map/MapKey";
import MapLayersControl from "@/components/map/MapLayersControl";
import MapPriceFilterChips from "@/components/map/MapPriceFilterChips";
import { initialFilters } from "@/components/map/ControlRail";
import { mapPriceLegend } from "@/lib/mapPriceLegend";
import { POI_CATEGORIES, type PoiCategory } from "@/lib/pois";

// The map surface is search plus one toast (lib/mapSurfaceChrome.ts). The price
// key, the pint price cap and the venue list are READER controls, so they are
// reachable from the Layers popover instead. This asserts the popover really
// carries them, because a reader who cannot find the key has lost the map's
// whole colour vocabulary.

const poiHidden = Object.fromEntries(
  POI_CATEGORIES.map((category) => [category, true]),
) as Record<PoiCategory, boolean>;

const legend = mapPriceLegend({
  kind: "default",
  renderedState: {
    priceBands: [
      { meaning: "pint", bucket: 0 },
      { meaning: "pint", bucket: 1 },
      { meaning: "pint", bucket: 2 },
      { meaning: "pint", bucket: 3 },
    ] as const,
    storyColour: null,
  },
});

function renderLayers(
  overrides: Parameters<typeof MapLayersControl>[0] extends infer P
    ? Partial<P>
    : never = {},
): string {
  return renderToStaticMarkup(
    createElement(MapLayersControl, {
      poiHidden,
      onPoiHiddenChange: () => undefined,
      // `embedded` is the popover's own open state, which is what a reader
      // sees after tapping Layers.
      embedded: true,
      ...overrides,
    }),
  );
}

describe("Layers is where the map's reader controls live", () => {
  it("carries the price key rows a reader used to get from floating chrome", () => {
    const html = renderLayers({
      readerKey: createElement(MapKey, { legend }),
    });

    expect(html).toContain("Pint price key and filters");
    expect(html).not.toMatch(/mapLayersSectionLabel[^>]*>Price key/);
    expect(legend.rows.length).toBeGreaterThan(0);
    for (const row of legend.rows) {
      expect(html).toContain(row.label);
    }
  });

  it("carries the max pint price cap with the active option pressed", () => {
    const html = renderLayers({
      readerPriceFilter: (close: () => void) =>
        createElement(MapPriceFilterChips, {
          filters: { ...initialFilters, maxPrice: 5.5 },
          onFiltersChange: () => undefined,
          onPicked: close,
        }),
    });

    expect(html).toContain("Maximum pint price");
    expect(html).toContain("Any");
    expect(html).toContain("£5.50");
    expect(html).toContain("£7");
    expect(html).toMatch(
      /aria-pressed="true"[^>]*>[^<]*<i class="mapLayersPriceDot green"[\s\S]*?£5\.50/,
    );
  });

  it("offers the venue list with its count", () => {
    const html = renderLayers({
      onListOpenChange: () => undefined,
      listCount: 12,
    });

    expect(html).toContain("List view");
    expect(html).toContain(">12<");
    expect(html).toContain('aria-pressed="false"');
  });

  it("names the list action for the state it will leave behind", () => {
    const html = renderLayers({
      listOpen: true,
      onListOpenChange: () => undefined,
    });

    expect(html).toContain("Hide venue list");
    expect(html).toContain('aria-pressed="true"');
  });

  it("draws no reader section when the owner hands it none", () => {
    const html = renderLayers();

    expect(html).not.toContain("mapLayersReader");
    expect(html).not.toContain("List view");
    expect(html).not.toContain("Price key");
  });
});
