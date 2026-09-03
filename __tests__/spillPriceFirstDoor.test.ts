import { describe, expect, it } from "vitest";

import {
  SPILL_EXTRAS_TOGGLE_LABEL,
  SPILL_LOG_ACTION_BUSY_LABEL,
  SPILL_LOG_ACTION_LABEL,
  SPILL_SIGNED_OUT_DOOR_LINE,
  spillHasSubmissionEvidence,
  spillExtrasStartOpen,
} from "@/lib/spill";

// Pure policy of the price-first door (activation report D2): what the copy
// says and when the optional half starts open. Pure logic only — the rendered
// step order lives in __tests__/pintDropPriceFirstDoor.test.tsx.

const EMPTY = {
  price: "",
  note: "",
  withWho: "",
  era: "",
  vibeTags: [] as string[],
  hasPhoto: false,
  visibility: "public" as const,
};

describe("spillExtrasStartOpen", () => {
  it("starts closed on a fresh composer", () => {
    expect(spillExtrasStartOpen(EMPTY)).toBe(false);
  });

  it("ignores whitespace-only text", () => {
    expect(spillExtrasStartOpen({ ...EMPTY, note: "  " })).toBe(false);
  });

  it("re-opens for a recovered story, company or era", () => {
    expect(spillExtrasStartOpen({ ...EMPTY, note: "Great pour" })).toBe(true);
    expect(spillExtrasStartOpen({ ...EMPTY, withWho: "@sam" })).toBe(true);
    expect(spillExtrasStartOpen({ ...EMPTY, era: "1998" })).toBe(true);
  });

  it("re-opens for vibes, a photo, or a non-default lane", () => {
    expect(spillExtrasStartOpen({ ...EMPTY, vibeTags: ["cosy"] })).toBe(true);
    expect(spillExtrasStartOpen({ ...EMPTY, hasPhoto: true })).toBe(true);
    expect(spillExtrasStartOpen({ ...EMPTY, visibility: "legacy" })).toBe(true);
  });

  it("a price alone keeps the door compact - price is the first step, not an extra", () => {
    expect(spillExtrasStartOpen({ ...EMPTY, price: "4.50" })).toBe(false);
  });
});

describe("spillHasSubmissionEvidence", () => {
  it("ignores note text the Pint Drop server removes", () => {
    expect(spillHasSubmissionEvidence({ price: "", note: "<>", withWho: "" })).toBe(false);
    expect(
      spillHasSubmissionEvidence({ price: "", note: "\u0001\u0002", withWho: "" }),
    ).toBe(false);
    expect(
      spillHasSubmissionEvidence({ price: "", note: "<Great pint>", withWho: "" }),
    ).toBe(true);
  });
});

describe("price-first door copy", () => {
  it("keeps the door words short, plain and free of plumbing", () => {
    for (const line of [
      SPILL_EXTRAS_TOGGLE_LABEL,
      SPILL_LOG_ACTION_LABEL,
      SPILL_LOG_ACTION_BUSY_LABEL,
      SPILL_SIGNED_OUT_DOOR_LINE,
    ]) {
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/—/);
      expect(line.toLowerCase()).not.toMatch(/composer|visibility|provenance|observation/);
    }
  });

  it("names the account rule at the signed-out door", () => {
    expect(SPILL_SIGNED_OUT_DOOR_LINE).toMatch(/sign in/i);
    expect(SPILL_SIGNED_OUT_DOOR_LINE).toMatch(/under your name/i);
  });
});
