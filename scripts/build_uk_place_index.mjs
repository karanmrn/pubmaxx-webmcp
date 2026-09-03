#!/usr/bin/env node
// Build the chooser's compact UK place index from locality tags on the
// committed UK OpenStreetMap pub snapshots. No second geography source and no
// network request: this is a navigation index over the base layer we ship.

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildUkPlaceIndex } from "./lib/ukPlaceIndex.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data", "osm", "uk", "raw");
const OUTPUT_PATH = path.join(ROOT, "public", "data", "uk_base", "places.json");
const OUTPUT_BUDGET_BYTES = 512 * 1024;

async function main() {
  const files = (await readdir(RAW_DIR))
    .filter((file) => file.startsWith("chunk_") && file.endsWith(".json"))
    .sort();
  const elements = [];
  let latestSourceTimestamp = "";
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(RAW_DIR, file), "utf8"));
    if (!Array.isArray(raw?.elements)) continue;
    elements.push(...raw.elements);
    const timestamp = String(raw?.osm3s?.timestamp_osm_base ?? "");
    if (timestamp > latestSourceTimestamp) latestSourceTimestamp = timestamp;
  }
  const index = buildUkPlaceIndex(elements, {
    generatedAt: latestSourceTimestamp || null,
  });
  const body = `${JSON.stringify(index)}\n`;
  const bytes = Buffer.byteLength(body);
  if (bytes > OUTPUT_BUDGET_BYTES) {
    throw new Error(
      `UK place index is ${(bytes / 1024).toFixed(1)} KB, over the ` +
        `${OUTPUT_BUDGET_BYTES / 1024} KB chooser-search budget`,
    );
  }
  if (!index.places.some((place) => place[0] === "Sheffield")) {
    throw new Error("UK place index has no Sheffield result");
  }
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await writeFile(temporaryPath, body);
  await rename(temporaryPath, OUTPUT_PATH);
  console.log(
    `UK place search → ${index.places.length} places, ${(bytes / 1024).toFixed(1)} KB`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
