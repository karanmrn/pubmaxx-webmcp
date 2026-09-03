import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PubmaxxMark, { MARK_GEOMETRY } from "@/components/brand/PubmaxxMark";

function render(props: Parameters<typeof PubmaxxMark>[0] = {}): string {
  return renderToStaticMarkup(createElement(PubmaxxMark, props));
}

describe("PubmaxxMark — the double-struck X", () => {
  it("pins the canonical X geometry (thick descending stroke + two thin ascending strokes)", () => {
    // These coordinates are the master brand geometry, owner-approved
    // 2026-07-22. They must stay in lockstep with scripts/gen-brand-assets.mjs
    // and scripts/gen-native-app-icons.mjs — a drift here ships everywhere.
    expect(MARK_GEOMETRY.viewBox).toBe("0 0 64 64");
    expect(MARK_GEOMETRY.thick).toBe("9,10 21,10 55,54 43,54");
    expect(MARK_GEOMETRY.thinA).toBe("42,10 47,10 13,54 8,54");
    expect(MARK_GEOMETRY.thinB).toBe("51,10 56,10 22,54 17,54");
    expect(MARK_GEOMETRY.slashSimple).toBe("45,10 53,10 19,54 11,54");
    expect(MARK_GEOMETRY.node).toEqual({ cx: 32, cy: 32, r: 3.2 });
    expect(MARK_GEOMETRY.plaqueRadius).toBe(15);
  });

  it("renders the strokes as three filled polygons — never stroked paths", () => {
    const svg = render();
    expect(svg).toContain("<svg");
    expect(svg).toContain(`viewBox="${MARK_GEOMETRY.viewBox}"`);
    // Two thin ascending strokes + the thick descending stroke.
    expect(svg).toContain(`points="${MARK_GEOMETRY.thinA}"`);
    expect(svg).toContain(`points="${MARK_GEOMETRY.thinB}"`);
    expect(svg).toContain(`points="${MARK_GEOMETRY.thick}"`);
    expect((svg.match(/<polygon/g) ?? []).length).toBe(3);
    // The X is filled geometry: no <path>, no stroke language survives.
    expect(svg).not.toContain("<path");
    expect(svg).not.toContain("stroke-width");
  });

  it("mono variant is theme-agnostic: currentColor strokes, no baked hex, no node", () => {
    const svg = render({ variant: "mono" });
    expect(svg).toContain("currentColor");
    expect(svg).not.toMatch(/#[0-9a-f]{6}/i);
    // No lit ember and no tile in the bare mono mark.
    expect(svg).not.toContain("<circle");
    expect(svg).not.toContain("<rect");
  });

  it("duo variant is the bare coral X with a lit ember, on transparent", () => {
    const duo = render({ variant: "duo" });
    // All three strokes are coral (no amber anywhere in the X palette).
    expect((duo.match(/var\(--brass, #ff5a5f\)/g) ?? []).length).toBe(3);
    expect(duo).not.toContain("--amber");
    expect(duo).toContain("var(--brass-bright, #ff7a55)"); // ember
    expect(duo).toContain("<circle");
    expect(duo).not.toContain("<rect"); // transparent, no tile
  });

  it("plaque variant lays the coral X + ember on an ink-deep tile", () => {
    const plaque = render({ variant: "plaque" });
    expect(plaque).toContain("<rect");
    expect(plaque).toContain(`rx="${MARK_GEOMETRY.plaqueRadius}"`);
    expect(plaque).toContain("var(--ink-deep, #060607)"); // tile
    expect((plaque.match(/var\(--brass, #ff5a5f\)/g) ?? []).length).toBe(3); // coral strokes
    expect(plaque).toContain("var(--brass-bright, #ff7a55)"); // ember
  });

  it("renders correctly in both themes via token custom properties", () => {
    // The mark never hardcodes a single theme's colour — brand variants pull
    // live tokens (which flip between light/dark) with a literal fallback, so
    // one render is correct under html[data-theme=light] and =dark alike.
    const duo = render({ variant: "duo" });
    expect(duo).toContain("var(--brass, #ff5a5f)");
    expect(duo).toContain("var(--brass-bright, #ff7a55)");
  });

  it("honours the size prop (favicon → hero)", () => {
    expect(render({ size: 16 })).toContain('width="16"');
    expect(render({ size: 512 })).toContain('width="512"');
  });

  it("is decorative by default and labelled when given a title", () => {
    expect(render()).toContain('aria-hidden="true"');
    const labelled = render({ title: "PUBMAXX" });
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain("<title>PUBMAXX</title>");
    expect(labelled).not.toContain('aria-hidden="true"');
  });
});
