#!/usr/bin/env node
/**
 * Refresh the What's-On SPORT payload (PRD_WHATS_ON B2) from Greene King's own
 * public per-pub pages (first-party chain pages ONLY):
 *
 *   https://www.greeneking.co.uk/pubs/{region}/{slug}   (robots.txt: allowed)
 *     Each pub page inlines a first-party boolean "sports":true|false. We emit
 *     ONE venue-level attribute row per pub flagged true (kind:"sport", with no
 *     startsAt — it is an attribute, not a timed event). The venue list comes
 *     from the already-scraped identities in data/greene_king/raw/*.menu.json.
 *
 * GOVERNANCE:
 *   - Public first-party chain pages only. We fetch /pubs/{region}/{slug} and
 *     nothing else. robots.txt is honoured for every path we touch.
 *   - We NEVER touch FANZO booking links. Timed fixtures (kickoff times) are
 *     delivered through Greene King's FANZO partner behind gated booking URLs
 *     (/*book?sportId=, /*book?date=) which robots.txt disallows and which are
 *     not first-party data. So the timed sport_whats_on.json stays EMPTY with a
 *     meta note; only venue-level attributes go to sport_attributes.json.
 *   - Polite: descriptive UA with a contact address, 1.5s between requests.
 *
 * Usage:
 *   node scripts/whatson/scrape_greene_king_sport.mjs                 # live
 *   node scripts/whatson/scrape_greene_king_sport.mjs --from-dir DIR  # offline
 *     DIR holds saved pub pages named <slug>.html (one per menu.json venue).
 *
 * Output:
 *   public/data/whats_on/sport_attributes.json  (venue-level attribute rows)
 *   public/data/whats_on/sport_whats_on.json    (timed rows — honestly EMPTY)
 * Runs on the PR-gated refresh rail — never pushes to main.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseGreeneKingSportsFlag,
  pubPageUrlFromMenuUrl,
  buildSportAttributeRows,
} from "./greeneKingSportParser.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW_DIR = join(ROOT, "data", "greene_king", "raw");
const OUT_DIR = join(ROOT, "public", "data", "whats_on");
const ATTRS_PATH = join(OUT_DIR, "sport_attributes.json");
const TIMED_PATH = join(OUT_DIR, "sport_whats_on.json");

const ORIGIN = "https://www.greeneking.co.uk";
const USER_AGENT =
  "PubmaxxingBot/0.1 (+https://pubmaxxing.com; what's-on data curation; contact karanszdy@gmail.com)";
const FETCH_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function politeFetch(url) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const text = await res.text();
  await sleep(FETCH_DELAY_MS);
  return text;
}

// robots.txt gate for the paths we touch: refuse to run if a Disallow rule for
// User-agent: * covers the path (first-party or not, we stay polite).
async function assertRobotsAllows(origin, path) {
  let body = "";
  try {
    body = await politeFetch(`${origin}/robots.txt`);
  } catch {
    return; // no robots.txt -> allowed
  }
  let applies = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^(user-agent|disallow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    if (m[1].toLowerCase() === "user-agent") applies = m[2].trim() === "*";
    else if (applies && m[2] && path.startsWith(m[2]))
      throw new Error(`${origin}/robots.txt disallows ${path} — refusing to fetch`);
  }
}

// Load the venue identities we already hold (name+address+lat+lng+menuUrl).
function loadVenues() {
  return readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".menu.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(RAW_DIR, f), "utf8")))
    .filter((r) => r && r.menuUrl);
}

async function resolveSportFlag(record, fromDir) {
  const url = pubPageUrlFromMenuUrl(record.menuUrl);
  const slug = url.split("/").filter(Boolean).pop() ?? "";
  let html = "";
  if (fromDir) {
    const p = join(fromDir, `${slug}.html`);
    if (!existsSync(p)) return null;
    html = readFileSync(p, "utf8");
  } else {
    console.log(`fetch ${url}`);
    try {
      html = await politeFetch(url);
    } catch (err) {
      console.warn(`  fetch failed (${err.message}); flag undetermined`);
      return null;
    }
  }
  return parseGreeneKingSportsFlag(html);
}

async function main() {
  const fromDirFlag = process.argv.indexOf("--from-dir");
  const fromDir = fromDirFlag >= 0 ? process.argv[fromDirFlag + 1] : null;
  const observedAt = new Date().toISOString();

  if (!fromDir) await assertRobotsAllows(ORIGIN, "/pubs/");

  const records = loadVenues();
  const venues = [];
  for (const record of records) {
    const showsSport = await resolveSportFlag(record, fromDir);
    venues.push({ record, showsSport });
  }

  const { rows, counts } = buildSportAttributeRows({ venues, observedAt });

  const attrs = {
    generatedAt: observedAt,
    kind: "sport_attributes",
    sources: [
      {
        label: "Greene King",
        url: `${ORIGIN}/pubs/`,
        firstParty: true,
        pubsChecked: counts.pubsChecked,
        showsLiveSport: counts.showsLiveSport,
        noLiveSport: counts.noLiveSport,
        notes:
          'Each Greene King pub page (/pubs/{region}/{slug}) carries a first-party ' +
          '"sports":true|false flag. One attribute row is emitted per pub flagged ' +
          "true; the rest are counted, never guessed. Timed fixtures are FANZO " +
          "partner-gated (see sport_whats_on.json) and are not published here.",
      },
    ],
    rows,
  };

  // The timed sport payload stays honestly EMPTY: fixtures are partner-gated.
  const timed = {
    generatedAt: observedAt,
    kind: "sport",
    sources: [
      {
        label: "Greene King live-sport (FANZO)",
        url: `${ORIGIN}/live-sport`,
        firstParty: true,
        rowsEmitted: 0,
        notes:
          "Timed sport fixtures (kickoff times) are delivered via Greene King's " +
          "FANZO partner behind gated booking links (/*book?sportId=, " +
          "/*book?date=), which robots.txt disallows and which are not first-party " +
          "data. No timed rows are emitted. Venue-level 'shows live sport' " +
          "attributes live in sport_attributes.json.",
      },
    ],
    rows: [],
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeSportPayload(ATTRS_PATH, attrs);
  writeFileSync(TIMED_PATH, `${JSON.stringify(timed, null, 2)}\n`);
  console.log(`wrote ${rows.length} attribute rows -> ${ATTRS_PATH}`);
  console.log(`counts: ${JSON.stringify(counts)}`);
  console.log(`timed sport payload left empty (partner-gated) -> ${TIMED_PATH}`);
}

// Meta pretty-printed, rows one-per-line: reviewable diffs without an
// indentation tax on the row list (mirrors quizRefresh.mjs).
function writeSportPayload(path, payload) {
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = payload.rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  const body = payload.rows.length
    ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n`
    : `${meta},\n  "rows": []\n}\n`;
  writeFileSync(path, body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
