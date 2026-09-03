import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OG } from "@/lib/ogBrand";

// Contract for the store visual identity masters (issue #440), re-branded to the
// Wave C icon identity (#520/#523): a clean WHITE tile with the coral
// double-struck X, no text, no ember. Hexes never drift from the OG brand kit;
// geometry never drifts from the canonical 64-grid double-struck X polygons
// (components/brand/PubmaxxMark.tsx MARK_GEOMETRY, the same numbers
// scripts/gen-brand-assets.mjs and scripts/gen-native-app-icons.mjs stamp).
// These are the masters scripts/gen-store-assets.mjs renders the whole store PNG
// set from, so a drift here ships to both stores.

const DIR = join(process.cwd(), "public", "store-assets");
const WHITE = "#ffffff";

// The canonical double-struck X polygons, verbatim from MARK_GEOMETRY: the thick
// descending stroke, the two thin ascending strokes, and the simplified single
// ascending stroke (`slashSimple`) for the small-optics tier.
const X_THICK = "9,10 21,10 55,54 43,54";
const X_THIN_A = "42,10 47,10 13,54 8,54";
const X_THIN_B = "51,10 56,10 22,54 17,54";
const X_SLASH_SIMPLE = "45,10 53,10 19,54 11,54";

// The retired Clink arms — these MUST NOT appear on any master any more.
const RETIRED_CLINK_A = "19.8,8.7 10.2,17.3 46.0,53.7 52.0,48.3";
const RETIRED_CLINK_B = "44.2,8.7 53.8,17.3 18.0,53.7 12.0,48.3";

// Masters that draw the X at all (they all carry the thick descending stroke).
const MARK_CARRIERS = [
  "icon-square.svg",
  "icon-square-small.svg",
  "play-adaptive-foreground.svg",
  "splash.svg",
] as const;

// Masters that draw the full double-struck X (both thin ascending strokes).
// icon-square-small is EXCLUDED — it takes the small-optics single-slash cut.
const DOUBLE_STRUCK_CARRIERS = [
  "icon-square.svg",
  "play-adaptive-foreground.svg",
  "splash.svg",
] as const;

// White-tile masters (the icon field flips from the retired ink to pure white).
// The splash is deliberately EXCLUDED — splashes keep the ink field per #523.
const WHITE_FIELDS = [
  "icon-square.svg",
  "icon-square-small.svg",
  "play-adaptive-background.svg",
] as const;

const ALL_MASTERS = [
  ...new Set([...MARK_CARRIERS, ...WHITE_FIELDS, "play-adaptive-background.svg"]),
] as const;

const read = (name: string) => readFileSync(join(DIR, name), "utf8");

describe("store asset masters", () => {
  it("every master is an svg with no text (owner lock: mark only)", () => {
    for (const name of ALL_MASTERS) {
      const svg = read(name);
      expect(svg, name).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg, name).not.toMatch(/<text[\s>]/);
      expect(svg, name).not.toMatch(/<tspan[\s>]/);
    }
  });

  it("mark carriers draw the coral double-struck X, never the retired Clink arms", () => {
    for (const name of MARK_CARRIERS) {
      const svg = read(name);
      // The thick descending stroke, as a filled polygon in coral.
      expect(svg, name).toContain(`points="${X_THICK}"`);
      expect(svg, name).toContain(`fill="${OG.coral}"`);
      expect(svg, name).toMatch(/<polygon[\s>]/);
      // The retired Clink arms are gone.
      expect(svg, name).not.toContain(RETIRED_CLINK_A);
      expect(svg, name).not.toContain(RETIRED_CLINK_B);
    }
  });

  it("full-size carriers draw both thin ascending strokes (double-struck)", () => {
    for (const name of DOUBLE_STRUCK_CARRIERS) {
      const svg = read(name);
      expect(svg, name).toContain(`points="${X_THIN_A}"`);
      expect(svg, name).toContain(`points="${X_THIN_B}"`);
      // Not the simplified small-optics slash.
      expect(svg, name).not.toContain(X_SLASH_SIMPLE);
    }
  });

  it("small-optics cut: icon-square-small takes the single-slash `slashSimple`", () => {
    const small = read("icon-square-small.svg");
    // The simplified single ascending stroke + the thick descending stroke…
    expect(small).toContain(`points="${X_SLASH_SIMPLE}"`);
    expect(small).toContain(`points="${X_THICK}"`);
    // …not the double-struck thin pair (the channel closes up below ~24px)…
    expect(small).not.toContain(X_THIN_A);
    expect(small).not.toContain(X_THIN_B);
    // …no glow gradient (mud at these sizes).
    expect(small).not.toMatch(/<radialGradient[\s>]/);
  });

  it("no ember anywhere: static store exports drop the lit node (#523)", () => {
    for (const name of ALL_MASTERS) {
      const svg = read(name);
      // No coral-bright fill and no r 3.2 node circle on any master.
      expect(svg, name).not.toContain(OG.coralBright);
      expect(svg, name).not.toContain('r="3.2"');
    }
  });

  it("icon masters sit on a pure white tile", () => {
    for (const name of WHITE_FIELDS) {
      expect(read(name), name).toContain(`fill="${WHITE}"`);
    }
  });

  it("splash keeps the ink-deep field (splashes are not icons, #523)", () => {
    const svg = read("splash.svg");
    expect(svg).toContain(`fill="${OG.inkDeep}"`);
    // …but carries the coral X, not the retired Clink.
    expect(svg).toContain(`points="${X_THICK}"`);
    expect(svg).not.toContain(RETIRED_CLINK_A);
  });

  it("adaptive background stays flat white: no mark, no gradient (parallax layer)", () => {
    const svg = read("play-adaptive-background.svg");
    expect(svg).toContain(`fill="${WHITE}"`);
    expect(svg).not.toMatch(/<polygon[\s>]/);
    expect(svg).not.toMatch(/<path[\s>]/);
    expect(svg).not.toMatch(/<radialGradient[\s>]/);
  });
});
