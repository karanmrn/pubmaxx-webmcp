import { describe, expect, it } from "vitest";

import { toMapLibreColor } from "@/components/map/canvas/tokens";

describe("MapLibre theme colour normalisation", () => {
  it("converts Chromium CSS Color 4 output to MapLibre-safe rgb", () => {
    expect(toMapLibreColor("color(srgb 0.256 0.205804 0.134902)", "#000000"))
      .toBe("rgb(65, 52, 34)");
    expect(
      toMapLibreColor(
        "color(srgb 0.994392 0.955059 0.880706 / 0.82)",
        "#000000",
      ),
    ).toBe("rgba(254, 244, 225, 0.82)");
  });

  it("keeps already supported colours and falls back from unknown syntax", () => {
    expect(toMapLibreColor("rgb(12, 34, 56)", "#000000"))
      .toBe("rgb(12, 34, 56)");
    expect(toMapLibreColor("not-a-colour", "#123456")).toBe("#123456");
  });
});
