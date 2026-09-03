import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("installed skill integrity", () => {
  it("links committed directory mirrors into Cursor skill discovery", () => {
    const root = mkdtempSync(join(tmpdir(), "pubmax-skill-links-"));
    const canonical = join(root, ".agents", "skills", "architect");
    const mirror = join(root, "skills", "architect");
    mkdirSync(canonical, { recursive: true });
    writeFileSync(join(canonical, "SKILL.md"), "---\nname: architect\n---\n");
    mkdirSync(dirname(mirror), { recursive: true });
    symlinkSync(relative(dirname(mirror), canonical), mirror);

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "link-cursor-skills.mjs")], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const cursorLink = join(root, ".cursor", "skills", "architect");
    expect(lstatSync(cursorLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(cursorLink)).toBe(relative(dirname(cursorLink), mirror));
    expect(realpathSync(join(cursorLink, "SKILL.md"))).toBe(realpathSync(join(canonical, "SKILL.md")));
  });

  it("keeps continual learning self-contained and approval-gated", () => {
    const skill = readFileSync(
      join(process.cwd(), ".agents", "skills", "continual-learning", "SKILL.md"),
      "utf8",
    );

    expect(skill).not.toContain("agents-memory-updater");
    expect(skill).toMatch(/Wait for explicit approval/);
    expect(skill).toMatch(/Never read transcripts outside current workspace/);
  });
});
