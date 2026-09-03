import { describe, expect, it } from "vitest";

import {
  CACHE_COORD_DP,
  encodeStops,
  isValidLngLat,
  legCacheKey,
  legDistances,
  legsToLineString,
  parseStops,
  polylineDistanceKm,
  roundCoord,
  routeSource,
  stitchLegCoordinates,
  stopPairs,
  straightLegCoordinates,
  straightLegs,
  type LngLat,
  type WalkLeg,
} from "@/lib/walkRoute";
import { haversineKm } from "@/lib/haversine";

// Two real central-London pub coordinates, [lng, lat].
const A: LngLat = [-0.1005, 51.5136];
const B: LngLat = [-0.0975, 51.5142];
const C: LngLat = [-0.0951, 51.5155];

describe("roundCoord + legCacheKey", () => {
  it("rounds to the documented precision", () => {
    expect(roundCoord(-0.10054321)).toBe(-0.10054);
    expect(CACHE_COORD_DP).toBe(5);
  });

  it("keys the same ordered pair identically within precision, and is direction-sensitive", () => {
    expect(legCacheKey(A, B)).toBe(legCacheKey([-0.100501, 51.513604], B));
    expect(legCacheKey(A, B)).not.toBe(legCacheKey(B, A));
  });
});

describe("isValidLngLat", () => {
  it("accepts in-range finite pairs and rejects everything else", () => {
    expect(isValidLngLat(A)).toBe(true);
    expect(isValidLngLat([0, 0])).toBe(true);
    expect(isValidLngLat([200, 0])).toBe(false);
    expect(isValidLngLat([0, 91])).toBe(false);
    expect(isValidLngLat([Number.NaN, 0])).toBe(false);
    expect(isValidLngLat([0])).toBe(false);
    expect(isValidLngLat("nope")).toBe(false);
  });
});

describe("encodeStops / parseStops round-trip", () => {
  it("round-trips a valid ordered list", () => {
    expect(parseStops(encodeStops([A, B, C]))).toEqual([A, B, C]);
  });

  it("drops malformed and out-of-range pairs, never throws", () => {
    expect(parseStops("-0.1005,51.5136;nan,nan;;200,0;-0.0975,51.5142")).toEqual([A, B]);
    expect(parseStops("")).toEqual([]);
    expect(parseStops(null)).toEqual([]);
    expect(parseStops(undefined)).toEqual([]);
  });
});

describe("stopPairs + straightLegs", () => {
  it("yields N-1 adjacent legs, straight by default", () => {
    expect(stopPairs([A, B, C])).toHaveLength(2);
    const legs = straightLegs([A, B, C]);
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ fromIndex: 0, toIndex: 1, source: "straight" });
    expect(legs[0].coordinates).toEqual(straightLegCoordinates(A, B));
    expect(legs[1]).toMatchObject({ fromIndex: 1, toIndex: 2, source: "straight" });
  });

  it("yields no legs for fewer than two stops", () => {
    expect(straightLegs([A])).toEqual([]);
    expect(straightLegs([])).toEqual([]);
  });
});

describe("stitchLegCoordinates", () => {
  it("drops the duplicated shared vertex between adjacent legs", () => {
    const routed: LngLat[] = [
      [-0.1005, 51.5136],
      [-0.099, 51.5139],
      [-0.0975, 51.5142],
    ];
    const next: LngLat[] = [
      [-0.0975, 51.5142],
      [-0.0951, 51.5155],
    ];
    expect(stitchLegCoordinates([routed, next])).toEqual([
      [-0.1005, 51.5136],
      [-0.099, 51.5139],
      [-0.0975, 51.5142],
      [-0.0951, 51.5155],
    ]);
  });
});

describe("routeSource", () => {
  it("is ors only when every leg is routed", () => {
    const straight: WalkLeg = { fromIndex: 0, toIndex: 1, coordinates: [A, B], source: "straight" };
    const ors: WalkLeg = { fromIndex: 1, toIndex: 2, coordinates: [B, C], source: "ors" };
    expect(routeSource([straight, straight])).toBe("straight");
    expect(routeSource([straight, ors])).toBe("straight");
    expect(routeSource([])).toBe("straight");
  });
});

describe("legsToLineString", () => {
  it("stitches legs into one LineString carrying the source flag", () => {
    const legs = straightLegs([A, B, C]);
    const fc = legsToLineString(legs);
    expect(fc.features).toHaveLength(1);
    const feature = fc.features[0];
    expect(feature.geometry.type).toBe("LineString");
    expect(feature.properties).toEqual({ source: "straight" });
    expect((feature.geometry as GeoJSON.LineString).coordinates).toEqual([A, B, C]);
  });

  it("keeps a mixed line approximate when one leg lacks routed geometry", () => {
    const legs: WalkLeg[] = [
      { fromIndex: 0, toIndex: 1, coordinates: [A, [-0.099, 51.5139], B], source: "ors" },
      { fromIndex: 1, toIndex: 2, coordinates: [B, C], source: "straight" },
    ];
    const fc = legsToLineString(legs);
    expect(fc.features[0].properties).toEqual({ source: "straight" });
    expect((fc.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([
      A,
      [-0.099, 51.5139],
      B,
      C,
    ]);
  });

  it("returns an empty collection when there is nothing drawable", () => {
    expect(legsToLineString([]).features).toEqual([]);
  });
});

describe("polylineDistanceKm", () => {
  it("measures nothing for fewer than two points", () => {
    expect(polylineDistanceKm([])).toBe(0);
    expect(polylineDistanceKm([A])).toBe(0);
  });

  it("equals the straight haversine distance for a two-point leg", () => {
    expect(polylineDistanceKm([A, B])).toBeCloseTo(haversineKm(A, B), 9);
  });

  it("sums every hop, so a dog-leg is longer than the straight line", () => {
    const via: LngLat = [-0.098, 51.516];
    const routed = polylineDistanceKm([A, via, B]);
    expect(routed).toBeCloseTo(haversineKm(A, via) + haversineKm(via, B), 9);
    expect(routed).toBeGreaterThan(polylineDistanceKm([A, B]));
  });
});

describe("legDistances", () => {
  it("reports each leg's measured length and source, in order", () => {
    const legs: WalkLeg[] = [
      { fromIndex: 0, toIndex: 1, coordinates: [A, [-0.098, 51.516], B], source: "ors" },
      { fromIndex: 1, toIndex: 2, coordinates: [B, C], source: "straight" },
    ];
    const distances = legDistances(legs);
    expect(distances[0]).toMatchObject({ fromIndex: 0, toIndex: 1, source: "ors" });
    expect(distances[0].distanceKm).toBeCloseTo(polylineDistanceKm(legs[0].coordinates), 9);
    expect(distances[1]).toMatchObject({ fromIndex: 1, toIndex: 2, source: "straight" });
    expect(distances[1].distanceKm).toBeCloseTo(haversineKm(B, C), 9);
  });
});
