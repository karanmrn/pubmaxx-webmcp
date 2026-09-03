// Canonicalize duplicate venue identities in the bundled price dataset (D1).
//
// The venue dataset carries the same physical pub twice across dataset lineages
// (e.g. a seed record + a Wetherspoons-directory record), which double-counts
// pubs in borough leaderboards and duplicates map pins. This step collapses
// those duplicates in place — rewriting the losing rows' identity fields to the
// canonical pub so every downstream consumer groups them as one venue — and
// emits public/data/venue_id_aliases.json mapping each merged id to its
// canonical id, so stored references (pint drops, plans, saved lists) still
// resolve via lib/venueAliases.ts.
//
// Runs as part of the reproducible pipeline (postexport:data + prebuild:slim),
// so it heals both this committed artifact AND any regeneration from the CSV.
// Idempotent: a run against an already-canonical dataset finds no duplicates
// and leaves both files untouched (aliases are merged cumulatively, never
// clobbered, so a dedup already applied is never forgotten).
//
// Run manually:  node scripts/canonicalize_venue_dataset.mjs

import { readFile, writeFile, rename } from "node:fs/promises";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeDataset, mergeAliasMaps } from "./lib/venueCanonicalization.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATASET_PATH = path.join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const ALIASES_PATH = path.join(ROOT, "public", "data", "venue_id_aliases.json");

// Reads a JSON file, falling back only when it doesn't exist (ENOENT) — a
// fresh checkout before this file has ever been generated. Malformed JSON,
// permission errors, and other I/O failures are rethrown: silently treating
// them as "no aliases" risks rebuilding the alias document without the
// historical mappings it already held, and a rerun can't recover them once
// the (already-canonical) dataset no longer surfaces those duplicate
// clusters.
async function readJsonOr(pathname, fallback) {
  let text;
  try {
    text = await readFile(pathname, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object in ${pathname}, got ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function main() {
  const rows = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  if (!Array.isArray(rows)) {
    throw new Error(`Expected an array in ${DATASET_PATH}, got ${typeof rows}`);
  }

  const { rows: newRows, aliases, clusters, stats } = canonicalizeDataset(rows);

  // Cumulative alias map: never forget a dedup that was applied on an earlier
  // (full-dataset) run just because this run sees an already-canonical file.
  // See mergeAliasMaps in lib/venueCanonicalization.mjs for the rebase +
  // cycle-drop logic (unit-tested there).
  const prev = await readJsonOr(ALIASES_PATH, { aliases: {} });
  const mergedAliases = mergeAliasMaps(prev.aliases, aliases);

  const aliasDoc = {
    version: 1,
    generatedBy: "scripts/canonicalize_venue_dataset.mjs",
    note:
      "duplicateVenueId -> canonicalVenueId. The same physical pub appeared twice across dataset lineages (e.g. Wetherspoons directory vs seed); those identities were collapsed into one venue. A stored reference to a merged id resolves to its canonical id via lib/venueAliases.ts — no id is ever deleted silently.",
    aliasCount: Object.keys(mergedAliases).length,
    aliases: mergedAliases,
    clusters: clusters.length > 0 ? clusters : prev.clusters ?? [],
  };

  const nextAliasText = `${JSON.stringify(aliasDoc, null, 2)}\n`;
  const prevAliasText = await readFile(ALIASES_PATH, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });

  // Publish failure-safe: the dataset becoming canonical (duplicates merged)
  // and the alias file recording where those merged ids now resolve are one
  // logical unit — if only the dataset lands, a reference to a merged id can
  // never be resolved again (a rerun sees zero duplicate clusters and won't
  // regenerate the mapping). Stage both writes to temp files first, so a
  // mid-write crash never leaves a half-written JSON file on disk, then
  // commit via atomic renames (same filesystem, so `rename` is atomic) —
  // alias file first, dataset second — so a crash between the two renames
  // leaves the alias mapping already in place for the pending dataset flip,
  // never the reverse.
  const writeAtomic = async (targetPath, contents) => {
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, contents);
    await rename(tmpPath, targetPath);
  };

  const aliasesChanged = nextAliasText !== prevAliasText;
  if (aliasesChanged) {
    await writeAtomic(ALIASES_PATH, nextAliasText);
  }
  if (stats.duplicateClusters > 0) {
    await writeAtomic(DATASET_PATH, JSON.stringify(newRows));
  }

  console.log(
    `canonicalize: ${stats.venueIdentitiesBefore} -> ${stats.venueIdentitiesAfter} venue identities ` +
      `(${stats.duplicateClusters} duplicate clusters, ${stats.mergedRecords} merged records this run; ` +
      `${Object.keys(mergedAliases).length} total aliases)`,
  );
  if (stats.duplicateClusters === 0) {
    console.log("canonicalize: dataset already canonical — dataset left unchanged");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
