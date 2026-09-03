import { describe, expect, it } from "vitest";

import { shouldShowPubPalSummon } from "@/components/pubpal/PubPalSummon";

describe("shouldShowPubPalSummon", () => {
  it("appears on the adaptive home, city maps, and plan surfaces", () => {
    expect(shouldShowPubPalSummon("/")).toBe(true);
    expect(shouldShowPubPalSummon("/map")).toBe(true);
    expect(shouldShowPubPalSummon("/map/manchester")).toBe(true);
    expect(shouldShowPubPalSummon("/plan")).toBe(true);
    expect(shouldShowPubPalSummon("/plan/abc123")).toBe(true);
  });

  it("stays out of reading and account-management surfaces", () => {
    expect(shouldShowPubPalSummon("/feed")).toBe(false);
    expect(shouldShowPubPalSummon("/pal")).toBe(false);
    expect(shouldShowPubPalSummon("/u/night_owl")).toBe(false);
  });
});
