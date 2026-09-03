import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const strikeCss = readFileSync(join(process.cwd(), "components/brand/pubmaxxMarkStrike.css"), "utf8");
const emberCss = readFileSync(join(process.cwd(), "components/brand/pubmaxxLoadingEmber.css"), "utf8");
const sealCss = readFileSync(join(process.cwd(), "components/brand/pubmaxxNightSeal.css"), "utf8");

describe("The Strike CSS conformance", () => {
  it("draws the beams with the specced timings (heavy first 180ms, second 140ms overlapping at 120ms)", () => {
    const a = strikeCss.match(/\.markStrike--play \.markStrike__beam--a\s*{([\s\S]*?)}/)?.[1] ?? "";
    const b = strikeCss.match(/\.markStrike--play \.markStrike__beam--b\s*{([\s\S]*?)}/)?.[1] ?? "";
    expect(a).toMatch(/markStrikeDraw 180ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) 0ms both/);
    expect(b).toMatch(/markStrikeDraw 140ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) 120ms both/);
  });

  it("draws by retracting stroke-dashoffset (1 -> 0) on the mask beams", () => {
    const kf = strikeCss.match(/@keyframes markStrikeDraw\s*{([\s\S]*?)}\s*}/)?.[1] ?? strikeCss.match(/@keyframes markStrikeDraw\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    expect(kf).toMatch(/stroke-dashoffset:\s*1/);
    expect(kf).toMatch(/stroke-dashoffset:\s*0/);
  });

  it("pops the ember (scale 0 -> 1.15 -> 1.0, 160ms overshoot easing at the clink moment)", () => {
    const emberRule = strikeCss.match(/\.markStrike--play \.markStrike__ember\s*{([\s\S]*?)}/)?.[1] ?? "";
    expect(emberRule).toMatch(/markStrikeEmber 160ms cubic-bezier\(0\.34, 1\.56, 0\.64, 1\) 260ms both/);
    // GPU-only: the ember pop rides transform, about its own centre.
    expect(emberRule).toMatch(/transform-box:\s*fill-box/);
    expect(emberRule).toMatch(/transform-origin:\s*center/);
    const kf = strikeCss.match(/@keyframes markStrikeEmber\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    expect(kf).toMatch(/scale\(0\)/);
    expect(kf).toMatch(/scale\(1\.15\)/);
    expect(kf).toMatch(/scale\(1\)/);
  });

  it("only animates GPU-cheap properties (stroke-dashoffset on masks, transform/opacity on the ember)", () => {
    // No layout/paint properties are animated in the keyframes.
    const keyframeBodies = strikeCss.match(/@keyframes[\s\S]*$/)?.[0] ?? "";
    expect(keyframeBodies).not.toMatch(/\b(width|height|top|left|margin|padding|fill):/);
  });

  it("respects reduced motion (no draw, no pop — a single 120ms fade, ember static)", () => {
    const query = strikeCss.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    expect(query).toMatch(/\.markStrike__beam\s*{[\s\S]*?animation:\s*none/);
    expect(query).toMatch(/\.markStrike__ember\s*{[\s\S]*?animation:\s*none/);
    expect(query).toMatch(/\.markStrike--play\s*{\s*animation:\s*markStrikeFade 120ms/);
  });
});

describe("The loading ember CSS conformance", () => {
  it("breathes opacity 0.6 -> 1.0 over 900ms ease-in-out infinite alternate", () => {
    const rule = emberCss.match(/\.loadingEmber__node\s*{([\s\S]*?)}/)?.[1] ?? "";
    expect(rule).toMatch(/loadingEmberBreathe 900ms ease-in-out infinite alternate/);
    const kf = emberCss.match(/@keyframes loadingEmberBreathe\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    expect(kf).toMatch(/opacity:\s*0\.6/);
    expect(kf).toMatch(/opacity:\s*1/);
  });

  it("stills to a steady lit ember under reduced motion", () => {
    const query = emberCss.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    expect(query).toMatch(/animation:\s*none/);
    expect(query).toMatch(/opacity:\s*1/);
  });
});

describe("The night seal CSS conformance", () => {
  it("presses the stamp at a static -8deg tilt (identity, holds under reduced motion)", () => {
    const rule = sealCss.match(/\.nightSeal\s*{([\s\S]*?)}/)?.[1] ?? "";
    expect(rule).toMatch(/transform:\s*rotate\(-8deg\)/);
  });

  it("selects tone by theme for the auto variant", () => {
    expect(sealCss).toMatch(/\.nightSeal--auto\s*{[\s\S]*?color:\s*var\(--ink-deep/);
    expect(sealCss).toMatch(/html\[data-theme="dark"\]\s*\.nightSeal--auto\s*{[\s\S]*?color:\s*var\(--brass/);
  });
});
