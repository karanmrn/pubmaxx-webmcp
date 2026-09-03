import { describe, expect, it } from "vitest";

import { shortDrinkVerdict } from "@/lib/conditionsFormat";

describe("shortDrinkVerdict", () => {
  it("keeps only the first sentence for chip-sized surfaces", () => {
    expect(shortDrinkVerdict("Beer garden weather. Lager or cider.")).toBe(
      "Beer garden weather.",
    );
    expect(shortDrinkVerdict("Cold one tonight. Stout weather.")).toBe(
      "Cold one tonight.",
    );
  });

  it("passes through a single-sentence line without a trailing stop", () => {
    expect(shortDrinkVerdict("Bitter weather")).toBe("Bitter weather");
  });

  it("returns null for empty input so hosts can skip the segment", () => {
    expect(shortDrinkVerdict("")).toBeNull();
    expect(shortDrinkVerdict("   ")).toBeNull();
  });
});
