import { describe, expect, it } from "vitest";

import { LONDON_BOUNDS, LONDON_VIEW, UK_BOUNDS } from "@/components/map/canvas/tokens";
import { CITIES, cityMaxBounds } from "@/lib/cities";

function contains(
  bounds: [[number, number], [number, number]],
  [lng, lat]: [number, number],
): boolean {
  return (
    lng >= bounds[0][0] &&
    lng <= bounds[1][0] &&
    lat >= bounds[0][1] &&
    lat <= bounds[1][1]
  );
}

describe("UK map camera bounds", () => {
  it("admits Leeds while the London-only bounds do not", () => {
    const leeds: [number, number] = [-1.5491, 53.8008];

    expect(contains(UK_BOUNDS, leeds)).toBe(true);
    expect(contains(LONDON_BOUNDS, leeds)).toBe(false);
  });

  it("keeps national overview separate from the London base-layer arrival", () => {
    expect(LONDON_VIEW).toEqual({
      center: [-0.12, 51.52],
      zoom: 10.7,
      pitch: 42,
      bearing: -12,
    });
    expect(CITIES.london.mapView).toEqual({
      center: [-0.12, 51.52],
      zoom: 12,
      pitch: 38,
      bearing: -8,
    });
  });

  it("keeps active-city framing separate from the UK camera clamp", () => {
    const manchesterBounds = cityMaxBounds(CITIES.manchester);
    const leeds: [number, number] = [-1.5491, 53.8008];

    expect(contains(manchesterBounds, CITIES.manchester.mapView.center)).toBe(true);
    expect(contains(manchesterBounds, leeds)).toBe(false);
    expect(manchesterBounds).not.toEqual(UK_BOUNDS);
    expect(contains(UK_BOUNDS, leeds)).toBe(true);
  });
});
