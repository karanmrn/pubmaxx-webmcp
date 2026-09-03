import { describe, expect, it } from "vitest";

import { venuesInNearbyMembership } from "@/lib/mapNearbyMembership";

const venues = [
  { id: "a" },
  { id: "b" },
  { id: "c" },
  { id: "d" },
];

describe("a Near me answer narrows the painted map, and only while it is held", () => {
  it("paints the named venues and nothing else while a membership is held", () => {
    const painted = venuesInNearbyMembership(venues, { venueIds: ["b", "d"] });
    expect(painted.map((venue) => venue.id)).toEqual(["b", "d"]);
  });

  it("paints everything again the moment the membership is dropped", () => {
    // This is the whole regression: picking another area drops the membership,
    // and the area the reader moved to must paint its own pubs rather than
    // whichever of the near-me twenty happen to be in frame.
    const near = venuesInNearbyMembership(venues, { venueIds: ["b", "d"] });
    expect(near).toHaveLength(2);
    expect(venuesInNearbyMembership(venues, null).map((venue) => venue.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("hands the venues straight back when nothing is held, by reference", () => {
    // A fresh array here would re-derive the whole painted map on every pass.
    expect(venuesInNearbyMembership(venues, null)).toBe(venues);
  });

  it("names no venue the map is not already holding", () => {
    const painted = venuesInNearbyMembership(venues, {
      venueIds: ["b", "gone-with-a-filter"],
    });
    expect(painted.map((venue) => venue.id)).toEqual(["b"]);
  });

  it("paints nothing for a membership that named nobody", () => {
    expect(venuesInNearbyMembership(venues, { venueIds: [] })).toEqual([]);
  });
});
