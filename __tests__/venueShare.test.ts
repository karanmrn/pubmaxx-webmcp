import { describe, expect, it } from "vitest";

import { isUserCancelledShare } from "@/lib/venueShare";

describe("isUserCancelledShare", () => {
  it("treats an AbortError (user-cancelled share sheet) as cancellation", () => {
    const err = new DOMException("cancelled", "AbortError");
    expect(isUserCancelledShare(err)).toBe(true);
    expect(isUserCancelledShare({ name: "AbortError" })).toBe(true);
  });

  it("treats other errors as real failures", () => {
    expect(isUserCancelledShare(new Error("network"))).toBe(false);
    expect(isUserCancelledShare({ name: "TypeError" })).toBe(false);
    expect(isUserCancelledShare(null)).toBe(false);
    expect(isUserCancelledShare("AbortError")).toBe(false);
    expect(isUserCancelledShare(undefined)).toBe(false);
  });
});
