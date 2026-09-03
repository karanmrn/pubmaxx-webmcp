// A route may not download a font weight nothing can draw.
//
// U5 of docs/plans/SITE_SPEED_2026-09-01.md. Three families load through
// next/font: Space Grotesk and Inter as VARIABLE faces, which carry their whole
// axis in one file and so have no unused weight to drop, and JetBrains Mono as
// a static list.
//
// That list carried 500, and CSS cannot reach it. The font-matching algorithm
// searches UPWARD first for any target above 500, so every stamped rule in the
// tree - the `font: 550` shorthands on the landing, the legal pages and the
// drop strip, and Pub Pal chat's 600, 640 and 650 - already resolves to 700.
// Only an exact 500, or a target in (400, 500], could have used the file.
//
// This fence is the reason that stays true: add such a rule and the weight has
// to come back, deliberately, in the same commit.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const layout = readFileSync(join(REPO_ROOT, "app/layout.tsx"), "utf8");

function stylesheets(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".css")) found.push(full);
    }
  };
  walk(join(REPO_ROOT, dir));
  return found;
}

/** Every weight a rule asks for while naming the mono face. */
function monoWeightTargets(): number[] {
  const targets: number[] = [];
  for (const dir of ["app", "components"]) {
    for (const file of stylesheets(dir)) {
      const css = readFileSync(file, "utf8");
      // `font: <weight> <size>/<lh> var(--font-data)`
      for (const match of css.matchAll(
        /font:\s*(\d{3})[^;]*var\(--font-data\)/g,
      )) {
        targets.push(Number(match[1]));
      }
      // A `font-family: var(--font-data)` rule with its own font-weight, in
      // either order inside the same declaration block.
      for (const block of css.matchAll(/\{[^{}]*\}/g)) {
        const body = block[0];
        if (!body.includes("var(--font-data)")) continue;
        const weight = /font-weight:\s*(\d{3})/.exec(body);
        if (weight) targets.push(Number(weight[1]));
      }
    }
  }
  return targets;
}

describe("the mono face carries only weights something asks for", () => {
  it("declares 400 and 700 and nothing between", () => {
    expect(layout).toContain('weight: ["400", "700"]');
  });

  it("has no shipped rule that could resolve to 500", () => {
    // A target in (400, 500] is the only band that prefers 500 over 700.
    const unreachable = monoWeightTargets().filter(
      (weight) => weight > 400 && weight <= 500,
    );
    expect(
      unreachable,
      "a rule in this band needs the 500 file back in app/layout.tsx",
    ).toEqual([]);
  });

  it("keeps the two variable families variable, so they drop no weight", () => {
    expect(layout).toContain('weight: "variable"');
    // Inter declares no weight at all, which is next/font's variable default.
    const inter = layout.slice(layout.indexOf("const bodySans = Inter("));
    expect(inter.slice(0, inter.indexOf("});"))).not.toContain("weight:");
  });

  it("keeps the metric-matched fallback, so no swap reflows", () => {
    expect(layout).toContain("adjustFontFallback: true");
  });
});
