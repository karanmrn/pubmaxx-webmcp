// scripts/whatson/eventsRefresh.mjs
//
// What's-On EVENTS vertical — the first live-API vertical. Unlike the music /
// deals / sport / quiz generators (pure transforms over hand-verified
// first-party data), this one ingests OFFICIAL, self-service event-listing APIs
// and normalises their payloads into the B1 WhatsOnRow contract. See
// docs/EVENT_SOURCES_RESEARCH_2026-07-18.md for the full source audit.
//
// GOVERNANCE — official APIs only, provenance non-negotiable:
//   * NO scraping of aggregators. The two wired providers are the only free,
//     self-service, legally-clean discovery APIs found (Eventbrite killed
//     public search in 2019; DICE/SeeTickets/Songkick/Bandsistown/RA are all
//     partner-gated or scraping-only).
//   * TICKETMASTER (Discovery API v2) — free, instant key. Terms require a
//     deep-link back to the event's ticketmaster page and only "reasonable
//     period" caching. We honour that by FULLY OVERWRITING events_london.json
//     on every refresh (never append-only history) and letting the store's
//     tonight-window + past-dated freshness guard (lib/whatsOn.ts filterNotPast)
//     drop expired rows — the checked-in file is only ever a short-lived
//     working cache. Every row links back to its
//     own ticketmaster.co.uk event page.
//   * SKIDDLE (Events API) — best pub/bar-scale coverage, free key, BUT the
//     API is "for non-commercial use only. Any commercial use must be first
//     approved in writing by emailing dev@skiddle.com." PUBMAXX is commercial,
//     so this provider stays noop-skipped until SKIDDLE_API_KEY is present
//     (owner must secure written approval AND a key first).
//
// KEYS / NOOP-SKIP: each provider reads its own env key
// (TICKETMASTER_API_KEY / SKIDDLE_API_KEY). A provider whose key is absent is
// SKIPPED entirely (no fetch, contributes no rows) — the owner signs up later
// and it lights up with no code change. With no keys at all, main() is a pure
// no-op that leaves the honest empty file untouched.
//
// KIND MAPPING: music and sport stay themselves. Comedy, theatre, club and
// BARPUB map onto kind "event" so a real night is not dropped. A classification
// we still cannot name (Film, DATE, …) is DROPPED and counted.
//
// VENUE MATCHING (W6): each normalised row is passed through the shared,
// conservative resolveVenueId (exact grouping-key OR normalized-name +
// postcode/proximity confirmation, null on ambiguity). Unmatched events are
// STILL LISTED with their own venue name — they just don't carry a venueId.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVENT_REFRESH_CITIES,
  SKIDDLE_EVENTCODE_KIND,
  SKIDDLE_SOURCE,
  TICKETMASTER_SOURCE,
  cityGeo,
  dedupeEventRowsBySourceId,
  emptyEventDrops,
  mergeEventDrops,
  normaliseSkiddleEvents,
  normaliseTicketmasterEvents,
  skiddleLaneFenced,
  summariseEventDrops,
} from "../../lib/whatson/eventNormalise.mjs";
import { eventsOutputPath } from "./eventsOutputPath.mjs";
import { loadCanonicalVenueIndex, resolveVenueId } from "./resolveVenueId.mjs";

export { eventsOutputPath } from "./eventsOutputPath.mjs";
// Statically imported, and deliberately so: the lane is a TypeScript module this
// plain-node CLI loads through Node's own type stripping, which resolves no
// tsconfig `@/*` alias. A dynamic import hid that resolution failure inside the
// lane's catch, so the lane reported an upstream fault every run. Loading it up
// front makes a broken specifier a loud start-up error instead.
import {
  contextDevLaneStatus,
  contextDevSourceLabels,
  runContextDevEventsLane,
} from "../../lib/events/contextDevProvider.ts";

export {
  EMPTY_EVENT_DROPS,
  EVENT_REFRESH_CITIES,
  SKIDDLE_BRAND_ASSET_PRESENT,
  SKIDDLE_EVENTCODE_KIND,
  SKIDDLE_SOURCE,
  TICKETMASTER_SEGMENT_KIND,
  TICKETMASTER_SOURCE,
  cityGeo,
  dedupeEventRowsBySourceId,
  emptyEventDrops,
  mapSkiddleEvent,
  mapTicketmasterEvent,
  normaliseSkiddleEvents,
  normaliseTicketmasterEvents,
  skiddleLaneFenced,
  summariseEventDrops,
  toIsoInstant,
} from "../../lib/whatson/eventNormalise.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Opt in to the Common crawl. See runEventsRefresh for why it is opt-in. */
export const WITH_COMMON_FLAG = "--with-common";

export function eventsReviewBranchName(city = "london") {
  return `whats-on-events/${String(city).trim().toLowerCase() || "london"}`;
}

function commandOutput(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return typeof value === "string" ? value : "";
}

export function isPullRequestPermissionError(error) {
  const text = [error?.message, error?.stdout, error?.stderr].map(commandOutput).join("\n");
  return /github actions is not permitted to create or approve pull requests/i.test(text);
}

function branchHandoff({ branch, env, reason }) {
  const server = String(env.GITHUB_SERVER_URL ?? "https://github.com").replace(/\/+$/, "");
  const repository = String(env.GITHUB_REPOSITORY ?? "Singularityszn/pubmax");
  return {
    status: "branch-only",
    branch,
    branchUrl: `${server}/${repository}/tree/${branch}`,
    reason,
  };
}

/**
 * Publish one stable review branch and create or update its PR.
 *
 * A stable branch means a still-open review PR is updated by the next refresh,
 * instead of every scheduled run leaving another branch and PR behind. The
 * repository may disable PR creation for GITHUB_TOKEN even when the workflow
 * asks for pull-requests: write. In that case the branch is still useful and
 * the exact manual handoff is returned, while authentication failures remain
 * hard errors.
 */
export function publishEventsReview({
  outPath,
  observedAt,
  city = "london",
  env = process.env,
  rootDir = ROOT,
  runCommand = execFileSync,
  log = console.log,
}) {
  const branch = eventsReviewBranchName(city);
  const commandEnv = { ...process.env, ...env };
  const options = { cwd: rootDir, env: commandEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const run = (command, args) => runCommand(command, args, options);
  const relativePath = relative(rootDir, outPath);
  // Switching to the stable review branch replaces tracked files. Hold the
  // validated refresh bytes across that switch so the new branch stages this
  // run's evidence, not the previous branch snapshot.
  const refreshedOutput = readFileSync(outPath);
  run("git", ["restore", "--worktree", "--source=HEAD", "--", relativePath]);

  const remoteRefs = commandOutput(run("git", ["ls-remote", "--heads", "origin", branch]));
  if (remoteRefs.trim()) {
    run("git", ["fetch", "origin", branch]);
    run("git", ["switch", "--force-create", branch, `origin/${branch}`]);
  } else {
    run("git", ["switch", "--create", branch]);
  }

  writeFileSync(outPath, refreshedOutput);
  run("git", ["add", "--", relativePath]);
  let changed = true;
  try {
    run("git", ["diff", "--cached", "--quiet"]);
    changed = false;
  } catch {
    // git diff --quiet exits 1 when the refresh staged a change.
  }
  if (!changed) {
    log(`eventsRefresh: no data changes for ${branch}; existing review state unchanged.`);
    return { status: "no-change", branch };
  }

  const stamp = observedAt.slice(0, 10).replaceAll("-", "");
  run("git", ["commit", "-m", `chore(whats-on): refresh events ${stamp}`]);
  run("git", ["push", "--set-upstream", "origin", branch]);

  let openPullRequest = [];
  try {
    const listed = commandOutput(
      run("gh", ["pr", "list", "--base", "main", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"]),
    );
    openPullRequest = JSON.parse(listed || "[]");
  } catch (error) {
    if (isPullRequestPermissionError(error)) {
      const result = branchHandoff({
        branch,
        env,
        reason: "GitHub Actions token cannot create pull requests; branch was pushed for manual review.",
      });
      log(`eventsRefresh: ${result.reason} Open ${result.branchUrl}.`);
      return result;
    }
    throw error;
  }

  const existing = openPullRequest[0];
  if (existing?.url) {
    log(`eventsRefresh: updated existing What's-On review PR ${existing.url} from ${branch}.`);
    return { status: "updated", branch, pullRequestUrl: existing.url };
  }

  try {
    const created = commandOutput(
      run("gh", [
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        branch,
        "--title",
        `What's-On events ${stamp}`,
        "--body",
        "Scheduled official-API (Ticketmaster/Skiddle) events refresh for the Tonight page. Provenance links back to each source per its terms.",
      ]),
    );
    const pullRequestUrl = created.split(/\s+/).find((token) => /^https?:\/\//.test(token));
    return { status: "created", branch, ...(pullRequestUrl ? { pullRequestUrl } : {}) };
  } catch (error) {
    if (!isPullRequestPermissionError(error)) throw error;
    const result = branchHandoff({
      branch,
      env,
      reason: "GitHub Actions token cannot create pull requests; branch was pushed for manual review.",
    });
    log(`eventsRefresh: ${result.reason} Open ${result.branchUrl}.`);
    return result;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// How far ahead to pull. The store re-windows to "tonight" and drops stale
// rows, so a small forward horizon keeps the cached file short-lived (honouring
// Ticketmaster's "reasonable period" caching term) while surviving a missed run.
const FORWARD_HORIZON_MS = 2 * 24 * 60 * 60 * 1000;


export function providerLaneStatus(env = process.env) {
  const present = (name) => {
    const value = env?.[name];
    return typeof value === "string" && value.trim().length > 0;
  };
  return {
    ticketmaster: present("TICKETMASTER_API_KEY") ? "configured" : "not-configured",
    skiddle: present("SKIDDLE_API_KEY") ? "configured" : "not-configured",
    contextdev: contextDevLaneStatus(env ?? {}),
  };
}



// ---------------------------------------------------------------------------
// Fetchers (impure — network only; fetchImpl is injectable for tests)
// ---------------------------------------------------------------------------

async function fetchTicketmaster(apiKey, { nowMs, city = "london", fetchImpl = fetch }) {
  const geo = cityGeo(city);
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.search = new URLSearchParams({
    apikey: apiKey,
    countryCode: "GB",
    latlong: `${geo.lat},${geo.lng}`,
    radius: String(geo.radiusMiles),
    unit: "miles",
    startDateTime: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
    endDateTime: new Date(nowMs + FORWARD_HORIZON_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    size: "100",
    sort: "date,asc",
  }).toString();
  const res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "PUBMAXX-events/1" } });
  if (!res.ok) {
    await res.arrayBuffer();
    throw new Error(`Ticketmaster Discovery API returned ${res.status}`);
  }
  return res.json();
}

const SKIDDLE_FETCH_CODES = Object.keys(SKIDDLE_EVENTCODE_KIND).join(",");

async function fetchSkiddle(apiKey, { nowMs, city = "london", fetchImpl = fetch }) {
  const geo = cityGeo(city);
  const url = new URL("https://www.skiddle.com/api/v1/events/search/");
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
  url.search = new URLSearchParams({
    api_key: apiKey,
    latitude: String(geo.lat),
    longitude: String(geo.lng),
    radius: String(geo.radiusMiles),
    eventcode: SKIDDLE_FETCH_CODES,
    minDate: fmt(nowMs),
    maxDate: fmt(nowMs + FORWARD_HORIZON_MS),
    order: "date",
    limit: "100",
    description: "1",
  }).toString();
  const res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "PUBMAXX-events/1" } });
  if (!res.ok) {
    await res.arrayBuffer();
    throw new Error(`Skiddle Events API returned ${res.status}`);
  }
  return res.json();
}

/**
 * The rows the held file already carries for a set of source labels.
 *
 * This is the CLOBBER GUARD, and it is per-provider: the file is overwritten
 * whole, so a lane that is not in this run's answer - because it is keyless
 * (Common, which has its own writer) or because its upstream failed - would be
 * published as empty. Its own last-known rows carry across instead, each still
 * carrying the observedAt it was really seen at.
 */
export function readExistingRowsForLabels(filePath, labels) {
  if (!existsSync(filePath)) return [];
  const wanted = new Set(labels.map((label) => String(label).toLowerCase()));
  if (wanted.size === 0) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    const rows = Array.isArray(raw?.rows) ? raw.rows : [];
    return rows.filter((row) => wanted.has(String(row?.source?.label ?? "").toLowerCase()));
  } catch {
    return [];
  }
}

export function readExistingCommonRows(filePath) {
  return readExistingRowsForLabels(filePath, ["common"]);
}

export function parseEventsCityArg(argv = process.argv) {
  const flagged = argv.find((arg) => arg.startsWith("--city="));
  const city = flagged ? flagged.slice("--city=".length).trim().toLowerCase() : "london";
  return EVENT_REFRESH_CITIES.includes(city) ? city : null;
}

// ---------------------------------------------------------------------------
// main: fetch enabled providers, normalise, write events_london.json
// ---------------------------------------------------------------------------

function serialiseFile(payload) {
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = payload.rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  return payload.rows.length ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n` : `${meta},\n  "rows": []\n}\n`;
}

// The provider lane: fetch every CONFIGURED provider, normalise, and write the
// city file. It answers one of four outcomes and never throws, so the caller
// can run the keyless lanes whatever happened here.
async function runProviderLane({
  city,
  outPath,
  nowMs,
  observedAt,
  argv,
  env,
  fetchImpl,
  loadVenueIndex,
  log,
  logError,
}) {
  const tmKey = env.TICKETMASTER_API_KEY;
  const skKey = env.SKIDDLE_API_KEY;
  const lanes = providerLaneStatus(env);
  log(
    `eventsRefresh: city=${city} ticketmaster=${lanes.ticketmaster} skiddle=${lanes.skiddle} contextdev=${lanes.contextdev}`,
  );

  if (
    !nonEmptyString(tmKey) &&
    !nonEmptyString(skKey) &&
    lanes.contextdev !== "configured"
  ) {
    log(
      "eventsRefresh: no provider keys present (TICKETMASTER_API_KEY / SKIDDLE_API_KEY / CONTEXT_DEV_API_KEY). " +
        "Lanes stay not-configured. Leaving the events file untouched.",
    );
    return { status: "not-configured", wrote: false };
  }

  const venueIndex = loadVenueIndex();
  const allRows = [];
  const providersRun = [];
  // A lane that FAILED is recorded and the run carries on: the other lanes are
  // independent and an operator is owed each one's own outcome. The failed
  // lane's own held rows carry across the write further down, so a lane that
  // answered still publishes and the quiet lane is not emptied by its
  // neighbour's outage.
  const providerFailures = [];
  const dropped = emptyEventDrops();
  const opts = { observedAt, venueIndex, resolveVenue: resolveVenueId };

  const addDrops = (from) => mergeEventDrops(dropped, from);

  if (nonEmptyString(tmKey)) {
    try {
      const payload = await fetchTicketmaster(tmKey, { nowMs, city, fetchImpl });
      const result = normaliseTicketmasterEvents(payload, opts);
      allRows.push(...result.rows);
      addDrops(result.dropped);
      providersRun.push({ provider: "ticketmaster", rows: result.rows.length });
      log(
        `eventsRefresh: Ticketmaster -> ${result.rows.length} rows, ${summariseEventDrops(result.dropped)}`,
      );
    } catch (err) {
      logError(
        `eventsRefresh: Ticketmaster fetch failed (${err.message}) - its held rows carry across instead. The other provider lanes still run.`,
      );
      providerFailures.push({
        provider: "ticketmaster",
        label: TICKETMASTER_SOURCE.label,
        message: err.message,
      });
    }
  }

  if (nonEmptyString(skKey) && skiddleLaneFenced()) {
    log(
      "eventsRefresh: Skiddle lane FENCED OFF - the official logo asset is absent and " +
        "the credit obligation cannot be discharged, so no Skiddle row is fetched or written. " +
        "This is not an empty market.",
    );
  } else if (nonEmptyString(skKey)) {
    try {
      const payload = await fetchSkiddle(skKey, { nowMs, city, fetchImpl });
      const result = normaliseSkiddleEvents(payload, opts);
      allRows.push(...result.rows);
      addDrops(result.dropped);
      providersRun.push({ provider: "skiddle", rows: result.rows.length });
      log(
        `eventsRefresh: Skiddle -> ${result.rows.length} rows, ${summariseEventDrops(result.dropped)}`,
      );
    } catch (err) {
      logError(
        `eventsRefresh: Skiddle fetch failed (${err.message}) - its held rows carry across instead.`,
      );
      providerFailures.push({
        provider: "skiddle",
        label: SKIDDLE_SOURCE.label,
        message: err.message,
      });
    }
  } else {
    log("eventsRefresh: Skiddle lane not-configured (no SKIDDLE_API_KEY).");
  }

  if (lanes.contextdev === "configured") {
    try {
      const contextDev = await runContextDevEventsLane({
        observedAt,
        venueIndex,
        resolveVenue: resolveVenueId,
        env,
        callOptions: fetchImpl ? { fetchImpl } : {},
        log,
        logError,
      });
      allRows.push(...contextDev.rows);
      // A source whose every extracted event was refused reports zero rows and
      // a drop count, and the drops are the finding: counting them only when a
      // row survived would make a silently non-yielding page read as a quiet one.
      addDrops(contextDev.dropped);
      for (const run of contextDev.sourcesRun) {
        providersRun.push({ provider: run.sourceId, rows: run.rows });
      }
      for (const failure of contextDev.failures) {
        providerFailures.push({
          provider: failure.sourceId,
          label: failure.label,
          message: failure.message,
        });
      }
      if (contextDev.status === "failed" && contextDev.sourcesRun.length === 0) {
        logError("eventsRefresh: every Context.dev registered source failed this run.");
      }
    } catch (err) {
      logError(
        `eventsRefresh: Context.dev lane failed (${err.message}) - its held rows carry across instead.`,
      );
      // Rows this lane wrote carry the SOURCE's credit label, so the carry list
      // has to name those labels; a failure labelled "Context.dev" would match
      // no held row and drop the lot.
      providerFailures.push({
        provider: "contextdev",
        label: "Context.dev",
        carryLabels: contextDevSourceLabels(),
        message: err.message,
      });
    }
  } else {
    log("eventsRefresh: Context.dev lane not-configured (no CONTEXT_DEV_API_KEY).");
  }

  const failureReason = providerFailures
    .map((failure) => `${failure.provider}: ${failure.message}`)
    .join("; ");

  const carriedFailedRows = readExistingRowsForLabels(
    outPath,
    providerFailures.flatMap((failure) => failure.carryLabels ?? [failure.label]),
  );

  // The clobber guard is PER PROVIDER. A failed lane keeps its own held rows
  // (read above) and the lanes that answered still publish, so one upstream
  // outage never ages the whole file. With NO lane answering the write is
  // refused OUTRIGHT, held rows or not: the payload stamps `generatedAt` with
  // this run's instant, lib/whatsOnStore.ts feeds that stamp into
  // `sourceObservedAt`, and a failed revalidation is not an observation. The
  // held rows survive by the file being left exactly as it is.
  if (providerFailures.length > 0 && providersRun.length === 0) {
    logError(
      `eventsRefresh: not writing ${outPath} - every configured provider lane failed ` +
        `(${failureReason}).`,
    );
    return { status: "failed", wrote: false, reason: failureReason };
  }
  if (providerFailures.length > 0) {
    log(
      `eventsRefresh: carrying ${carriedFailedRows.length} held row(s) across for the failed lane(s) ` +
        `(${failureReason}), so a lane that answered can still publish.`,
    );
  }

  // Fail closed: a successful run that yields zero rows across every enabled
  // provider is more likely an upstream hiccup than a genuinely empty city -
  // refuse to clobber a good file unless --allow-empty is passed. The count is
  // the rows THIS run fetched, taken BEFORE the held Common rows are merged: a
  // single carried-over Common row would otherwise keep the list non-empty
  // forever and let a quiet Ticketmaster window silently drop yesterday's
  // provider rows.
  if (allRows.length === 0 && !argv.includes("--allow-empty")) {
    logError(
      `eventsRefresh: aborting - enabled provider(s) returned 0 mappable rows. ` +
        `Refusing to overwrite ${outPath}. Pass --allow-empty to override.`,
    );
    return { status: "refused", wrote: false, reason: "0 mappable rows" };
  }

  allRows.push(...carriedFailedRows);

  const commonRows = city === "london" ? readExistingCommonRows(outPath) : [];
  allRows.push(...commonRows);

  const deduped = dedupeEventRowsBySourceId(allRows);
  // A Common row states a DATE and no clock time, so it sorts on that instead.
  const whenOf = (row) => row.startsAt ?? row.startsDate ?? "";
  deduped.sort((a, b) => whenOf(a).localeCompare(whenOf(b)) || a.id.localeCompare(b.id));

  const countBy = (provider) =>
    deduped.filter((r) => r.source.label.toLowerCase().startsWith(provider)).length;
  const payload = {
    generatedAt: observedAt,
    kind: "events",
    region: city === "london" ? "greater-london" : city,
    city,
    sources: [
      {
        ...TICKETMASTER_SOURCE,
        firstParty: false,
        provider: "ticketmaster",
        rowsEmitted: countBy("ticketmaster"),
        notes:
          "Official Ticketmaster Discovery API v2 (GB market, city bbox). Music->music, " +
          "Sports->sport, Arts & Theatre/Comedy->event; other segments dropped and counted. " +
          "Each row deep-links back to its own ticketmaster.co.uk event page per the API terms; " +
          "file is fully overwritten each run (transient cache only).",
      },
      {
        ...SKIDDLE_SOURCE,
        firstParty: false,
        provider: "skiddle",
        rowsEmitted: countBy("skiddle"),
        notes:
          "Official Skiddle Events API (city lat/lng radius). LIVE/FEST->music, SPORT->sport, " +
          "CLUB/COMEDY/THEATRE/BARPUB->event; other codes dropped and counted. Commercial use " +
          "requires written approval from dev@skiddle.com; provider stays not-configured " +
          "without SKIDDLE_API_KEY. Name + logo + event link are licence obligations.",
      },
      {
        label: "Context.dev registered sources",
        url: "https://context.dev/",
        firstParty: false,
        provider: "contextdev",
        rowsEmitted: deduped.filter((row) => String(row.id ?? "").startsWith("events-cd-")).length,
        notes:
          "Registered venue-events pages from lib/harvest/sourcePolicy.ts, read through Context.dev " +
          "extract. Date-only listings carry startsDate and never invent a clock time.",
      },
    ],
    rows: deduped,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialiseFile(payload));
  log(
    `eventsRefresh: wrote ${deduped.length} event rows -> ${outPath} ` +
      `(${providersRun.map((p) => `${p.provider}:${p.rows}`).join(", ") || "none"}; ` +
      `common kept ${commonRows.length}; carried ${carriedFailedRows.length} from failed lane(s); ` +
      `${summariseEventDrops(dropped)})`,
  );
  const report = { status: "wrote", wrote: true, rows: deduped.length };
  if (providerFailures.length > 0) {
    report.failures = providerFailures.map((failure) => `${failure.provider}: ${failure.message}`);
    report.reason = failureReason;
  }
  return report;
}

async function defaultRunCommonLane(options) {
  const { refreshCommonEvents } = await import("./commonRefresh.mjs");
  return refreshCommonEvents(options);
}

/**
 * One refresh run: the provider lane, then the KEYLESS Common lane, then the
 * review PR.
 *
 * The two supply lanes are independent. The Common reader needs no provider key
 * and depends on Ticketmaster for nothing, so a quiet upstream window - or the
 * deliberate "0 mappable rows, refusing to clobber" refusal - must not stop it
 * running. On a first run the file ships with zero rows, so keeping Common
 * behind that refusal meant it could never seed itself at all.
 *
 * Every dependency is injectable so the run can be executed end to end in a
 * test: this whole path used to be reachable only by spawning the CLI, which is
 * why a module-level binding error in it went uncaught.
 */
export async function runEventsRefresh({
  argv = process.argv,
  env = process.env,
  nowMs = Date.now(),
  fetchImpl = fetch,
  outPath: outPathOverride,
  loadVenueIndex = loadCanonicalVenueIndex,
  runCommonLane = defaultRunCommonLane,
  openPr = defaultOpenPr,
  validate = defaultValidate,
  log = console.log,
  logError = console.error,
} = {}) {
  const observedAt = new Date(nowMs).toISOString();
  const city = parseEventsCityArg(argv);
  if (!city) {
    logError(`eventsRefresh: unknown city. Use one of ${EVENT_REFRESH_CITIES.join(", ")}.`);
    return { ok: false, city: null, provider: { status: "skipped" }, common: { status: "skipped" } };
  }
  const outPath = outPathOverride ?? eventsOutputPath(city);

  const provider = await runProviderLane({
    city,
    outPath,
    nowMs,
    observedAt,
    argv,
    env,
    fetchImpl,
    loadVenueIndex,
    log,
    logError,
  });

  // ONE owner of the Common crawl per run. It is a polite 1-req/s crawl of a
  // third party's sitemap, so running it from here AND spawning
  // commonRefresh.mjs beside us would spend the budget twice. The local
  // scheduler owns it as its own independent lane and does NOT pass this flag;
  // the workflow, which has only this one command, does.
  let common = { status: "skipped" };
  if (city === "london" && argv.includes(WITH_COMMON_FLAG)) {
    try {
      const report = await runCommonLane({ nowMs, outPath });
      // The Common lane refuses its own write when a run that can see nothing
      // would empty the rows the file already holds. That is a refusal, not a
      // write, so nothing downstream may treat it as one.
      common = report?.refused
        ? { status: "refused", wrote: false, reason: report.refused }
        : { status: "ran", wrote: true, rows: report?.rows?.length ?? 0 };
    } catch (err) {
      logError(`eventsRefresh: Common lane failed (${err.message}).`);
      common = { status: "failed", reason: err.message };
    }
  }

  // A provider FAILURE is always a failure. A deliberate REFUSAL (0 mappable
  // rows, refusing to clobber a good file) is an ordinary quiet-upstream
  // outcome, so it only reds the run when nothing else published - an operator
  // reading a red job beside an open review PR cannot tell the two apart.
  const providerFailed = provider.status === "failed" || (provider.failures?.length ?? 0) > 0;
  const commonFailed = common.status === "failed";
  const wrote = provider.wrote === true || common.wrote === true;
  const refusedWithNothingPublished =
    (provider.status === "refused" || common.status === "refused") && !wrote;

  let validation = { status: "skipped" };
  let published = { status: "skipped" };
  if (argv.includes("--open-pr") && wrote) {
    // Validate BEFORE anything is pushed. A refresh that produced a row the
    // app's own gate rejects must be refused here, not left on a branch with a
    // review PR already open against it. The two steps report SEPARATELY: a git
    // or gh failure is not a data-gate refusal, and once the push has run
    // "no branch pushed" would be false.
    try {
      validate();
      validation = { status: "ran" };
    } catch (err) {
      logError(
        `eventsRefresh: validate-data refused the refreshed file (${err.message}) - no branch pushed, no PR opened.`,
      );
      validation = { status: "failed", reason: err.message };
    }
    if (validation.status === "ran") {
      try {
        const publication = await openPr({ outPath, observedAt, nowMs, env, city, log });
        published = publication?.status ? publication : { status: "ran" };
      } catch (err) {
        if (isPullRequestPermissionError(err)) {
          const reason =
            "GitHub Actions token cannot create pull requests; branch publication needs a manual PR handoff.";
          logError(`eventsRefresh: ${reason}`);
          published = { status: "branch-only", reason };
        } else {
          logError(
            `eventsRefresh: the refreshed file passed validate-data, but publishing it failed (${err.message}).`,
          );
          published = { status: "failed", reason: err.message };
        }
      }
    }
  }

  return {
    ok:
      !providerFailed &&
      !refusedWithNothingPublished &&
      !commonFailed &&
      validation.status !== "failed" &&
      published.status !== "failed",
    city,
    provider,
    common,
    validation,
    published,
  };
}

function defaultValidate() {
  execFileSync(process.execPath, [join(ROOT, "scripts", "validate-data.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function defaultOpenPr(options) {
  return publishEventsReview(options);
}

async function main() {
  const result = await runEventsRefresh();
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
