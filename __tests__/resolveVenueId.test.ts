import { describe, it, expect } from "vitest";

import {
  buildVenueResolverIndex,
  resolveVenueId,
} from "@/scripts/whatson/resolveVenueId.mjs";

function canonicalRow(overrides: Record<string, unknown> = {}) {
  return {
    pub_name: "The Test Arms",
    address: "1 Test Street, London, N16 0NY",
    latitude: 51.5,
    longitude: -0.1,
    ...overrides,
  };
}

describe("resolveVenueId", () => {
  it("resolves an exact grouping-key match", () => {
    const canonical = [canonicalRow()];
    const index = buildVenueResolverIndex(canonical);

    const resolved = resolveVenueId(
      { name: "The Test Arms", address: "1 Test Street, London, N16 0NY", lat: 51.5, lng: -0.1 },
      index,
    );

    expect(resolved).toEqual(expect.stringMatching(/^venue-/));
    expect(resolved).toBe([...index.exactByKey.values()][0]);
  });

  it("falls back to a postcode-district-confirmed name match when the exact key misses", () => {
    const canonical = [
      canonicalRow({
        pub_name: "The Rochester Castle",
        address: "145 Stoke Newington High Street, London, N16 0NY",
        latitude: 51.5619,
        longitude: -0.07542,
      }),
    ];
    const index = buildVenueResolverIndex(canonical);

    // Source row's own address string doesn't match the canonical formula
    // (different formatting), but shares a normalized name + postcode district.
    const resolved = resolveVenueId(
      { name: "The Rochester Castle - JD Wetherspoon", postcode: "N16 0AA" },
      index,
    );

    expect(resolved).toBe(index.exactByKey.values().next().value);
  });

  it("falls back to a coordinate-proximity-confirmed name match (<=75m) when no postcode is available", () => {
    const canonical = [
      canonicalRow({
        pub_name: "The Anchor",
        address: "12 River Street, London, SE1 1AA",
        latitude: 51.5045,
        longitude: -0.0865,
      }),
    ];
    const index = buildVenueResolverIndex(canonical);

    // ~50m away from the canonical coordinate, no postcode supplied.
    const resolved = resolveVenueId(
      { name: "The Anchor", lat: 51.50495, lng: -0.08585 },
      index,
    );

    const expectedId = [...index.byNormalizedName.get("anchor")!][0].venueId;
    expect(resolved).toBe(expectedId);
  });

  it("returns null (never guesses) when multiple same-named candidates exist and more than one is confirmed", () => {
    const canonical = [
      canonicalRow({
        pub_name: "The Crown",
        address: "1 High Street, London, E1 1AA",
        latitude: 51.51,
        longitude: -0.07,
      }),
      canonicalRow({
        pub_name: "The Crown",
        address: "2 High Street, London, E1 1AB",
        latitude: 51.5101,
        longitude: -0.0701,
      }),
    ];
    const index = buildVenueResolverIndex(canonical);

    // Same postcode district ("E1") matches both candidates -> ambiguous.
    const resolved = resolveVenueId({ name: "The Crown", postcode: "E1 2CD" }, index);
    expect(resolved).toBeNull();
  });

  it("returns null (never guesses) when multiple same-named candidates exist and none is confirmed", () => {
    const canonical = [
      canonicalRow({
        pub_name: "The Crown",
        address: "1 High Street, London, E1 1AA",
        latitude: 51.51,
        longitude: -0.07,
      }),
      canonicalRow({
        pub_name: "The Crown",
        address: "99 Far Away Road, London, W9 9ZZ",
        latitude: 51.9,
        longitude: -0.9,
      }),
    ];
    const index = buildVenueResolverIndex(canonical);

    const resolved = resolveVenueId({ name: "The Crown", postcode: "SW1 1AA" }, index);
    expect(resolved).toBeNull();
  });

  it("returns null when there is no candidate at all", () => {
    const index = buildVenueResolverIndex([canonicalRow()]);
    const resolved = resolveVenueId({ name: "Nowhere Pub That Does Not Exist" }, index);
    expect(resolved).toBeNull();
  });

  it("returns null when the row has no usable name", () => {
    const index = buildVenueResolverIndex([canonicalRow()]);
    expect(resolveVenueId({ name: "" }, index)).toBeNull();
    expect(resolveVenueId(null as unknown as { name: string }, index)).toBeNull();
  });
});
