import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The submit-failure line is the ONE sentence a contributor has to read, and the
// success line is the only confirmation their account landed. Both are painted
// from --brick / --pint, which are tuned for price bands and pin fills: raw,
// they land near 2.9:1 on the light card. So this file reads the SHIPPED
// stylesheets — the two theme blocks and the mix in visitReports.css — rather
// than a restated palette, because a restated copy could not catch a token whose
// value drifts under one theme.

const globalsCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const themeCss = readFileSync(join(process.cwd(), "app/theme.css"), "utf8");
const panelCss = readFileSync(join(process.cwd(), "components/visits/visitReports.css"), "utf8");

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} must exist`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function token(source: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(source);
  expect(match, `${name} must be a plain hex in this block`).toBeTruthy();
  return match![1].toLowerCase();
}

// Light: the base scale lives at :root, but the DOM's raised card is re-pointed
// under body (the map keeps the :root value), so the card is read from there.
const LIGHT_ROOT = block(globalsCss, ":root");
const LIGHT_DOM = block(globalsCss, 'html:not([data-theme="dark"]) body');
const DARK = block(themeCss, 'html[data-theme="dark"]');

const THEMES = [
  {
    name: "light",
    ink: token(LIGHT_ROOT, "--ink"),
    pint: token(LIGHT_ROOT, "--pint"),
    brick: token(LIGHT_ROOT, "--brick"),
    card: token(LIGHT_DOM, "--panel-raised"),
  },
  {
    name: "dark",
    ink: token(DARK, "--ink"),
    pint: token(DARK, "--pint"),
    brick: token(DARK, "--brick"),
    card: token(DARK, "--panel-raised"),
  },
];

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `color-mix(in srgb, a P%, b)` — sRGB is gamma-encoded, so this mixes bytes. */
function mixSrgb(a: string, b: string, percentA: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const w = percentA / 100;
  const mix = (x: number, y: number) => Math.round(x * w + y * (1 - w));
  return [mix(ar, br), mix(ag, bg), mix(ab, bb)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .reduce((acc, c) => acc + c, "#");
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The mix weight the stylesheet actually ships for a feedback class. A class can
 * be declared across several rules (the shared metrics rule plus its own colour
 * rule), so every rule naming it is read, not just the first.
 */
function shippedMixPercent(className: string): number {
  const bodies: string[] = [];
  const css = panelCss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const names = selectors.split(",").map((s) => s.trim());
    if (names.includes(`.${className}`)) bodies.push(body);
  }
  expect(bodies.length, `.${className} must have a rule`).toBeGreaterThan(0);
  const match = /color-mix\(in srgb,[\s\S]*?\s(\d+)%,\s*var\(--ink/.exec(bodies.join("\n"));
  expect(match, `.${className} must read its colour through a color-mix toward --ink`).toBeTruthy();
  return Number(match![1]);
}

describe("Visit Report feedback lines", () => {
  it("keeps the failure and success lines readable on the card in both themes", () => {
    const lanes = [
      { className: "visitReportError", tokenName: "brick" as const },
      { className: "visitReportOk", tokenName: "pint" as const },
    ];

    for (const lane of lanes) {
      const percent = shippedMixPercent(lane.className);
      for (const theme of THEMES) {
        const painted = mixSrgb(theme[lane.tokenName], theme.ink, percent);
        expect(
          contrast(painted, theme.card),
          `.${lane.className} on the ${theme.name} card`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the raw positive token below the bar while the dear token stays AA-safe", () => {
    // PR #1010 changed light --brick to a deeper destructive colour that clears
    // AA on its own. --pint remains a price-band colour, so visit feedback still
    // needs the shipped ink mix.
    const light = THEMES[0];
    expect(contrast(light.pint, light.card)).toBeLessThan(4.5);
    expect(contrast(light.brick, light.card)).toBeGreaterThanOrEqual(4.5);
  });
});
