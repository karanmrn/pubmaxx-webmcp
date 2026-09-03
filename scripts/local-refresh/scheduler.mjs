#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { cpus, homedir, loadavg } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_REFRESH_PATHS = [
  /^public\/data\/drink_price_updates\//,
  /^public\/data\/price_updates\//,
  /^public\/data\/whats_on\//,
  /^public\/data\/pint_prices_app_dataset\.json$/,
  /^public\/data\/venue_menu_enrichment\.json$/,
];

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(MODULE_PATH), "..", "..");
const LABELS = ["com.pubmax.refresh-prices", "com.pubmax.refresh-events"];
const PRICE_PROVIDER_KEYS = ["EXA_API_KEY", "BROWSERBASE_API_KEY", "TAVILY_API_KEY"];
const EVENT_PROVIDER_KEYS = ["TICKETMASTER_API_KEY", "SKIDDLE_API_KEY", "CONTEXT_DEV_API_KEY"];
const PROVIDER_SECRET_ENV_KEYS = [...PRICE_PROVIDER_KEYS, ...EVENT_PROVIDER_KEYS];

export function parseFreeMemoryPercent(output) {
  const match = String(output).match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/);
  if (!match) throw new Error("memory_pressure did not report system-free memory percentage.");
  return Number(match[1]);
}

export function loadKeyFile(path) {
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`${path} must have mode 0600; found ${mode.toString(8).padStart(4, "0")}.`);
  }
  const loaded = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const raw = lines[lineNumber].trim();
    if (!raw || raw.startsWith("#")) continue;
    const line = raw.startsWith("export ") ? raw.slice(7).trim() : raw;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`${path}:${lineNumber + 1} is not a KEY=value entry.`);
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    loaded[match[1]] = value;
  }
  return loaded;
}

export function redactSecrets(text, values) {
  let redacted = String(text);
  const secrets = [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]
    .sort((left, right) => right.length - left.length);
  for (const secret of secrets) redacted = redacted.replaceAll(secret, "[REDACTED]");
  return redacted;
}

/**
 * Which lanes of a mode can run with the keys on this machine.
 *
 * Readiness is per LANE, not per mode. The Common reader needs no provider key
 * at all, so a machine with neither TICKETMASTER_API_KEY nor SKIDDLE_API_KEY
 * must still run it - gating the whole events mode on a provider key meant the
 * keyless lane could never seed itself, which is the same coupling the
 * independent-lane loop below exists to remove. A skipped lane is REPORTED,
 * never silent.
 */
export function laneReadiness(mode, keys, dryRun = false) {
  const runnable = [];
  const skipped = [];
  for (const command of commandsForMode(mode, dryRun)) {
    const needs = command.requiresAnyKey ?? [];
    if (needs.length === 0 || needs.some((key) => keys[key])) {
      runnable.push(command);
      continue;
    }
    skipped.push({
      command,
      reason: `${command.args[0]} needs one of ${needs.join(" or ")} in the protected key file`,
    });
  }
  return { runnable, skipped };
}

export function keyReadinessError(mode, keys, dryRun = false) {
  if (mode === "prices") {
    const missing = PRICE_PROVIDER_KEYS.filter((key) => !keys[key]);
    return missing.length
      ? `prices refresh requires EXA_API_KEY, BROWSERBASE_API_KEY, and TAVILY_API_KEY in the protected key file; missing ${missing.join(", ")}`
      : null;
  }
  if (mode !== "events") throw new Error(`Unknown refresh mode: ${mode}`);
  const { runnable, skipped } = laneReadiness(mode, keys, dryRun);
  if (runnable.length > 0) return null;
  return `events refresh has no runnable lane: ${skipped.map((entry) => entry.reason).join("; ")}`;
}

export function providerSafeEnvironment(environment) {
  const safe = { ...environment };
  for (const key of PROVIDER_SECRET_ENV_KEYS) delete safe[key];
  return safe;
}

function normalise(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function rowsFromEnvelope(value, field) {
  if (Array.isArray(value)) return value;
  return value && Array.isArray(value[field]) ? value[field] : [];
}

function priceSnapshot(id, price, observedAt) {
  return {
    id,
    price,
    ...(typeof observedAt === "string" && observedAt ? { observedAt } : {}),
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function captureRefreshSnapshot(root) {
  const datasetPath = join(root, "public/data/pint_prices_app_dataset.json");
  const dataset = readJson(datasetPath, []);
  const venues = new Map();
  const prices = new Map();

  for (const row of Array.isArray(dataset) ? dataset : []) {
    const id = String(row.pub_key ?? "").trim() || `${normalise(row.pub_name)}|${normalise(row.address)}`;
    if (!venues.has(id)) {
      venues.set(id, {
        id,
        name: String(row.pub_name ?? ""),
        address: String(row.address ?? ""),
        lat: Number(row.latitude),
        lng: Number(row.longitude),
      });
    }
    if (typeof row.price_gbp === "number" && Number.isFinite(row.price_gbp)) {
      const priceId = row.app_price_id
        ? `dataset-row|${row.app_price_id}`
        : `dataset|${id}|${normalise(row.pint_name)}`;
      prices.set(priceId, priceSnapshot(priceId, row.price_gbp, row.scraped_at_values));
    }
  }

  const drinkEnvelope = readJson(join(root, "public/data/drink_price_updates/latest.json"), { updates: [] });
  for (const row of rowsFromEnvelope(drinkEnvelope, "updates")) {
    if (typeof row.priceGbp !== "number" || !Number.isFinite(row.priceGbp)) continue;
    const id = [
      "drink",
      row.venueKey,
      normalise(row.category),
      normalise(row.drinkName),
      row.source?.url ?? "",
    ].join("|");
    prices.set(id, priceSnapshot(id, row.priceGbp, row.observedAt));
  }

  const pintEnvelope = readJson(join(root, "public/data/price_updates/latest.json"), { updates: [] });
  for (const row of rowsFromEnvelope(pintEnvelope, "updates")) {
    const price = typeof row.price === "number" ? row.price : row.priceGbp;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    const id = ["pint", row.venueKey, row.source?.url ?? ""].join("|");
    prices.set(id, priceSnapshot(id, price, row.observedAt));
  }

  const deals = new Set();
  const events = new Set();
  const whatsOnDirectory = join(root, "public/data/whats_on");
  if (existsSync(whatsOnDirectory)) {
    for (const file of readdirSync(whatsOnDirectory).filter((name) => name.endsWith(".json"))) {
      const envelope = readJson(join(whatsOnDirectory, file), { rows: [] });
      for (const row of rowsFromEnvelope(envelope, "rows")) {
        if (row?.kind === "deal" && typeof row.id === "string" && row.id) deals.add(row.id);
        else if (typeof row?.id === "string" && row.id) events.add(row.id);
      }
    }
  }

  const enrichmentEnvelope = readJson(join(root, "public/data/venue_menu_enrichment.json"), { venues: {} });
  const enrichments = Object.entries(enrichmentEnvelope?.venues ?? {})
    .map(([id, value]) => ({ id, value: stableJson(value) }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    venues: [...venues.values()].sort((left, right) => left.id.localeCompare(right.id)),
    prices: [...prices.values()].sort((left, right) => left.id.localeCompare(right.id)),
    deals: [...deals].sort().map((id) => ({ id })),
    events: [...events].sort().map((id) => ({ id })),
    enrichments,
  };
}

export function commandsForMode(mode, dryRun) {
  if (mode === "events") {
    // Two INDEPENDENT lanes. eventsRefresh exits non-zero on ordinary outcomes
    // (an upstream 5xx, or its deliberate "0 mappable rows, refusing to
    // clobber" refusal), and Common depends on Ticketmaster for nothing, so a
    // quiet provider window must not stop the Common lane from running - which
    // on a first run would mean Common could never seed itself at all.
    return [
      {
        executable: process.execPath,
        args: ["scripts/whatson/eventsRefresh.mjs"],
        independent: true,
        requiresAnyKey: EVENT_PROVIDER_KEYS,
      },
      {
        executable: process.execPath,
        args: ["scripts/whatson/commonRefresh.mjs"],
        independent: true,
      },
    ];
  }
  if (mode !== "prices") throw new Error(`Unknown refresh mode: ${mode}`);
  const command = (...args) => ({ executable: process.execPath, args });
  if (dryRun) {
    return [
      command("scripts/refresh_drink_prices.mjs", "--limit", "1"),
      command("scripts/refresh_prices.mjs"),
      command("scripts/firecrawl_greene_king_prices.mjs", "--limit", "1", "--merge"),
      command("scripts/firecrawl_mbplc_prices.mjs", "--limit", "1"),
      command("scripts/harvest_outer_london_prices.mjs", "--limit", "1", "--budget", "2"),
      command("scripts/merge_london_chain_scrapes.mjs"),
      command("scripts/merge_london_chain_gazetteer.mjs"),
    ];
  }
  return [
    command("scripts/refresh_drink_prices.mjs"),
    command("scripts/refresh_prices.mjs"),
    command("scripts/firecrawl_greene_king_prices.mjs", "--merge"),
    command("scripts/firecrawl_mbplc_prices.mjs"),
    command("scripts/harvest_outer_london_prices.mjs"),
    command("scripts/merge_london_chain_scrapes.mjs"),
    command("scripts/merge_london_chain_gazetteer.mjs"),
  ];
}

export function baseRefForRun(dryRun) {
  return dryRun ? "HEAD" : "origin/main";
}

export function resourceRefusal({ load1, maxLoad, freeMemoryPercent, minFreeMemoryPercent }) {
  if (load1 > maxLoad) {
    return `load ${load1.toFixed(2)} exceeds limit ${maxLoad.toFixed(2)}`;
  }
  if (freeMemoryPercent < minFreeMemoryPercent) {
    return `free memory ${Math.floor(freeMemoryPercent)}% is below floor ${Math.floor(minFreeMemoryPercent)}%`;
  }
  return null;
}

export function summariseRefresh(before, after) {
  const beforeVenues = new Map(before.venues.map((venue) => [venue.id, venue]));
  const afterVenues = new Map(after.venues.map((venue) => [venue.id, venue]));
  const beforePrices = new Map(before.prices.map((price) => [price.id, price]));
  const afterPrices = new Map(after.prices.map((price) => [price.id, price]));
  const beforeDeals = new Set(before.deals.map((deal) => deal.id));
  const beforeEvents = new Set((before.events ?? []).map((event) => event.id));
  const beforeEnrichments = new Map((before.enrichments ?? []).map((entry) => [entry.id, entry.value]));

  let locationFixes = 0;
  for (const [id, venue] of afterVenues) {
    const previous = beforeVenues.get(id);
    if (!previous) continue;
    if (previous.lat !== venue.lat || previous.lng !== venue.lng) locationFixes += 1;
  }

  let priceChanges = 0;
  let refreshedPriceRows = 0;
  for (const [id, price] of afterPrices) {
    const previous = beforePrices.get(id);
    if (!previous) continue;
    if (previous.price !== price.price) priceChanges += 1;
    else if (price.observedAt && previous.observedAt !== price.observedAt) refreshedPriceRows += 1;
  }

  let enrichmentChanges = 0;
  for (const entry of after.enrichments ?? []) {
    if (beforeEnrichments.get(entry.id) !== entry.value) enrichmentChanges += 1;
  }

  return {
    newPubs: [...afterVenues.keys()].filter((id) => !beforeVenues.has(id)).length,
    newPriceRows: [...afterPrices.keys()].filter((id) => !beforePrices.has(id)).length,
    priceChanges,
    refreshedPriceRows,
    newDeals: after.deals.filter((deal) => !beforeDeals.has(deal.id)).length,
    newEvents: (after.events ?? []).filter((event) => !beforeEvents.has(event.id)).length,
    locationFixes,
    enrichmentChanges,
  };
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderAgent({ label, mode, hour, minute, weekday, repoRoot, nodePath, homeDir }) {
  const schedulerPath = `${repoRoot}/scripts/local-refresh/scheduler.mjs`;
  const logDirectory = `${homeDir}/karan-agent-workspace/data/refresh-logs`;
  const launchPath = `${dirname(nodePath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  const weekdayXml = weekday === undefined
    ? ""
    : `\n      <key>Weekday</key>\n      <integer>${weekday}</integer>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(schedulerPath)}</string>
    <string>run</string>
    <string>${xmlEscape(mode)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(launchPath)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
      <key>Hour</key>
      <integer>${hour}</integer>
      <key>Minute</key>
      <integer>${minute}</integer>${weekdayXml}
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>Nice</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(`${logDirectory}/launchd-${mode}.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(`${logDirectory}/launchd-${mode}.log`)}</string>
</dict>
</plist>
`;
  return { label, fileName: `${label}.plist`, xml };
}

export function renderLaunchAgents({ repoRoot, nodePath, homeDir }) {
  return [
    renderAgent({
      label: "com.pubmax.refresh-prices",
      mode: "prices",
      hour: 7,
      minute: 30,
      weekday: 1,
      repoRoot,
      nodePath,
      homeDir,
    }),
    renderAgent({
      label: "com.pubmax.refresh-events",
      mode: "events",
      hour: 15,
      minute: 45,
      repoRoot,
      nodePath,
      homeDir,
    }),
  ];
}

function git(worktree, args, options = {}) {
  return execFileSync("git", args, {
    cwd: worktree,
    encoding: "utf8",
    env: options.environment ?? providerSafeEnvironment(process.env),
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
}

function changedRefreshFiles(worktree, environment) {
  const output = git(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    environment,
  });
  const entries = output.split("\0").filter(Boolean);
  const files = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    let path = entry.slice(3);
    if (status.includes("R") || status.includes("C")) {
      path = entries[index + 1] ?? path;
      index += 1;
    }
    if (ALLOWED_REFRESH_PATHS.some((pattern) => pattern.test(path))) files.push(path);
  }
  return [...new Set(files)].sort();
}

function summaryMarkdown(mode, summary, changedFiles) {
  return `## Local ${mode} refresh

Review required before merge. Existing acquisition scripts produced every row; this job only isolated, validated, and packaged their output.

| Change | Count |
| --- | ---: |
| New pubs | ${summary.newPubs} |
| New price rows | ${summary.newPriceRows} |
| Price changes | ${summary.priceChanges} |
| Refreshed price observations | ${summary.refreshedPriceRows} |
| New deals | ${summary.newDeals} |
| New events | ${summary.newEvents} |
| Location fixes | ${summary.locationFixes} |
| Menu enrichment changes | ${summary.enrichmentChanges} |

Changed files: ${changedFiles.length}
`;
}

export async function publishPreparedChanges({
  worktree,
  mode,
  dryRun,
  summary,
  log = console.log,
  ghAxiPath,
  timestamp = new Date().toISOString(),
  environment = process.env,
}) {
  const externalCommandEnvironment = providerSafeEnvironment(environment);
  if (!Object.values(summary).some((count) => count > 0)) {
    log("No semantic refresh data changed. No branch or PR created.");
    return { status: "no-change", changedFiles: [] };
  }
  const changedFiles = changedRefreshFiles(worktree, externalCommandEnvironment);
  if (changedFiles.length === 0) {
    log("No refresh data changed. No branch or PR created.");
    return { status: "no-change", changedFiles: [] };
  }

  git(worktree, ["add", "--", ...changedFiles], { environment: externalCommandEnvironment });
  try {
    git(worktree, ["diff", "--cached", "--quiet"], { environment: externalCommandEnvironment });
    log("No staged refresh data changed. No branch or PR created.");
    return { status: "no-change", changedFiles: [] };
  } catch {
    // A non-zero status is the expected signal that a staged diff exists.
  }

  const diff = git(worktree, ["diff", "--cached", "--stat"], {
    environment: externalCommandEnvironment,
  });
  log(summaryMarkdown(mode, summary, changedFiles));
  log(diff.trimEnd());

  if (dryRun) {
    log("Dry run complete. No branch, commit, push, or PR created.");
    return { status: "dry-run", changedFiles, diff };
  }

  if (!ghAxiPath) throw new Error("gh-axi path is required to open a review PR.");
  try {
    accessSync(ghAxiPath, fsConstants.X_OK);
  } catch {
    throw new Error(`gh-axi is not executable at ${ghAxiPath}; refusing to push without review PR capability.`);
  }

  const stamp = timestamp.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").toLowerCase();
  const branch = `automation/local-refresh-${mode}-${stamp}`;
  if (branch === "main" || branch === "master") throw new Error("Refusing to publish the default branch.");
  git(worktree, ["switch", "-c", branch], {
    environment: externalCommandEnvironment,
    stdio: "inherit",
  });
  git(
    worktree,
    [
      "-c",
      "user.name=pubmax-local-refresh",
      "-c",
      "user.email=local-refresh@users.noreply.github.com",
      "commit",
      "-m",
      `chore(data): refresh London ${mode}`,
    ],
    { environment: externalCommandEnvironment, stdio: "inherit" },
  );
  git(worktree, ["push", "-u", "origin", branch], {
    environment: externalCommandEnvironment,
    stdio: "inherit",
  });

  const body = summaryMarkdown(mode, summary, changedFiles);
  const title = mode === "prices" ? "Refresh London pub prices" : "Refresh London events";
  execFileSync(ghAxiPath, ["pr", "create", "--base", "main", "--head", branch, "--title", title, "--body", body], {
    cwd: worktree,
    env: externalCommandEnvironment,
    stdio: "inherit",
  });
  return { status: "published", changedFiles, branch };
}

function numericSetting(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function defaultMaxLoad(logicalCpuCount) {
  return Math.max(4, Number(logicalCpuCount) * 0.75);
}

function probeResources(environment = process.env) {
  const memoryOutput = execFileSync("/usr/bin/memory_pressure", ["-Q"], { encoding: "utf8" });
  return {
    load1: loadavg()[0],
    maxLoad: numericSetting(environment.PUBMAX_REFRESH_MAX_LOAD, defaultMaxLoad(cpus().length)),
    freeMemoryPercent: parseFreeMemoryPercent(memoryOutput),
    minFreeMemoryPercent: numericSetting(environment.PUBMAX_REFRESH_MIN_FREE_PERCENT, 25),
  };
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function createLogger(path, secretValues) {
  writeFileSync(path, "", { mode: 0o600 });
  return (message) => {
    const safe = redactSecrets(String(message), secretValues);
    appendFileSync(path, `${safe}\n`, "utf8");
    console.log(safe);
  };
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireLock(lockDirectory) {
  try {
    mkdirSync(lockDirectory);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const pidPath = join(lockDirectory, "pid");
    const existingPid = existsSync(pidPath) ? Number(readFileSync(pidPath, "utf8").trim()) : NaN;
    if (processExists(existingPid)) return false;
    rmSync(lockDirectory, { recursive: true, force: true });
    mkdirSync(lockDirectory);
  }
  writeFileSync(join(lockDirectory, "pid"), `${process.pid}\n`, { mode: 0o600 });
  return true;
}

function releaseLock(lockDirectory) {
  const pidPath = join(lockDirectory, "pid");
  if (!existsSync(pidPath)) return;
  const owner = Number(readFileSync(pidPath, "utf8").trim());
  if (owner === process.pid) rmSync(lockDirectory, { recursive: true, force: true });
}

function streamLines(stream, emit) {
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) emit(line);
  });
  stream.on("end", () => {
    if (pending) emit(pending);
  });
}

async function runChild({ executable, args, cwd, environment, log }) {
  log(`$ ${executable} ${args.join(" ")}`);
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    streamLines(child.stdout, log);
    streamLines(child.stderr, log);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} exited ${code ?? `on signal ${signal}`}`));
    });
  });
}

export async function validatePreparedData({ worktree, environment, log }) {
  await runChild({
    executable: "npm",
    args: ["run", "validate-data"],
    cwd: worktree,
    environment,
    log,
  });
}

function environmentWithNodePath(environment) {
  const systemPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return {
    ...environment,
    PATH: [dirname(process.execPath), environment.PATH, systemPath].filter(Boolean).join(":"),
  };
}

export async function runScheduledRefresh({
  mode,
  dryRun = false,
  repoRoot = REPO_ROOT,
  homeDir = homedir(),
  keysFile = join(homeDir, "karan-agent-workspace/data/keys.env"),
  logDirectory = join(homeDir, "karan-agent-workspace/data/refresh-logs"),
  environment = process.env,
} = {}) {
  if (mode !== "prices" && mode !== "events") throw new Error(`Unknown refresh mode: ${mode}`);

  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const secretValues = [];
  const logPath = join(logDirectory, `${timestampForPath()}-${mode}${dryRun ? "-dry-run" : ""}.log`);
  const log = createLogger(logPath, secretValues);

  let resources;
  try {
    resources = probeResources(environment);
  } catch (error) {
    log(`REFUSED: unable to measure machine resources: ${error.message}`);
    return { status: "refused", reason: error.message, logPath };
  }
  const refusal = resourceRefusal(resources);
  if (refusal) {
    log(`REFUSED: ${refusal}`);
    return { status: "refused", reason: refusal, logPath };
  }
  log(`Resource gate passed: load=${resources.load1.toFixed(2)}, free-memory=${resources.freeMemoryPercent}%.`);

  const lockDirectory = join(logDirectory, "refresh.lock");
  if (!acquireLock(lockDirectory)) {
    log("REFUSED: another local refresh is already running.");
    return { status: "refused", reason: "another local refresh is already running", logPath };
  }

  let runDirectory;
  let worktree;
  let externalCommandEnvironment = providerSafeEnvironment(environmentWithNodePath(environment));
  try {
    const keys = loadKeyFile(keysFile);
    secretValues.push(...Object.values(keys));
    const readinessError = keyReadinessError(mode, keys, dryRun);
    if (readinessError) {
      log(`MISSING KEY: ${readinessError}.`);
      return { status: "missing-key", reason: readinessError, logPath };
    }

    const childEnvironment = environmentWithNodePath({ ...environment, ...keys });
    externalCommandEnvironment = providerSafeEnvironment(childEnvironment);
    runDirectory = mkdtempSync(join(logDirectory, `.run-${mode}-`));
    worktree = join(runDirectory, "worktree");

    await runChild({
      executable: "git",
      args: ["fetch", "origin", "main", "--prune"],
      cwd: repoRoot,
      environment: externalCommandEnvironment,
      log,
    });
    const baseRef = baseRefForRun(dryRun);
    await runChild({
      executable: "git",
      args: ["worktree", "add", "--detach", worktree, baseRef],
      cwd: repoRoot,
      environment: externalCommandEnvironment,
      log,
    });
    log(`Prepared disposable worktree from ${baseRef}.`);

    const before = captureRefreshSnapshot(worktree);
    const { runnable: commands, skipped: skippedLanes } = laneReadiness(mode, keys, dryRun);
    for (const entry of skippedLanes) log(`SKIPPED LANE: ${entry.reason}.`);
    let independentRun = 0;
    let independentFailed = 0;
    for (const command of commands) {
      const { independent = false, ...child } = command;
      if (!independent) {
        await runChild({ ...child, cwd: worktree, environment: childEnvironment, log });
        continue;
      }
      independentRun += 1;
      try {
        await runChild({ ...child, cwd: worktree, environment: childEnvironment, log });
      } catch (error) {
        independentFailed += 1;
        log(`LANE FAILED (independent): ${error.message}`);
      }
    }
    if (independentRun > 0 && independentFailed === independentRun) {
      throw new Error(`Every ${mode} lane failed; nothing was refreshed.`);
    }
    await validatePreparedData({ worktree, environment: childEnvironment, log });
    const after = captureRefreshSnapshot(worktree);
    const summary = summariseRefresh(before, after);
    const result = await publishPreparedChanges({
      worktree,
      mode,
      dryRun,
      summary,
      log,
      ghAxiPath: join(homeDir, ".local/bin/gh-axi"),
      environment: childEnvironment,
    });
    return { ...result, summary, logPath };
  } catch (error) {
    log(`FAILED: ${error.message}`);
    throw error;
  } finally {
    if (worktree && existsSync(worktree)) {
      try {
        execFileSync("git", ["worktree", "remove", "--force", worktree], {
          cwd: repoRoot,
          env: externalCommandEnvironment,
          stdio: "ignore",
        });
      } catch (error) {
        log(`Cleanup warning: ${error.message}`);
      }
    }
    if (runDirectory && existsSync(runDirectory)) rmSync(runDirectory, { recursive: true, force: true });
    releaseLock(lockDirectory);
  }
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function launchAgentDirectory(homeDir) {
  return join(homeDir, "Library/LaunchAgents");
}

export function writeLaunchAgents(outputDirectory, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const homeDir = options.homeDir ?? homedir();
  const nodePath = options.nodePath ?? process.execPath;
  mkdirSync(outputDirectory, { recursive: true });
  const agents = renderLaunchAgents({ repoRoot, nodePath, homeDir });
  for (const agent of agents) {
    const path = join(outputDirectory, agent.fileName);
    writeFileSync(path, agent.xml, { mode: 0o644 });
    chmodSync(path, 0o644);
    execFileSync("/usr/bin/plutil", ["-lint", path], { stdio: "inherit" });
  }
  return agents.map((agent) => join(outputDirectory, agent.fileName));
}

function isAgentLoaded(label) {
  try {
    execFileSync("/bin/launchctl", ["list", label], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function startAgents(directory) {
  for (const label of LABELS) {
    const path = join(directory, `${label}.plist`);
    if (!existsSync(path)) throw new Error(`Missing ${path}; run install first.`);
    if (!isAgentLoaded(label)) execFileSync("/bin/launchctl", ["load", path], { stdio: "inherit" });
  }
}

function stopAgents(directory) {
  for (const label of LABELS) {
    const path = join(directory, `${label}.plist`);
    if (existsSync(path) && isAgentLoaded(label)) {
      execFileSync("/bin/launchctl", ["unload", path], { stdio: "inherit" });
    }
  }
}

function printAgentStatus() {
  for (const label of LABELS) {
    if (!isAgentLoaded(label)) {
      console.log(`${label}: not loaded`);
      continue;
    }
    console.log(execFileSync("/bin/launchctl", ["list", label], { encoding: "utf8" }).trimEnd());
  }
}

async function main(args) {
  const [command, mode] = args;
  const homeDir = homedir();
  const installedDirectory = launchAgentDirectory(homeDir);
  if (command === "run") {
    const result = await runScheduledRefresh({
      mode,
      dryRun: args.includes("--dry-run"),
      logDirectory: optionValue(args, "--log-dir", undefined),
    });
    if (result.status === "refused" || result.status === "missing-key") process.exitCode = 75;
    return;
  }
  if (command === "render-launchd") {
    const outputDirectory = optionValue(args, "--output-dir", join(REPO_ROOT, ".local-refresh-launchd"));
    for (const path of writeLaunchAgents(outputDirectory)) console.log(path);
    return;
  }
  if (command === "install") {
    mkdirSync(join(homeDir, "karan-agent-workspace/data/refresh-logs"), { recursive: true, mode: 0o700 });
    writeLaunchAgents(installedDirectory);
    startAgents(installedDirectory);
    printAgentStatus();
    return;
  }
  if (command === "start") {
    startAgents(installedDirectory);
    printAgentStatus();
    return;
  }
  if (command === "stop") {
    stopAgents(installedDirectory);
    printAgentStatus();
    return;
  }
  if (command === "status") {
    printAgentStatus();
    return;
  }
  if (command === "uninstall") {
    stopAgents(installedDirectory);
    for (const label of LABELS) {
      const path = join(installedDirectory, `${label}.plist`);
      if (existsSync(path)) unlinkSync(path);
    }
    printAgentStatus();
    return;
  }
  throw new Error(
    "Usage: scheduler.mjs run <prices|events> [--dry-run] [--log-dir DIR] | render-launchd [--output-dir DIR] | install | start | stop | status | uninstall",
  );
}

if (process.argv[1] === MODULE_PATH) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
