// Manual reviewed permissible-source price publish.
//
// This script is the ONLY path that advances the served
// public/data/price_updates/ snapshot: it is run by hand and opens a review PR.
// Scheduled retrieval was retired while every parser remained a documented
// no-op. A serverless filesystem cannot publish this committed file.
//
// WHAT IS REAL in this scaffold:
//   - reads the permissible-source allowlist (data/price_sources.json) and
//     REFUSES to proceed on any source not marked first-party/open;
//   - validates every candidate price row with the SAME hand-rolled guard the
//     app uses (mirrors lib/priceUpdates.ts isValidPriceUpdate) — bad rows are
//     dropped, counted, and reported;
//   - writes a versioned file public/data/price_updates/prices_YYYYMMDD.json in
//     the documented schema;
//   - opens a pull request with the new file via the GitHub CLI (`gh`), so a
//     human reviews every price change before it ships. Never pushes to main.
//
// WHAT IS STUBBED (documented):
//   - price_source_fetchers.mjs: network fetch + parse of each first-party
//     page/feed. It currently returns [] (no rows) so a run is a safe no-op
//     that opens no PR. Implement parsers there, reading ONLY allowlisted URLs.
//
// GOVERNANCE (hard rules — do not remove):
//   - NO scraping of competitor price sites. Only first-party official pages
//     and open-data feeds listed in data/price_sources.json.
//   - Every emitted price carries { source: {label, url}, observedAt }.
//   - A refreshed price is "sourced" (attributed), never community.
//   - Never present stale as live — observedAt is required and validated.
//
// Run:  node scripts/refresh_prices.mjs [--open-pr]
//   --open-pr   also open a GitHub PR with the new file (needs `gh` auth).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  fetchFromSource,
  filterPermissiblePriceSources,
  isHttpUrl,
} from "./price_source_fetchers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ALLOWLIST_PATH = join(ROOT, "data", "price_sources.json");
const OUT_DIR = join(ROOT, "public", "data", "price_updates");

// --- validation (mirror of lib/priceUpdates.ts isValidPriceUpdate) -----------

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isValidPriceUpdate(row, now) {
  if (typeof row !== "object" || row === null) return false;
  if (!isNonEmptyString(row.venueKey)) return false;
  if (!isFiniteNumber(row.price) || row.price < 0) return false;
  const s = row.source;
  if (typeof s !== "object" || s === null) return false;
  if (!isNonEmptyString(s.label)) return false;
  if (!isHttpUrl(s.url)) return false;
  if (!isNonEmptyString(row.observedAt)) return false;
  const ms = Date.parse(row.observedAt);
  return Number.isFinite(ms) && ms <= now;
}

// --- allowlist ----------------------------------------------------------------

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  return filterPermissiblePriceSources(raw.sources, {
    onSkip: (message) => console.warn(message),
  });
}

// --- main ---------------------------------------------------------------------

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

async function main() {
  const openPr = process.argv.includes("--open-pr");
  const now = Date.now();
  const sources = loadAllowlist();
  console.log(`Permissible sources: ${sources.length}`);

  const raw = [];
  for (const source of sources) {
    const rows = await fetchFromSource(source);
    console.log(`  ${source.id}: ${rows.length} candidate row(s)`);
    raw.push(...rows);
  }

  let dropped = 0;
  const valid = [];
  for (const row of raw) {
    if (isValidPriceUpdate(row, now)) valid.push(row);
    else dropped += 1;
  }
  if (dropped > 0) console.warn(`Dropped ${dropped} invalid row(s)`);

  if (valid.length === 0) {
    console.log("No valid updates this run — nothing to write. (Stub returns no rows.)");
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = todayStamp();
  const outPath = join(OUT_DIR, `prices_${stamp}.json`);
  const body = {
    version: 1,
    generatedAt: new Date().toISOString(),
    updates: valid,
  };
  writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  // Stable alias the client fetches (404-tolerant) — always the newest file.
  const latestPath = join(OUT_DIR, "latest.json");
  writeFileSync(latestPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  console.log(`Wrote ${valid.length} update(s) to ${outPath} (+ latest.json)`);

  if (!openPr) {
    console.log("Run with --open-pr to open a review PR.");
    return;
  }

  // Open a PR so a human reviews every price change. Never push to main.
  const branch = `price-refresh/${stamp}`;
  execFileSync("git", ["checkout", "-b", branch], { stdio: "inherit" });
  execFileSync("git", ["add", outPath, latestPath], { stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(prices): refresh ${stamp} (${valid.length} sourced)`], {
    stdio: "inherit",
  });
  execFileSync("git", ["push", "-u", "origin", branch], { stdio: "inherit" });
  execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--title",
      `Price refresh ${stamp}`,
      "--body",
      "Automated permissible-source price refresh. Every price carries a first-party source + observedAt. Review before merge.",
    ],
    { stdio: "inherit" },
  );
  console.log("Opened review PR.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
