import { describe, expect, it } from "vitest";

import {
  defaultVenueKindVisibility,
  filterVenuesByKind,
  hasSavedPubVenue,
  isPubVenue,
  isPubVenueKind,
  toggleVenueKind,
  venueKindLabel,
  venueKindNoun,
} from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

const venue = (id: string, kind?: Venue["kind"]) => ({ id, kind }) as Venue;

describe("venueKindFilters", () => {
  it("defaults every curated venue type on", () => {
    expect(defaultVenueKindVisibility()).toEqual({
      pub: true,
      bar: true,
      food: true,
      restaurant: true,
    });
  });

  it("treats absent kind as a backward-compatible pub", () => {
    const visibility = toggleVenueKind(defaultVenueKindVisibility(), "pub");
    expect(
      filterVenuesByKind([venue("legacy"), venue("bar", "bar")], visibility),
    ).toEqual([venue("bar", "bar")]);
  });

  it("toggles each kind independently", () => {
    const barsOff = toggleVenueKind(defaultVenueKindVisibility(), "bar");
    expect(barsOff).toEqual({
      pub: true,
      bar: false,
      food: true,
      restaurant: true,
    });
    expect(
      filterVenuesByKind(
        [
          venue("pub"),
          venue("bar", "bar"),
          venue("food", "food"),
          venue("restaurant", "restaurant"),
        ],
        barsOff,
      ).map((item) => item.id),
    ).toEqual(["pub", "food", "restaurant"]);
  });

  it("keeps restaurants distinct from Pints and excludes future clubs", () => {
    const restaurantsOff = toggleVenueKind(
      defaultVenueKindVisibility(),
      "restaurant",
    );

    expect(
      filterVenuesByKind(
        [
          venue("pub"),
          venue("restaurant", "restaurant"),
          venue("club", "club"),
        ],
        restaurantsOff,
      ).map((item) => item.id),
    ).toEqual(["pub"]);
  });

  it("identifies only legacy and explicit pub venues for pint-domain consumers", () => {
    expect(
      [
        venue("legacy"),
        venue("pub", "pub"),
        venue("bar", "bar"),
        venue("food", "food"),
      ]
        .filter(isPubVenue)
        .map((item) => item.id),
    ).toEqual(["legacy", "pub"]);
    const kinds: Array<Venue["kind"]> = [undefined, "pub", "bar", "food"];
    expect(kinds.filter(isPubVenueKind)).toEqual([undefined, "pub"]);
  });

  it("does not let saved bars or food satisfy a saved-pub workflow", () => {
    const venues = [
      venue("legacy"),
      venue("pub", "pub"),
      venue("bar", "bar"),
      venue("food", "food"),
    ];

    expect(hasSavedPubVenue(venues, new Set(["bar", "food"]))).toBe(false);
    expect(hasSavedPubVenue(venues, new Set(["bar", "pub"]))).toBe(true);
  });

  it("supplies accessible labels for each venue kind", () => {
    expect(venueKindLabel(undefined)).toBe("Pub");
    expect(venueKindLabel("pub")).toBe("Pub");
    expect(venueKindLabel("bar")).toBe("Bar");
    expect(venueKindLabel("food")).toBe("Late food");
    expect(venueKindLabel("restaurant")).toBe("Restaurant");
  });

  it("lands a kind this build does not hold on the neutral word, never on nothing", () => {
    // A slim row, a shard or a stored venue may carry a kind a later build
    // added. It reaches this copy as a string, and "undefined" printed into a
    // heading or an image alt text is not copy.
    const unknown = "brewpub" as Venue["kind"];
    expect(venueKindLabel(unknown)).toBe("Venue");
    expect(venueKindNoun(unknown)).toBe("venue");
    // Still not a fall-through to Pub: a known non-pub kind keeps its own word.
    expect(venueKindLabel("library")).toBe("Library");
    expect(venueKindNoun("library")).toBe("library");
  });

  it("supplies kind-honest nouns for shared venue copy", () => {
    expect(venueKindNoun(undefined)).toBe("pub");
    expect(venueKindNoun("pub")).toBe("pub");
    expect(venueKindNoun("bar")).toBe("bar");
    expect(venueKindNoun("food")).toBe("late-food venue");
    expect(venueKindNoun("club")).toBe("club");
    expect(venueKindNoun("restaurant")).toBe("restaurant");
  });
});
