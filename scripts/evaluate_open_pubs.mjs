#!/usr/bin/env node
/**
 * Open Pubs dry-run evaluation against curated slim + OSM UK identity.
 *
 * Default behaviour is report-only: print match rates. Never merges into
 * venues_slim or invents prices.
 *
 * Usage:
 *   node scripts/evaluate_open_pubs.mjs --csv path/to/open_pubs.csv
 *   node scripts/evaluate_open_pubs.mjs --download
 *   node scripts/evaluate_open_pubs.mjs --csv fixture.csv --identity curated --limit 20
 *   node scripts/evaluate_open_pubs.mjs --csv open_pubs.csv --report data/generated/open_pubs_eval.json
 *   node scripts/evaluate_open_pubs.mjs --csv open_pubs.csv --london --report data/generated/open_pubs_london.json
 *
 * See docs/data/OPEN_PUBS.md and docs/data/SOURCE_LEDGER.md.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OPEN_PUBS_DOWNLOAD_URL,
  buildLondonCuratedMatchReport,
  evaluateOpenPubsMatches,
  filterOpenPubsRowsForLondon,
  identityFromOsmPub,
  identityFromSlimVenue,
  parseOpenPubsCsv,
} from "./lib/openPubs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SLIM = join(ROOT, "public/data/venues_slim.json");
const DEFAULT_OSM = join(ROOT, "data/osm/uk/uk_osm_pubs.json");
const DEFAULT_CACHE_DIR = join(ROOT, "data/generated/open_pubs");

function printUsage(exitCode = 1) {
  console.log(`Usage:
  node scripts/evaluate_open_pubs.mjs --csv <open_pubs.csv> [options]
  node scripts/evaluate_open_pubs.mjs --download [options]

Options:
  --csv PATH          Local Open Pubs CSV (headerless or with fsa_id header)
  --download          Fetch the official zip into data/generated/open_pubs/ and evaluate
  --identity LAYER    curated | osm | both (default: both; forced curated with --london)
  --slim PATH         venues_slim.json (default: public/data/venues_slim.json)
  --osm PATH          uk_osm_pubs.json (default: data/osm/uk/uk_osm_pubs.json)
  --limit N           Evaluate only the first N parsed rows
  --authority NAME    Keep rows whose local_authority equals NAME (case-insensitive)
  --city london       Filter to Greater London authorities; curated identity only
  --london            Alias for --city london
  --report PATH       Write JSON report (match rates + sample misses). Still no slim merge
  --help              Show this help

Dry-run only. This script never writes venues_slim or community_prices.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    csv: null,
    download: false,
    identity: "both",
    slim: DEFAULT_SLIM,
    osm: DEFAULT_OSM,
    limit: null,
    authority: null,
    city: null,
    london: false,
    report: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--download") args.download = true;
    else if (a === "--csv") args.csv = argv[++i];
    else if (a === "--identity") args.identity = String(argv[++i] ?? "").toLowerCase();
    else if (a === "--slim") args.slim = resolve(argv[++i] ?? "");
    else if (a === "--osm") args.osm = resolve(argv[++i] ?? "");
    else if (a === "--limit") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      args.limit = Number.isFinite(n) && n > 0 ? n : null;
    } else if (a === "--authority") args.authority = String(argv[++i] ?? "").trim();
    else if (a === "--london") {
      args.london = true;
      args.city = "london";
    } else if (a === "--city") {
      const city = String(argv[++i] ?? "").trim().toLowerCase();
      args.city = city || null;
      if (city === "london") args.london = true;
    } else if (a === "--report") args.report = resolve(argv[++i] ?? "");
    else if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      printUsage(1);
    }
  }
  if (args.city && args.city !== "london") {
    console.error(`--city currently supports only london (got ${args.city})`);
    process.exit(1);
  }
  if (args.london) {
    // London curated identity report: product slim only, never OSM fill-in.
    args.identity = "curated";
  }
  if (!["curated", "osm", "both"].includes(args.identity)) {
    console.error(`--identity must be curated | osm | both (got ${args.identity})`);
    process.exit(1);
  }
  return args;
}

async function downloadOpenPubsCsv() {
  mkdirSync(DEFAULT_CACHE_DIR, { recursive: true });
  const zipPath = join(DEFAULT_CACHE_DIR, "open_pubs.csv.zip");
  const csvPath = join(DEFAULT_CACHE_DIR, "open_pubs.csv");
  console.log(`Downloading ${OPEN_PUBS_DOWNLOAD_URL}`);
  const res = await fetch(OPEN_PUBS_DOWNLOAD_URL);
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(zipPath, buf);
  const extractDir = mkdtempSync(join(tmpdir(), "open-pubs-"));
  try {
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", extractDir], { stdio: "inherit" });
    const extracted = join(extractDir, "open_pubs.csv");
    if (!existsSync(extracted)) {
      throw new Error("Zip did not contain open_pubs.csv");
    }
    writeFileSync(csvPath, readFileSync(extracted));
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
  console.log(`Wrote ${csvPath}`);
  return csvPath;
}

function loadIdentityCandidates(args) {
  /** @type {import("./lib/openPubs.mjs").IdentityCandidate[]} */
  const candidates = [];
  if (args.identity === "curated" || args.identity === "both") {
    if (!existsSync(args.slim)) {
      console.error(`Curated slim not found: ${args.slim}`);
      process.exit(1);
    }
    const payload = JSON.parse(readFileSync(args.slim, "utf8"));
    const slim = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.rows)
        ? payload.rows
        : [];
    if (slim.length === 0) {
      console.error(`Expected non-empty venues_slim payload at ${args.slim}`);
      process.exit(1);
    }
    for (const venue of slim) {
      const c = identityFromSlimVenue(venue);
      if (c) candidates.push(c);
    }
  }
  if (args.identity === "osm" || args.identity === "both") {
    if (!existsSync(args.osm)) {
      if (args.identity === "osm") {
        console.error(`OSM pack not found: ${args.osm}`);
        process.exit(1);
      } else {
        console.warn(`OSM pack missing (${args.osm}); evaluating curated only.`);
      }
    } else {
      const pack = JSON.parse(readFileSync(args.osm, "utf8"));
      const pubs = Array.isArray(pack?.pubs) ? pack.pubs : [];
      for (const pub of pubs) {
        const c = identityFromOsmPub(pub);
        if (c) candidates.push(c);
      }
    }
  }
  return candidates;
}

function formatReport(summary, { london = false } = {}) {
  const title = london
    ? "Open Pubs London curated identity report (dry-run; no merge into venues_slim)"
    : "Open Pubs evaluation (dry-run; no merge into venues_slim)";
  const lines = [
    title,
    `  rows read:              ${summary.rowsRead}`,
    `  with coordinates:       ${summary.withCoords}`,
    `  skipped (no coords):    ${summary.skipped ?? summary.skippedNoCoords}`,
    `  identity candidates:    ${summary.identityCandidates}`,
    `  matched:                ${summary.matched} (${summary.matchRateOfCoordsPct}% of coords)`,
  ];
  if (!london) {
    lines.push(
      `    curated:              ${summary.matchedCurated} (${summary.curatedRateOfCoordsPct}%)`,
      `    osm only:             ${summary.matchedOsm} (${summary.osmOnlyRateOfCoordsPct}%)`,
    );
  } else {
    lines.push(`    curated:              ${summary.matchedCurated}`);
  }
  lines.push(
    `  unmatched:              ${summary.unmatched}`,
    `  ambiguous:              ${summary.ambiguous ?? 0}`,
    `  match radius:           ${summary.radiusM} m`,
  );
  const samples = summary.sampleUnmatchedNames ?? [];
  if (samples.length > 0) {
    lines.push("  sample unmatched names:");
    for (const name of samples.slice(0, 20)) {
      lines.push(`    - ${name}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) printUsage(0);
  if (!args.csv && !args.download) {
    console.error("Provide --csv PATH or --download.");
    printUsage(1);
  }

  const csvPath = args.download ? await downloadOpenPubsCsv() : resolve(args.csv);
  if (!existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  let rows = parseOpenPubsCsv(readFileSync(csvPath, "utf8"));
  if (args.authority) {
    const needle = args.authority.toLowerCase();
    rows = rows.filter(
      (r) => (r.localAuthority ?? "").toLowerCase() === needle,
    );
  }
  if (args.london) {
    rows = filterOpenPubsRowsForLondon(rows);
  }
  if (args.limit != null) rows = rows.slice(0, args.limit);

  const candidates = loadIdentityCandidates(args);

  /** @type {object} */
  let payload;
  /** @type {ReturnType<typeof evaluateOpenPubsMatches>} */
  let summary;

  if (args.london) {
    payload = buildLondonCuratedMatchReport(rows, candidates, { csvPath });
    summary = {
      rowsRead: payload.stats.rowsRead,
      withCoords: payload.stats.withCoords,
      skippedNoCoords: payload.stats.skippedNoCoords,
      skipped: payload.totals.skipped,
      identityCandidates: payload.stats.identityCandidates,
      matched: payload.totals.matched,
      matchedCurated: payload.stats.matchedCurated,
      matchedOsm: payload.stats.matchedOsm,
      unmatched: payload.totals.unmatched,
      ambiguous: payload.totals.ambiguous,
      matchRateOfCoordsPct: payload.stats.matchRateOfCoordsPct,
      curatedRateOfCoordsPct: payload.stats.curatedRateOfCoordsPct,
      osmOnlyRateOfCoordsPct: 0,
      radiusM: payload.stats.radiusM,
      sampleUnmatchedNames: payload.sampleUnmatchedNames,
    };
    console.log(formatReport(summary, { london: true }));
    console.log(
      `  totals: matched=${payload.totals.matched} unmatched=${payload.totals.unmatched} ambiguous=${payload.totals.ambiguous} skipped=${payload.totals.skipped}`,
    );
  } else {
    summary = evaluateOpenPubsMatches(rows, candidates);
    console.log(formatReport(summary));
    payload = {
      generatedAt: new Date().toISOString(),
      source: "open-pubs",
      downloadUrl: OPEN_PUBS_DOWNLOAD_URL,
      csvPath,
      identity: args.identity,
      dryRun: true,
      mergedIntoSlim: false,
      inventedPrices: false,
      totals: summary.totals,
      stats: {
        rowsRead: summary.rowsRead,
        withCoords: summary.withCoords,
        skippedNoCoords: summary.skippedNoCoords,
        identityCandidates: summary.identityCandidates,
        matched: summary.matched,
        matchedCurated: summary.matchedCurated,
        matchedOsm: summary.matchedOsm,
        unmatched: summary.unmatched,
        ambiguous: summary.ambiguous,
        skipped: summary.skipped,
        matchRateOfCoordsPct: summary.matchRateOfCoordsPct,
        curatedRateOfCoordsPct: summary.curatedRateOfCoordsPct,
        osmOnlyRateOfCoordsPct: summary.osmOnlyRateOfCoordsPct,
        radiusM: summary.radiusM,
      },
      sampleUnmatchedNames: summary.sampleUnmatchedNames,
      // Cap samples so a full-UK run does not dump tens of thousands of rows.
      sampleMatches: summary.matches.slice(0, 50),
      sampleMisses: summary.misses.slice(0, 50),
      sampleAmbiguous: summary.ambiguousRows.slice(0, 20),
    };
  }

  if (args.report) {
    mkdirSync(dirname(args.report), { recursive: true });
    writeFileSync(args.report, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Wrote report ${args.report}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
