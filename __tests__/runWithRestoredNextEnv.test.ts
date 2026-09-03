import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const wrapper = resolve(process.cwd(), "scripts/run-with-restored-next-env.mjs");

function workspace(withNextEnv = true): string {
  const directory = mkdtempSync(join(tmpdir(), "pubmax-next-env-"));
  if (withNextEnv) writeFileSync(join(directory, "next-env.d.ts"), "canonical\n", "utf8");
  writeFileSync(join(directory, "tsconfig.json"), "{\"canonical\":true}\n", "utf8");
  return directory;
}

function initialiseGit(cwd: string): void {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "gate0@example.test"], { cwd });
  execFileSync("git", ["config", "user.name", "Gate Zero"], { cwd });
  writeFileSync(join(cwd, "tracked.txt"), "baseline\n", "utf8");
  mkdirSync(join(cwd, "docs", "screenshots"), { recursive: true });
  writeFileSync(join(cwd, "docs", "screenshots", "baseline.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd });
}

describe("run-with-restored-next-env", () => {
  it("restores the exact stub after a successful command", () => {
    const cwd = workspace();
    execFileSync(process.execPath, [wrapper, process.execPath, "-e", "require('fs').writeFileSync('next-env.d.ts', 'rewritten\\n')"], { cwd });
    expect(readFileSync(join(cwd, "next-env.d.ts"), "utf8")).toBe("canonical\n");
  });

  it("restores the exact TypeScript config after a successful command", () => {
    const cwd = workspace();
    execFileSync(process.execPath, [wrapper, process.execPath, "-e", "require('fs').writeFileSync('tsconfig.json', '{\\\"rewritten\\\":true}\\n')"], { cwd });
    expect(readFileSync(join(cwd, "tsconfig.json"), "utf8")).toBe("{\"canonical\":true}\n");
  });

  it("leaves a tracked checkout clean after Next-managed files are rewritten", () => {
    const cwd = workspace();
    initialiseGit(cwd);
    execFileSync(
      process.execPath,
      [
        wrapper,
        process.execPath,
        "-e",
        "const fs=require('fs'); fs.writeFileSync('next-env.d.ts','generated\\n'); fs.writeFileSync('tsconfig.json','{\\\"generated\\\":true}\\n')",
      ],
      { cwd, env: { ...process.env, NEXT_DIST_DIR: "caller-dist" } },
    );

    expect(execFileSync("git", ["status", "--short"], { cwd, encoding: "utf8" })).toBe("");
  });

  it("restores the exact stub and preserves a failing exit code", () => {
    const cwd = workspace();
    const result = spawnSync(process.execPath, [wrapper, process.execPath, "-e", "require('fs').writeFileSync('next-env.d.ts', 'rewritten\\n'); process.exit(23)"], { cwd });
    expect(result.status).toBe(23);
    expect(readFileSync(join(cwd, "next-env.d.ts"), "utf8")).toBe("canonical\n");
  });

  it("removes a stub that did not exist before the command", () => {
    const cwd = workspace(false);
    execFileSync(process.execPath, [wrapper, process.execPath, "-e", "require('fs').writeFileSync('next-env.d.ts', 'generated\\n')"], { cwd });
    expect(existsSync(join(cwd, "next-env.d.ts"))).toBe(false);
  });

  it("creates a unique default dist directory and removes it afterwards", () => {
    const cwd = workspace();
    execFileSync(process.execPath, [wrapper, process.execPath, "-e", "const fs=require('fs'); fs.mkdirSync(process.env.NEXT_DIST_DIR,{recursive:true}); fs.writeFileSync('dist-name.txt',process.env.NEXT_DIST_DIR)"], { cwd, env: { ...process.env, NEXT_DIST_DIR: "" } });
    const distDir = readFileSync(join(cwd, "dist-name.txt"), "utf8");
    expect(distDir).toMatch(/^\.next-isolated\//);
    expect(existsSync(join(cwd, distDir))).toBe(false);
  });

  it("preserves a caller-provided dist directory", () => {
    const cwd = workspace();
    const distDir = join(cwd, "caller-dist");
    execFileSync(process.execPath, [wrapper, process.execPath, "-e", "require('fs').mkdirSync(process.env.NEXT_DIST_DIR,{recursive:true})"], { cwd, env: { ...process.env, NEXT_DIST_DIR: distDir } });
    expect(existsSync(distDir)).toBe(true);
  });

  it("allows pre-existing tracked WIP but rejects new tracked mutations", () => {
    const cwd = workspace();
    initialiseGit(cwd);
    writeFileSync(join(cwd, "tracked.txt"), "owner WIP\n", "utf8");
    const result = spawnSync(process.execPath, [wrapper, process.execPath, "-e", "require('fs').appendFileSync('tracked.txt', 'build mutation\\n')"], { cwd });
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain("changed tracked files");
  });

  it("allows declared tracked outputs", () => {
    const cwd = workspace();
    initialiseGit(cwd);
    const result = spawnSync(
      process.execPath,
      [
        wrapper,
        process.execPath,
        "-e",
        "require('fs').appendFileSync('docs/screenshots/baseline.txt', 'new capture\\n')",
      ],
      {
        cwd,
        env: { ...process.env, PUBMAX_TRACKED_OUTPUTS: "docs/screenshots" },
      },
    );
    expect(result.status).toBe(0);
  });

  it("still rejects unrelated mutations when tracked outputs are declared", () => {
    const cwd = workspace();
    initialiseGit(cwd);
    const result = spawnSync(
      process.execPath,
      [
        wrapper,
        process.execPath,
        "-e",
        "const fs=require('fs'); fs.appendFileSync('docs/screenshots/baseline.txt', 'new capture\\n'); fs.appendFileSync('tracked.txt', 'unrelated\\n')",
      ],
      {
        cwd,
        env: { ...process.env, PUBMAX_TRACKED_OUTPUTS: "docs/screenshots, docs/screenshots/extra" },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain("changed tracked files");
  });
});
