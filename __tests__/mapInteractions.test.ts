import { describe, expect, it, vi } from "vitest";

import {
  PUB_FIRST_LAYERS,
  wireClickRouting,
} from "@/components/map/canvas/interactions";
import { pubsToGeoJSON } from "@/components/map/canvas/geojson";
import type { Landmark } from "@/lib/landmarks";
import type { Venue } from "@/lib/venues";

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-a",
    name: "The A Arms",
    address: "Somewhere",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Southwark",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
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
    ...overrides,
  } as Venue;
}

describe("landmark interactions", () => {
  it("opens the landmark inspector from a label that survived icon collision", () => {
    const bigBen: Landmark = {
      id: "big-ben",
      name: "Big Ben",
      coordinates: [-0.1246, 51.5007],
      history: "History",
      icon: "clock-tower",
      source: { label: "UK Parliament", url: "https://example.com" },
    };
    let clickHandler: ((event: { point: { x: number; y: number } }) => void) | undefined;
    const map = {
      on: vi.fn((event: string, handler: typeof clickHandler) => {
        if (event === "click") clickHandler = handler;
      }),
      getLayer: vi.fn(() => ({})),
      queryRenderedFeatures: vi.fn(() => [{
        layer: { id: "landmarks-label" },
        properties: { id: "big-ben" },
      }]),
      getZoom: vi.fn(() => 11.5),
    };
    const selectLandmark = vi.fn();
    const cinematic = vi.fn();

    wireClickRouting(map as never, {
      selectLandmark,
      setHoveredVenue: vi.fn(),
      setActivePoi: vi.fn(),
      onVenueClickRef: { current: vi.fn() },
      onUkBasePubClickRef: { current: vi.fn() },
      onRouteStopClickRef: { current: vi.fn() },
      onTonightOpportunityClickRef: { current: vi.fn() },
      cityLandmarksRef: { current: [bigBen] },
      tonightOpportunitiesRef: { current: [] },
      cinematic,
    });

    clickHandler?.({ point: { x: 100, y: 200 } });

    expect(PUB_FIRST_LAYERS.indexOf("landmarks-label")).toBeGreaterThan(
      PUB_FIRST_LAYERS.indexOf("clusters"),
    );
    expect(selectLandmark).toHaveBeenCalledWith(bigBen);
    expect(cinematic).toHaveBeenCalledWith(
      expect.objectContaining({ center: bigBen.coordinates, zoom: 13 }),
      "landmark",
    );
  });
});

describe("venue pin interactions", () => {
  it("routes each visible pin to its own GeoJSON venue id when hit boxes overlap", () => {
    const venueA = makeVenue({ id: "venue-a", name: "The A Arms" });
    const venueB = makeVenue({
      id: "venue-b",
      name: "The B Arms",
      latitude: 51.5002,
      longitude: -0.1002,
    });
    const features = pubsToGeoJSON([venueA, venueB], new Map(), null).features;
    const featureFor = (id: string) => features.find((feature) => feature.properties?.id === id)!;
    let clickHandler: ((event: { point: { x: number; y: number } }) => void) | undefined;
    const map = {
      on: vi.fn((event: string, handler: typeof clickHandler) => {
        if (event === "click") clickHandler = handler;
      }),
      getLayer: vi.fn(() => ({})),
      queryRenderedFeatures: vi.fn((point: { x: number; y: number }) => {
        // The selected symbol is larger and can overlap the neighbouring pin.
        // Both features are real rendered hits at B's tap point; routing must
        // use the pin at the tap, not whichever layer was added first.
        if (point.x === 10) {
          return [
            { ...featureFor("venue-a"), layer: { id: "pubs-point" } },
          ];
        }
        return [
          { ...featureFor("venue-a"), layer: { id: "pubs-point-selected" } },
          { ...featureFor("venue-b"), layer: { id: "pubs-point" } },
        ];
      }),
    };
    const onVenueClick = vi.fn();

    wireClickRouting(map as never, {
      selectLandmark: vi.fn(),
      setHoveredVenue: vi.fn(),
      setActivePoi: vi.fn(),
      onVenueClickRef: { current: onVenueClick },
      onUkBasePubClickRef: { current: vi.fn() },
      onRouteStopClickRef: { current: vi.fn() },
      onTonightOpportunityClickRef: { current: vi.fn() },
      cityLandmarksRef: { current: [] },
      tonightOpportunitiesRef: { current: [] },
      cinematic: vi.fn(),
    });

    clickHandler?.({ point: { x: 10, y: 100 } });
    clickHandler?.({ point: { x: 20, y: 100 } });

    expect(features.map((feature) => feature.properties?.id)).toEqual([
      "venue-a",
      "venue-b",
    ]);
    expect(onVenueClick.mock.calls.map(([id]) => id)).toEqual([
      "venue-a",
      "venue-b",
    ]);
  });
});
