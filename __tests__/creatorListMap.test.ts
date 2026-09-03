import { describe, expect, it } from "vitest";

import { creatorListMapHref } from "@/lib/creatorListMap";

describe("creatorListMapHref", () => {
  it("opens a creator list as one ordered Map plan without duplicate venues", () => {
    expect(
      creatorListMapHref([
        { venueId: "venue-alpha", venueMapUrl: "/map?sel=venue-alpha" },
        { venueId: "venue-beta", venueMapUrl: "/map?sel=venue-beta" },
        { venueId: "venue-alpha", venueMapUrl: "/map?sel=venue-alpha" },
      ]),
    ).toBe(
      "/map?mode=build&pubs=venue-alpha%2Cvenue-beta&sel=venue-alpha",
    );
  });

  it("uses the venue Map link when a list contains one venue", () => {
    expect(
      creatorListMapHref([
        { venueId: "venue-one", venueMapUrl: "/map?sel=venue-one" },
      ]),
    ).toBe("/map?mode=build&pubs=venue-one&sel=venue-one");
  });

  it("does not offer a dead Map action for an empty list", () => {
    expect(creatorListMapHref([])).toBeNull();
  });
});
