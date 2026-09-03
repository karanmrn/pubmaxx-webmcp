import { describe, expect, it } from "vitest";

import { roundVitalValue, sanitizeVitalTarget, vitalEventProps } from "@/lib/webVitals";

describe("roundVitalValue", () => {
  it("rounds CLS to 3 dp and other metrics to whole ms", () => {
    expect(roundVitalValue("CLS", 0.123456)).toBe(0.123);
    expect(roundVitalValue("LCP", 2345.6)).toBe(2346);
    expect(roundVitalValue("TTFB", 120.4)).toBe(120);
  });

  it("clamps negative or non-finite values to 0", () => {
    expect(roundVitalValue("INP", -5)).toBe(0);
    expect(roundVitalValue("TTFB", Number.NaN)).toBe(0);
    expect(roundVitalValue("LCP", Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("sanitizeVitalTarget", () => {
  it("keeps a structural CSS selector", () => {
    expect(sanitizeVitalTarget("main>div.hero>img")).toBe("main>div.hero>img");
    expect(sanitizeVitalTarget("button#submit")).toBe("button#submit");
  });

  it("drops anything carrying a URL, handle, query, or attribute value", () => {
    expect(sanitizeVitalTarget('a[href="https://x.com/dave"]')).toBeNull();
    expect(sanitizeVitalTarget("img[src=http://a]")).toBeNull();
    expect(sanitizeVitalTarget("[data-user=dave@x.com]")).toBeNull();
    expect(sanitizeVitalTarget("div?x")).toBeNull();
  });

  it("drops empty and non-string inputs", () => {
    expect(sanitizeVitalTarget("")).toBeNull();
    expect(sanitizeVitalTarget("   ")).toBeNull();
    expect(sanitizeVitalTarget(null)).toBeNull();
    expect(sanitizeVitalTarget(123)).toBeNull();
  });

  it("caps the selector length at 80", () => {
    const out = sanitizeVitalTarget("div>".repeat(30));
    expect(out).not.toBeNull();
    expect(out).toHaveLength(80);
  });
});

describe("vitalEventProps", () => {
  it("builds a privacy-safe event payload with the route template", () => {
    expect(
      vitalEventProps({
        metric: "LCP",
        value: 2345.6,
        rating: "good",
        pathname: "/plan/abc-123?vibe=big",
        target: "main>img.hero",
      }),
    ).toEqual({ metric: "LCP", value: 2346, rating: "good", route: "/plan/[id]", target: "main>img.hero" });
  });

  it("omits target when attribution is absent or unsafe", () => {
    expect(
      vitalEventProps({ metric: "CLS", value: 0.05, rating: "good", pathname: "/near", target: null }),
    ).toEqual({ metric: "CLS", value: 0.05, rating: "good", route: "/near" });
    expect(
      vitalEventProps({ metric: "INP", value: 180, rating: "needs-improvement", pathname: "/x", target: "a[href=http://y]" }).target,
    ).toBeUndefined();
  });
});
