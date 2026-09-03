import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MapVenueList from "@/components/map/MapVenueList";
import type { MapVenueListModel, UkBasePubListModel } from "@/lib/mapVenueList";

const emptyBase: UkBasePubListModel = {
  rows: [],
  total: 0,
  shown: 0,
  truncated: false,
};

describe("MapVenueList", () => {
  it("announces rendered base pubs as a distinct group without a listed price", () => {
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };
    const base: UkBasePubListModel = {
      rows: [
        {
          id: "venue-uk-n123",
          name: "Base Arms",
          priceLabel: "Other pub · no listed price",
          pub: {
            id: "venue-uk-n123",
            name: "Base Arms",
            address: "",
            lat: 53.8,
            lng: -1.55,
            curatedVenueId: "",
          },
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: base,
        cityName: "UK",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain('aria-label="Listed pubs and venues"');
    expect(html).toContain('aria-label="Other pubs with no listed price"');
    expect(html).toContain("Base Arms");
    expect(html).toContain("Other pub · no listed price");
  });

  it("offers Nearest and Cheapest sort chips when the list has venues", () => {
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
        sortMode: "cheapest",
        onSortModeChange: () => {},
      }),
    );

    expect(html).toContain('aria-label="Sort venues on the map"');
    expect(html).toContain("Nearest");
    expect(html).toContain("Cheapest");
    expect(html).toContain('aria-pressed="true"');
  });

  it("keeps an empty list explicit and omits the sort chips", () => {
    const curated: MapVenueListModel = {
      rows: [],
      total: 0,
      shown: 0,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
        sortMode: "nearest",
        onSortModeChange: () => {},
      }),
    );

    expect(html).toContain("Nothing matches");
    expect(html).toContain(
      "Nothing in view fits that, which takes some doing round here",
    );
    expect(html).not.toContain('aria-label="Sort venues on the map"');
  });

  it("does not claim an empty view when unlisted pubs could not load", () => {
    const curated: MapVenueListModel = {
      rows: [],
      total: 0,
      shown: 0,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        ukBaseStatus: "unavailable",
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain("Unlisted pubs could not load");
    expect(html).not.toContain("Nothing matches");
    expect(html).not.toContain("Nothing in view fits that");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("keeps an empty list pending while unlisted pubs are still loading", () => {
    const curated: MapVenueListModel = {
      rows: [],
      total: 0,
      shown: 0,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        ukBaseStatus: "loading",
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain("Counting them up…");
    expect(html).not.toContain("Nothing matches");
    expect(html).not.toContain("Nothing in view fits that");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("discloses incomplete unlisted-pub coverage beside curated results", () => {
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        ukBaseStatus: "unavailable",
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain("Some unlisted pubs could not load");
    expect(html).toContain("Curated Arms");
  });
});
