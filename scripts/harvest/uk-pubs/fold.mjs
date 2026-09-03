#!/usr/bin/env node
// Fold the UK harvest overlay into the product store.
//
//   npm run harvest:fold -- --overlay <overlay.jsonl> --stats <fold-stats.md>
//   npm run harvest:fold -- --dry-run --overlay ... --stats ...
//
// Idempotent upserts keyed by OSM id. Malformed rows and fold-stats mismatches
// fail the process. Social observations are excluded. Website and menu must be
// https. Lore requires https citations.
//
// Copy overlay.jsonl out of the harvest worktree; never write back into it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
nextEnv.loadEnvConfig(ROOT);

const {
  HarvestFoldError,
  canonicalOsmId,
  overlayRowsFromHarvestRecords,
  parseFoldStatsMarkdown,
  parseOverlayJsonl,
  reconcileFoldStats,
  summariseOverlay,
} = await import("../../../lib/harvestFold.ts");
const { readJsonl } = await import("../../lib/ukPubHarvest.mjs");
const { loadSeedMetadata } = await import("./foldInput.mjs");

function arg(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function usage() {
  return `Usage:
  npm run harvest:fold -- --enriched-dir <pub-enriched> --bars-enriched-dir <bar-enriched> --seed <pub-seed> --bars-seed <bar-seed> --stats <fold-stats.md>
  npm run harvest:fold -- --dry-run --enriched-dir <pub-enriched> --bars-enriched-dir <bar-enriched> --seed <pub-seed> --bars-seed <bar-seed> --stats <fold-stats.md>
  npm run harvest:fold -- --overlay <overlay.jsonl> --stats <fold-stats.md>

Fails loud on a malformed row or a count that does not match fold-stats.md.`;
}

async function loadShardRecords(directory) {
  if (!existsSync(directory)) throw new Error(`missing enriched harvest directory: ${directory}`);
  const files = readdirSync(directory)
    .filter((name) => /^shard_\d{4}\.jsonl$/.test(name))
    .sort();
  if (files.length === 0) throw new Error(`no completed harvest shards in ${directory}`);
  return (await Promise.all(files.map((name) => readJsonl(join(directory, name))))).flat();
}

async function loadCompletedHarvestRecords({ enrichedDir, barsEnrichedDir, seed, barsSeed }) {
  const records = [];
  for (const [directory, seedPath] of [[enrichedDir, seed], [barsEnrichedDir, barsSeed]]) {
    const metadata = await loadSeedMetadata(seedPath, readJsonl);
    for (const raw of await loadShardRecords(directory)) {
      if (!raw || typeof raw !== "object" || typeof raw.osmId !== "string") {
        throw new Error(`malformed enriched harvest row in ${directory}`);
      }
      const osmId = canonicalOsmId(raw.osmId);
      if (!osmId) throw new Error(`malformed enriched harvest OSM id: ${raw.osmId}`);
      const meta = metadata.get(osmId);
      if (!meta) throw new Error(`enriched row has no matching seed metadata: ${raw.osmId}`);
      if (raw.name !== meta.name) throw new Error(`enriched row name disagrees with seed: ${raw.osmId}`);
      records.push({ osmId, name: meta.name, town: meta.town, observations: raw.observations });
    }
  }
  return records;
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(usage());
    return;
  }
  const overlayPath = arg("--overlay");
  const statsPath = arg("--stats", join(ROOT, "data/uk-pub-harvest/fold-stats.md"));
  const enrichedDir = arg("--enriched-dir", join(ROOT, "data-harvest/enriched"));
  const barsEnrichedDir = arg("--bars-enriched-dir", join(ROOT, "data-harvest/bars-enriched"));
  const seed = arg("--seed", join(ROOT, "data-harvest/uk_pubs_seed.enriching.jsonl"));
  const barsSeed = arg("--bars-seed", join(ROOT, "data-harvest/uk_bars_seed.enriching.jsonl"));
  const dryRun = hasFlag("--dry-run");

  let overlayText;
  let statsText;
  try {
    if (overlayPath) overlayText = readFileSync(resolve(overlayPath), "utf8");
    statsText = readFileSync(resolve(statsPath), "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`harvest:fold could not read inputs: ${message}`);
    process.exitCode = 1;
    return;
  }

  const rows = overlayPath
    ? parseOverlayJsonl(overlayText)
    : overlayRowsFromHarvestRecords(
        await loadCompletedHarvestRecords({ enrichedDir, barsEnrichedDir, seed, barsSeed }),
      );
  const actual = summariseOverlay(rows);
  const expected = parseFoldStatsMarkdown(statsText);
  reconcileFoldStats(actual, expected);

  console.log(
    `Fold-ready overlay: ${actual.overlayRows} rows, ${actual.httpsWebsite} https websites, ${actual.httpsMenuUrl} https menus, ${actual.matchedLore} cited lore, ${actual.social} social.`,
  );

  if (dryRun) {
    console.log("Dry run. No rows written.");
    return;
  }

  const { harvestOverlayStore } = await import("../../../lib/harvestOverlayStore.ts");
  const outcome = await harvestOverlayStore({ requireDurable: true }).upsertMany(rows);
  if (outcome.failed) {
    console.error(`harvest:fold write failed: ${outcome.failure ?? "unknown error"}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Upserted ${outcome.written} overlay rows.`);
}

main().catch((error) => {
  if (error instanceof HarvestFoldError) {
    console.error(`harvest:fold ${error.code}: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
