import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { classifyLondonBoroughPoint, type BoroughBoundaryCollection } from "@/lib/londonBoroughClassifier";

const boundaries = JSON.parse(readFileSync(path.join(process.cwd(), "data/london_boroughs_simplified.json"), "utf8")) as BoroughBoundaryCollection;

describe("London borough classifier", () => {
  it("classifies a known point using polygon containment", () => {
    expect(classifyLondonBoroughPoint(51.5079, -0.0877, boundaries)).toMatchObject({
      code: "southwark", name: "Southwark", method: "point_in_polygon", confidence: "high",
    });
  });

  it("does not snap an outside point to the nearest borough", () => {
    expect(classifyLondonBoroughPoint(52.4862, -1.8904, boundaries)).toBeNull();
  });
});
