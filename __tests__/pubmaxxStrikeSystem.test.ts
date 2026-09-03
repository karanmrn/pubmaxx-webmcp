import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PubmaxxMarkStrike from "@/components/brand/PubmaxxMarkStrike";
import PubmaxxNightSeal from "@/components/brand/PubmaxxNightSeal";
import PubmaxxLoadingEmber from "@/components/brand/PubmaxxLoadingEmber";
import { MARK_GEOMETRY } from "@/components/brand/PubmaxxMark";

function strike(props: Parameters<typeof PubmaxxMarkStrike>[0] = {}): string {
  return renderToStaticMarkup(createElement(PubmaxxMarkStrike, props));
}
function seal(props: Parameters<typeof PubmaxxNightSeal>[0] = {}): string {
  return renderToStaticMarkup(createElement(PubmaxxNightSeal, props));
}
function ember(props: Parameters<typeof PubmaxxLoadingEmber>[0] = {}): string {
  return renderToStaticMarkup(createElement(PubmaxxLoadingEmber, props));
}

describe("PubmaxxMarkStrike — the draw-in", () => {
  it("reuses the canonical X geometry (three filled stroke polygons, never strokes)", () => {
    const svg = strike();
    expect(svg).toContain(`points="${MARK_GEOMETRY.thinA}"`);
    expect(svg).toContain(`points="${MARK_GEOMETRY.thinB}"`);
    expect(svg).toContain(`points="${MARK_GEOMETRY.thick}"`);
    expect((svg.match(/<polygon/g) ?? []).length).toBe(3);
  });

  it("drives the draw with two masked beams (a=thick descending, b=ascending double)", () => {
    const svg = strike();
    expect((svg.match(/<mask/g) ?? []).length).toBe(2);
    expect(svg).toContain("markStrike__beam markStrike__beam--a");
    expect(svg).toContain("markStrike__beam markStrike__beam--b");
    // All three stroke polygons are revealed through a mask (beam A the thick
    // descending stroke, beam B both thin ascending strokes).
    expect((svg.match(/mask="url\(#strikeBeam/g) ?? []).length).toBe(3);
    // pathLength normalises the dash sweep across sizes.
    expect(svg).toContain('pathLength="1"');
  });

  it("plays on mount by default and can be frozen still", () => {
    expect(strike()).toContain("markStrike--play");
    expect(strike()).not.toContain("markStrike--still");
    const frozen = strike({ still: true });
    expect(frozen).toContain("markStrike--still");
    expect(frozen).not.toContain("markStrike--play");
  });

  it("defaults to the duo X: coral strokes + a lit bright ember", () => {
    const svg = strike();
    expect((svg.match(/var\(--brass, #ff5a5f\)/g) ?? []).length).toBe(3);
    expect(svg).toContain("var(--brass-bright, #ff7a55)");
    expect(svg).toContain('class="markStrike__ember"');
  });

  it("mono is ember-less by default but pops a monochrome ember when asked", () => {
    const mono = strike({ variant: "mono" });
    expect(mono).toContain("currentColor");
    expect(mono).not.toContain("markStrike__ember");
    const monoSeal = strike({ variant: "mono", monoEmber: true });
    expect(monoSeal).toContain("markStrike__ember");
    // The ember inherits the single stamp tone, not the bright token.
    expect(monoSeal).not.toContain("var(--brass-bright");
    expect(monoSeal).toMatch(/markStrike__ember"[^>]*fill="currentColor"/);
  });

  it("is decorative by default and labelled when titled", () => {
    expect(strike()).toContain('aria-hidden="true"');
    const labelled = strike({ title: "PUBMAXX" });
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain("<title>PUBMAXX</title>");
  });

  it("honours size", () => {
    expect(strike({ size: 40 })).toContain('width="40"');
  });
});

describe("PubmaxxNightSeal — the completed-night stamp", () => {
  it("draws a broken ink ring: r 29, 1.5px, one 3px gap, rotated for the break", () => {
    const svg = seal();
    expect(svg).toContain('r="29"');
    expect(svg).toContain('stroke-width="1.5"');
    // A single 3px gap on the ~182.21 circumference.
    const circumference = 2 * Math.PI * 29;
    expect(svg).toContain(`stroke-dasharray="${(circumference - 3).toFixed(2)} 3"`);
    expect(svg).toContain('transform="rotate(41 32 32)"');
  });

  it("stamps the Clink at 0.72 scale via the Strike (monochrome, with a popping ember)", () => {
    const svg = seal({ size: 100 });
    // 0.72 * 100 = 72 — the mark inside the stamp.
    expect(svg).toContain('width="72"');
    expect(svg).toContain("markStrike");
    expect(svg).toContain("nightSeal__mark");
    expect(svg).toContain("markStrike__ember"); // monoEmber on
  });

  it("selects tone by variant (auto theme-driven by default)", () => {
    expect(seal()).toContain("nightSeal--auto");
    expect(seal({ variant: "ink" })).toContain("nightSeal--ink");
    expect(seal({ variant: "coral" })).toContain("nightSeal--coral");
  });

  it("is decorative unless titled", () => {
    expect(seal()).toContain('aria-hidden="true"');
    expect(seal({ title: "Night sealed" })).toContain('aria-label="Night sealed"');
  });
});

describe("PubmaxxLoadingEmber — the breathing node", () => {
  it("renders the ember alone (the mark unstruck) in the bright token", () => {
    const svg = ember();
    expect(svg).toContain('class="loadingEmber__node"');
    expect(svg).toContain("var(--brass-bright, #ff7a55)");
    expect(svg).not.toContain("<polygon"); // no arms — just the ember
    expect(svg).toContain(`r="${MARK_GEOMETRY.node.r}"`);
  });

  it("is decorative by default and a status image when labelled", () => {
    expect(ember()).toContain('aria-hidden="true"');
    const labelled = ember({ label: "Building route" });
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Building route"');
  });

  it("honours size", () => {
    expect(ember({ size: 15 })).toContain('width="15"');
  });
});
