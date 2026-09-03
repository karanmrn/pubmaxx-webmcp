import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const themeCss = readFileSync(join(process.cwd(), "app/theme.css"), "utf8");
const socialCss = readFileSync(join(process.cwd(), "app/social/social.css"), "utf8");
const composerSource = readFileSync(
  join(process.cwd(), "app/social/SocialComposer.tsx"),
  "utf8",
);

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} must exist`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  expect(start, `@media ${query} must exist`).toBeGreaterThan(-1);
  const openingBrace = css.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, index + 1);
  }
  throw new Error(`@media ${query} must have balanced braces`);
}

function token(source: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(source);
  expect(match, `${name} must be a plain hex in this block`).toBeTruthy();
  return match![1].toLowerCase();
}

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixSrgb(a: string, b: string, percentA: number): string {
  const first = channels(a);
  const second = channels(b);
  const weight = percentA / 100;
  return first
    .map((channel, index) =>
      Math.round(channel * weight + second[index] * (1 - weight)),
    )
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .replace(/^/, "#");
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

function shippedControlBorderWeight(): number {
  const composer = block(socialCss, ".socialComposer");
  const match =
    /--social-control-border:\s*color-mix\(\s*in srgb,\s*var\(--ink-soft\)\s+(\d+)%,\s*var\(--panel-raised\)\s*\)/.exec(
      composer,
    );
  expect(match, "composer must ship one theme-aware control-border token").toBeTruthy();
  return Number(match![1]);
}

function shippedPhotoWeights(): { surface: number; ink: number } {
  const picker = block(socialCss, ".socialComposer .socialPhotoPicker");
  const surface =
    /background:\s*color-mix\(in srgb, var\(--river\) (\d+)%, var\(--panel-raised\)\)/.exec(
      picker,
    );
  const ink =
    /color:\s*color-mix\(in srgb, var\(--river\) (\d+)%, var\(--ink\)\)/.exec(
      picker,
    );
  expect(surface, "photo action must ship a restrained river surface").toBeTruthy();
  expect(ink, "photo action must ship a readable river action colour").toBeTruthy();
  return { surface: Number(surface![1]), ink: Number(ink![1]) };
}

describe("Social composer visual contract", () => {
  it("keeps every unfocused form boundary at 3:1 in both shipped themes", () => {
    const lightRoot = block(globalsCss, ":root");
    const lightBody = block(
      globalsCss,
      'html:not([data-theme="dark"]) body',
    );
    const dark = block(themeCss, 'html[data-theme="dark"]');
    const weight = shippedControlBorderWeight();
    const themes = [
      {
        name: "light",
        borderBase: token(lightRoot, "--ink-soft"),
        panel: token(lightBody, "--panel-raised"),
      },
      {
        name: "dark",
        borderBase: token(dark, "--ink-soft"),
        panel: token(dark, "--panel-raised"),
      },
    ];

    expect(socialCss).toMatch(
      /\.socialComposer textarea,[\s\S]*?border:\s*1px solid var\(--social-control-border\)/,
    );
    for (const theme of themes) {
      const border = mixSrgb(theme.borderBase, theme.panel, weight);
      expect(contrast(border, theme.panel), theme.name).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps Add photo action text at 4.5:1 on its shipped tint", () => {
    const lightRoot = block(globalsCss, ":root");
    const lightBody = block(
      globalsCss,
      'html:not([data-theme="dark"]) body',
    );
    const dark = block(themeCss, 'html[data-theme="dark"]');
    const weights = shippedPhotoWeights();
    const themes = [
      {
        name: "light",
        river: token(lightRoot, "--river"),
        ink: token(lightRoot, "--ink"),
        panel: token(lightBody, "--panel-raised"),
      },
      {
        name: "dark",
        river: token(dark, "--river"),
        ink: token(dark, "--ink"),
        panel: token(dark, "--panel-raised"),
      },
    ];

    for (const theme of themes) {
      const surface = mixSrgb(theme.river, theme.panel, weights.surface);
      const ink = mixSrgb(theme.river, theme.ink, weights.ink);
      expect(contrast(ink, surface), theme.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("ships one focus ring, a dedicated body label, safe spacing, and legible actions", () => {
    expect(composerSource).toMatch(
      /<label className="socialComposerBody">\s*Write post\s*<textarea/,
    );
    expect(composerSource).toMatch(
      /<span className="socialPhotoCue" aria-hidden="true">\+<\/span>\s*<span>\{photo \?/,
    );
    expect(composerSource).toMatch(/<input[^>]+aria-label="Add photo"[^>]+type="file"/);
    expect(socialCss).toMatch(
      /padding:[\s\S]*?calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\)/,
    );
    expect(
      block(socialCss, ".socialComposer .socialComposerBody textarea"),
    ).toMatch(
      /resize:\s*none/,
    );
    expect(socialCss).not.toMatch(/resize:\s*vertical/);
    expect(socialCss).toMatch(
      /\.socialComposer :is\(textarea, input, select\):focus-visible\s*{[^}]*outline-offset:\s*0/,
    );
    expect(socialCss).toMatch(
      /\.socialComposer header button:disabled\s*{[^}]*opacity:\s*1/,
    );
    expect(block(socialCss, ".socialComposer .socialPhotoPicker")).toMatch(
      /border:\s*1px solid var\(--social-control-border\)[\s\S]*background:\s*color-mix\(in srgb, var\(--river\) \d+%, var\(--panel-raised\)\)[\s\S]*color:\s*color-mix\(in srgb, var\(--river\) \d+%, var\(--ink\)\)/,
    );
  });

  it("keeps the body text-first after shared control rules at every viewport", () => {
    const sharedControls = socialCss.indexOf(
      ".socialComposer textarea,\n.socialComposer input,\n.socialComposer select",
    );
    const bodyRule = socialCss.indexOf(
      ".socialComposer .socialComposerBody textarea",
    );
    expect(sharedControls).toBeGreaterThan(-1);
    expect(bodyRule, "body height must override shared control sizing").toBeGreaterThan(
      sharedControls,
    );
    expect(
      block(socialCss, ".socialComposer .socialComposerBody textarea"),
    ).toMatch(/min-height:\s*160px/);

    const phone = mediaBlock(socialCss, "(max-width: 640px)");
    expect(
      block(phone, ".socialComposer .socialComposerBody textarea"),
    ).toMatch(/min-height:\s*96px/);
    expect(block(socialCss, ".socialComposer label > select")).toMatch(
      /padding-right:\s*(?:3[2-9]|[4-9]\d)px/,
    );
  });

  it("makes the narrow composer a square-cornered full-height sheet", () => {
    const narrow = mediaBlock(socialCss, "(max-width: 360px)");
    expect(narrow).toMatch(
      /\.socialComposerBackdrop\s*{[^}]*place-items:\s*stretch/,
    );
    const composer = block(narrow, ".socialComposer");
    expect(composer).toMatch(/\n\s*width:\s*100%;/);
    expect(composer).toMatch(/\n\s*height:\s*100svh;/);
    expect(composer).toMatch(/\n\s*border-radius:\s*0;/);
  });
});
