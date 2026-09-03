import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*{([^}]*)}`))?.[1] ?? "";
}

const globalsCss = read("app/globals.css");
const toolbarCss = read("components/map/mapToolbar.css");
const citySwitcherCss = read("components/map/citySwitcher.css");
const zonePickerCss = read("components/map/zonePicker.css");
const conditionsCss = read("components/desktop/conditionsChip.css");
const searchCss = read("components/map/mapSearchSuggest.css");

describe("desktop map toolbar rhythm", () => {
  it.each([
    ["Drinks", toolbarCss, ".mapToolbarDrinksBtn"],
    ["Search", searchCss, ".mapSearchSuggest--toolbar > label"],
    ["Drink", toolbarCss, ".mapToolbarDesktopExtras .favoritePintControl"],
    ["Zone", zonePickerCss, ".zonePickerBtn"],
    ["Plan an outing", globalsCss, ".planBtn"],
    ["City", citySwitcherCss, ".citySwitcherTrigger"],
    ["Conditions", conditionsCss, ".conditionsChip"],
  ])("keeps %s at the shared 44px row height", (_name, css, selector) => {
    expect(ruleBody(css, selector)).toMatch(/min-height:\s*44px/);
  });

  it("keeps desktop drink selectors on one shared row", () => {
    expect(
      ruleBody(toolbarCss, ".mapToolbarDesktopExtras .favoritePintPicker"),
    ).toMatch(/flex-wrap:\s*nowrap\s*!important/);
  });

  it("reserves the measured 155px tablet toolbar height", () => {
    expect(toolbarCss).toMatch(
      /@media \(min-width: 641px\) and \(max-width: 900px\)[\s\S]*--map-toolbar-resting-height:\s*155px/,
    );
  });

  it("reserves the measured 155px desktop toolbar height", () => {
    expect(ruleBody(toolbarCss, ".appShell")).toMatch(
      /--map-toolbar-resting-height:\s*155px/,
    );
  });
});
