import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Party-accent containment gate (docs/VIBE_LAYER_SPEC_2026-07-19.md, "Accent
// type"). The spec quarantined Bungee to at most three component families and
// banned it from body, navigation and data surfaces. On 2026-08-18 the vibe
// chips - its last consumer - left the face, so the app loads no Bungee
// webfont at all and defines no --font-party token. The quarantine therefore
// tightens to zero: a reference in shipped code is now a token nothing
// defines, which resolves to its fallback and drags a webfont back with it if
// anyone re-adds the loader. Share cards keep Bungee through the vendored TTF
// satori reads (lib/ogBrand.tsx); no browser downloads that.

function codeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return codeFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

// The grep is scoped to code surfaces, so docs and this test may name the
// token freely.
function filesContaining(pattern: RegExp): string[] {
  const root = process.cwd();
  return ["app", "components", "lib"]
    .flatMap((directory) => codeFiles(join(root, directory)))
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file));
}

describe("party accent containment (vibe layer spec)", () => {
  it("keeps --font-party out of shipped code", () => {
    // Scan shipped code directly. Deployment archives intentionally omit .git,
    // while this containment gate must run identically in local and Vercel CI.
    expect(filesContaining(/--font-party/)).toEqual([]);
  });

  it("keeps the killed register out of the tracked tree's product strings", () => {
    // Spec kill-list: these terms are banned everywhere, not just chips.
    // Word boundaries keep this honest (no substring hits inside larger words).
    // lib/vibeChips.ts is the kill-list's one canonical DEFINITION site (its
    // KILLED_VIBE_TERMS constant powers the chip-surface tests) — the terms
    // appearing there are the ban itself, not product copy, so it is the one
    // sanctioned hit. Anything else is a leak.
    const KILL_LIST_DEFINITION_SITE = "lib/vibeChips.ts";
    for (const term of ["turnt", "bussin"]) {
      const leaks = filesContaining(new RegExp(`\\b${term}\\b`, "i"))
        .filter((file) => file !== KILL_LIST_DEFINITION_SITE);
      expect(leaks, `killed term "${term}" found`).toEqual([]);
    }
  });
});
