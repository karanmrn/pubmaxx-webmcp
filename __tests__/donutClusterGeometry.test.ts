import { describe, expect, it } from "vitest";

import {
  buildDonutMarkerSvg,
  buildDonutStrokeSegments,
  donutOuterRadius,
  donutTotal,
  formatDonutCount,
  type DonutCounts,
} from "@/lib/donutClusterGeometry";

const COLORS = ["#2f8f5b", "#d99f45", "#d16353", "#6b726a"];

describe("donutOuterRadius", () => {
  it("mirrors the product-weight cluster-circle step expression", () => {
    expect(donutOuterRadius(1)).toBe(11);
    expect(donutOuterRadius(24)).toBe(11);
    expect(donutOuterRadius(25)).toBe(15);
    expect(donutOuterRadius(99)).toBe(15);
    expect(donutOuterRadius(100)).toBe(20);
    expect(donutOuterRadius(1000)).toBe(20);
  });
});

describe("donutTotal", () => {
  it("sums all buckets", () => {
    expect(donutTotal([3, 1, 0, 2])).toBe(6);
    expect(donutTotal([0, 0, 0, 0])).toBe(0);
  });
});

describe("buildDonutStrokeSegments", () => {
  it("returns one segment per non-zero bucket, proportional to share of total", () => {
    const counts: DonutCounts = [3, 1, 0, 0];
    const radius = 10;
    const circumference = 2 * Math.PI * radius;
    const segments = buildDonutStrokeSegments(counts, COLORS, radius);
    expect(segments).toHaveLength(2);
    expect(segments[0].index).toBe(0);
    expect(segments[0].color).toBe(COLORS[0]);
    expect(segments[1].index).toBe(1);

    // First segment's arc length is 3/4 of the circumference.
    const [firstArc] = segments[0].dasharray.split(" ").map(Number);
    expect(firstArc).toBeCloseTo(circumference * 0.75, 2);
    // Segments are laid end to end: the second starts where the first ends.
    expect(segments[1].dashoffset).toBeCloseTo(-firstArc, 2);
    expect(segments[0].dashoffset).toBeCloseTo(0, 5);
  });

  it("returns no segments when every bucket is empty or radius is non-positive", () => {
    expect(buildDonutStrokeSegments([0, 0, 0, 0], COLORS, 10)).toEqual([]);
    expect(buildDonutStrokeSegments([1, 0, 0, 0], COLORS, 0)).toEqual([]);
  });

  it("omits zero-count buckets entirely (proportional to what actually renders)", () => {
    const segments = buildDonutStrokeSegments([0, 5, 0, 5], COLORS, 10);
    expect(segments.map((s) => s.index)).toEqual([1, 3]);
  });
});

describe("formatDonutCount", () => {
  it("matches supercluster's point_count_abbreviated exactly", () => {
    expect(formatDonutCount(3)).toBe("3");
    expect(formatDonutCount(999)).toBe("999");
    expect(formatDonutCount(1000)).toBe("1k");
    expect(formatDonutCount(1500)).toBe("1.5k");
    expect(formatDonutCount(9999)).toBe("10k");
    expect(formatDonutCount(10000)).toBe("10k");
    expect(formatDonutCount(12345)).toBe("12k");
  });
});

describe("buildDonutMarkerSvg", () => {
  it("renders an svg with one circle per non-zero bucket plus the count label", () => {
    const svg = buildDonutMarkerSvg({
      counts: [2, 1, 0, 0],
      colors: COLORS,
      ringColor: "#ffffff",
      textColor: "#111111",
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain(">3<"); // total count in the hole
    expect((svg.match(/data-bucket="0"/g) ?? []).length).toBe(1);
    expect((svg.match(/data-bucket="1"/g) ?? []).length).toBe(1);
    expect(svg).not.toContain('data-bucket="2"');
    expect(svg).not.toContain('data-bucket="3"');
    expect(svg).toContain(COLORS[0]);
    expect(svg).toContain(COLORS[1]);
  });

  it("scales size with the legacy radius steps", () => {
    const small = buildDonutMarkerSvg({
      counts: [10, 0, 0, 0],
      colors: COLORS,
      ringColor: "#fff",
      textColor: "#000",
    });
    const large = buildDonutMarkerSvg({
      counts: [150, 0, 0, 0],
      colors: COLORS,
      ringColor: "#fff",
      textColor: "#000",
    });
    const widthOf = (svg: string) => Number(/width="([\d.]+)"/.exec(svg)?.[1]);
    expect(widthOf(large)).toBeGreaterThan(widthOf(small));
  });
});
