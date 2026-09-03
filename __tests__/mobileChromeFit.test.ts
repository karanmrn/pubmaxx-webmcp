import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Regression lock for the 390/430 device pass. Same house pattern as
// landingChromeCss.test.ts: text assertions over the shipped CSS, because the
// defects these guard were all invisible to a desktop browser and to a headless
// run that never sets a phone viewport.
//
// Two of them are not cosmetic:
//   - the map rail overflowed 390px by ~21px, cutting the Filters chip clean
//     through its refinement badge, so a filtered map looked unfiltered;
//   - the venue peek caption ellipsed to "current recorded pri…", which is a
//     PRICE with its own meaning truncated. A price you cannot read the label of
//     is the one thing this product cannot ship.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const mobileMapCss = read("components/mobile/mobileMapShell.css");
const mobileMapChromeSpec = read("e2e/mobile-map-chrome-fit.spec.ts");
const arcChipsCss = read("components/map/tonightArcChips.css");
const arcChipsTsx = read("components/map/TonightArcChips.tsx");
const landingCss = read("components/landing/landing.css");
const hygieneCss = read("components/map/venueHygiene.css");
const saveToListCss = read("components/savedpubs/saveToList.css");
const buzzCss = read("components/map/venueBuzz.css");
const pintArrivalCss = read("components/pintindex/pintIndexArrival.css");
const venueListCss = read("components/map/mapVenueList.css");
const venuePriceSubmitCss = read("components/map/venuePriceSubmit.css");
const globalCss = read("app/globals.css");

function declarationsFor(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = (
    mobileMapCss.match(
      new RegExp(`(?:^|\\n)\\s*${escaped}\\s*{([^{}]*)}`),
    )?.[1] ?? ""
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = new Map<string, string>();
  for (const declaration of rule.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    declarations.set(
      declaration.slice(0, separator).trim(),
      declaration.slice(separator + 1).trim(),
    );
  }
  return declarations;
}

describe("mobile chrome fit at 390px", () => {
  it("uses limited setup for the limited map journey", () => {
    const limitedTestStart = mobileMapChromeSpec.indexOf(
      'test("320px limited map keeps its topbar and city menu inside the viewport"',
    );
    const nextTestStart = mobileMapChromeSpec.indexOf("\ntest(", limitedTestStart + 1);
    const limitedTest = mobileMapChromeSpec.slice(
      limitedTestStart,
      nextTestStart < 0 ? undefined : nextTestStart,
    );

    expect(limitedTestStart, "limited map journey is present").toBeGreaterThanOrEqual(0);
    expect(limitedTest).toContain("await openLimitedPhoneMap(");
    expect(limitedTest).not.toContain("await openPhoneMap(");
  });

  it("keeps first-visit analytics choices equal and clear of map activation", () => {
    const buttons = globalCss.match(/\.analyticsConsentPromptActions button\s*{([^}]*)}/)?.[1] ?? "";
    expect(buttons).toMatch(/min-height:\s*44px/);
    expect(buttons).toMatch(/background:\s*var\(--panel\)/);
    expect(globalCss).not.toMatch(/\.analyticsConsentPromptActions button:first-child/);
    expect(globalCss).toMatch(
      /body:has\(\.mobilePlanActivation\) \.analyticsConsentPrompt\s*{[^}]*bottom:\s*calc\(var\(--mobile-map-dock-clearance\) \+ 86px\)/,
    );
    expect(globalCss).toMatch(
      /body:has\(\.mobilePlanActivation\) \.analyticsConsentPrompt\s*{[^}]*box-shadow:\s*none/,
    );
    // PR #1017 removed map-only consent action overrides. Map activation now
    // inherits the same full-size, equal choice controls as every mobile page.
    expect(globalCss).not.toMatch(/body:has\(\.mobilePlanActivation\) \.analyticsConsentPrompt(?: p|Actions(?: button)?)\s*{/);
    expect(globalCss).not.toMatch(
      /body:has\(\.mobilePlanActivation\) \.analyticsConsentPrompt\s*{[^}]*(?:display:\s*none|opacity:\s*0)/,
    );
    expect(mobileMapCss).toMatch(
      /body:has\(\.analyticsConsentPrompt\) \.appShell \.mapStage \.maplibregl-ctrl-bottom-right\s*{[^}]*bottom:\s*calc\(var\(--mobile-map-dock-clearance\) \+ 206px\)/,
    );
  });

  it("fits the one top bar inside the narrowest phone at the tap floor", () => {
    // 320px is the narrowest phone the e2e matrix runs. The bar is five slots:
    // wordmark, area, search, filters, more. Three of them are 44px controls,
    // and at 360px and below the wordmark yields its column so the place name
    // is never cut to nothing. Measured at 390x844x3, a sixth control left
    // "King's Cross" 54px of a 72px name. The arithmetic below is what stops a
    // sixth slot coming back (finding 2.3). Tonight's cold-start chip docks
    // under the bar, never inside it.
    const bar = mobileMapCss.match(/\.mobileMapTopbar\s*{([^}]*)}/)?.[1] ?? "";
    expect(bar, ".mobileMapTopbar rule present").not.toBe("");
    const fixedColumns = (columns: string): number[] =>
      [...columns.replace(/minmax\([^)]*\)/g, "").matchAll(/(\d+)px/g)].map((m) => Number(m[1]));

    const wide = bar.match(/grid-template-columns:\s*([^;]+);/)?.[1]?.trim() ?? "";
    expect(wide, "the bar declares its columns").not.toBe("");
    // The wordmark column is content-sized, so a long wordmark cannot be cut
    // mid-word by a narrower phone; the area name is what gives way.
    expect(wide).toMatch(/^auto\s+minmax\(0,\s*1fr\)/);
    const wideFixed = fixedColumns(wide);
    expect(wideFixed.length, "fixed control columns").toBe(3);

    const narrow =
      mobileMapCss
        .match(/@media \(max-width: 360px\)\s*{[\s\S]*?\.mobileMapTopbar\s*{([^}]*)}/)?.[1]
        ?.match(/grid-template-columns:\s*([^;]+);/)?.[1]
        ?.trim() ?? "";
    expect(narrow, "the 360px bar declares its columns").not.toBe("");
    const narrowFixed = fixedColumns(narrow);
    for (const width of [...wideFixed, ...narrowFixed]) {
      expect(width, "every control column keeps the 44px tap floor").toBeGreaterThanOrEqual(44);
    }

    const narrowLimited =
      mobileMapCss
        .match(
          /@media \(max-width: 360px\)\s*{[\s\S]*?\.mobileMapTopbar\.mobileMapTopbarLimited\s*{([^}]*)}/,
        )?.[1]
        ?.match(/grid-template-columns:\s*([^;]+);/)?.[1]
        ?.trim() ?? "";
    expect(
      narrowLimited,
      "the limited bar drops the hidden wordmark track at 320px",
    ).toBe("minmax(0, 1fr) 44px");

    const stackLeft = Number(mobileMapCss.match(/--mobile-map-stack-left:\s*(\d+)px/)?.[1]);
    const stackRight = Number(mobileMapCss.match(/--mobile-map-stack-right:\s*(\d+)px/)?.[1]);
    const padding = bar.match(/padding:\s*(\d+)px\s+(\d+)px\s+(\d+)px\s+(\d+)px/);
    expect(padding, "the bar declares its padding").not.toBeNull();
    const padInline = Number(padding?.[2]) + Number(padding?.[4]);
    const gap = Number(bar.match(/gap:\s*(\d+)px/)?.[1]);
    const content = 320 - stackLeft - stackRight - 2 - padInline - gap * narrowFixed.length;
    const taken = narrowFixed.reduce((sum, width) => sum + width, 0);
    // The place name keeps a readable column at 320px rather than zero.
    expect(content - taken, "area name column at 320px").toBeGreaterThanOrEqual(60);
  });

  it("keeps the map top bar's resting surface neutral, like its sibling bars", () => {
    // On one phone map screen the bottom tab bar drew a neutral --hairline edge
    // and this bar drew `--line 82% / --brass 18%` with a --surface-tint-river
    // gradient behind it: two lanes, opposite decisions, both shipped. Accent on
    // PASSIVE chrome is the defect; hover and active states are untouched by
    // this fence, which reads the resting rule alone.
    const bar = mobileMapCss.match(/\.mobileMapTopbar\s*{([^}]*)}/)?.[1] ?? "";
    expect(bar, ".mobileMapTopbar rule present").not.toBe("");

    const border = bar.match(/border:\s*([^;]+);/)?.[1] ?? "";
    expect(border, "the bar declares a resting border").not.toBe("");
    expect(border, "a resting border mixes no accent").not.toMatch(
      /--brass|--brick|--amber|--river|--pint/,
    );
    expect(border, "passive chrome takes the neutral divider").toContain("--hairline");

    const background = bar.match(/background:\s*([^;]+);/)?.[1] ?? "";
    expect(background, "the bar declares a resting background").not.toBe("");
    expect(background, "no accent wash behind passive chrome").not.toMatch(
      /--surface-tint-river|--surface-tint-brass|--brass|--river/,
    );
  });

  it("keeps the docked chip row inside chrome budgets and the corner lane", () => {
    // Bar (~52) + chrome gap (6) + 44px chip stays under the 164px phone budget
    // that e2e/ui-consistency-layout.spec.ts and mobile-map-chrome-fit hold.
    // The drink lane and Tonight share ONE row, so the budget is still one
    // chip tall however many chips end up on it.
    const barH = Number(mobileMapCss.match(/--mobile-map-bar-h:\s*(\d+)px/)?.[1]);
    const chromeGap = Number(
      mobileMapCss.match(/\.mobileMapChrome\s*{[^}]*gap:\s*(\d+)px/)?.[1],
    );
    const chipMins: number[] = [];
    for (const selector of [".mobileMapTonightChip", ".mobileMapDrinkChip"]) {
      const rule = mobileMapCss.match(
        new RegExp(`\\${selector}\\s*{([^}]*)}`),
      )?.[1] ?? "";
      expect(rule, `${selector} rule present`).not.toBe("");
      // Every chip on that row still clears the 44px tap floor.
      expect(rule, `${selector} tap floor`).toMatch(/min-height:\s*44px/);
      chipMins.push(Number(rule.match(/min-height:\s*(\d+)px/)?.[1]));
    }
    const chipMin = Math.max(...chipMins);
    for (const [label, value] of [
      ["bar height", barH],
      ["chrome gap", chromeGap],
      ["chip row floor", chipMin],
    ] as const) {
      expect(Number.isFinite(value), `${label} parsed from CSS`).toBe(true);
    }
    expect(barH + chromeGap + chipMin, "bar + chip row under 164px").toBeLessThanOrEqual(
      164,
    );

    // The row clears the published map-edge lane so TfL cannot steal taps.
    expect(mobileMapCss).toMatch(
      /\.mobileMapChipRow\s*{[^}]*padding-right:\s*calc\(\s*var\(--mobile-map-corner-lane\)\s*-\s*var\(--mobile-map-stack-right\)/,
    );
    // A lane label may shorten, but the chip that names the prices on the pins
    // never scrolls out of reach: the row wraps nothing off-screen.
    expect(mobileMapCss).not.toMatch(/\.mobileMapChipRow\s*{[^}]*overflow-x:\s*auto/);
    // And the shell still publishes the balanced stack the chip sits inside.
    expect(mobileMapCss).toMatch(/--mobile-map-stack-left:\s*\d+px/);
    expect(mobileMapCss).toMatch(/--mobile-map-stack-right:\s*\d+px/);
  });

  it("bounds named map controls before their labels are laid out", () => {
    // This is a shipped-CSS behaviour check, not a selector-presence check.
    // A grid item with an automatic minimum can widen its one-column parent,
    // while a flex item with an automatic minimum can widen the chip row. Both
    // leave document.scrollWidth unchanged because the chrome is fixed, but
    // cut the visible area name, Tonight label, and trailing controls at the
    // viewport edge (the supplied 390px proof). The declarations below are the
    // box-sizing and shrink contracts that make the rendered geometry bounded.
    const topbar = declarationsFor(".mobileMapTopbar");
    const limitedTopbar = declarationsFor(".mobileMapTopbar.mobileMapTopbarLimited");
    const chipRow = declarationsFor(".mobileMapChipRow");
    const areaRoot = declarationsFor(".citySwitcher--mobile");
    const areaTrigger = declarationsFor(".citySwitcher--mobile .citySwitcherTrigger");
    const areaLabel = declarationsFor(".citySwitcher--mobile .citySwitcherLabelFull");
    const tonightLabel = declarationsFor(".mobileMapTonightChipLabel");

    expect(topbar.get("width"), "topbar fills its bounded shell").toBe("100%");
    expect(topbar.get("min-width"), "topbar may shrink below label min-content").toBe("0");
    expect(topbar.get("box-sizing"), "topbar width includes its frame").toBe("border-box");
    expect(
      limitedTopbar.get("grid-template-columns"),
      "limited first-visit bar keeps brand, area, and Search in explicit tracks",
    ).toBe("minmax(64px, 1fr) minmax(0, 1fr) 44px");
    expect(chipRow.get("width"), "chip row fills its bounded shell").toBe("100%");
    expect(chipRow.get("box-sizing"), "chip row padding stays inside its frame").toBe("border-box");
    expect(areaRoot.get("width"), "area switcher owns its grid track").toBe("100%");
    expect(areaTrigger.get("display"), "area trigger exposes a shrinkable flex row").toBe("flex");
    expect(areaTrigger.get("width"), "area trigger stays inside its track").toBe("100%");
    expect(areaTrigger.get("min-width"), "area trigger may shrink").toBe("0");
    expect(areaLabel.get("min-width"), "area label may shrink before its caret").toBe("0");
    expect(tonightLabel.get("min-width"), "Tonight label may shrink before its chip").toBe("0");

    // Resolve the actual phone shell arithmetic from the declarations. This
    // proves the bounded boxes have positive usable space at 390px and leave
    // the published map-edge lane untouched.
    const viewport = 390;
    const stackLeft = Number(mobileMapCss.match(/--mobile-map-stack-left:\s*(\d+)px/)?.[1]);
    const stackRight = Number(mobileMapCss.match(/--mobile-map-stack-right:\s*(\d+)px/)?.[1]);
    const cornerInset = Number(mobileMapCss.match(/--mobile-map-corner-inset:\s*max\((\d+)px/)?.[1]);
    const cornerButton = Number(mobileMapCss.match(/--mobile-map-corner-btn:\s*(\d+)px/)?.[1]);
    const cornerGap = Number(mobileMapCss.match(/--mobile-map-corner-lane:\s*calc\([\s\S]*?\+\s*(\d+)px/)?.[1]);
    const shellWidth = viewport - stackLeft - stackRight;
    const cornerLane = cornerInset + cornerButton + cornerGap;
    const chipContentWidth = shellWidth - (cornerLane - stackRight);
    const resolveWidth = (value: string | undefined, containingWidth: number): number =>
      value === "100%" ? containingWidth : Number.NaN;
    const topbarWidth = resolveWidth(topbar.get("width"), shellWidth);
    const chipRowWidth = resolveWidth(chipRow.get("width"), shellWidth);
    expect(shellWidth, "390px shell width is positive").toBeGreaterThan(0);
    expect(chipContentWidth, "chip labels retain usable width before the edge lane").toBeGreaterThan(0);
    expect(topbarWidth, "topbar resolves to its shell width").toBe(shellWidth);
    expect(chipRowWidth, "chip row resolves to its shell width").toBe(shellWidth);
    expect(stackLeft + topbarWidth, "bounded topbar right edge").toBe(viewport - stackRight);
    expect(stackLeft + chipRowWidth, "bounded chip row right edge").toBe(viewport - stackRight);
  });

  it("never truncates the venue price caption", () => {
    const rule = mobileMapCss.match(/\.mobileVenuePeekSummary small\s*{([^}]*)}/)?.[1] ?? "";
    expect(rule, ".mobileVenuePeekSummary small rule present").not.toBe("");
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(rule).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(mobileMapCss).toMatch(
      /\.mobileVenuePeekSummary \.mobileVenuePeekDrop strong\s*{[^}]*white-space:\s*normal/,
    );
  });

  it("keeps the map-edge lane clear for the two controls that live on it", () => {
    // The Tonight Arc used to be a full-width band in this same vertical strip,
    // and the TfL button swallowed the taps meant for its fifth chip. The arc
    // has left the phone map entirely (finding 2.3), so what the lane has to
    // describe now is the two map-edge controls themselves: TfL at the top and
    // the Near me FAB at the thumb.
    const cornerInset = Number(
      mobileMapCss.match(/--mobile-map-corner-inset:\s*max\((\d+)px/)?.[1],
    );
    const cornerBtn = Number(mobileMapCss.match(/--mobile-map-corner-btn:\s*(\d+)px/)?.[1]);
    const cornerGap = Number(
      mobileMapCss.match(
        /--mobile-map-corner-lane:\s*calc\([\s\S]*?--mobile-map-corner-btn\)\s*\+\s*(\d+)px/,
      )?.[1],
    );
    for (const [label, value] of [
      ["map-edge inset", cornerInset],
      ["map-edge button size", cornerBtn],
      ["map-edge lane gap", cornerGap],
    ] as const) {
      expect(Number.isFinite(value), `${label} parsed from CSS`).toBe(true);
    }
    // The lane only describes the controls if the controls are laid out from
    // the same two numbers.
    expect(mobileMapCss).toMatch(
      /\.mobileMapUtilityCorner\s*{[^}]*right:\s*var\(--mobile-map-corner-inset\)/,
    );
    expect(mobileMapCss).toMatch(
      /\.mobileMapUtilityCorner > button\s*{[^}]*min-width:\s*var\(--mobile-map-corner-btn\)/,
    );
    // TfL at the top, Near me at the bottom of that one lane.
    expect(mobileMapCss).toMatch(
      /\.mobileMapUtilityCorner\s*{[^}]*justify-content:\s*space-between/,
    );
    const fab = mobileMapCss.match(/\.mobileMapLocateFab\s*{([^}]*)}/)?.[1] ?? "";
    expect(fab, ".mobileMapLocateFab rule present").not.toBe("");
    expect(fab, "a locate FAB is round").toMatch(/border-radius:\s*50%/);
    // Its SIZE is published with the floating stack (mobileNav.css), because the
    // create action above has to clear this control's own top edge. A number
    // read back out of that declaration proves nothing, so the tap floor and the
    // lane fit are measured against the rendered box at 320/390/430 in
    // e2e/mobile-map-chrome-fit.spec.ts.

    const chipCount = (arcChipsTsx.match(/\bkind:\s*"/g) ?? []).length;
    expect(chipCount, "chips declared in TonightArcChips").toBe(5);
    expect(arcChipsCss, "chip labels are never truncated").not.toMatch(/text-overflow/);
    // Design judgement 2026-08-01 (finding 2.1): the selected chip carries a
    // tick so selection reads without colour.
    expect(arcChipsTsx, "the tick renders on the selected chip alone").toMatch(
      /\{on \? \([\s\S]*?tonightArcChipTick/,
    );
  });

  it("keeps a venue name whole when a drink lens puts an unknown caption in the row", () => {
    // A pint row's caption is a figure ("£5.60"); a lens row's is a whole
    // finding ("No whisky price logged"). Sharing one 44px line, the caption
    // wraps to two and the NAME is what loses its characters — measured at
    // 390x844x3, .mapVenueListItemName fell from 189px under the pint lens to
    // 106-122px under whisky, clipping five of the visible pubs. Stack the row
    // on a phone so the name owns a full line and the caption keeps wrapping
    // below it: neither is ever ellipsed.
    const phoneBlocks = venueListCss.split("@media (max-width: 640px)").slice(1);
    const stacked = phoneBlocks.find((block) =>
      /\.mapVenueListItem\s*{[^}]*flex-direction:\s*column/.test(block),
    );
    expect(stacked, "phone override stacking the venue list row").toBeTruthy();
    const nameRule = stacked?.match(/\.mapVenueListItemName\s*{([^}]*)}/)?.[1] ?? "";
    expect(nameRule, ".mapVenueListItemName phone override present").not.toBe("");
    expect(nameRule).toMatch(/white-space:\s*normal/);
    expect(nameRule).not.toMatch(/text-overflow:\s*ellipsis/);
    // The caption wraps in place rather than holding a fixed side column.
    expect(stacked).toMatch(/\.mapVenueListItemMeta\s*{[^}]*flex-wrap:\s*wrap/);
    expect(stacked).toMatch(/\.mapVenueListCompactPrice\s*{[^}]*max-width:\s*100%/);

    // And the full line the name now gets is wider than the remainder it used
    // to be left with once the caption took its column.
    const panelWidth = Number(
      venueListCss.match(/\.mapVenueListPanel\s*{[^}]*width:\s*min\((\d+)px/)?.[1],
    );
    const itemsPad = Number(venueListCss.match(/\.mapVenueListItems\s*{[^}]*padding:\s*(\d+)px/)?.[1]);
    const itemPadX = Number(
      venueListCss.match(/\.mapVenueListItem\s*{[^}]*padding:\s*\d+px\s+(\d+)px/)?.[1],
    );
    const captionMax = Number(
      venueListCss.match(/\.mapVenueListCompactPrice\s*{[^}]*max-width:\s*(\d+)px/)?.[1],
    );
    for (const [label, value] of [
      ["panel width", panelWidth],
      ["items padding", itemsPad],
      ["item padding", itemPadX],
      ["caption max-width", captionMax],
    ] as const) {
      expect(Number.isFinite(value), `${label} parsed from CSS`).toBe(true);
    }
    const viewport = 390;
    const panel = Math.min(panelWidth, viewport - 24);
    const nameLine = panel - 2 - itemsPad * 2 - itemPadX * 2;
    expect(nameLine, "the stacked name line holds a pub name").toBeGreaterThanOrEqual(240);
    expect(nameLine - captionMax, "the shared line it replaces was the narrow one").toBeLessThan(
      nameLine,
    );
  });

  it("stacks the landing hero readout without the side-by-side divider indent", () => {
    // In a column the left rule + 20px pad stepped each stat further right, so
    // three honest counts read as a broken staircase.
    const stacked = landingCss.match(
      /@media \(max-width: 700px\)[\s\S]*?\.lpReadoutStat \+ \.lpReadoutStat\s*{([^}]*)}/,
    )?.[1];
    expect(stacked, "phone override for the stacked readout").toBeTruthy();
    expect(stacked).toMatch(/border-left:\s*0/);
    expect(stacked).toMatch(/padding-left:\s*0/);
    expect(stacked).toMatch(/border-top:\s*1px solid/);
  });
});

describe("mobile tap-target floors", () => {
  it("gives the Tonight Arc chips a 44px floor where a phone reads them", () => {
    // The floor a PHONE reads is proved by rendered geometry in
    // e2e/drink-chip-controls.spec.ts; the desktop floating arc is proved in
    // e2e/desktop-map-rail.spec.ts. This keeps the sheet variant's rule from
    // being dropped outright.
    expect(arcChipsCss).toMatch(
      /\.tonightArcChipsSheet \.tonightArcChip\s*{[^}]*min-height:\s*44px/,
    );
  });

  it("gives the map wordmark link a real hit box, not a 14px text run", () => {
    expect(mobileMapCss).toMatch(/\.mobileMapBrand\s*{[^}]*min-height:\s*44px/);
  });

  it("floors the venue-sheet controls that sat under 44px", () => {
    expect(hygieneCss).toMatch(/\.venueHygiene\s*{[^}]*min-height:\s*44px/);
    expect(saveToListCss).toMatch(/\.saveToListToggle\s*{[^}]*min-height:\s*44px/);
  });

  it("keeps a thumb-sized route to every press source", () => {
    // The inline superscript citation cannot reach 44px without wrecking the
    // paragraph, so the mention pill below the summary carries the floor and
    // the superscript just gets a padded hit box.
    expect(buzzCss).toMatch(/\.venueBuzzMention a\s*{[^}]*min-height:\s*44px/);
    expect(buzzCss).toMatch(/\.venueBuzzCite a\s*{[^}]*padding:\s*7px 5px/);
  });

  it("keeps the Pint Index arrival chips thumb-sized, and never clips an area name", () => {
    // A press arrival's whole next step is one of these. A chip under the
    // floor, or a borough name cut to "Kensington and Ch...", loses the tap
    // and the destination with it.
    const chip = pintArrivalCss.match(/\.pintArrivalArea\s*{([^}]*)}/)?.[1] ?? "";
    expect(chip, ".pintArrivalArea rule present").not.toBe("");
    expect(chip).toMatch(/min-height:\s*56px/);
    expect(chip).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(pintArrivalCss).toMatch(/\.pintArrivalAreaName\s*{[^}]*overflow-wrap:\s*break-word/);
    expect(pintArrivalCss).toMatch(
      /@media \(max-width: 420px\)[\s\S]*?\.pintArrivalAreas\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });

  it("floors the landing footer links to 44px", () => {
    expect(landingCss).toMatch(/\.lpFooterCol a\s*{\s*min-height:\s*44px/);
    expect(landingCss).toMatch(/\.lpFooterSmallPrint a\s*{\s*min-height:\s*44px/);
  });

  it("keeps every community signal choice thumb-sized", () => {
    expect(venuePriceSubmitCss).toMatch(
      /\.vpsigQuestion\s*{[^}]*min-height:\s*44px/,
    );
    expect(venuePriceSubmitCss).toMatch(
      /\.vpsigOption\s*{[^}]*min-height:\s*44px/,
    );
    expect(venuePriceSubmitCss).toMatch(
      /\.vpsigSubmit\s*{[^}]*min-height:\s*44px/,
    );
  });

  it("sizes the signal readout label column by the widest label, never a guess", () => {
    // Measured at 390x844x3: "CHARACTER" renders 72px and "ENTRANCE" 64px, so
    // the fixed 62px column this used to declare pushed both labels through the
    // 8px gutter and into their own values ("CHARACTERDrinkers called it
    // rough."). A row is a label plus a reading, so the label may not be
    // clipped and the reading may not be reached early. The five rows share ONE
    // grid whose first track is content-sized, which is the only form that
    // cannot go stale when the label copy changes.
    const readout = venuePriceSubmitCss.match(/\.vpsigReadout\s*{([^}]*)}/)?.[1] ?? "";
    expect(readout, ".vpsigReadout rule present").not.toBe("");
    const track = readout.match(/grid-template-columns:\s*([^;]+);/)?.[1]?.trim() ?? "";
    expect(track, ".vpsigReadout declares its columns").not.toBe("");
    expect(track).toMatch(/^(max-content|min-content|auto|fit-content\()/);
    expect(track, "label column is not a fixed length").not.toMatch(/^\d/);
    expect(readout).toMatch(/column-gap:\s*\d/);

    // display: contents is what makes that one track govern all five rows.
    expect(venuePriceSubmitCss).toMatch(
      /\.vpsigReadoutRow\s*{[^}]*display:\s*contents/,
    );
    const labelRule =
      venuePriceSubmitCss.match(/\.vpsigReadoutRow dt\s*{([^}]*)}/)?.[1] ?? "";
    expect(labelRule, ".vpsigReadoutRow dt rule present").not.toBe("");
    expect(labelRule).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(labelRule).not.toMatch(/overflow:\s*hidden/);
    expect(labelRule).not.toMatch(/width:/);
  });

  it("removes community signal motion when the phone asks for less", () => {
    expect(venuePriceSubmitCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{[\s\S]*?\.vpsigSummaryChevron\s*{[^}]*transition:\s*none/,
    );
  });

  it("keeps basemap Retry thumb-sized and clear of phone navigation", () => {
    expect(globalCss).toMatch(
      /\.mapSoftRetryBtn\s*{[^}]*min-width:\s*64px;[^}]*min-height:\s*44px/,
    );
    expect(globalCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.mapSoftRetry\s*{[^}]*bottom:\s*calc\(var\(--mobile-tab-clearance\) \+ 10px\)/,
    );
  });
});

// The create action's own geometry - 56px square, its menu rows at the 44px tap
// floor, the whole stack clear of the tab bar it parks above - is measured
// against the RENDERED boxes in e2e/mobile-map-chrome-fit.spec.ts at 320, 390
// and 430. Restating those declarations here would prove only that the text is
// present, which a dead rule or a behaviour-preserving rename both defeat.
