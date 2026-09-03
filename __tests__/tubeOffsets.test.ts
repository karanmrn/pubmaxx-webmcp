import { describe, it, expect } from "vitest";
import type { FeatureCollection, Feature } from "geojson";

import {
  coordKey,
  segmentKey,
  sharedSegmentLineCount,
  offsetIndexForLine,
  assignLineOffsets,
  SUBSURFACE_FAN_ORDER,
} from "@/lib/tubeOffsets";

function line(name: string, coords: number[][]): Feature {
  return {
    type: "Feature",
    properties: { line: name, color: "#123456" },
    geometry: { type: "LineString", coordinates: coords },
  };
}

describe("segment keys", () => {
  it("rounds coordinates to a stable key (~11 m)", () => {
    expect(coordKey([-0.12461, 51.50072])).toBe("-0.1246,51.5007");
    // Two points inside the same 4dp cell collapse to one key.
    expect(coordKey([-0.12463, 51.50069])).toBe(coordKey([-0.12461, 51.50072]));
  });

  it("segmentKey is undirected — A->B equals B->A", () => {
    const a = [-0.1, 51.5];
    const b = [-0.09, 51.51];
    expect(segmentKey(a, b)).toBe(segmentKey(b, a));
  });
});

describe("sharedSegmentLineCount", () => {
  it("counts distinct lines per shared undirected segment", () => {
    const shared: number[][] = [
      [-0.1, 51.5],
      [-0.09, 51.51],
    ];
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        line("District", shared),
        // Circle draws the same edge reversed — must still be detected as shared.
        line("Circle", [shared[1], shared[0]]),
        // A lone edge only District walks.
        line("District", [
          [-0.09, 51.51],
          [-0.08, 51.52],
        ]),
      ],
    };
    const counts = sharedSegmentLineCount(fc);
    expect(counts.get(segmentKey(shared[0], shared[1]))).toBe(2);
    expect(counts.get(segmentKey([-0.09, 51.51], [-0.08, 51.52]))).toBe(1);
  });
});

describe("offset index assignment", () => {
  it("fans the four sub-surface lines symmetrically about zero", () => {
    const indices = SUBSURFACE_FAN_ORDER.map(offsetIndexForLine);
    expect(indices).toEqual([-1.5, -0.5, 0.5, 1.5]);
    // Symmetric: mirrors sum to zero, mean is zero.
    expect(indices.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("centres any line outside the fan group", () => {
    expect(offsetIndexForLine("Central")).toBe(0);
    expect(offsetIndexForLine("Victoria")).toBe(0);
    expect(offsetIndexForLine("")).toBe(0);
  });

  it("is stable — same line always gets the same index", () => {
    expect(offsetIndexForLine("District")).toBe(offsetIndexForLine("District"));
    expect(offsetIndexForLine("Circle")).toBe(offsetIndexForLine("Circle"));
  });
});

describe("assignLineOffsets", () => {
  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      line("District", [[-0.1, 51.5], [-0.09, 51.51]]),
      line("Central", [[-0.1, 51.5], [-0.09, 51.51]]),
    ],
  };

  it("stamps offsetIndex without mutating the input or dropping properties", () => {
    const out = assignLineOffsets(fc);
    expect(fc.features[0].properties).not.toHaveProperty("offsetIndex"); // input untouched
    expect(out.features[0].properties?.offsetIndex).toBe(offsetIndexForLine("District"));
    expect(out.features[1].properties?.offsetIndex).toBe(0);
    // Existing properties survive.
    expect(out.features[0].properties?.line).toBe("District");
    expect(out.features[0].properties?.color).toBe("#123456");
  });

  it("is idempotent — re-running yields the same indices", () => {
    const once = assignLineOffsets(fc);
    const twice = assignLineOffsets(once);
    expect(twice.features.map((f) => f.properties?.offsetIndex)).toEqual(
      once.features.map((f) => f.properties?.offsetIndex),
    );
  });
});
