import { describe, expect, it } from "vitest";

import { CONCIERGE_MOODS } from "@/lib/concierge/rank";
import { detectWhatsOnIntent } from "@/lib/concierge/whatsOn";
import { parseConciergeIntent } from "@/lib/concierge/intent";
import {
  palChatHref,
  VIBE_CHIPS,
  VIBE_KILLED_TERMS,
  vibeChipById,
  visibleTonightVibeChips,
} from "@/lib/vibeChips";

// The vibe layer's honesty contract (docs/VIBE_LAYER_SPEC_2026-07-19.md):
// every chip must land on a deterministic seam that answers with receipts.
// These tests pin the ask strings to the parsers so a reworded ask that would
// silently misroute (mood lost, kind hijacked, junk area captured) fails here
// instead of shipping a chip that returns the wrong venues.

describe("vibe chips (spec contract)", () => {
  it("uses stance-safe labels for high-energy presets", () => {
    expect(vibeChipById("bender")?.label).toBe("Big one tonight");
    expect(vibeChipById("lit")?.label).toBe("Live and loud");
  });

  it("ships exactly the seven spec chips with unique ids", () => {
    expect(VIBE_CHIPS.map((chip) => chip.id)).toEqual([
      "bender",
      "lit",
      "quiet",
      "cheeky",
      "match",
      "quiz",
      "date",
    ]);
    expect(new Set(VIBE_CHIPS.map((chip) => chip.id)).size).toBe(7);
  });

  it("declares only real concierge moods", () => {
    for (const chip of VIBE_CHIPS) {
      for (const mood of chip.moods) {
        expect(CONCIERGE_MOODS).toContain(mood);
      }
    }
  });

  it("every declared mood survives the deterministic parser", async () => {
    for (const chip of VIBE_CHIPS.filter((c) => c.moods.length > 0)) {
      const { intent, source } = await parseConciergeIntent(chip.ask, { skipModel: true });
      expect(source).toBe("deterministic");
      for (const mood of chip.moods) {
        expect(intent.mood, `${chip.id}: "${chip.ask}"`).toContain(mood);
      }
    }
  });

  it("kind-backed chips trigger the What's-On lookup with exactly their kind", () => {
    for (const chip of VIBE_CHIPS) {
      if (chip.tonight.type !== "filter") continue;
      if (chip.id === "bender") continue; // deliberate: crawl ask rides venue ranking
      const detected = detectWhatsOnIntent(chip.ask);
      expect(detected?.kind, `${chip.id}: "${chip.ask}"`).toBe(chip.tonight.kind);
      expect(detected?.window, `${chip.id} should clamp to tonight`).toBe("tonight");
    }
  });

  it("the bender ask stays on the venue-ranking path (no kind hijack)", () => {
    const bender = vibeChipById("bender")!;
    expect(detectWhatsOnIntent(bender.ask)).toBeNull();
  });

  it("no ask captures a junk area or invents a budget", async () => {
    for (const chip of VIBE_CHIPS) {
      const { intent } = await parseConciergeIntent(chip.ask, { skipModel: true });
      // "near me"-style junk areas silently filter every venue out; asks must
      // parse with no area at all (the user adds their own area when typing).
      expect(intent.area, `${chip.id}: "${chip.ask}"`).toBeUndefined();
      if (intent.maxPintPrice !== undefined) {
        // Only the two cheap-pint chips may set a budget, via the parser's own
        // "cheap" heuristic — never an arbitrary number baked into the ask.
        expect(["bender", "cheeky"], `${chip.id} set a budget`).toContain(chip.id);
      }
    }
  });

  it("keeps the killed register off every chip surface", () => {
    const corpus = VIBE_CHIPS.flatMap((chip) => [chip.label, chip.ask])
      .join(" \n ")
      .toLowerCase();
    for (const term of VIBE_KILLED_TERMS) {
      expect(corpus).not.toContain(term);
    }
    // " fr " as a standalone token (inside-word "fr" as in "from" is fine).
    expect(corpus).not.toMatch(/\bfr\b/);
  });

  it("labels stay within the accent-type constraint (2-4 words, no em dashes)", () => {
    for (const chip of VIBE_CHIPS) {
      const words = chip.label.trim().split(/\s+/);
      expect(words.length, chip.label).toBeGreaterThanOrEqual(2);
      expect(words.length, chip.label).toBeLessThanOrEqual(5);
      expect(chip.label).not.toContain("—");
      expect(chip.ask).not.toContain("—");
    }
  });

  it("palChatHref encodes the ask for the quick-fire deep link", () => {
    const quiet = vibeChipById("quiet")!;
    expect(palChatHref(quiet)).toBe(
      `/pal/chat?ask=${encodeURIComponent(quiet.ask)}`,
    );
  });

  it("hides kind-backed vibes when no matching listing kind exists", () => {
    expect(visibleTonightVibeChips([]).map((chip) => chip.id)).toEqual([
      "quiet",
      "cheeky",
      "date",
    ]);
  });

  it("keeps only available kind-backed vibes on a populated Tonight page", () => {
    expect(visibleTonightVibeChips(["music", "quiz"]).map((chip) => chip.id)).toEqual([
      "lit",
      "quiet",
      "cheeky",
      "quiz",
      "date",
    ]);
  });
});
