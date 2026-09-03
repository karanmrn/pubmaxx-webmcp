import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// D3 — the shipped-CSS half of the desktop venue-sheet chrome contract. The
// rendered geometry lives in e2e/desktop-sheet-chrome-fit.spec.ts; this file is
// the cheap fence, in the same house pattern as mobileChromeFit.test.ts.
//
// What it locks: an open venue drawer owns the right edge from 1024px up, so the
// map toolbar and the ambient banners keep the lane that is left of it, and the
// search field is allowed to shrink inside that lane. Both floors below are the
// ones that turned an overflowing row into a search input drawn through the
// drink select's box.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const toolbarCss = read("components/map/mapToolbar.css");
const toolbarSource = read("components/map/MapToolbar.tsx");
const sheetCss = read("components/map/venueSheet.css");
const bannerCss = read("components/map/mapBannerStaging.css");
const searchCss = read("components/map/mapSearchSuggest.css");

describe("desktop venue sheet chrome fit", () => {
  it("publishes the drawer width the toolbar has to stay clear of", () => {
    expect(sheetCss).toMatch(/--desktop-venue-drawer-width:\s*min\(640px,\s*46vw\)/);
    expect(sheetCss).toMatch(
      /\.mapDrawer\.right\.open\s*{[^}]*width:\s*var\(--desktop-venue-drawer-width\)/,
    );
  });

  it("keeps the toolbar inside the free map lane while the sheet is open", () => {
    const rule =
      toolbarCss.match(
        /\.appShell\.detail-open \.mapToolbar\s*{([^}]*)}/,
      )?.[1] ?? "";
    expect(rule).toMatch(/width:\s*fit-content/);
    expect(rule).toMatch(
      /max-width:\s*calc\(100% - var\(--desktop-venue-drawer-width\) - 32px\)/,
    );
    expect(rule).toMatch(/left:\s*50%/);
    expect(toolbarSource).toMatch(
      /desktopLaneActive\s*\?\s*{\s*transform:\s*`translateX\(calc\(-50% \+ \$\{laneOffset}px\)\)`/,
    );
  });

  it("drops the accessory controls that no longer fit in that lane", () => {
    expect(toolbarCss).toMatch(
      /\.appShell\.detail-open \.mapToolbar \.mapToolbarDesktopExtras,\s*\.appShell\.detail-open \.mapToolbar \.conditionsChip,\s*\.appShell\.detail-open \.mapToolbar \.zonePicker\s*{\s*display:\s*none;/,
    );
  });

  it("lets the search field shrink with its cell instead of overflowing it", () => {
    // The resting floors are real, and they are what the open sheet has to lift.
    expect(searchCss).toMatch(/\.mapSearchSuggest--toolbar\s*{[^}]*min-width:\s*260px/);

    const suggest =
      toolbarCss.match(
        /\.appShell\.detail-open \.mapToolbarSearch \.mapSearchSuggest--toolbar\s*{([^}]*)}/,
      )?.[1] ?? "";
    expect(suggest).toMatch(/min-width:\s*0/);
    expect(suggest).toMatch(/max-width:\s*100%/);

    const input =
      toolbarCss.match(
        /\.appShell\.detail-open \.mapToolbarSearch input\s*{([^}]*)}/,
      )?.[1] ?? "";
    expect(input).toMatch(/min-width:\s*0/);
  });

  it("re-centres the ambient banners on the same lane", () => {
    const rule =
      bannerCss.match(
        /\.appShell\.detail-open \.cityStatusStack,\s*\.appShell\.detail-open \.citySuggestBanner\s*{([^}]*)}/,
      )?.[1] ?? "";
    expect(rule).toMatch(
      /left:\s*calc\(\(100% - var\(--desktop-venue-drawer-width\)\) \/ 2\)/,
    );
    expect(rule).toMatch(
      /max-width:\s*calc\(100% - var\(--desktop-venue-drawer-width\) - 32px\)/,
    );
  });

  it("scopes the whole state to real desktop widths", () => {
    for (const css of [toolbarCss, bannerCss]) {
      const block = css.slice(css.indexOf(".appShell.detail-open") - 400);
      expect(block).toContain("@media (min-width: 1024px)");
    }
  });
});
