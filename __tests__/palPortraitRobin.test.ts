import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PalPortrait from "@/components/pal/PalPortrait";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";

function portraitMarkup(species: typeof DEFAULT_PAL_DRAFT.appearance.species): string {
  return renderToStaticMarkup(
    createElement(PalPortrait, {
      appearance: { ...DEFAULT_PAL_DRAFT.appearance, species },
      name: "Pub Pal",
      state: "noticing",
    }),
  );
}

describe("PalPortrait circuit robin", () => {
  it("defaults /pal to the circuit robin with alt Pub Pal", () => {
    expect(DEFAULT_PAL_DRAFT.appearance.species).toBe("robin");
    const html = portraitMarkup(DEFAULT_PAL_DRAFT.appearance.species);
    expect(html).toContain("circuit-robin");
    expect(html).toMatch(/<img\b[^>]*alt="Pub Pal"/);
  });

  it("renders the circuit robin bitmap by default", () => {
    const html = portraitMarkup("robin");
    expect(html).toContain("circuit-robin");
    expect(html).toMatch(/<img\b[^>]*alt="Pub Pal"/);
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("palRigGreyhound");
  });

  it("draws the rendered species from its own master, never the robin's", () => {
    const greyhound = portraitMarkup("greyhound");
    expect(greyhound).toContain("circuit-greyhound");
    expect(greyhound).not.toContain("circuit-robin");
    expect(greyhound).not.toContain("palRigGreyhound");

    const cat = portraitMarkup("cat");
    expect(cat).toContain("circuit-cat");
    expect(cat).not.toContain("circuit-robin");
    expect(cat).not.toContain("palRigCat");
  });

  it("keeps the layered-SVG rig for a species with no master", () => {
    const fox = portraitMarkup("fox");
    expect(fox).toContain("palRigFox");
    expect(fox).not.toContain("/pal/circuit-");
    expect(fox).toContain('role="img"');

    // `hound` is the legacy spelling and has no row of its own, so it stays on
    // the rig even though `greyhound` now ships a master.
    const hound = portraitMarkup("hound");
    expect(hound).toContain("palRigGreyhound");
    expect(hound).not.toContain("/pal/circuit-");
  });
});
