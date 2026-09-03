import { describe, expect, it } from "vitest";

import { buildTonightPosterModel, clampPosterText } from "@/lib/tonightPoster";

describe("clampPosterText", () => {
  it("strips control chars, collapses whitespace, and trims", () => {
    expect(clampPosterText("  Live\tjazz\n night ")).toBe("Live jazz night");
  });

  it("truncates over-long text with an ellipsis", () => {
    expect(clampPosterText("x".repeat(60), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("returns '' for empty/nullish", () => {
    expect(clampPosterText(null)).toBe("");
    expect(clampPosterText(undefined)).toBe("");
    expect(clampPosterText("   ")).toBe("");
  });
});

describe("buildTonightPosterModel", () => {
  it("derives coverage, up to 3 clamped titles, and a provenance line", () => {
    const model = buildTonightPosterModel({
      asOf: "2026-07-12T18:00:00Z",
      opportunities: [
        { title: "Jazz at the Blue Post" },
        { title: "Quiz night" },
        { title: "Comedy cellar" },
        { title: "Fourth event (dropped)" },
      ],
    });
    expect(model.title).toBe("Tonight in London");
    expect(model.coverage).toBe("4 things on tonight");
    expect(model.titles).toEqual(["Jazz at the Blue Post", "Quiz night", "Comedy cellar"]);
    expect(model.provenance).toBe("Checked 12 Jul · via CityMCP London");
  });

  it("renders a clean generic poster for an empty/null result", () => {
    const model = buildTonightPosterModel(null);
    expect(model.coverage).toBe("Nothing confirmed tonight yet");
    expect(model.titles).toEqual([]);
    expect(model.provenance).toBe("No date on this yet · via CityMCP London");
  });

  it("skips blank titles when collecting teasers", () => {
    const model = buildTonightPosterModel({
      opportunities: [{ title: "   " }, { title: "Real one" }],
    });
    expect(model.titles).toEqual(["Real one"]);
  });
});
