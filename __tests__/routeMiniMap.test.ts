import { describe, expect, it } from "vitest";

import {
  boundsFromCoords,
  lineCoordsFromFeatureCollection,
  projectCoords,
  projectPoint,
  stopsParam,
  svgPath,
  type LngLat,
  type Viewport,
} from "@/lib/routeMiniMap";

const VP: Viewport = { width: 320, height: 176, padding: 26 };

// A small Soho-ish two-stop crawl (lng, lat).
const A: LngLat = [-0.14, 51.51];
const B: LngLat = [-0.13, 51.52];

describe("boundsFromCoords", () => {
  it("returns null for no coordinates", () => {
    expect(boundsFromCoords([])).toBeNull();
  });

  it("wraps the tight extent of the coordinates", () => {
    expect(boundsFromCoords([A, B])).toEqual({
      minLng: -0.14,
      minLat: 51.51,
      maxLng: -0.13,
      maxLat: 51.52,
    });
  });

  it("ignores non-finite coordinates", () => {
    const bounds = boundsFromCoords([A, [Number.NaN, Number.NaN] as LngLat, B]);
    expect(bounds).toEqual({ minLng: -0.14, minLat: 51.51, maxLng: -0.13, maxLat: 51.52 });
  });

  it("returns null when every coordinate is non-finite", () => {
    expect(boundsFromCoords([[Infinity, Infinity]])).toBeNull();
  });
});

describe("projectPoint", () => {
  const bounds = boundsFromCoords([A, B])!;

  it("keeps points inside the padded viewport", () => {
    for (const coord of [A, B]) {
      const { x, y } = projectPoint(coord, bounds, VP);
      expect(x).toBeGreaterThanOrEqual(VP.padding - 0.01);
      expect(x).toBeLessThanOrEqual(VP.width - VP.padding + 0.01);
      expect(y).toBeGreaterThanOrEqual(VP.padding - 0.01);
      expect(y).toBeLessThanOrEqual(VP.height - VP.padding + 0.01);
    }
  });

  it("puts north at the top (higher latitude -> smaller y)", () => {
    const south = projectPoint([-0.135, 51.51], bounds, VP);
    const north = projectPoint([-0.135, 51.52], bounds, VP);
    expect(north.y).toBeLessThan(south.y);
  });

  it("puts east to the right (larger longitude -> larger x)", () => {
    const west = projectPoint([-0.14, 51.515], bounds, VP);
    const east = projectPoint([-0.13, 51.515], bounds, VP);
    expect(east.x).toBeGreaterThan(west.x);
  });

  it("centres coincident coordinates instead of dividing by zero", () => {
    const flat = boundsFromCoords([A, A])!;
    const { x, y } = projectPoint(A, flat, VP);
    expect(x).toBeCloseTo(VP.width / 2, 5);
    expect(y).toBeCloseTo(VP.height / 2, 5);
  });

  it("vertically centres a wide, latitude-flat route", () => {
    // Big longitude span, negligible latitude span -> width drives the fit and
    // the thin line sits on the vertical centre line.
    const wide = boundsFromCoords([[-0.2, 51.5], [0.0, 51.5000001]])!;
    const mid = projectPoint([-0.1, 51.5], wide, VP);
    expect(mid.y).toBeCloseTo(VP.height / 2, 2);
  });
});

describe("projectCoords", () => {
  it("projects each coordinate against the shared bounds", () => {
    const bounds = boundsFromCoords([A, B])!;
    const points = projectCoords([A, B], bounds, VP);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual(projectPoint(A, bounds, VP));
  });
});

describe("svgPath", () => {
  it("returns an empty string for fewer than two points", () => {
    expect(svgPath([])).toBe("");
    expect(svgPath([{ x: 1, y: 2 }])).toBe("");
  });

  it("builds an M/L polyline rounded to two decimals", () => {
    const d = svgPath([
      { x: 10.123, y: 20.987 },
      { x: 30, y: 40.5 },
    ]);
    expect(d).toBe("M10.12 20.99 L30 40.5");
  });
});

describe("stopsParam", () => {
  it("joins coordinates as lng,lat pairs separated by semicolons", () => {
    expect(stopsParam([A, B])).toBe("-0.14,51.51;-0.13,51.52");
  });
});

describe("lineCoordsFromFeatureCollection", () => {
  it("reads the coordinates from the first LineString feature", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[-0.14, 51.51], [-0.135, 51.515], [-0.13, 51.52]] },
        },
      ],
    };
    expect(lineCoordsFromFeatureCollection(fc)).toEqual([
      [-0.14, 51.51],
      [-0.135, 51.515],
      [-0.13, 51.52],
    ]);
  });

  it("returns [] for an empty collection", () => {
    expect(lineCoordsFromFeatureCollection({ type: "FeatureCollection", features: [] })).toEqual([]);
  });

  it("skips malformed vertices and non-LineString geometry", () => {
    const fc = {
      features: [
        { geometry: { type: "Point", coordinates: [-0.14, 51.51] } },
        { geometry: { type: "LineString", coordinates: [[-0.14, 51.51], ["x", null], [-0.13, 51.52]] } },
      ],
    };
    expect(lineCoordsFromFeatureCollection(fc)).toEqual([[-0.14, 51.51], [-0.13, 51.52]]);
  });

  it("returns [] for junk input", () => {
    expect(lineCoordsFromFeatureCollection(null)).toEqual([]);
    expect(lineCoordsFromFeatureCollection("nope")).toEqual([]);
    expect(lineCoordsFromFeatureCollection({ features: "nope" })).toEqual([]);
  });
});
