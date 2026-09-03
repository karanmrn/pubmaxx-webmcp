import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

const toolbarCss = read("components/map/mapToolbar.css");
const siteNavCss = read("components/nav/siteNav.css");
const mobileCss = read("components/mobile/mobileMapShell.css");
const tonightArcCss = read("components/map/tonightArcChips.css");

describe("map surface alignment", () => {
  it("gives desktop navigation and toolbar one centred boundary", () => {
    expect(toolbarCss).toMatch(
      /--desktop-map-surface-width:\s*min\(1240px,\s*calc\(100vw - 32px\)\)/,
    );
    expect(toolbarCss).toMatch(
      /\.mapToolbar\s*{[\s\S]*?width:\s*var\(--desktop-map-surface-width\)/,
    );
    expect(siteNavCss).toMatch(
      /\.siteNavBarFloating\s*{[\s\S]*?width:\s*var\(--desktop-map-surface-width\)/,
    );
    expect(tonightArcCss).toMatch(
      /@media \(min-width: 641px\)[\s\S]*?\.tonightArcChips\s*{[\s\S]*?width:\s*var\(--desktop-map-surface-width\)[\s\S]*?background:\s*transparent/,
    );
  });

  it("gives phone map controls one centred boundary with balanced gutters", () => {
    expect(mobileCss).toMatch(/--mobile-map-stack-left:\s*12px/);
    expect(mobileCss).toMatch(/--mobile-map-stack-right:\s*12px/);
    expect(mobileCss).toMatch(
      /\.mobileMapChrome\s*{[\s\S]*?left:\s*var\(--mobile-map-stack-left\)[\s\S]*?right:\s*var\(--mobile-map-stack-right\)/,
    );
    expect(mobileCss).toMatch(
      /\.mobilePlanActivation\s*{[\s\S]*?left:\s*var\(--mobile-map-stack-left\)[\s\S]*?right:\s*var\(--mobile-map-stack-right\)/,
    );
    expect(mobileCss).toMatch(
      /\.mobileMapNearMeAlert\s*{[\s\S]*?left:\s*var\(--mobile-map-stack-left\)[\s\S]*?right:\s*var\(--mobile-map-stack-right\)/,
    );
    // The Tonight Arc floats over the DESKTOP map only. On a phone it is a
    // section of the Filters sheet, so it declares no phone map geometry at
    // all (design judgement 2026-08-01, finding 2.3).
    expect(tonightArcCss).not.toMatch(/@media \(max-width: 640px\)/);
    expect(tonightArcCss).not.toMatch(/--mobile-map-corner-lane/);
  });

  it("uses an accent border only for selected Tonight Arc state", () => {
    expect(tonightArcCss).toMatch(
      /\.tonightArcChips\s*{[\s\S]*?border:\s*0/,
    );
    expect(tonightArcCss).toMatch(
      /\.tonightArcChip\.isOn\s*{[\s\S]*?border-color:/,
    );
  });

  it("does not leak mobile-only controls into desktop layout", () => {
    expect(mobileCss).toMatch(
      /@media \(min-width: 641px\)\s*{[\s\S]*?\.mobileMapUtilityCorner,[\s\S]*?\.mobilePlanActivation[\s\S]*?display:\s*none/,
    );
  });
});
