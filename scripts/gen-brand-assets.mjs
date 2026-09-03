#!/usr/bin/env node
// Stamp the PUBMAXX web icon set (favicon / PWA / maskable / apple-touch) onto
// disk from the master mark geometry.
//
// This script is only the WRITER. What each file is lives in
// lib/brandIconAssets.mjs, and the geometry it is cut from lives in
// lib/brandMark.mjs. __tests__/brandIconAssets.test.ts builds the same table in
// memory and fails when a committed file no longer matches, so the shipped
// icons cannot drift away from the brand mark.
//
// Usage:  node scripts/gen-brand-assets.mjs
// The raster step needs `sharp` (already a dependency). If sharp cannot load
// the run fails loudly - do NOT add a new raster dependency; export the emitted
// SVGs by hand at their target px instead.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let buildBrandIconFiles;
let brandMirrorFiles;
try {
  ({ buildBrandIconFiles, brandMirrorFiles } = await import("../lib/brandIconAssets.mjs"));
} catch (err) {
  process.stderr.write(
    "gen-brand-assets: the raster step needs the `sharp` package and it failed to load.\n" +
      `  (${err instanceof Error ? err.message : String(err)})\n` +
      "  Do not add a raster dependency; export the emitted SVGs by hand at their target px.\n",
  );
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const BRAND = join(PUBLIC, "brand");

const files = await buildBrandIconFiles();
const mirror = brandMirrorFiles(files);

mkdirSync(BRAND, { recursive: true });
for (const [name, data] of files) writeFileSync(join(PUBLIC, name), data);
for (const [name, data] of mirror) writeFileSync(join(BRAND, name), data);

process.stdout.write(
  "✓ PUBMAXX icon set stamped from lib/brandMark.mjs:\n" +
    `  public/          ${files.size} files (light + dark tiles, maskable, monochrome, ico)\n` +
    `  public/brand/    ${mirror.size} reference files\n`,
);
