import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isVibeSlug, shareVibeSlug, VIBE_CHIP_IDS, VIBE_CHIPS, VIBE_SLUGS } from "@/lib/vibeChips";

// The seven ?vibe= share slugs are a LOCKED public contract (issue #438):
// stamped plan links already live in group chats, so a renamed slug breaks
// cards in the wild. lib/vibeChips.VIBE_SLUGS is the one canonical map; the
// plan-card OG route keeps a byte-for-byte VIBE_STAMPS literal for satori.
// These tests pin the literal contract AND the route's copy of it, so either
// side drifting fails CI instead of shipping a stamp that silently vanishes
// (an unknown slug renders the base card by design).

describe("vibe share slugs (locked public contract)", () => {
  it("pins the exact slug per chip id", () => {
    expect(VIBE_SLUGS).toEqual({
      bender: "on-a-bender",
      lit: "get-lit",
      quiet: "quiet-pint",
      cheeky: "cheeky-one-after-work",
      match: "match-on",
      quiz: "big-brain-energy",
      date: "date-night",
    });
  });

  it("covers every chip id with a unique slug", () => {
    expect(Object.keys(VIBE_SLUGS).sort()).toEqual([...VIBE_CHIP_IDS].sort());
    expect(new Set(Object.values(VIBE_SLUGS)).size).toBe(VIBE_CHIP_IDS.length);
  });

  it("guards slugs at runtime and never admits chip ids or junk", () => {
    for (const slug of Object.values(VIBE_SLUGS)) expect(isVibeSlug(slug)).toBe(true);
    expect(isVibeSlug("bender")).toBe(false);
    expect(isVibeSlug("ON-A-BENDER")).toBe(false);
    expect(isVibeSlug("")).toBe(false);
    expect(isVibeSlug(null)).toBe(false);
  });

  it("keeps the plan-card route's VIBE_STAMPS literal in sync, slug and label", () => {
    const source = readFileSync(join(process.cwd(), "app/api/plan-card/route.tsx"), "utf8");
    const block = source.match(/const VIBE_STAMPS: Record<string, string> = \{([\s\S]*?)\};/);
    expect(block, "plan-card route no longer declares the VIBE_STAMPS literal").not.toBeNull();
    const stamps = Object.fromEntries(
      [...block![1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((entry) => [entry[1], entry[2]]),
    );
    const canonical = Object.fromEntries(
      VIBE_CHIPS.map((chip) => [VIBE_SLUGS[chip.id], chip.label]),
    );
    expect(stamps).toEqual(canonical);
  });
});

describe("shareVibeSlug (what a share/OG URL carries)", () => {
  it("keeps a valid requested slug even against a different live top", () => {
    expect(shareVibeSlug("quiet-pint", "bender")).toBe("quiet-pint");
  });

  it("falls back to the crew's top vibe when the request is absent or junk", () => {
    expect(shareVibeSlug(undefined, "bender")).toBe("on-a-bender");
    expect(shareVibeSlug("not-a-slug", "date")).toBe("date-night");
    expect(shareVibeSlug(["get-lit"], "quiz")).toBe("big-brain-energy");
  });

  it("yields nothing without a valid request or a single top vibe", () => {
    expect(shareVibeSlug(undefined, null)).toBeNull();
    expect(shareVibeSlug("bender", null)).toBeNull();
  });
});
