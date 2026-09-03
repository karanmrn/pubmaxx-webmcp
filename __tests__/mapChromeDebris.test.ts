import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Two pieces of chrome that read as debris on a phone (desktop taste gate,
// finding M7). Both were invisible to a desktop browser, so both are held in
// the shipped CSS, the same house pattern as mobileChromeFit.test.ts.
//
//  - MapLibre's control group parked a bare dark square under the round TfL
//    chip, over cluster pins. It is a control, so it wears the lane's shape.
//  - The map key's three closed sections carried no affordance at all:
//    `display: flex` on a <summary> drops the browser's disclosure triangle, so
//    "Pin shapes", "Dots and rings" and "Routes" read as headings over nothing.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const mobileMapCss = read("components/mobile/mobileMapShell.css");
const mapKeyCss = read("components/map/mapKey.css");

/**
 * Every declaration that lands on `selector`, from each rule that names it.
 *
 * Selector-list rules are the reason this is not one regex: `.mapKeySection h3,
 * .mapKeyDetails summary { … }` styles the summary too, and a naive match on
 * the second name would read the shared rule as the whole answer.
 */
function rule(css: string, selector: string): string {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
  const declarations: string[] = [];
  for (const [, list, body] of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (list.split(",").some((name) => name.trim() === selector)) {
      declarations.push(body);
    }
  }
  return declarations.join("\n");
}

describe("phone map compass — a control, not a box", () => {
  const group = rule(
    mobileMapCss,
    ".appShell .mapStage .maplibregl-ctrl-top-right .maplibregl-ctrl-group",
  );

  it("wears the round 44px shape the rest of the lane uses", () => {
    expect(group).toMatch(/border-radius:\s*50%/);
    expect(group).toMatch(/width:\s*44px/);
    expect(group).toMatch(/height:\s*44px/);
    // A square corner painting outside a round group is the box coming back.
    expect(group).toMatch(/overflow:\s*hidden/);
  });

  it("keeps the compass itself, which is the only way back to north", () => {
    expect(mobileMapCss).not.toMatch(
      /\.maplibregl-ctrl-compass\s*{[^}]*display:\s*none/,
    );
  });
});

describe("map key sections — a closed row says it opens", () => {
  const summary = rule(mapKeyCss, ".mapKeyDetails summary");
  const chevron = rule(mapKeyCss, ".mapKeyDetails summary::after");
  const openChevron = rule(mapKeyCss, ".mapKeyDetails[open] summary::after");

  it("draws a chevron on every summary row", () => {
    expect(chevron).toMatch(/content:\s*""/);
    expect(chevron).toMatch(/border-right:/);
    expect(chevron).toMatch(/border-bottom:/);
    expect(chevron).toMatch(/rotate\(45deg\)/);
    // The row is a flex line, so the chevron needs its own end of it.
    expect(summary).toMatch(/justify-content:\s*space-between/);
    expect(summary).toMatch(/min-height:\s*44px/);
  });

  it("turns the chevron when the section is open", () => {
    expect(openChevron).toMatch(/rotate\(-135deg\)/);
    expect(openChevron).not.toBe(chevron);
  });

  it("hides the browser markers it replaced, in both engines", () => {
    expect(summary).toMatch(/list-style:\s*none/);
    expect(mapKeyCss).toMatch(
      /\.mapKeyDetails summary::-webkit-details-marker\s*{[^}]*display:\s*none/,
    );
  });
});
