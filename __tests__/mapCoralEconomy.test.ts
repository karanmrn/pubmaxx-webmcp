import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The coral economy (design judgement 2026-08-01, findings 2.1 / 2.2 / 2.9).
// On the map, coral (--brass) may survive in exactly three places: the primary
// CTA, the selected pin ring, and the active tab glyph. Every other former
// coral surface is pinned neutral here, and every changed text pair must
// measure at least 4.5:1 in both themes. The values are read from the shipped
// stylesheets, never restated, so a token retune re-runs the arithmetic.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const globalsCss = read("app/globals.css");
const themeCss = read("app/theme.css");
const arcCss = read("components/map/tonightArcChips.css");
const shellCss = read("components/mobile/mobileMapShell.css");
const navCss = read("components/nav/mobileNav.css");
const mapIconsSrc = read("lib/mapIcons.ts");
const buildSceneSrc = read("components/map/canvas/buildScene.ts");
const tokensSrc = read("components/map/canvas/tokens.ts");
const canvasSrc = read("components/PubMapCanvas.tsx");

// --- token resolution -------------------------------------------------------

function block(css: string, opener: string): string {
  const start = css.indexOf(opener);
  expect(start, `${opener} must exist`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

const lightRoot = block(globalsCss, ":root {");
const darkRoot = block(themeCss, 'html[data-theme="dark"] {');

function token(scope: string, fallback: string | null, name: string): string {
  const m = new RegExp(
    `${name}:\\s*(#[0-9a-fA-F]{6}|var\\(--[\\w-]+\\))\\s*;`,
  ).exec(scope);
  const raw = m?.[1] ?? (fallback ? token(fallback, null, name) : undefined);
  expect(raw, `${name} must resolve`).toBeTruthy();
  if (raw!.startsWith("var(")) {
    const inner = raw!.slice(4, -1);
    // A dark var chain may point at a light-defined token.
    return token(scope, scope === darkRoot ? lightRoot : null, inner);
  }
  return raw!.toLowerCase();
}

const light = (name: string) => token(lightRoot, null, name);
const dark = (name: string) => token(darkRoot, lightRoot, name);

// WCAG 2.x relative luminance and contrast ratio.
function ratio(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(hexA), lum(hexB)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe("finding 2.2 — labels on coral fills measure AA in both themes", () => {
  it("light-theme text on a --brass fill is at least 4.5:1", () => {
    expect(ratio(light("--color-on-accent"), light("--brass"))).toBeGreaterThanOrEqual(4.5);
  });

  it("dark-theme text on a --brass fill is at least 4.5:1", () => {
    expect(ratio(dark("--color-on-accent"), dark("--brass"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the strong on-accent ink measures on coral in both themes", () => {
    expect(ratio(light("--color-on-accent-strong"), light("--brass"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(light("--color-on-accent-strong"), dark("--brass"))).toBeGreaterThanOrEqual(4.5);
  });

  it("badge counts (--ink on --panel-raised) measure in both themes", () => {
    expect(ratio(light("--ink"), light("--panel-raised"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark("--ink"), dark("--panel-raised"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("finding 2.1 — map chrome holds no coral fills", () => {
  const accentPattern = /var\(--brass[\w-]*\)|var\(--color-accent[\w-]*\)|var\(--accent-action[\w-]*\)|#ff5a5f/i;

  function rules(css: string, selector: string): string[] {
    const out: string[] = [];
    const re = new RegExp(
      `${selector.replace(/[.[\]()*+?^$\\]/g, "\\$&")}[^{]*\\{([^}]*)\\}`,
      "g",
    );
    for (const m of css.matchAll(re)) out.push(m[1]);
    expect(out.length, `${selector} must have rules`).toBeGreaterThan(0);
    return out;
  }

  it("selected category chips fill with --panel-raised, not coral", () => {
    for (const body of rules(arcCss, ".tonightArcChip.isOn")) {
      const bg = /background:\s*([^;]+);/.exec(body)?.[1];
      if (bg) expect(bg).not.toMatch(accentPattern);
      const colour = /color:\s*([^;]+);/.exec(body)?.[1];
      if (colour) expect(colour).not.toMatch(accentPattern);
    }
  });

  it("the Near me control is no longer a coral fill", () => {
    for (const body of rules(shellCss, ".mobileMapLocateFab")) {
      // The focus ring is the one accent this control keeps: it marks where
      // the keyboard is, which is not a fill.
      expect(body.replace(/outline:[^;]+;/g, "")).not.toMatch(accentPattern);
    }
  });

  it("chip badge counts and the TfL badge are ink on panel, not coral", () => {
    for (const sel of [".mobileMapTopbarBadge", ".mobileMapCornerBadge"]) {
      for (const body of rules(shellCss, sel)) {
        expect(body).not.toMatch(accentPattern);
      }
    }
  });

  it("the active tab keeps a coral glyph but an ink label", () => {
    const tab = /\.mobileTab\.isActive\s*\{([^}]*)\}/.exec(navCss)?.[1] ?? "";
    expect(tab).toMatch(/color:\s*var\(--ink\)/);
    expect(tab).not.toMatch(/--brass/);
    // The glyph is the one surviving coral mark in the tab bar.
    expect(navCss).toMatch(
      /\.mobileTab\.isActive \.mobileTabIcon\s*\{[^}]*color:\s*var\(--brass\)/,
    );
  });

  it("the active glyph is the tab bar's ONLY coral mark", () => {
    // The Moment circle and its glow used to be the second one. Compose left
    // the row entirely for the floating create action, so the budget is now a
    // count rather than a per-selector exemption: any new coral in this
    // stylesheet is a second mark in the same eight-degree band.
    const coralRules: string[] = [];
    for (const match of navCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1]!.trim();
      // A focus ring is an affordance, not a resting mark, and the rules()
      // helper above already treats an outline that way.
      if (selector.includes(":focus-visible")) continue;
      if (accentPattern.test(match[2]!)) coralRules.push(selector);
    }
    expect(coralRules).toEqual([".mobileTab.isActive .mobileTabIcon"]);
  });
});

describe("findings 2.1 / 2.9 — map canvas coral economy", () => {
  it("base-layer unpriced pins ring in a desaturated neutral, never coral", () => {
    const fn = /function drawBasePub[\s\S]*?\n\}/.exec(mapIconsSrc)?.[0] ?? "";
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).not.toContain("t.brass");
    expect(mapIconsSrc).toMatch(/BASE_PUB_RING_COLOR\s*=\s*"#6b5f57"/);
    expect(mapIconsSrc).toMatch(/BASE_PUB_RING_OPACITY\s*=\s*0\.6\b/);
  });

  it("no free-floating scraped-provenance ring layer remains", () => {
    expect(buildSceneSrc).not.toContain("pubs-scraped-halo");
    expect(canvasSrc).not.toContain("pubs-scraped-halo");
  });

  it("the what's-on badge never falls back to coral for an unknown kind", () => {
    const layer = /id: "pubs-whatson-badge"[\s\S]*?circle-stroke-color[\s\S]*?\]/.exec(
      buildSceneSrc,
    )?.[0] ?? "";
    expect(layer.length).toBeGreaterThan(0);
    expect(layer).not.toMatch(/tokens\.brass,\s*\]/);
  });

  it("a story band without its own colour falls back to river, not coral", () => {
    const fallback = /storyColour \?\? tokens\.(\w+)/.exec(canvasSrc)?.[1];
    expect(fallback).toBe("riverBright");
  });

  it("the selected-pin rings stay coral — selection owns the accent", () => {
    const glow = /id: "pubs-selected-glow"[\s\S]*?\},/.exec(buildSceneSrc)?.[0] ?? "";
    expect(glow).toContain("tokens.brass");
  });

  // The reader's dot moved from a DOM marker onto the canvas. The marker was
  // already river; the token that replaced it must be too, or "you are here"
  // wears the selection ring's colour and the accent budget gains a fourth
  // place. The source is read rather than restated, so a retune re-runs here.
  it("the reader's own dot paints river, never the selection coral", () => {
    expect(tokensSrc).toMatch(
      /const userLocation = resolvedColour\("--color-info-strong",/,
    );
    expect(tokensSrc).not.toMatch(
      /const userLocation = resolvedColour\("--color-accent",/,
    );
    const dot = /export function buildUserLocation[\s\S]*?\n\}/.exec(buildSceneSrc)?.[0] ?? "";
    expect(dot.length).toBeGreaterThan(0);
    expect(dot).not.toContain("tokens.brass");
    expect(dot).not.toContain("tokens.brick");
  });
});
