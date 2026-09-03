import { describe, expect, it } from "vitest";

import { shouldOfferWebPushPrompt } from "@/lib/webPushPrompt";

const eligible = {
  eligibleRuntime: true,
  alreadyEnabled: false,
  dismissedAtSeq: null,
  currentSeq: 1,
  triggeredThisDocument: true,
};

describe("installed-PWA Web Push prompt gate", () => {
  it("offers only after a qualifying action in the live document", () => {
    expect(shouldOfferWebPushPrompt(eligible)).toBe(true);
    expect(shouldOfferWebPushPrompt({ ...eligible, currentSeq: 0 })).toBe(false);
    expect(shouldOfferWebPushPrompt({ ...eligible, triggeredThisDocument: false })).toBe(false);
  });

  it("never offers to an ordinary tab, unsupported runtime, or enabled browser", () => {
    expect(shouldOfferWebPushPrompt({ ...eligible, eligibleRuntime: false })).toBe(false);
    expect(shouldOfferWebPushPrompt({ ...eligible, alreadyEnabled: true })).toBe(false);
  });

  it("keeps Later dismissed until a later qualifying action", () => {
    expect(shouldOfferWebPushPrompt({ ...eligible, dismissedAtSeq: 1 })).toBe(false);
    expect(shouldOfferWebPushPrompt({ ...eligible, dismissedAtSeq: 2 })).toBe(false);
    expect(shouldOfferWebPushPrompt({ ...eligible, dismissedAtSeq: 1, currentSeq: 2 })).toBe(true);
  });

  it("does not resurrect persisted action history on a cold boot", () => {
    expect(shouldOfferWebPushPrompt({
      ...eligible,
      currentSeq: 18,
      triggeredThisDocument: false,
    })).toBe(false);
  });
});
