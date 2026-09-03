import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Design judgement 2026-08-01, findings 2.3 and 2.15 — the map is the hero.
 *
 * 2.3 (phone): the chrome was three stacked containers — the top bar, a
 * Near me / Tonight / Filters rail, and a full-width category band — with a
 * plan pill and a tab bar under them. Nine controls stood between the reader
 * and the first pin. The end state is ONE top bar, the category toggles in the
 * Filters sheet, and Near me as a round map-edge FAB.
 *
 * 2.15 (desktop): the SHOW ME panel arrived open, so the toolbar block was a
 * third layer over the map before the reader asked for it. The end state is a
 * panel that opens only from its own control.
 *
 * These read the shipped source, because every defect they guard was invisible
 * to a headless run that never sets a phone viewport.
 */

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const shell = read("components/mobile/MobileMapShell.tsx");
const shellCss = read("components/mobile/mobileMapShell.css");
const pubMap = read("components/PubMap.tsx");
const toolbar = read("components/map/MapToolbar.tsx");

function mapChromeMarkup(): string {
  const start = shell.lastIndexOf('<div className="mobileMapChrome"');
  const end = shell.indexOf("\n      </div>", start);
  expect(start, "the map chrome container").toBeGreaterThan(-1);
  expect(end, "its closing tag").toBeGreaterThan(start);
  return shell.slice(start, end);
}

describe("finding 2.3 — the phone map chrome is one bar", () => {
  it("renders exactly one bar inside the chrome", () => {
    const chrome = mapChromeMarkup();
    expect((chrome.match(/className="mobileMapTopbar["\s]/g) ?? []).length).toBe(1);
    // The rail was the second container. Nothing may bring it back.
    expect(chrome, "no control rail").not.toContain("mobileMapRail");
    expect(shellCss, "and no rail styling survives").not.toContain(".mobileMapRail");
    // The only other children at rest are optional: the search field (mounts
    // on the reader's own tap) and ONE docked chip row. The drink lane and the
    // Tonight cold-start chip share that row rather than docking one each, so
    // a second chip can never grow into a second control rail.
    expect(chrome).toMatch(/overlay === "search" \? \([\s\S]*?mobileMapSearchRow/);
    expect(chrome).toMatch(/overlay === "search" \? null : \([\s\S]*?<MapChipRow/);
    expect((shell.match(/className="mobileMapChipRow"/g) ?? []).length).toBe(1);
    expect(shell).toMatch(
      /mobileMapChipRow"[\s\S]*?mobileMapDrinkChip[\s\S]*?tonightChip \? \([\s\S]*?mobileMapTonightChip/,
    );
    expect(chrome, "no control rail").not.toContain("mobileMapRail");
  });

  it("puts Near me on the map edge as a round control, not in the bar", () => {
    const chrome = mapChromeMarkup();
    expect(chrome, "Near me left the bar").not.toContain("mobileMapLocateFab");
    expect(shell).toContain('className="mobileMapLocateFab"');
    expect(shell, "the FAB carries the Near me action").toMatch(
      /mobileMapLocateFab[\s\S]{0,320}onClick=\{onNearMe\}/,
    );
    // Its state is the accessible name, because a FAB has no visible label.
    expect(shell).toMatch(/mobileMapLocateFab[\s\S]{0,200}aria-label=\{nearMe\.label\}/);
    const fab = shellCss.match(/\.mobileMapLocateFab\s*{([^}]*)}/)?.[1] ?? "";
    expect(fab).toMatch(/border-radius:\s*50%/);
    // It shares the one published map-edge lane with the TfL control.
    expect(shell).toMatch(
      /className="mobileMapUtilityCorner"[\s\S]*?mobileMapLocateFab/,
    );
  });

  it("keeps the bar to controls, and the category toggles out of it", () => {
    const chrome = mapChromeMarkup();
    expect(chrome, "no venue-type toggles in the chrome").not.toContain("TonightArcChips");
    // A permanent Tonight slot used Sparkles inside the bar rail. The cold-start
    // chip docks under the bar with MoonStar and never reclaims a sixth slot.
    expect(chrome, "no Sparkles Tonight chip in the bar").not.toContain("Sparkles");
    expect(chrome, "the chip row is docked, not in the bar").toContain("<MapChipRow");
    expect(shell).toMatch(/mobileMapTonightChip[\s\S]*?MoonStar/);
    expect(shell).toMatch(/mobileMapTonightChip[\s\S]{0,400}onOpen\("tonight"\)/);
  });
});

describe("finding 2.3 — the category toggles have exactly one home per viewport", () => {
  it("floats them over the desktop map and nowhere else", () => {
    const floating = pubMap.match(
      /<TonightArcChips\n(?:(?!\/>)[\s\S])*?\/>/g,
    );
    expect(floating?.length, "TonightArcChips mount sites").toBe(2);
    // The map copy is desktop only.
    expect(pubMap).toMatch(
      /!baseLedChrome && !mobileViewport \? \(\s*<TonightArcChips/,
    );
    // The other copy is the Filters sheet section, which is where a phone
    // reads them.
    expect(pubMap).toMatch(/<TonightArcChips[\s\S]*?variant="sheet"/);
  });

  it("gives the sheet copy sheet geometry rather than map geometry", () => {
    const arcCss = read("components/map/tonightArcChips.css");
    const sheet = arcCss.match(/\.tonightArcChipsSheet\s*{([^}]*)}/)?.[1] ?? "";
    expect(sheet, ".tonightArcChipsSheet rule present").not.toBe("");
    expect(sheet).toMatch(/position:\s*static/);
    expect(sheet).toMatch(/transform:\s*none/);
    // The phone map band it used to occupy is gone from this stylesheet.
    expect(arcCss).not.toMatch(/@media \(max-width: 640px\)/);
  });
});

describe("finding 2.15 — SHOW ME opens only from its own control", () => {
  it("does not mount the experience lens panel by default", () => {
    expect(toolbar, "closed on first paint").toMatch(
      /const \[lensOpen, setLensOpen\] = useState\(false\)/,
    );
    expect(toolbar, "the panel is conditional").toMatch(
      /\{lensOpen \? \(\s*<MapExperienceLensControl/,
    );
  });

  it("gives it a control that names its own state", () => {
    expect(toolbar).toContain('"mapToolbarLensBtn"');
    expect(toolbar).toMatch(/aria-expanded=\{lensOpen\}/);
    expect(toolbar).toMatch(/setLensOpen\(\(open\) => !open\)/);
  });

  it("names the active view on the closed control, so no lens is invisible", () => {
    expect(toolbar).toMatch(/MAP_EXPERIENCE_LENS_OPTIONS\.find/);
    expect(toolbar).toContain("`Show me: ${activeLensLabel}`");
    const lens = read("components/map/MapExperienceLens.tsx");
    expect(lens, "one table of view names").toContain(
      "export const MAP_EXPERIENCE_LENS_OPTIONS",
    );
  });
});

describe("finding 2.15 — the banners dock under the bar and step off the map", () => {
  it("docks them against the toolbar's measured height, not a constant", () => {
    const toolbarCss = read("components/map/mapToolbar.css");
    expect(toolbar, "the toolbar publishes its own height").toMatch(
      /setProperty\(\s*"--map-toolbar-resting-height"/,
    );
    expect(toolbar).toMatch(/new ResizeObserver/);
    // The constant survives only as the pre-measure fallback.
    expect(toolbarCss).toMatch(/--map-toolbar-resting-height:\s*155px/);
    for (const file of [
      "components/map/citySuggestBanner.css",
      "components/map/cityStatusBanner.css",
    ]) {
      expect(read(file), `${file} docks under the bar`).toMatch(
        /var\(--map-toolbar-resting-height/,
      );
    }
  });

  it("hides them once the reader moves the camera, and only then", () => {
    const canvas = read("components/PubMapCanvas.tsx");
    // A gesture carries an originalEvent; a programmatic fly does not.
    expect(canvas).toMatch(
      /if \(!event\.originalEvent\) return;/,
    );
    expect(canvas).toMatch(/map\.on\("dragstart", emitUserCameraMove\)/);
    expect(canvas).toMatch(/map\.on\("zoomstart", emitUserCameraMove\)/);
    expect(pubMap).toMatch(/onUserCameraMove=\{dismissAmbientBanners\}/);
    expect(pubMap).toMatch(
      /const ambientBannerLane = !mobileViewport && !mapCameraTouched/,
    );
    expect(pubMap).toMatch(/\{ambientBannerLane && !baseLedChrome \?/);
    expect(pubMap).toMatch(/\{ambientBannerLane && isLondon \?/);
  });
});
