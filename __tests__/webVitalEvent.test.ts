import { describe, expect, it } from "vitest";

import { sanitizeEvent } from "@/lib/analyticsEvents";

// The web_vital event through the L02 registry sanitizer: required props fail
// closed, an unknown route pattern (a raw path) can never pass, and no venue
// id or free text survives.
const base = { metric: "LCP", value: 2400, rating: "good", route: "/plan/[id]" };

describe("sanitizeEvent(web_vital)", () => {
  it("keeps a full valid vital including a sanitized attribution target", () => {
    expect(sanitizeEvent("web_vital", { ...base, target: "main>img.hero" })).toEqual({
      name: "web_vital",
      props: { ...base, target: "main>img.hero" },
    });
  });

  it("keeps a vital without the optional target", () => {
    expect(sanitizeEvent("web_vital", base)?.props).toEqual(base);
  });

  it("accepts a fractional CLS value", () => {
    expect(sanitizeEvent("web_vital", { ...base, metric: "CLS", value: 0.042 })?.props.value).toBe(0.042);
  });

  it("rejects the whole event when required route is missing", () => {
    expect(sanitizeEvent("web_vital", { metric: "LCP", value: 2400, rating: "good" })).toBeNull();
  });

  it("rejects an unknown route pattern so a raw path can never leak", () => {
    expect(sanitizeEvent("web_vital", { ...base, route: "/plan/dave-stag-do" })).toBeNull();
    expect(sanitizeEvent("web_vital", { ...base, route: "/plan/[id]?vibe=big" })).toBeNull();
  });

  it("rejects an out-of-set metric or rating", () => {
    expect(sanitizeEvent("web_vital", { ...base, metric: "map" })).toBeNull();
    expect(sanitizeEvent("web_vital", { ...base, rating: "great" })).toBeNull();
  });

  it("rejects a negative value", () => {
    expect(sanitizeEvent("web_vital", { ...base, value: -1 })).toBeNull();
  });

  it("drops an unsafe attribution target but keeps the vital", () => {
    const event = sanitizeEvent("web_vital", { ...base, target: 'a[href="http://x/dave"]' });
    expect(event?.props.target).toBeUndefined();
    expect(event?.props.route).toBe("/plan/[id]");
  });

  it("drops unknown props like a raw path", () => {
    const event = sanitizeEvent("web_vital", { ...base, rawPath: "/plan/secret-id" });
    expect(event?.props).toEqual(base);
    expect(JSON.stringify(event)).not.toContain("secret-id");
  });
});
