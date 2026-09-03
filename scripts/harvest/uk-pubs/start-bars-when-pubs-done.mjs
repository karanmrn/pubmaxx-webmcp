#!/usr/bin/env node
// Wait until the pubs Exa enrich is complete, then start the plain-bars wave.
// Does not compete for the Exa key while pubs are still running.

import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule, loadProgress, pubsEnrichComplete } from "../../lib/ukPubHarvest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const HARVEST_DIR = path.join(ROOT, "data-harvest");
const RUN = path.join(path.dirname(fileURLToPath(import.meta.url)), "run.mjs");
const BARS_SEED = path.join(HARVEST_DIR, "uk_bars_seed.jsonl");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pubEnrichProcessRunning() {
  try {
    const out = execFileSync("ps", ["-ax", "-o", "command="], { encoding: "utf8" });
    return out.split("\n").some((line) => {
      if (!line.includes("uk-pubs/run.mjs")) return false;
      if (line.includes("--bars")) return false;
      if (line.includes("start-bars-when-pubs-done")) return false;
      return true;
    });
  } catch {
    return false;
  }
}

function runHarvest(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUN, ...args], {
      cwd: ROOT,
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=2048" },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`harvest exited ${code} (${args.join(" ")})`));
    });
  });
}

export async function waitThenStartBars() {
  console.log("bars waiter: holding until pubs enrich completes");
  while (true) {
    const progress = await loadProgress(HARVEST_DIR);
    const complete = pubsEnrichComplete(progress);
    const running = pubEnrichProcessRunning();
    if (complete && !running) break;
    const count = progress ? `${progress.enrichedCount ?? "?"}/${progress.seedCount ?? "?"}` : "no-progress";
    console.log(`bars waiter: pubs ${count} complete=${complete} running=${running}`);
    await sleep(30_000);
  }

  console.log("bars waiter: pubs enrich is complete. Starting bars wave.");
  if (!existsSync(BARS_SEED)) {
    await runHarvest(["--bars", "--enumerate"]);
  }
  await runHarvest(["--bars", "--enrich"]);
  console.log("bars waiter: bars enrich finished");
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await waitThenStartBars();
}
