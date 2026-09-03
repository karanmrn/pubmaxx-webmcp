import { describe, expect, it } from "vitest";

import { summarizeCityPubCoverage } from "@/lib/cityMapCoverage";

describe("summarizeCityPubCoverage", () => {
  it("uses only pub rows for mapped count and pint range", () => {
    expect(
      summarizeCityPubCoverage([
        { cheapestPrice: 4.5 },
        { kind: "pub", cheapestPrice: 7 },
        { kind: "bar", cheapestPrice: 18 },
        { kind: "food", cheapestPrice: 28 },
      ]),
    ).toEqual({ count: 2, min: 4.5, max: 7 });
  });

  it("reads revisioned slim payloads", () => {
    expect(
      summarizeCityPubCoverage({
        revision: "deploy-1",
        rows: [{ kind: "pub", cheapestPrice: 6 }],
      }),
    ).toEqual({ count: 1, min: 6, max: 6 });
  });

  it("returns empty coverage for malformed input", () => {
    expect(summarizeCityPubCoverage(null)).toEqual({
      count: 0,
      min: null,
      max: null,
    });
  });
});
