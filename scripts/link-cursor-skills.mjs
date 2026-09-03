#!/usr/bin/env node
/**
 * Create/refresh .cursor/skills/* symlinks -> ../skills/<name>
 * so Cursor Desktop discovers the committed skill mirrors.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const skillsRoot = join(root, "skills");
const cursorSkills = join(root, ".cursor", "skills");
mkdirSync(cursorSkills, { recursive: true });

function linkSkill(absSkillDir, name) {
  const dest = join(cursorSkills, name);
  const target = relative(cursorSkills, absSkillDir);
  if (existsSync(dest) || lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink()) {
    try {
      const cur = readlinkSync(dest);
      if (cur === target) return "skip";
    } catch {
      /* replace */
    }
    rmSync(dest, { recursive: true, force: true });
  }
  symlinkSync(target, dest);
  return "linked";
}

let linked = 0;
let skipped = 0;
for (const name of readdirSync(skillsRoot)) {
  const dir = join(skillsRoot, name);
  try {
    // Follow committed skills/* directory symlinks. lstatSync sees each mirror
    // as a symlink and used to skip every one before Cursor links were made.
    if (!statSync(dir).isDirectory()) continue;
  } catch {
    continue;
  }
  if (!existsSync(join(dir, "SKILL.md"))) continue;
  const r = linkSkill(dir, name);
  if (r === "linked") linked += 1;
  else skipped += 1;
}

// Nested vendor packs
for (const rel of ["emilkowalski-skills/skills", "gnurio-refactoring-ui-plugin/skills"]) {
  const nested = join(skillsRoot, rel);
  if (!existsSync(nested)) continue;
  for (const name of readdirSync(nested)) {
    const dir = join(nested, name);
    if (!existsSync(join(dir, "SKILL.md"))) continue;
    if (existsSync(join(cursorSkills, name))) continue;
    const r = linkSkill(dir, name);
    if (r === "linked") linked += 1;
  }
}

console.log(`link-cursor-skills: linked=${linked} unchanged=${skipped} -> ${cursorSkills}`);
