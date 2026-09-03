import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import VenueGettingHomeTab from "@/components/map/inspector/VenueGettingHomeTab";
import { GetHomeHandoffRow } from "@/components/night/RouteEndingCard";
import {
  buildGetHomeHandoffLinks,
  citymapperDirectionsHref,
  getHomeHandoffHeading,
  googleMapsTransitHref,
  orderGetHomeLinkKinds,
  uberRideHref,
  venueToGetHomeHandoff,
  type GetHomeHandoffVenue,
} from "@/lib/getHomeHandoff";
import type { Venue } from "@/lib/venues";

const VENUE: GetHomeHandoffVenue = {
  name: "The Handoff Arms",
  latitude: 51.51331234,
  longitude: -0.13495678,
  addressLine: "1 Test Street, London",
};

const UBER_CLIENT_ID = "test-uber-client-id";

function venue(kind: Venue["kind"] = "pub"): Venue {
  return {
    id: "venue-handoff",
    name: VENUE.name,
    address: VENUE.addressLine,
    latitude: VENUE.latitude,
    longitude: VENUE.longitude,
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
    kind,
  };
}

describe("getHomeHandoff builders", () => {
  const originalUberClientId = process.env.NEXT_PUBLIC_UBER_CLIENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_UBER_CLIENT_ID = UBER_CLIENT_ID;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_UBER_CLIENT_ID = originalUberClientId;
  });

  it("builds the Uber pickup link with exact venue fields and no dropoff", () => {
    const href = uberRideHref(VENUE);
    expect(href).not.toBeNull();

    const url = new URL(href!);
    expect(url.origin + url.pathname).toBe("https://m.uber.com/looking");
    expect(url.searchParams.get("client_id")).toBe(UBER_CLIENT_ID);
    expect(url.searchParams.has("dropoff")).toBe(false);

    const pickup = JSON.parse(url.searchParams.get("pickup") ?? "{}");
    expect(pickup).toEqual({
      latitude: VENUE.latitude,
      longitude: VENUE.longitude,
      addressLine1: VENUE.addressLine,
      title: VENUE.name,
    });
  });

  it("omits Uber when NEXT_PUBLIC_UBER_CLIENT_ID is unset", () => {
    delete process.env.NEXT_PUBLIC_UBER_CLIENT_ID;
    expect(uberRideHref(VENUE)).toBeNull();
  });

  it("builds Citymapper with encoded start params, exact coordinates and no end", () => {
    const namedVenue: GetHomeHandoffVenue = {
      ...VENUE,
      name: "Tom & Jerry's",
      addressLine: "1/2 Test Street",
    };
    const href = citymapperDirectionsHref(namedVenue);
    const url = new URL(href);

    expect(url.origin + url.pathname).toBe("https://citymapper.com/directions");
    expect(url.searchParams.get("startcoord")).toBe(
      `${namedVenue.latitude},${namedVenue.longitude}`,
    );
    expect(url.searchParams.get("startname")).toBe("Tom & Jerry's");
    expect(url.searchParams.get("startaddress")).toBe("1/2 Test Street");
    expect(url.searchParams.has("endcoord")).toBe(false);
    expect(url.searchParams.has("endname")).toBe(false);
    expect(url.searchParams.has("endaddress")).toBe(false);
  });

  it("builds Google Maps transit with the venue as origin and no destination", () => {
    const href = googleMapsTransitHref(VENUE);
    const url = new URL(href);

    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("origin")).toBe(
      `${VENUE.latitude},${VENUE.longitude}`,
    );
    expect(url.searchParams.get("travelmode")).toBe("transit");
    expect(url.searchParams.has("destination")).toBe(false);
  });

  it("orders ride first on train_risk nights and transit first otherwise", () => {
    expect(orderGetHomeLinkKinds("train_risk")).toEqual([
      "uber",
      "citymapper",
      "google_transit",
    ]);
    expect(orderGetHomeLinkKinds("settle_up_now")).toEqual([
      "citymapper",
      "google_transit",
      "uber",
    ]);
    expect(orderGetHomeLinkKinds(null)).toEqual([
      "citymapper",
      "google_transit",
      "uber",
    ]);
  });

  it("refuses viewer coordinate fields on the venue record", () => {
    expect(() =>
      uberRideHref({
        ...VENUE,
        lat: 51.5,
      } as GetHomeHandoffVenue & { lat: number }),
    ).toThrow(/refuses viewer coordinates/i);
    expect(() =>
      venueToGetHomeHandoff({
        name: VENUE.name,
        latitude: VENUE.latitude,
        longitude: VENUE.longitude,
        address: VENUE.addressLine,
        fromLat: 51.5,
      } as {
        name: string;
        latitude: number;
        longitude: number;
        address: string;
        fromLat: number;
      }),
    ).toThrow(/refuses viewer coordinates/i);
  });

  it("maps curated venue rows into the handoff venue shape", () => {
    expect(venueToGetHomeHandoff(venue())).toEqual(VENUE);
  });
});

describe("GetHomeHandoffRow mounts", () => {
  const originalUberClientId = process.env.NEXT_PUBLIC_UBER_CLIENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_UBER_CLIENT_ID = UBER_CLIENT_ID;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_UBER_CLIENT_ID = originalUberClientId;
  });

  it("renders provider links in VenueGettingHomeTab", () => {
    const html = renderToStaticMarkup(
      createElement(VenueGettingHomeTab, {
        venue: venue(),
        tab: "getting-home",
        cityId: "london",
        onDecision: () => {},
      }),
    );

    expect(html).toContain("Get a ride from The Handoff Arms");
    expect(html).toContain("https://citymapper.com/directions");
    expect(html).toContain("https://www.google.com/maps/dir/");
    expect(html).toContain("https://m.uber.com/looking");
  });

  it("renders provider links in the get-home ending handoff row", () => {
    const html = renderToStaticMarkup(
      createElement(GetHomeHandoffRow, {
        venue: VENUE,
        decision: "train_risk",
      }),
    );

    const links = buildGetHomeHandoffLinks(VENUE, "train_risk");
    expect(links[0]?.kind).toBe("uber");
    expect(html).toContain("https://m.uber.com/looking");
    expect(html).toContain("client_id=test-uber-client-id");
    expect(html).toContain("Get a ride from The Handoff Arms");
  });
});

describe("get-home handoff voice fences", () => {
  it("keeps get-home copy plain and promise-free", () => {
    const heading = getHomeHandoffHeading(VENUE);
    expect(heading).toBe("Get a ride from The Handoff Arms");
    expect(heading).not.toMatch(/!/);
    expect(heading).not.toMatch(/—|–/);
    expect(heading).not.toMatch(/eta|price|available|safe/i);
  });

  it("keeps mounted get-home surfaces free of jokes and exclamation marks", () => {
    const html = renderToStaticMarkup(
      createElement(GetHomeHandoffRow, { venue: VENUE }),
    );

    expect(html).not.toMatch(/!/);
    expect(html).not.toMatch(/—|–/);
    expect(html).not.toMatch(/lol|cheers|mate\./i);
  });
});
