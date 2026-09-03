import { describe, expect, it } from "vitest";

import {
  matchVenuePermalinkSlug,
  parsePermalinkSlug,
  postcodeDistrictPrefixes,
  postcodeOutwardFromText,
  slugifyVenueName,
  venuePermalinkKeys,
} from "@/lib/venuePermalinkSlug";

describe("venue permalink slug helpers", () => {
  it("slugifies names and reads outward postcodes", () => {
    expect(slugifyVenueName("The Ship Soho")).toBe("the-ship-soho");
    expect(postcodeOutwardFromText("west end, w1f 0tt westminster")).toBe("w1f");
    expect(postcodeDistrictPrefixes("w1f")).toEqual(["w1f", "w1"]);
  });

  it("parses name and trailing district", () => {
    expect(parsePermalinkSlug("the-ship-w1")).toEqual({
      nameSlug: "the-ship",
      district: "w1",
    });
    expect(parsePermalinkSlug("the-ship-soho")).toEqual({
      nameSlug: "the-ship-soho",
      district: null,
    });
  });

  it("resolves the-ship-w1 to the unique W1 Ship", () => {
    const venues = [
      {
        id: "venue-806vol",
        name: "The Ship Soho",
        searchText: "the ship soho west end, w1f 0tt westminster",
      },
      {
        id: "venue-efr0wp",
        name: "The Ship",
        searchText: "the ship 41 jews row, wandsworth, sw18 1tb",
      },
      {
        id: "venue-8ln1g4",
        name: "The Ship",
        searchText: "the ship 68 borough rd, london se1 1dx",
      },
    ];
    expect(venuePermalinkKeys(venues[0]!)).toEqual(
      expect.arrayContaining(["the-ship-soho-w1f", "the-ship-soho-w1", "the-ship-w1"]),
    );
    expect(matchVenuePermalinkSlug("the-ship-w1", venues)).toBe("venue-806vol");
    // Bare name is ambiguous across London Ships.
    expect(matchVenuePermalinkSlug("the-ship", venues)).toBeNull();
    expect(matchVenuePermalinkSlug("venue-806vol", venues, new Map(venues.map((v) => [v.id, v])))).toBe(
      "venue-806vol",
    );
  });
});
