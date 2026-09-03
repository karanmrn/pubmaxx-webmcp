import { describe, expect, it } from "vitest";

import { tonightLocalityBasis } from "@/lib/tonight";

// The locality basis reported on tonight_result_opened (§4.9). It must match the
// order the list was actually built from — never claim a basis we did not use.
describe("tonightLocalityBasis", () => {
  it("reports live-location when the viewer shared a position", () => {
    expect(tonightLocalityBasis(true, null)).toBe("live-location");
    // A live position wins even if a patch is also remembered.
    expect(tonightLocalityBasis(true, { near: { lat: 51.5, lng: -0.13 }, patchLabel: "Soho" })).toBe(
      "live-location",
    );
  });

  it("reports remembered-patch when ordering came from a resolved patch centre", () => {
    expect(
      tonightLocalityBasis(false, { near: { lat: 51.5, lng: -0.13 }, patchLabel: "Soho" }),
    ).toBe("remembered-patch");
  });

  it("reports london-default when there is no live position and no resolved patch", () => {
    // Covers no area and a remembered borough (no canonical centroid, so it orders
    // london-default) — resolveTonightNear returns null in both cases.
    expect(tonightLocalityBasis(false, null)).toBe("london-default");
  });
});
