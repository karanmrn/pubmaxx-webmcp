#!/usr/bin/env node
/**
 * Refresh the What's-On QUIZ payload (PRD_WHATS_ON B3) from the quiz
 * suppliers' own public venue listings (first-party finders only):
 *
 *   Question One   https://questionone.com/venues/  (robots.txt: allowed)
 *     Paginated WordPress archive; each card links a venue page carrying the
 *     weekly slot, entry fee and address. Rows are emitted for Greater London
 *     only, with the NEXT occurrence of the weekly slot as startsAt.
 *
 *   SpeedQuizzing  https://www.speedquizzing.com/find/  (page allowed)
 *     The page inlines ~1,400 upcoming events (date/day/lat/lon), but venue
 *     names and start times only exist behind /utils/… which
 *     speedquizzing.com/robots.txt DISALLOWS — so v1 records coverage counts
 *     in the payload meta and emits NO rows from this source.
 *
 *   Redtooth       https://www.redtoothquiz.co.uk/pages/find-us
 *     Checked 2026-07-11: the page is now only Redtooth's office address
 *     (they sell quiz packs; no venue finder exists any more). No rows.
 *
 * Aggregators (pubquizzers.com, londonquizmap, …) are cross-check only and
 * are never fetched or ingested by this script.
 *
 * Usage:
 *   node scripts/whatson/quizRefresh.mjs                  # live fetch
 *   node scripts/whatson/quizRefresh.mjs --from-dir DIR   # offline (tests):
 *     DIR holds saved pages: qo_venues_p*.html, qo_detail/<slug>.html,
 *     sq_find.html
 *
 * Output: public/data/whats_on/quiz_london.json
 * Runs on the weekly PR-gated refresh rail — never pushes to main.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseQuestionOneVenuesPage,
  parseQuestionOneNextPage,
  parseQuestionOneVenueDetail,
  parseSpeedQuizzingFindEvents,
  isGreaterLondonLatLng,
  buildQuestionOneRows,
} from "./quizParsers.mjs";
import { loadCanonicalVenueIndex } from "./resolveVenueId.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_PATH = join(ROOT, "public", "data", "whats_on", "quiz_london.json");

const QO_VENUES_URL = "https://questionone.com/venues/";
const SQ_FIND_URL = "https://www.speedquizzing.com/find/";
const USER_AGENT =
  "PubmaxxingBot/0.1 (+https://pubmaxxing.com; what's-on data curation; contact karanszdy@gmail.com)";
const FETCH_DELAY_MS = 1500;
const MAX_ARCHIVE_PAGES = 30;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function politeFetch(url) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const text = await res.text();
  await sleep(FETCH_DELAY_MS);
  return text;
}

// robots.txt gate for the paths we touch: refuse to run if a Disallow rule
// for User-agent: * covers the path (first-party or not, we stay polite).
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

async function loadQuestionOne(fromDir) {
  const pages = [];
  if (fromDir) {
    for (const f of readdirSync(fromDir).filter((f) => /^qo_venues_p\d+\.html$/.test(f)).sort())
      pages.push(readFileSync(join(fromDir, f), "utf8"));
  } else {
    await assertRobotsAllows("https://questionone.com", "/venues/");
    let url = QO_VENUES_URL;
    for (let i = 0; url && i < MAX_ARCHIVE_PAGES; i += 1) {
      console.log(`fetch ${url}`);
      const html = await politeFetch(url);
      pages.push(html);
      url = parseQuestionOneNextPage(html);
    }
  }

  const cards = [];
  const seen = new Set();
  for (const html of pages) {
    for (const card of parseQuestionOneVenuesPage(html)) {
      if (seen.has(card.url)) continue;
      seen.add(card.url);
      cards.push(card);
    }
  }

  const detailsByUrl = new Map();
  for (const card of cards) {
    const slug = card.url.split("/").filter(Boolean).pop();
    if (fromDir) {
      const p = join(fromDir, "qo_detail", `${slug}.html`);
      if (existsSync(p))
        detailsByUrl.set(card.url, parseQuestionOneVenueDetail(readFileSync(p, "utf8")));
    } else {
      console.log(`fetch ${card.url}`);
      try {
        detailsByUrl.set(card.url, parseQuestionOneVenueDetail(await politeFetch(card.url)));
      } catch (err) {
        console.warn(`  detail fetch failed (${err.message}); card-only data used`);
      }
    }
  }
  return { cards, detailsByUrl };
}

async function loadSpeedQuizzingCoverage(fromDir) {
  let html;
  if (fromDir) {
    const p = join(fromDir, "sq_find.html");
    if (!existsSync(p)) return { totalEvents: 0, londonEvents: 0 };
    html = readFileSync(p, "utf8");
  } else {
    await assertRobotsAllows("https://www.speedquizzing.com", "/find/");
    console.log(`fetch ${SQ_FIND_URL}`);
    html = await politeFetch(SQ_FIND_URL);
  }
  const events = parseSpeedQuizzingFindEvents(html);
  return {
    totalEvents: events.length,
    londonEvents: events.filter((e) => isGreaterLondonLatLng(e.lat, e.lng)).length,
  };
}

async function main() {
  const fromDirFlag = process.argv.indexOf("--from-dir");
  const fromDir = fromDirFlag >= 0 ? process.argv[fromDirFlag + 1] : null;
  const observedAt = new Date().toISOString();

  const { cards, detailsByUrl } = await loadQuestionOne(fromDir);
  const venueIndex = loadCanonicalVenueIndex();
  const { rows, dropped } = buildQuestionOneRows({ cards, detailsByUrl, observedAt, venueIndex });
  const sq = await loadSpeedQuizzingCoverage(fromDir);

  const payload = {
    generatedAt: observedAt,
    kind: "quiz",
    region: "greater-london",
    sources: [
      {
        label: "Question One",
        url: QO_VENUES_URL,
        firstParty: true,
        cardsSeen: cards.length,
        rowsEmitted: rows.length,
        dropped,
        notes:
          "Supplier's own venue directory. Non-weekly cadences (monthly/every-other) " +
          "and venues outside Greater London are dropped, never guessed.",
      },
      {
        label: "SpeedQuizzing",
        url: SQ_FIND_URL,
        firstParty: true,
        rowsEmitted: 0,
        coverage: sq,
        notes:
          "Find page inlines upcoming events (date/lat/lng only). Venue names/times " +
          "sit behind /utils/… which robots.txt disallows, so no rows are emitted; " +
          "counts recorded for coverage tracking.",
      },
      {
        label: "Redtooth",
        url: "https://www.redtoothquiz.co.uk/pages/find-us",
        firstParty: true,
        rowsEmitted: 0,
        notes:
          "Checked 2026-07-11: find-us page is only the company's office address — " +
          "no venue finder exists on the current site.",
      },
    ],
    rows,
  };

  // Meta pretty-printed, rows one-per-line: reviewable diffs without a 50KB
  // indentation tax on ~hundreds of rows.
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "");
  const rowLines = payload.rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  const body = `${meta.replace(/"rows": undefined,?\s*/, "")},\n  "rows": [\n${rowLines}\n  ]\n}\n`;
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, body);
  console.log(`wrote ${rows.length} rows -> ${OUT_PATH}`);
  console.log(`dropped: ${JSON.stringify(dropped)}; speedquizzing coverage: ${JSON.stringify(sq)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
