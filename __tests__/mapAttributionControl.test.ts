// The map's ODbL credit is a control, not a rendering defect.
//
// DEFECT (UI audit, 2026-09-01, production, 390x844): four info glyphs rendered
// stacked on a white rounded blob at the map's bottom right.
//
// Read off the live control: ONE attribution control, ONE button, computed
// 44x44 with `background-size: auto` and `background-repeat: repeat`. MapLibre
// ships the glyph as a 24px background SVG on a 24px button and never
// constrains the repeat, because it never needs to. Raising the button to this
// app's 44px tap floor tiled that glyph 2 x 2, and the control behind it stayed
// MapLibre's 24 x 20 white sliver, so the button overflowed its own container.
//
// The credit itself is untouched: OSM_ATTRIBUTION is still passed as
// customAttribution on the map, so it survives every style swap and every city.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { OSM_ATTRIBUTION } from "@/components/map/canvas/tokens";

const REPO_ROOT = join(__dirname, "..");
const shellCss = readFileSync(
  join(REPO_ROOT, "components/mobile/mobileMapShell.css"),
  "utf8",
);
const canvasTsx = readFileSync(
  join(REPO_ROOT, "components/PubMapCanvas.tsx"),
  "utf8",
);

function ruleFor(selector: string): string {
  const at = shellCss.indexOf(selector);
  expect(at, `${selector} present`).toBeGreaterThan(-1);
  const open = shellCss.indexOf("{", at);
  return shellCss.slice(open, shellCss.indexOf("}", open));
}

describe("the attribution glyph is drawn once", () => {
  const button = ruleFor(".appShell .mapStage .maplibregl-ctrl-attrib-button");

  it("keeps the 44px tap floor", () => {
    expect(button).toContain("min-width: 44px;");
    expect(button).toContain("min-height: 44px;");
  });

  it("stops the 24px glyph tiling across it", () => {
    expect(button).toContain("background-repeat: no-repeat;");
    expect(button).toContain("background-position: center;");
    expect(button).toContain("background-size: 24px 24px;");
  });
});

describe("the collapsed credit takes this lane's own shape", () => {
  const control = ruleFor(
    ".maplibregl-ctrl-attrib.maplibregl-compact:not(.maplibregl-compact-show)",
  );

  it("is a 44px circle on the raised surface, like the compass beside it", () => {
    expect(control).toContain("width: 44px;");
    expect(control).toContain("height: 44px;");
    expect(control).toContain("border-radius: 50%;");
    expect(control).toContain("background: var(--color-surface-raised);");
  });

  it("shapes only the COLLAPSED state, so the expanded credit stays readable", () => {
    expect(shellCss).toContain(":not(.maplibregl-compact-show)");
  });
});

describe("the credit itself is unchanged", () => {
  it("still rides the map as customAttribution", () => {
    expect(canvasTsx).toContain("customAttribution: OSM_ATTRIBUTION,");
    expect(OSM_ATTRIBUTION).toContain("OpenStreetMap contributors");
    expect(OSM_ATTRIBUTION).toContain("ODbL");
  });
});
