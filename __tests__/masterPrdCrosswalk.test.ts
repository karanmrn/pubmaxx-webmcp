import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCS = join(process.cwd(), "docs");
const MASTER = readFileSync(join(DOCS, "MASTER_PRD.md"), "utf8");

describe("MASTER_PRD legacy crosswalk", () => {
  it("classifies every PRD and Wayfinder document, including archives", () => {
    const walk = (directory: string, prefix = ""): string[] => readdirSync(directory)
      .flatMap((name) => {
        const relative = prefix ? `${prefix}/${name}` : name;
        const absolute = join(directory, name);
        return statSync(absolute).isDirectory() ? walk(absolute, relative) : [relative];
      });
    const legacyDocuments = walk(DOCS)
      .filter((name) => {
        const normalizedBasename = basename(name).toLowerCase();
        return (
          (normalizedBasename.includes("prd") || normalizedBasename.startsWith("wayfinder"))
          && normalizedBasename.endsWith(".md")
          && normalizedBasename !== "master_prd.md"
          && normalizedBasename !== "wayfinder_master_v1.md"
        );
      })
      .sort();

    const missing = legacyDocuments.filter((name) => !MASTER.includes(`| \`${name}\` |`));
    expect(missing).toEqual([]);
  });

  it("does not leave known legacy roadmap-authority claims active", () => {
    const currentSnapshot = readFileSync(join(DOCS, "CURRENT_IMPLEMENTED_STATE_PRD.md"), "utf8");
    const fable = readFileSync(join(DOCS, "PRD_FOR_FABLE.md"), "utf8");
    const spill = readFileSync(join(DOCS, "THE_SPILL_FIRST_PRINCIPLES_PRD.md"), "utf8");
    expect(currentSnapshot).not.toContain("Purpose:** Single source of truth");
    expect(fable).not.toContain("PRD_CANONICAL.md` (the engineering roadmap)");
    expect(spill).not.toContain("as the north star for the social layer");
  });

  it("declares the rejected progression mechanics explicitly", () => {
    expect(MASTER).toContain("There are no streaks, freezes, drinking counts, or consumption-based rewards.");
  });
});
