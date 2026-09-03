import { describe, expect, it } from "vitest";

import {
  DESTINATION_META,
  SPILL_DESTINATIONS,
  buildSpillPreview,
  mergePriceChips,
  resolveDestination,
  type SpillPreviewInput,
} from "@/lib/spillPreview";
import { QUICK_ADD_PRICES_GBP } from "@/lib/spill";

// Pure-logic tests only (node env — no DOM). Covers the three seams the
// camera-first composer leans on: destination→visibility mapping, price-chip
// merging, and the live preview model (provenance never flattened).

const BASE_INPUT: SpillPreviewInput = {
  handle: "@thirsty_ted",
  price: "",
  note: "",
  withWho: "",
  drink: "",
  era: "",
  visibility: "public",
  venueName: "The Lamb",
  hasPhoto: false,
};

describe("resolveDestination", () => {
  it("maps Tonight to public, always enabled", () => {
    const r = resolveDestination("tonight", false);
    expect(r.visibility).toBe("public");
    expect(r.enabled).toBe(true);
  });

  it("maps Family Table and Ledger both to legacy (shared honest lane)", () => {
    expect(resolveDestination("family", false).visibility).toBe("legacy");
    expect(resolveDestination("ledger", false).visibility).toBe("legacy");
  });

  it("disables My Round when no Round is open — never faked", () => {
    const r = resolveDestination("round", false);
    expect(r.enabled).toBe(false);
    expect(r.helper).toMatch(/Open a Round/i);
  });

  it("enables My Round when a Round is open", () => {
    const r = resolveDestination("round", true);
    expect(r.enabled).toBe(true);
    expect(r.visibility).toBe("public");
  });

  it("every destination has metadata and a valid visibility", () => {
    for (const key of SPILL_DESTINATIONS) {
      const meta = DESTINATION_META[key];
      expect(meta.key).toBe(key);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(["public", "friends", "legacy", "anonymous"]).toContain(meta.visibility);
    }
  });
});

describe("mergePriceChips", () => {
  it("returns the base list unchanged when no last-known price", () => {
    const chips = mergePriceChips(QUICK_ADD_PRICES_GBP, null);
    expect(chips).toEqual([...QUICK_ADD_PRICES_GBP]);
  });

  it("leads with the last-known price when it is novel", () => {
    const chips = mergePriceChips(QUICK_ADD_PRICES_GBP, 7.2);
    expect(chips[0]).toBe(7.2);
    expect(chips.length).toBe(QUICK_ADD_PRICES_GBP.length + 1);
  });

  it("de-dupes a last-known price already in the base list (no dup chip)", () => {
    const lastKnown = QUICK_ADD_PRICES_GBP[0];
    const chips = mergePriceChips(QUICK_ADD_PRICES_GBP, lastKnown);
    expect(chips.length).toBe(QUICK_ADD_PRICES_GBP.length);
    expect(chips.filter((c) => c === lastKnown).length).toBe(1);
  });

  it("drops an invalid last-known price (NaN / <= 0)", () => {
    expect(mergePriceChips(QUICK_ADD_PRICES_GBP, Number.NaN)).toEqual([...QUICK_ADD_PRICES_GBP]);
    expect(mergePriceChips(QUICK_ADD_PRICES_GBP, 0)).toEqual([...QUICK_ADD_PRICES_GBP]);
    expect(mergePriceChips(QUICK_ADD_PRICES_GBP, -3)).toEqual([...QUICK_ADD_PRICES_GBP]);
  });
});

describe("buildSpillPreview", () => {
  it("derives contributor provenance for a priced Spill", () => {
    const model = buildSpillPreview({ ...BASE_INPUT, price: "5.50" });
    expect(model.provenance).toBe("contributor");
    expect(model.provenanceLabel).toBe("Contributor");
    expect(model.priceLabel).toBe("£5.50");
  });

  it("derives anecdote provenance for a price-less memory", () => {
    const model = buildSpillPreview({ ...BASE_INPUT, price: "" });
    expect(model.provenance).toBe("anecdote");
    expect(model.priceLabel).toBe(null);
  });

  it("folds the 'with' suffix into the preview note", () => {
    const model = buildSpillPreview({
      ...BASE_INPUT,
      note: "Cracking night",
      withWho: "@sam, @priya",
    });
    expect(model.note).toMatch(/Cracking night with @sam, @priya/);
  });

  it("withholds the handle and initial when anonymous", () => {
    const model = buildSpillPreview({ ...BASE_INPUT, visibility: "anonymous" });
    expect(model.shownHandle).toMatch(/PUBMAXXER/);
    // Must NOT leak the first letter of the real handle ("t" from thirsty_ted).
    expect(model.initial).not.toBe("T");
  });

  it("shows the normalized @handle and uppercase initial for a normal Spill", () => {
    const model = buildSpillPreview({ ...BASE_INPUT, handle: "thirsty_ted" });
    expect(model.shownHandle).toBe("@thirsty_ted");
    expect(model.initial).toBe("T");
  });

  it("renders a coherent card from a fully blank form", () => {
    const model = buildSpillPreview({ ...BASE_INPUT, handle: "" });
    expect(model.initial).toBe("?");
    expect(model.priceLabel).toBe(null);
    expect(model.note).toBe("");
    expect(model.venueName).toBe("The Lamb");
  });

  it("carries the hasPhoto flag through", () => {
    expect(buildSpillPreview({ ...BASE_INPUT, hasPhoto: true }).hasPhoto).toBe(true);
    expect(buildSpillPreview({ ...BASE_INPUT, hasPhoto: false }).hasPhoto).toBe(false);
  });
});
