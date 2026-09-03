import { describe, expect, it } from "vitest";

import {
  appendWithSuffix,
  buildWithSuffix,
  clampPriceGbp,
  cleanVisibility,
  DEFAULT_VISIBILITY,
  formatPriceGbp,
  MAX_PRICE_GBP,
  MIN_PRICE_GBP,
  parseWithEntries,
  PRICE_STEP_GBP,
  QUICK_ADD_PRICES_GBP,
  stepPrice,
  VISIBILITIES,
} from "@/lib/spill";

describe("spill: price stepper", () => {
  it("steps up from a quick-add price by PRICE_STEP_GBP", () => {
    expect(stepPrice("5", 1)).toBe(String(5 + PRICE_STEP_GBP));
  });

  it("steps down from a quick-add price by PRICE_STEP_GBP", () => {
    expect(stepPrice("5", -1)).toBe(String(5 - PRICE_STEP_GBP));
  });

  it("steps from empty using the first quick-add price as a base", () => {
    expect(stepPrice("", 1)).toBe(formatPriceGbp(QUICK_ADD_PRICES_GBP[0] + PRICE_STEP_GBP));
  });

  it("steps from an unparsable value using the first quick-add price as a base", () => {
    expect(stepPrice("not a number", -1)).toBe(
      formatPriceGbp(QUICK_ADD_PRICES_GBP[0] - PRICE_STEP_GBP),
    );
  });

  it("clamps at the minimum and never goes negative or to zero", () => {
    expect(clampPriceGbp(-5)).toBe(MIN_PRICE_GBP);
    expect(Number(stepPrice(String(MIN_PRICE_GBP), -1))).toBe(MIN_PRICE_GBP);
  });

  it("clamps at the maximum", () => {
    expect(clampPriceGbp(999)).toBe(MAX_PRICE_GBP);
    expect(Number(stepPrice(String(MAX_PRICE_GBP), 1))).toBe(MAX_PRICE_GBP);
  });

  it("collapses NaN/Infinity to the minimum rather than propagating", () => {
    expect(clampPriceGbp(Number.NaN)).toBe(MIN_PRICE_GBP);
    expect(clampPriceGbp(Number.POSITIVE_INFINITY)).toBe(MAX_PRICE_GBP);
    expect(clampPriceGbp(Number.NEGATIVE_INFINITY)).toBe(MIN_PRICE_GBP);
  });

  it("avoids floating point drift over repeated steps", () => {
    let value = "4";
    for (let i = 0; i < 10; i += 1) value = stepPrice(value, 1);
    // 4 + 10*0.1 = 5, exactly, with no trailing .0999999999998 drift.
    expect(value).toBe("5");
  });

  it("formats whole numbers without a trailing decimal", () => {
    expect(formatPriceGbp(5)).toBe("5");
  });

  it("formats fractional prices without floating point noise", () => {
    expect(formatPriceGbp(4.5)).toBe("4.5");
  });
});

describe("spill: with-suffix builder", () => {
  it("returns an empty suffix for empty input", () => {
    expect(buildWithSuffix("")).toBe("");
    expect(buildWithSuffix("   ")).toBe("");
  });

  it("builds a suffix from comma-separated handles", () => {
    expect(buildWithSuffix("@sam, @priya")).toBe("with @sam, @priya");
  });

  it("builds a suffix from space-separated handles", () => {
    expect(buildWithSuffix("@sam @priya")).toBe("with @sam, @priya");
  });

  it("accepts free text alongside handles", () => {
    expect(buildWithSuffix("@sam, the lads")).toBe("with @sam, the, lads");
  });

  it("dedupes repeated entries", () => {
    expect(parseWithEntries("@sam, @sam, @priya")).toEqual(["@sam", "@priya"]);
  });

  it("caps the number of entries", () => {
    const many = Array.from({ length: 10 }, (_, i) => `@p${i}`).join(", ");
    expect(parseWithEntries(many).length).toBeLessThanOrEqual(6);
  });

  it("caps per-entry length", () => {
    const long = "@" + "a".repeat(100);
    const [entry] = parseWithEntries(long);
    expect(entry.length).toBeLessThanOrEqual(30);
  });

  it("appends the suffix to a non-empty note with a separating space", () => {
    expect(appendWithSuffix("Great pint.", "@sam")).toBe("Great pint. with @sam");
  });

  it("returns just the suffix when the note is empty", () => {
    expect(appendWithSuffix("", "@sam")).toBe("with @sam");
  });

  it("returns the note unchanged when there is no with value", () => {
    expect(appendWithSuffix("Great pint.", "")).toBe("Great pint.");
  });

  it("trims the note before appending", () => {
    expect(appendWithSuffix("  Great pint.  ", "@sam")).toBe("Great pint. with @sam");
  });
});

describe("spill: visibility re-export", () => {
  it("re-exports the same allowlist as lib/pintDrops", () => {
    expect(VISIBILITIES).toEqual(["public", "friends", "legacy", "anonymous"]);
  });

  it("defaults to public", () => {
    expect(DEFAULT_VISIBILITY).toBe("public");
  });

  it("cleanVisibility collapses unknown values to the default", () => {
    expect(cleanVisibility("nonsense")).toBe("public");
    expect(cleanVisibility(undefined)).toBe("public");
  });

  it("cleanVisibility passes through allowlisted values", () => {
    expect(cleanVisibility("friends")).toBe("friends");
    expect(cleanVisibility("legacy")).toBe("legacy");
    expect(cleanVisibility("anonymous")).toBe("anonymous");
  });
});
