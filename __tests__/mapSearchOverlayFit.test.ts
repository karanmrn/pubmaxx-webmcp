import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The phone search overlay at 390px. Same house pattern as
// mobileChromeFit.test.ts: assertions over the shipped CSS, because every
// defect here was invisible to a desktop browser and to any run that never
// opens the overlay at phone width.
//
// Measured on the live map before the fix: the chrome stack ran to 478px on a
// 390px screen. The distance column, the Pub Pal button and the More controls
// button were all off-screen, the field drew a coral ring inside a coral ring,
// and Chrome's own cancel glyph sat beside the labelled Clear search button as
// a second, identical X.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const mobileMapCss = read("components/mobile/mobileMapShell.css");
const suggestCss = read("components/map/mapSearchSuggest.css");
const globalCss = read("app/globals.css");
const searchFieldTsx = read("components/ui/search-field.tsx");
const pubMapTsx = read("components/PubMap.tsx");

const rule = (css: string, selector: string): string => {
  const index = css.indexOf(selector);
  if (index < 0) return "";
  const open = css.indexOf("{", index);
  const close = css.indexOf("}", open);
  return open < 0 || close < 0 ? "" : css.slice(open + 1, close);
};

describe("the phone search overlay is bounded by the screen", () => {
  it("bounds every chrome row to the stack, not to its own content", () => {
    // A grid item defaults to min-width:auto, so the widest row sized the
    // implicit column and dragged the top bar off-screen with it.
    expect(rule(mobileMapCss, ".mobileMapChrome {")).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  it("lets the search row shrink below its content width", () => {
    expect(rule(mobileMapCss, ".mobileMapSearchRow {")).toMatch(/min-width:\s*0/);
  });

  it("caps the overlay field and its panel at the host width", () => {
    const overlay = rule(suggestCss, ".mapSearchSuggest--overlay {");
    expect(overlay).toMatch(/max-width:\s*100%/);
    expect(overlay).toMatch(/min-width:\s*0/);
    expect(rule(suggestCss, ".mapSearchSuggest--overlay .mapSearchSuggestPanel {")).toMatch(
      /max-width:\s*100%/,
    );
  });

  it("stacks a suggestion row so no figure is starved or overlapped", () => {
    // Bounding the panel made the never-shrinking distance crush the price to
    // four pixels, which then drew on top of the borough.
    expect(rule(suggestCss, ".mapSearchSuggest--overlay .mapSearchSuggestRow {")).toMatch(
      /flex-wrap:\s*wrap/,
    );
    expect(rule(suggestCss, ".mapSearchSuggest--overlay .mapSearchSuggestRowMain {")).toMatch(
      /flex:\s*1 1 100%/,
    );
    expect(rule(suggestCss, ".mapSearchSuggest--overlay .mapSearchSuggestMeta {")).toMatch(
      /flex:\s*1 1 100%/,
    );
  });

  it("keeps the distance wording, because a row is read on its own", () => {
    // The panel heading names the origin too, but the row must still say what
    // its figure is measured from. Fitting is never a licence to abbreviate.
    expect(suggestCss).not.toMatch(/mapSearchSuggestDistance[^}]*display:\s*none/);
  });
});

describe("the house search field is one control", () => {
  it("wears one focus ring, and the inner outline is suppressed", () => {
    expect(searchFieldTsx).toMatch(/focus-within:ring-2/);
    expect(searchFieldTsx).toMatch(/focus-within:ring-\[var\(--brass\)\]/);
    expect(rule(globalCss, '.houseSearchField input[type="search"]:focus-visible {')).toMatch(
      /outline:\s*none/,
    );
  });

  it("shows one clear button, not the browser's as well", () => {
    const native = rule(
      globalCss,
      '.houseSearchField input[type="search"]::-webkit-search-cancel-button {',
    );
    expect(native).toMatch(/appearance:\s*none/);
    expect(native).toMatch(/display:\s*none/);
    // The surviving X is the labelled one, so it stays reachable.
    expect(searchFieldTsx).toMatch(/aria-label="Clear search"/);
  });

  it("carries the class those rules hang on", () => {
    expect(searchFieldTsx).toMatch(/houseSearchField/);
  });
});

describe("the camera waits for a result the reader can see", () => {
  it("holds still while the phone search overlay covers the map", () => {
    expect(pubMapTsx).toMatch(/const searchOverlayOpen = mapOverlay === "search"/);
    expect(pubMapTsx).toMatch(/if \(searchOverlayOpen\) return;/);
  });

  it("still frames the matches once the overlay closes", () => {
    // The deferral must not become a cancellation: a live query with the
    // overlay shut has to move the camera, or search dead-ends again.
    const effect = pubMapTsx.slice(
      pubMapTsx.indexOf("const searchOverlayOpen"),
      pubMapTsx.indexOf("// #397"),
    );
    expect(effect).toMatch(/setSearchFitToken/);
    // Membership in the dependency list, not a position in it. Where the name
    // sits carries no meaning, and pinning the last slot broke the moment a
    // second guard joined the same effect.
    const deps = /\}, \[([^\]]*)\]\);/.exec(effect)?.[1] ?? "";
    expect(deps.split(",").map((d) => d.trim())).toContain("searchOverlayOpen");
  });
});
