import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// TWO ARROWS, TWO MEANINGS. `ExternalLink` rides a link that LEAVES the site;
// `ArrowRight` rides one that stays on it. The diagonal `ArrowUpRight` is the
// glyph a reader has learnt means "this opens somewhere else", so on an
// internal row it promises a new tab that never opens.
//
// /today's own header comment has said this since the day it was fixed there,
// and the rule then regrew on /tonight: "Coffee catch-up", "Alcohol-free
// outing", "See them on the map" and the quiet-pint alternatives all wore the
// diagonal while linking to /plan, /map and /crawls. A rule written in one
// file's comment is not a rule; this is.
//
// SCOPE. The two daily surfaces and the cards they share. Both routes link
// outward through `ExternalLink` alone, so on these files the diagonal has no
// honest use left. Surfaces that genuinely mix the two (e.g. /historic, whose
// rows carry outbound citations) are not in this sweep.

const ROOT = process.cwd();

const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

// A comment naming the retired glyph is the record of the fix, not the defect.
// /today's header explains why the diagonal left; that sentence must survive.
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function surfaceFiles(): string[] {
  const files: string[] = [];
  for (const dir of ["app/tonight", "app/today"]) {
    for (const entry of readdirSync(join(ROOT, dir))) {
      if (entry.endsWith(".tsx")) files.push(`${dir}/${entry}`);
    }
  }
  return files.sort();
}

describe("an internal link never wears the leaves-the-site arrow", () => {
  const files = surfaceFiles();

  it("sweeps a real spread of surfaces", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it("keeps the diagonal off /tonight and /today", () => {
    const offenders = files.filter((file) => code(file).includes("ArrowUpRight"));
    expect(
      offenders,
      `these link internally, so they take ArrowRight (or ExternalLink when they really leave):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps a distinct glyph for a link that really does leave", () => {
    // The fence above must not be satisfiable by dropping the distinction
    // altogether: an outbound row still says so.
    const tonight = read("app/tonight/TonightClient.tsx");
    expect(tonight).toContain("ExternalLink");
    expect(tonight).toContain("ArrowRight");
  });
});
