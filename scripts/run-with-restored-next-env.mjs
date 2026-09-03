#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const [, , command, ...args] = process.argv;

if (!command) {
  console.error("Usage: node scripts/run-with-restored-next-env.mjs <command> [args...]");
  process.exit(2);
}

const managedFiles = ["next-env.d.ts", "tsconfig.json"].map((name) => {
  const path = resolve(process.cwd(), name);
  const existed = existsSync(path);
  return { path, existed, original: existed ? readFileSync(path) : null };
});
const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
const requestedDistDir = process.env.NEXT_DIST_DIR?.trim();
const ownsDistDir = !requestedDistDir;
const distDir = requestedDistDir || `.next-isolated/${process.pid}-${randomUUID()}`;
const trackedOutputs = (process.env.PUBMAX_TRACKED_OUTPUTS ?? "")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean);

for (const output of trackedOutputs) {
  if (
    output.startsWith("/") ||
    output.split("/").includes("..") ||
    !/^[A-Za-z0-9._/-]+$/.test(output)
  ) {
    console.error(`Invalid PUBMAX_TRACKED_OUTPUTS path: ${output}`);
    process.exit(2);
  }
}

function trackedDiff() {
  const exclusions = trackedOutputs.flatMap((output) => [
    `:(exclude,top)${output}`,
    `:(exclude,top)${output}/**`,
  ]);
  const git = spawnSync("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--", ".", ...exclusions], {
    cwd: process.cwd(), encoding: "buffer", maxBuffer: 50 * 1024 * 1024,
  });
  return git.status === 0 ? git.stdout : null;
}

const trackedBefore = trackedDiff();

let result;
try {
  result = spawnSync(executable, args, {
    cwd: process.cwd(), env: { ...process.env, NEXT_DIST_DIR: distDir }, stdio: "inherit",
  });
} finally {
  // Next rewrites these tracked files to point at NEXT_DIST_DIR during a build.
  // Restore their exact original state even when the wrapped command fails.
  for (const file of managedFiles) {
    if (file.existed && file.original) writeFileSync(file.path, file.original);
    else rmSync(file.path, { force: true });
  }
  if (ownsDistDir) rmSync(resolve(process.cwd(), distDir), { recursive: true, force: true });
}

const trackedAfter = trackedDiff();
const introducedTrackedChanges = trackedBefore && trackedAfter && !trackedBefore.equals(trackedAfter);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.signal) {
  console.error(`Wrapped command ended with ${result.signal}.`);
  process.exit(1);
}
if (introducedTrackedChanges) {
  console.error("Wrapped command changed tracked files; restore or explicitly own those changes before release.");
  process.exit(1);
}
process.exit(result.status ?? 1);
