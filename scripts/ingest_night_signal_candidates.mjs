// Manual Exa candidate ingestion for Night Signals.
//
// The SCHEDULED sweep runs the same logic inside the Vercel cron plane
// (app/api/cron/refresh-night-signals via lib/nightSignalIngest.server); this
// script is the local/manual runner of that same boundary.
//
// This is the one place EXA_API_KEY is armed. It queries Exa for recent London
// pub buzz (new openings, award wins, "best pint" mentions), normalises each
// result into a *staged, pending* NightSignalClaim candidate, and writes them
// to data/night_signal_claims/. It NEVER publishes: candidates land as
// reviewState "pending", verification "single_source", routeEffect "none".
//
// The reviewed snapshot is produced by refresh_night_signal_claims.mjs, and a
// candidate cannot ship until a human flips it to "approved". This script and
// the interactive route never search a third party while a user waits.
//
// Honesty rules (non-negotiable):
//  - Real, dated, attributable only. A result with no valid published date,
//    no https source URL, or no matchable London night area is dropped.
//  - The claim text is the publisher's own headline, verbatim (trimmed). No
//    AI-written summary is ever presented as a fact.
//  - Source URLs are stripped to origin + pathname (tracking params removed) so
//    they satisfy the NightSignalClaim provenance contract.
//  - Nothing auto-affects route ranking: routeEffect is always "none" here.
//
// Safe no-op: without EXA_API_KEY the script prints a notice and exits 0, so
// both the manual run and the scheduled cron stay green until the owner arms
// the key.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "data", "night_signal_claims", "exa-candidates.json");

const EXA_ENDPOINT = "https://api.exa.ai/search";
const LOOKBACK_DAYS = 30;
const MAX_CANDIDATES = 40;
const RESULTS_PER_QUERY = 15;
const CANDIDATE_CONFIDENCE = 0.5;
const EXPIRY_DAYS = { opening: 30, event: 14 };
const DAY_MS = 24 * 60 * 60 * 1000;

// London night areas the ingestion can attribute a mention to. Kept in lockstep
// with NIGHT_AREA_SLUGS in lib/nightAreas.ts (asserted by the ingestion test).
// A candidate is only emitted when one of these terms appears in the article,
// so entity.id is always a real, reviewable area rather than a guess.
export const NIGHT_AREA_MATCHERS = [
  { slug: "clapham", terms: ["Clapham Common", "Clapham Junction", "Clapham"] },
  { slug: "victoria", terms: ["Pimlico", "Victoria"] },
  { slug: "piccadilly-soho", terms: ["Piccadilly & Soho", "Piccadilly", "Soho"] },
  { slug: "canary-wharf", terms: ["West India Quay", "Canary Wharf"] },
  { slug: "barnes", terms: ["Barnes Bridge", "Barnes"] },
  { slug: "chiswick", terms: ["Turnham Green", "Chiswick"] },
  { slug: "shoreditch", terms: ["Shoreditch", "Old Street", "Hoxton"] },
  { slug: "camden", terms: ["Camden Town", "Chalk Farm", "Camden"] },
  { slug: "brixton", terms: ["Brixton Village", "Brixton"] },
  { slug: "bermondsey-london-bridge", terms: ["London Bridge", "Bermondsey", "Borough"] },
  { slug: "kings-cross", terms: ["Coal Drops Yard", "King's Cross", "Kings Cross"] },
  { slug: "islington", terms: ["Upper Street", "Islington", "Angel"] },
  { slug: "dalston", terms: ["Dalston Kingsland", "Dalston Junction", "Dalston"] },
  { slug: "peckham", terms: ["Bellenden Road", "Peckham Rye", "Peckham"] },
  { slug: "greenwich", terms: ["Greenwich Market", "Cutty Sark", "Greenwich"] },
  { slug: "hammersmith", terms: ["Ravenscourt Park", "Hammersmith"] },
  { slug: "balham", terms: ["Balham"] },
  { slug: "marylebone", terms: ["Marylebone High Street", "Baker Street", "Marylebone"] },
  { slug: "richmond", terms: ["Richmond Riverside", "Richmond"] },
  { slug: "putney", terms: ["Putney Bridge", "East Putney", "Putney"] },
];

// Query set: buzz classes the contract can honestly carry. Each maps to a
// NightSignal kind. Award and "best pint" mentions are dated editorial events;
// a new opening is an "opening".
export const EXA_QUERY_SET = [
  { kind: "opening", query: "new London pub or bar opening this month" },
  { kind: "event", query: "London pub wins award best pub of the year" },
  { kind: "event", query: "best pint in London pub review feature" },
];

// A mention must read as pub-relevant, not merely name a London area.
const PUB_KEYWORDS = ["pub", "bar", "pint", "beer", "brewery", "taproom", "boozer", "tavern", "ale"];

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

/** Strip a URL to origin + pathname (https only). Drops query, hash, port and
 *  credentials so it satisfies the NightSignalClaim source contract. */
export function normalizeSourceUrl(value) {
  if (!isNonEmptyString(value)) return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const normalized = `${parsed.origin}${path}`;
  return normalized.length <= 2_000 ? normalized : null;
}

/** Publisher label from a hostname ("www.theinfatuation.com" -> "theinfatuation.com"). */
export function publisherFromUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host.length > 0 && host.length <= 160 ? host : null;
  } catch {
    return null;
  }
}

/** True when a headline is too thin or generic to stand as an attributable claim. */
export function isVagueTitle(title) {
  if (!isNonEmptyString(title)) return true;
  const trimmed = title.trim();
  if (trimmed.length < 25 || trimmed.length > 500) return true;
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  return letters.length < 15;
}

function containsWholeTerm(haystack, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`, "i").test(haystack);
}

/** Best (most specific) night-area match in the text, or null. Terms are tried
 *  longest-first so "Clapham Junction" wins over "Clapham". */
export function matchNightArea(text, matchers = NIGHT_AREA_MATCHERS) {
  if (!isNonEmptyString(text)) return null;
  let best = null;
  for (const area of matchers) {
    for (const term of area.terms) {
      if (!containsWholeTerm(text, term)) continue;
      if (!best || term.length > best.termLength) best = { slug: area.slug, termLength: term.length };
    }
  }
  return best ? best.slug : null;
}

function isPubRelevant(text) {
  if (!isNonEmptyString(text)) return false;
  const lower = text.toLocaleLowerCase("en-GB");
  return PUB_KEYWORDS.some((word) => containsWholeTerm(lower, word));
}

function claimId(kind, slug, publishedAt, sourceUrl) {
  const stamp = publishedAt.slice(0, 10).replaceAll("-", "");
  const hash = createHash("sha1").update(sourceUrl).digest("hex").slice(0, 8);
  return `${kind}:${slug}:${stamp}:${hash}`.slice(0, 120);
}

/**
 * Normalise a single Exa result into a pending NightSignalClaim candidate, or
 * null when it fails the quality bar. `now` is the observation instant.
 */
export function exaResultToCandidate(result, { kind, now = Date.now(), matchers = NIGHT_AREA_MATCHERS } = {}) {
  if (!result || typeof result !== "object") return null;
  if (kind !== "opening" && kind !== "event") return null;

  const title = isNonEmptyString(result.title) ? result.title.trim() : "";
  if (isVagueTitle(title)) return null;

  const sourceUrl = normalizeSourceUrl(result.url);
  if (!sourceUrl) return null;
  const publisher = publisherFromUrl(sourceUrl);
  if (!publisher) return null;

  const publishedRaw = result.publishedDate ?? result.published_date;
  if (!isNonEmptyString(publishedRaw) || !Number.isFinite(Date.parse(publishedRaw))) return null;
  const publishedMs = Date.parse(publishedRaw);
  if (publishedMs > now) return null;
  if (publishedMs < now - LOOKBACK_DAYS * DAY_MS) return null;
  const publishedAt = new Date(publishedMs).toISOString();

  const context = `${title} ${isNonEmptyString(result.text) ? result.text : ""}`;
  if (!isPubRelevant(context)) return null;

  const slug = matchNightArea(context, matchers);
  if (!slug) return null;

  const observedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + (EXPIRY_DAYS[kind] ?? 14) * DAY_MS).toISOString();

  return {
    id: claimId(kind, slug, publishedAt, sourceUrl),
    kind,
    entity: { type: "night_area", id: slug },
    claim: title,
    sourceUrl,
    publisher,
    publishedAt,
    observedAt,
    expiresAt,
    confidence: CANDIDATE_CONFIDENCE,
    reviewState: "pending",
    verification: "single_source",
    routeEffect: "none",
    corroboratingSources: [],
    reviewedAt: null,
    reviewAuthority: null,
  };
}

/**
 * Build the deduped candidate list from grouped Exa payloads.
 * `groups` is an array of { kind, results: Exa result objects }.
 */
export function buildCandidates(groups, { now = Date.now(), matchers = NIGHT_AREA_MATCHERS, max = MAX_CANDIDATES } = {}) {
  const byId = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const results = Array.isArray(group?.results) ? group.results : [];
    for (const result of results) {
      const candidate = exaResultToCandidate(result, { kind: group?.kind, now, matchers });
      if (candidate && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, max);
}

async function searchExa(apiKey, query, startPublishedDate) {
  const response = await fetch(EXA_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: RESULTS_PER_QUERY,
      startPublishedDate,
      contents: { text: { maxCharacters: 800 } },
    }),
  });
  if (!response.ok) {
    throw new Error(`Exa search failed (${response.status}) for "${query}".`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results : [];
}

function candidateBranchName(now = new Date(), runId = process.env.GITHUB_RUN_ID, runAttempt = process.env.GITHUB_RUN_ATTEMPT) {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const cleanRunId = runId?.replace(/[^0-9]/g, "");
  const cleanAttempt = runAttempt?.replace(/[^0-9]/g, "");
  const suffix = cleanRunId ? `${cleanRunId}-${cleanAttempt || "1"}` : String(now.getTime());
  return `night-signals-candidates/${stamp}-${suffix}`;
}

async function main() {
  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) {
    console.log("EXA_API_KEY not set; skipping Exa candidate ingestion (safe no-op).");
    return;
  }
  const now = Date.now();
  const startPublishedDate = new Date(now - LOOKBACK_DAYS * DAY_MS).toISOString();
  const groups = [];
  for (const { kind, query } of EXA_QUERY_SET) {
    const results = await searchExa(apiKey, query, startPublishedDate);
    groups.push({ kind, results });
  }
  const candidates = buildCandidates(groups, { now });
  if (candidates.length === 0) {
    console.log("No attributable, dated London pub buzz found; no candidate file written.");
    return;
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  const wrote = existsSync(OUTPUT);
  writeFileSync(OUTPUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), claims: candidates }, null, 2)}\n`);
  console.log(`${wrote ? "Refreshed" : "Wrote"} ${candidates.length} pending Night Signal candidate(s) for review.`);

  if (!process.argv.includes("--open-pr")) return;
  const now2 = new Date();
  const stamp = now2.toISOString().slice(0, 10).replaceAll("-", "");
  const branch = candidateBranchName(now2);
  execFileSync("git", ["checkout", "-b", branch], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["add", OUTPUT], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(signals): stage Exa buzz candidates ${stamp}`], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["push", "-u", "origin", branch], { cwd: ROOT, stdio: "inherit" });
  execFileSync("gh", ["pr", "create",
    "--title", `Night Signal candidates ${stamp}`,
    "--body", "Staged Exa buzz candidates (pending). Verify each source, published date and area attribution, then set reviewState to approved with reviewedAt and reviewAuthority before the reviewed snapshot can ship it. Nothing here affects route ranking."],
    { cwd: ROOT, stdio: "inherit" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
