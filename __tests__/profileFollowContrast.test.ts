import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const themeCss = readFileSync(join(process.cwd(), "app/theme.css"), "utf8");
const profileCss = readFileSync(join(process.cwd(), "app/u/[handle]/profile.css"), "utf8");

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} must exist`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function token(source: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(source);
  expect(match, `${name} must be a plain hex`).toBeTruthy();
  return match![1].toLowerCase();
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixSrgb(first: string, second: string, firstPercent: number): string {
  const firstChannels = channels(first);
  const secondChannels = channels(second);
  const weight = firstPercent / 100;
  return `#${firstChannels.map((channel, index) =>
    Math.round(channel * weight + secondChannels[index] * (1 - weight))
      .toString(16)
      .padStart(2, "0"),
  ).join("")}`;
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)]
    .sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("mutual-follow action", () => {
  it("keeps positive-state text readable at rest and hover in both themes", () => {
    const lightRoot = block(globalsCss, ":root");
    const lightBody = block(globalsCss, 'html:not([data-theme="dark"]) body');
    const darkRoot = block(themeCss, 'html[data-theme="dark"]');
    const mateRule = block(profileCss, ".profilePage .followBtn.isMates");
    const mateHoverRule = block(
      profileCss,
      ".profilePage .followBtn.isMates:hover:not(:disabled)",
    );
    const inkMix = /color-mix\(in srgb, var\(--color-positive, var\(--pint\)\) (\d+)%, var\(--ink\)\)/
      .exec(mateRule)?.[1];

    expect(inkMix).toBeTruthy();
    expect(mateHoverRule).toContain("color: var(--follow-mates-ink)");

    const themes = [
      {
        name: "light",
        ink: token(lightRoot, "--ink"),
        positive: token(lightRoot, "--pint"),
        accent: token(lightRoot, "--brass"),
        surface: token(lightBody, "--panel-raised"),
      },
      {
        name: "dark",
        ink: token(darkRoot, "--ink"),
        positive: token(darkRoot, "--pint"),
        accent: token(darkRoot, "--brass"),
        surface: token(darkRoot, "--panel-raised"),
      },
    ];

    for (const theme of themes) {
      const activeSurface = mixSrgb(theme.accent, theme.surface, 9);
      const hoverSurface = mixSrgb(activeSurface, theme.ink, 82);
      const positiveInk = mixSrgb(theme.positive, theme.ink, Number(inkMix));
      expect(contrast(positiveInk, activeSurface), `${theme.name} rest`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(positiveInk, hoverSurface), `${theme.name} hover`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
