// Human-gated offline signal publish, run by hand. There is no machine schedule
// for the reviewed snapshot. Reads only staged candidate JSON files,
// validates the full provenance/review contract, writes a reviewed snapshot,
// and optionally opens a PR. It never searches third parties in a route request.
//
// Candidate INGESTION is separately scheduled (Vercel cron
// app/api/cron/refresh-night-signals); it stages pending candidates and can
// never advance this reviewed snapshot. See docs/CRON_PLANE_RUNBOOK.md.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = join(ROOT, "data", "night_signal_claims");
const OUTPUT = join(ROOT, "public", "data", "night_signals", "latest.json");
const KINDS = new Set(["event", "price", "access", "opening", "transport"]);
const ENTITY_TYPES = new Set(["venue", "night_area", "transport"]);
const REVIEW_STATES = new Set(["pending", "approved", "rejected"]);
const VERIFICATIONS = new Set(["single_source", "corroborated", "manual_review"]);
const ROUTE_EFFECTS = new Set(["none", "boost", "avoid"]);

const isText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isIso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const isHttp = (value) => {
  if (!isText(value, 2_000)) return false;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol)
      && !parsed.username && !parsed.password && !parsed.port && !parsed.search && !parsed.hash;
  } catch { return false; }
};
const isSource = (source) => source && typeof source === "object" && isHttp(source.sourceUrl) && isText(source.publisher, 160) && isIso(source.publishedAt);

export function isValidNightSignalClaim(row, ingestedAt = Date.now()) {
  if (!row || typeof row !== "object") return false;
  if (!isText(row.id, 120) || !KINDS.has(row.kind) || !isText(row.claim, 500)) return false;
  if (!row.entity || !ENTITY_TYPES.has(row.entity.type) || !isText(row.entity.id, 120)) return false;
  if (!isSource(row) || !isIso(row.observedAt) || !isIso(row.expiresAt)) return false;
  if (Date.parse(row.expiresAt) <= Date.parse(row.observedAt)) return false;
  if (Date.parse(row.publishedAt) > Date.parse(row.observedAt)) return false;
  if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) return false;
  if (!REVIEW_STATES.has(row.reviewState) || !VERIFICATIONS.has(row.verification) || !ROUTE_EFFECTS.has(row.routeEffect)) return false;
  if (!Array.isArray(row.corroboratingSources) || row.corroboratingSources.length > 5 || !row.corroboratingSources.every(isSource)) return false;
  if (row.corroboratingSources.some((source) => Date.parse(source.publishedAt) > Date.parse(row.observedAt))) return false;
  const sourceKeys = row.corroboratingSources.map((source) => `${new URL(source.sourceUrl).toString()}|${source.publisher.trim().toLocaleLowerCase("en-GB")}`);
  if (new Set(sourceKeys).size !== sourceKeys.length) return false;
  const independentCorroboration = row.corroboratingSources.some((source) =>
    new URL(source.sourceUrl).hostname !== new URL(row.sourceUrl).hostname
      && source.publisher.trim().toLocaleLowerCase("en-GB") !== row.publisher.trim().toLocaleLowerCase("en-GB"),
  );
  if (row.corroboratingSources.length > 0 && !independentCorroboration) return false;
  if (row.verification === "corroborated" && !independentCorroboration) return false;
  if (row.routeEffect !== "none" && row.verification === "single_source") return false;
  if (row.routeEffect !== "none" && row.verification === "manual_review" && !["operations", "editorial"].includes(row.reviewAuthority)) return false;
  if (row.reviewState === "approved" && (!isIso(row.reviewedAt) || !["operations", "editorial", "automated"].includes(row.reviewAuthority) || Date.parse(row.reviewedAt) < Date.parse(row.observedAt) || Date.parse(row.reviewedAt) > ingestedAt)) return false;
  return true;
}

export function approvedClaimsUnchanged(current, approved) {
  return Array.isArray(current?.claims) && JSON.stringify(current.claims) === JSON.stringify(approved);
}

export function nightSignalBranchName(now = new Date(), runId = process.env.GITHUB_RUN_ID, runAttempt = process.env.GITHUB_RUN_ATTEMPT) {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const cleanRunId = runId?.replace(/[^0-9]/g, "");
  const cleanAttempt = runAttempt?.replace(/[^0-9]/g, "");
  const suffix = cleanRunId ? `${cleanRunId}-${cleanAttempt || "1"}` : String(now.getTime());
  return `night-signals/${stamp}-${suffix}`;
}

function candidates() {
  if (!existsSync(INPUT)) return [];
  const rows = [];
  for (const file of readdirSync(INPUT).filter((name) => name.endsWith(".json")).sort()) {
    let parsed;
    try { parsed = JSON.parse(readFileSync(join(INPUT, file), "utf8")); }
    catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
    const entries = Array.isArray(parsed) ? parsed : parsed?.claims;
    if (!Array.isArray(entries)) throw new Error(`${file} must contain an array or { claims: [] }.`);
    rows.push(...entries);
  }
  return rows;
}

function main() {
  const rows = candidates();
  if (rows.length === 0) {
    console.log("No staged Night Signal candidates; reviewed snapshot unchanged.");
    return;
  }
  const invalid = rows.filter((row) => !isValidNightSignalClaim(row));
  if (invalid.length > 0) throw new Error(`${invalid.length} Night Signal claim(s) failed validation.`);
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Night Signal claim ids must be unique.");
  const approved = rows.filter((row) => row.reviewState === "approved");
  let current = null;
  try {
    current = JSON.parse(readFileSync(OUTPUT, "utf8"));
  } catch { /* a missing or malformed snapshot must be replaced */ }
  if (approvedClaimsUnchanged(current, approved)) {
    console.log("Approved Night Signal claims unchanged; snapshot and PR skipped.");
    return;
  }
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), claims: approved }, null, 2)}\n`);
  console.log(`Wrote ${approved.length} approved Night Signal claim(s).`);
  if (!process.argv.includes("--open-pr")) return;
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const branch = nightSignalBranchName(now);
  execFileSync("git", ["checkout", "-b", branch], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["add", OUTPUT], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(signals): refresh ${stamp}`], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["push", "-u", "origin", branch], { cwd: ROOT, stdio: "inherit" });
  execFileSync("gh", ["pr", "create", "--title", `Night Signal review ${stamp}`, "--body", "Scheduled offline claim refresh. Review provenance, expiry, corroboration and route effect before merge."], { cwd: ROOT, stdio: "inherit" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
