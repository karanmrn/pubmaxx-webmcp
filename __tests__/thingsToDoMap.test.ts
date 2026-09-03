import { describe, expect, it } from "vitest";

import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import {
  labelForKind,
  opportunitiesToGeoJSON,
  opportunityMapHref,
} from "@/lib/thingsToDoMap";

describe("labelForKind", () => {
  it("humanises kind slugs", () => {
    expect(labelForKind("food_drink")).toBe("Food drink");
    expect(labelForKind("gig")).toBe("Gig");
    expect(labelForKind(undefined)).toBeNull();
    expect(labelForKind("")).toBeNull();
  });
});

describe("opportunityMapHref", () => {
  it("returns a London map deep-link only when lat/lng are finite", () => {
    const withLoc: ThingsToDoOpportunity = {
      title: "Jazz",
      place: {
        name: "Blue Post",
        location: { lat: 51.52601, lng: -0.07802 },
      },
    };
    const href = opportunityMapHref(withLoc);
    expect(href).toMatch(/^\/map\?/);
    expect(href).toContain("lat=51.52601");
    expect(href).toContain("lng=-0.07802");
    expect(href).toContain("q=Blue+Post");

    expect(
      opportunityMapHref({ title: "No coords", place: { name: "Somewhere" } }),
    ).toBeNull();
    expect(
      opportunityMapHref({
        title: "NaN",
        place: { location: { lat: Number.NaN, lng: -0.1 } },
      }),
    ).toBeNull();
  });
});

describe("opportunitiesToGeoJSON", () => {
  it("includes only features with finite place.location", () => {
    const ops: ThingsToDoOpportunity[] = [
      {
        title: "With coords",
        kind: "gig",
        place: {
          id: "ChIJ1",
          name: "Venue A",
          area: "Soho",
          location: { lat: 51.51, lng: -0.13 },
        },
        source: { label: "Time Out", url: "https://example.com/a" },
      },
      {
        title: "Missing location",
        place: { name: "Venue B", area: "Shoreditch" },
      },
      {
        title: "Non-finite",
        place: { location: { lat: Number.NaN, lng: -0.1 } },
      },
      {
        title: "Also good",
        place: { name: "Venue C", location: { lat: 51.52, lng: -0.08 } },
      },
    ];

    const fc = opportunitiesToGeoJSON(ops);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    expect(fc.features.map((f) => f.properties?.title)).toEqual([
      "With coords",
      "Also good",
    ]);
    expect(fc.features[0]?.geometry).toEqual({
      type: "Point",
      coordinates: [-0.13, 51.51],
    });
    expect(fc.features[0]?.properties).toMatchObject({
      title: "With coords",
      kind: "gig",
      kindLabel: "Gig",
      placeId: "ChIJ1",
      placeName: "Venue A",
      area: "Soho",
    });
  });
});
