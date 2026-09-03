#!/usr/bin/env node
// Build the server-only national UK pub name-search index from the committed
// OSM UK pub pack. Not published under public/ — phones never download the
// country-wide set; GET /api/map-search opens this file once per instance.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const OUTPUT = path.join(ROOT, "data", "generated", "uk_pub_search.json");
/** ~2.5 MB ceiling: named tuples for ~38k pubs. Fail loud if the pack balloons. */
const OUTPUT_BUDGET_BYTES = 3.25 * 1024 * 1024;

function osmRefToShort(osmId) {
  // "node/123" → "n123", "way/456" → "w456" (matches uk base id salting).
  if (typeof osmId !== "string") return "";
  if (osmId.startsWith("node/")) return `n${osmId.slice(5)}`;
  if (osmId.startsWith("way/")) return `w${osmId.slice(4)}`;
  if (osmId.startsWith("relation/")) return `r${osmId.slice(9)}`;
  return osmId.replace(/\//g, "");
}

async function main() {
  const raw = JSON.parse(await readFile(SOURCE, "utf8"));
  const pubs = Array.isArray(raw?.pubs) ? raw.pubs : [];
  const rows = [];
  for (const pub of pubs) {
    const name = typeof pub?.name === "string" ? pub.name.trim() : "";
    if (!name) continue;
    const lat = pub.lat;
    const lng = pub.lng;
    if (typeof lat !== "number" || !Number.isFinite(lat)) continue;
    if (typeof lng !== "number" || !Number.isFinite(lng)) continue;
    const osmRef = osmRefToShort(pub.osmId);
    if (!osmRef) continue;
    const address = typeof pub.address === "string" ? pub.address.trim() : "";
    rows.push([
      osmRef,
      name,
      address,
      Math.round(lat * 1e5) / 1e5,
      Math.round(lng * 1e5) / 1e5,
    ]);
  }
  if (rows.length < 10_000) {
    throw new Error(
      `UK pub search index only found ${rows.length} named pubs (expected ~38k)`,
    );
  }
  const body = `${JSON.stringify({
    source: "OpenStreetMap",
    license: "ODbL-1.0",
    attribution: "https://www.openstreetmap.org/copyright",
    generatedFrom: "data/osm/uk/uk_osm_pubs.json",
    fetchedAt: raw.fetchedAt ?? null,
    count: rows.length,
    // [osmRef, name, address, lat, lng]
    pubs: rows,
  })}\n`;
  const bytes = Buffer.byteLength(body);
  if (bytes > OUTPUT_BUDGET_BYTES) {
    throw new Error(
      `UK pub search index is ${(bytes / 1024 / 1024).toFixed(2)} MB, over the ` +
        `${(OUTPUT_BUDGET_BYTES / 1024 / 1024).toFixed(2)} MB budget`,
    );
  }
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  const temporaryPath = `${OUTPUT}.tmp`;
  await writeFile(temporaryPath, body);
  await rename(temporaryPath, OUTPUT);
  console.log(
    `UK pub search → ${rows.length} pubs, ${(bytes / 1024 / 1024).toFixed(2)} MB`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
