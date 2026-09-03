import { describe, expect, it } from "vitest";

import { journeyAddsTransit } from "@/lib/formatJourney";
import {
  routeStopAreaLabel,
  routeStopPlaceLabels,
  venueAddressLine,
  venueStreetLabel,
  type RouteStopPlace,
} from "@/lib/routeStops";

// D7 — a crawl stop card has to answer two questions on its own: which pub is
// this, and how long is the walk. Production answered neither on a Camden
// route: two cards both read "The Queens Head" over "Camden", and each card
// printed a straight-line walk line AND a walk-only TfL line under it.

function stop(partial: Partial<RouteStopPlace> & { name: string }): RouteStopPlace {
  return { address: "", ...partial };
}

describe("routeStopPlaceLabels", () => {
  it("keeps the plain area when every stop reads apart already", () => {
    const labels = routeStopPlaceLabels([
      stop({ name: "The Old Nick", address: "20 Sandland St, London", primaryBorough: "Camden" }),
      stop({ name: "The Boot", address: "116 Cromer St, London", primaryBorough: "Camden" }),
    ]);
    expect(labels).toEqual(["Camden", "Camden"]);
  });

  it("adds the street when two stops share a name and an area", () => {
    const labels = routeStopPlaceLabels([
      stop({
        name: "The Queens Head",
        address: "66 Acton St, London WC1X 9NB",
        primaryBorough: "Camden",
      }),
      stop({
        name: "The Queens Head",
        address: "13 Black Prince Rd, London SE11 6HS",
        primaryBorough: "Camden",
      }),
    ]);
    expect(labels).toEqual(["Acton St · Camden", "Black Prince Rd · Camden"]);
    expect(labels[0]).not.toEqual(labels[1]);
  });

  it("falls back to the numbered address line when the street collides too", () => {
    const labels = routeStopPlaceLabels([
      stop({ name: "The Queens Head", address: "10 High Rd, London", primaryBorough: "Camden" }),
      stop({ name: "The Queens Head", address: "212 High Rd, London", primaryBorough: "Camden" }),
    ]);
    expect(labels).toEqual(["10 High Rd · Camden", "212 High Rd · Camden"]);
  });

  it("separates same-named stops on their areas alone when those differ", () => {
    const labels = routeStopPlaceLabels([
      stop({ name: "The Queens Head", address: "66 Acton St", primaryBorough: "Camden" }),
      stop({ name: "The Queens Head", address: "13 Black Prince Rd", primaryBorough: "Lambeth" }),
    ]);
    expect(labels).toEqual(["Camden", "Lambeth"]);
  });

  it("matches names case- and space-insensitively", () => {
    const labels = routeStopPlaceLabels([
      stop({ name: "The  Queens Head", address: "66 Acton St", primaryBorough: "Camden" }),
      stop({ name: "the queens head", address: "13 Black Prince Rd", primaryBorough: "Camden" }),
    ]);
    expect(labels[0]).not.toEqual(labels[1]);
  });

  it("never invents a place for a stop with no address to widen", () => {
    const labels = routeStopPlaceLabels([
      stop({ name: "The Queens Head", primaryBorough: "Camden" }),
      stop({ name: "The Queens Head", primaryBorough: "Camden" }),
    ]);
    expect(labels).toEqual(["Camden", "Camden"]);
  });
});

describe("routeStopAreaLabel", () => {
  it("reads the curated tag, then the borough, then the visible list", () => {
    expect(routeStopAreaLabel(stop({ name: "A", storyTag: "Soho" }))).toBe("Soho");
    expect(routeStopAreaLabel(stop({ name: "A", primaryBorough: "Camden" }))).toBe("Camden");
    expect(routeStopAreaLabel(stop({ name: "A", visibleBoroughs: ["Hackney"] }))).toBe("Hackney");
    expect(routeStopAreaLabel(stop({ name: "A" }))).toBe("London");
  });
});

describe("venueStreetLabel", () => {
  it("drops the house number, including ranges and letter suffixes", () => {
    expect(venueStreetLabel("762-764 High Rd, London N12 9QH, UK")).toBe("High Rd");
    expect(venueStreetLabel("13a Black Prince Rd, London")).toBe("Black Prince Rd");
    expect(venueStreetLabel("66 Acton St")).toBe("Acton St");
  });

  it("refuses an address line that is only a number", () => {
    expect(venueStreetLabel("762-764, London")).toBeNull();
    expect(venueStreetLabel("")).toBeNull();
  });

  it("keeps the numbered line available separately", () => {
    expect(venueAddressLine("762-764 High Rd, London N12 9QH, UK")).toBe("762-764 High Rd");
    expect(venueAddressLine("")).toBeNull();
  });

  // A slim map pin recovers its address from the lower-cased search blob
  // (lib/slimPins), so an unhelped street printed as "acton st · Camden".
  it("cases a recovered lower-case address like the place name it is", () => {
    expect(venueStreetLabel("66 acton st, london wc1x 8du")).toBe("Acton St");
    expect(venueAddressLine("66 acton st, london")).toBe("66 Acton St");
  });

  it("leaves a token that already carries a capital alone", () => {
    expect(venueStreetLabel("1 McQueen WALK, London")).toBe("McQueen WALK");
  });
});

describe("journeyAddsTransit", () => {
  it("is false for a walk-only journey, which the card's own walk line covers", () => {
    expect(journeyAddsTransit(["walking"])).toBe(false);
    expect(journeyAddsTransit(["walk", "walking"])).toBe(false);
    expect(journeyAddsTransit([])).toBe(false);
    expect(journeyAddsTransit([" "])).toBe(false);
  });

  it("is true once the journey uses a mode the walk line cannot say", () => {
    expect(journeyAddsTransit(["walking", "bus", "walking"])).toBe(true);
    expect(journeyAddsTransit(["tube"])).toBe(true);
  });
});
