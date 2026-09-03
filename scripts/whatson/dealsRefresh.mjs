// scripts/whatson/dealsRefresh.mjs
//
// Pure generator for the What's-On DEALS vertical (PRD_WHATS_ON B4). Crosses a
// small, hand-seeded set of chain-level "deal day" definitions against that
// chain's OWN venues already in the dataset — no fetching here: every
// function is a plain transform so the whole module unit-tests offline.
// Orchestration (read venues, write output) lives in main() below, mirroring
// scripts/whatson/sportFixtures.mjs / quizRefresh.mjs.
//
// GOVERNANCE — first-party chain deal days ONLY, never wholesale copying:
//   Every deal definition below is hand-sourced from the chain's own public
//   pages (J D Wetherspoon's own "Food & drink" club-days page + its own news
//   article naming the prices) and cited by URL + observedAt. No price is
//   invented — every figure is the chain's own published number, quoted with
//   its own caveat ("price, dishes and participation may vary per pub") kept
//   honestly in `detail`. A weekly refresh only has to hand-edit
//   CHAIN_DEALS below (or re-check the source pages) — cheaper AND more
//   honest than scraping a booking/offers aggregator.
//
// RECURRENCE MODEL — mirrors the quiz vertical, NOT a literal multi-week
// series: each row is "the next occurrence" of a weekly deal day, computed
// DST-aware in Europe/London (nextWeeklyOccurrence, imported from
// quizParsers.mjs — same technique, same module). Unlike a quiz's single
// instant, a deal day runs for a WINDOW (e.g. 11:30-23:00), so every row also
// carries `endsAt` on the same resolved London calendar date.
//
// GREENE KING — investigated, honestly EMPTY: the raw Greene King venue pages
// already scraped into data/greene_king/raw/*.menu.json (used by
// scrape_greene_king_sport.mjs) carry no first-party "deal day" content — the
// markdown captured for every pub is just the menu-filter UI ("Sort by ...
// No Results"); no recurring offer copy was found on any page. Rather than
// guess or infer a program that was never published, ZERO Greene King rows
// are emitted this run — recorded in the output `sources` array, exactly the
// pattern sport_whats_on.json set for a partner-gated feed. Re-check on the
// next refresh in case Greene King's own site starts publishing deal days.
//
// GREATER LONDON SCOPE: Wetherspoons' pub list (public/data/wetherspoons/
// pubs.json) is nationwide (824 pubs); this file's own name says "london", so
// venues are filtered to Greater London via the SAME postcode tables
// quizParsers.mjs already curated for the quiz vertical (isGreaterLondonPostcode).
//
// VENUE MATCHING (W6): pubs.json's own name/address strings rarely line up
// with the canonical dataset's venueGroupingKey formula (that dataset uses
// Google-Places-style addresses; pubs.json uses the chain's own
// postcode-only address), so an exact-key match is rare. resolveVenueId
// (scripts/whatson/resolveVenueId.mjs) is used instead — its conservative
// fallback confirms a normalized-name match via postcode district or <=75m
// proximity, both of which pubs.json carries (postcode + lat/lng). `venueId`
// is only set when resolveVenueId returns non-null; a row that can't be
// confidently resolved simply omits the field, never a guessed id.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nextWeeklyOccurrence, isGreaterLondonPostcode } from "./quizParsers.mjs";
import { resolveVenueId, loadCanonicalVenueIndex } from "./resolveVenueId.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WETHERSPOONS_PATH = join(ROOT, "public", "data", "wetherspoons", "pubs.json");
const OUT_PATH = join(ROOT, "public", "data", "whats_on", "deals_london.json");

// ---------------------------------------------------------------------------
// Europe/London wall-clock -> ISO instant (DST-aware; two-pass resolution,
// same technique as quizParsers.mjs nextWeeklyOccurrence / sportFixtures.mjs
// londonWallClockToIso — duplicated here on purpose, mirroring the existing
// per-generator copies rather than reaching into a sibling script's private
// internals).
// ---------------------------------------------------------------------------

function londonOffsetMinutes(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((wallAsUtc - date.getTime()) / 60_000);
}

const pad = (n) => String(n).padStart(2, "0");

// Resolve a Europe/London wall-clock date+time ("YYYY-MM-DD", "HH:MM") to an
// ISO instant carrying the correct offset for that calendar date (+01:00 in
// BST, +00:00 in GMT). Returns null on a malformed date/time (never guessed).
export function londonWallClockToIso(dateStr, timeStr) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ""));
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr ?? ""));
  if (!dm || !tm) return null;
  const [y, mo, da] = [Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])];
  const [hh, mm] = [Number(tm[1]), Number(tm[2])];
  if (hh > 23 || mm > 59) return null;

  let offset = londonOffsetMinutes(new Date(Date.UTC(y, mo, da, hh, mm)));
  let instant = Date.UTC(y, mo, da, hh, mm) - offset * 60_000;
  offset = londonOffsetMinutes(new Date(instant));
  instant = Date.UTC(y, mo, da, hh, mm) - offset * 60_000;

  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${dm[1]}-${dm[2]}-${dm[3]}T${pad(hh)}:${pad(mm)}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// ---------------------------------------------------------------------------
// Chain-level deal definitions (hand-seeded, first-party, honest)
// ---------------------------------------------------------------------------

// J D Wetherspoon's own current "club days" page. Checked 2026-07-12: four
// named weekly clubs (Monday-Thursday), each 11:30-23:00. NOTE: no "Fish
// Friday" club is currently listed here (the page that used to carry it,
// jdwetherspoon.com/food/fish, now 404s) — rather than ship a stale/
// discontinued offer, it is simply NOT included below.
export const WETHERSPOONS_FOOD_DRINK_SOURCE = {
  label: "J D Wetherspoon — Food & drink",
  url: "https://www.jdwetherspoon.com/food-drink/",
};

// J D Wetherspoon's own news article naming the per-club prices (published
// 6 June 2025; prices "representative of most pubs" per the article's own
// caveat, and are NOT re-asserted as this pub's exact price — see `detail`).
export const WETHERSPOONS_PRICING_SOURCE = {
  label: "J D Wetherspoon — “New clubs, lower prices”",
  url: "https://www.jdwetherspoon.com/news/new-clubs-lower-prices/",
};

// Every entry MUST already be a currently-published club day + real terms —
// never a guessed price or day. Add/remove/re-check on the weekly refresh.
export const WETHERSPOONS_DEALS = [
  {
    id: "jdw-small-plates-monday",
    dayName: "Monday",
    startTime: "11:30",
    endTime: "23:00",
    title: "Small Plates Club",
    terms:
      "Any 3 small plates for £10 (£12 at some pubs), plus a drink from a choice of over 150.",
  },
  {
    id: "jdw-burgers-tuesday",
    dayName: "Tuesday",
    startTime: "11:30",
    endTime: "23:00",
    title: "Gourmet Burgers Club",
    terms:
      "Gourmet burgers from £8.46 (soft drink) / £9.99 (alcoholic drink), plus a drink from a choice of over 150.",
  },
  {
    id: "jdw-pizza-wednesday",
    dayName: "Wednesday",
    startTime: "11:30",
    endTime: "23:00",
    title: "Pizza Club",
    terms:
      "All 11-inch pizzas from £6.96 (soft drink) / £8.49 (alcoholic drink), plus a drink from a choice of over 150.",
  },
  {
    id: "jdw-curry-thursday",
    dayName: "Thursday",
    startTime: "11:30",
    endTime: "23:00",
    title: "Curry Club®",
    terms:
      "Curry Club dishes from £8.46 (soft drink) / £9.99 (alcoholic drink), plus a drink from a choice of over 150.",
  },
];

// ---------------------------------------------------------------------------
// Venue filtering + row building (pure)
// ---------------------------------------------------------------------------

function coordOf(value) {
  // Number(null) is 0 — treat null/undefined as genuinely missing, never 0,0.
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Filter a Wetherspoons pubs.json `pubs` array down to Greater London, using
// the SAME postcode tables the quiz vertical curated (quizParsers.mjs).
export function filterGreaterLondonWetherspoons(pubs) {
  return (pubs ?? []).filter((p) => isGreaterLondonPostcode(p?.postcode));
}

// Cross-join CHAIN_DEALS x venues -> WhatsOnRow[] (B1 contract shape,
// confidence:"listed" — a first-party listing of the chain's own program, not
// a per-venue confirmation that THIS pub runs THIS exact deal every week; the
// source's own "may vary per pub" caveat is carried in `detail`). A venue
// missing a slug/name is dropped; a deal whose weekly slot cannot be resolved
// is dropped (never guessed).
//
// CHAIN-AGNOSTIC BY PARAMETER, Wetherspoon by default. The Firecrawl harvest
// (scripts/harvest/run.mjs) feeds this same builder deal days it read off a
// chain's own offers page, so `idPrefix` and `source` let another chain's rows
// carry that chain's identity, and a deal may state its own `cadenceLabel`
// ("Monday to Friday") where a hand-seeded one only ever ran on one day.
// Every default reproduces the existing Wetherspoon output exactly.
export function buildWetherspoonsDealRows({
  deals,
  venues,
  observedAt,
  venueIndex = null,
  idPrefix = "jdw",
  source = WETHERSPOONS_FOOD_DRINK_SOURCE,
}) {
  const rows = [];
  for (const deal of deals ?? []) {
    const startsAt = nextWeeklyOccurrence(deal.dayName, deal.startTime, observedAt);
    if (!startsAt) continue;
    const dateStr = startsAt.slice(0, 10);
    const endsAt = londonWallClockToIso(dateStr, deal.endTime);
    const cadence = deal.cadenceLabel ?? `every ${deal.dayName}`;

    for (const venue of venues ?? []) {
      const slug = venue?.slug;
      const name = venue?.name;
      if (typeof slug !== "string" || slug.length === 0) continue;
      if (typeof name !== "string" || name.length === 0) continue;

      const row = {
        id: `deal-${idPrefix}-${deal.id}-${slug}`,
        placeName: name,
        kind: "deal",
        startsAt,
        title: `${deal.title} — ${cadence}`,
        detail: `${deal.terms} Price, dishes and participation may vary per pub — see venue for details.`,
        source: { ...source },
        observedAt,
        confidence: "listed",
      };
      if (endsAt) row.endsAt = endsAt;
      const lat = coordOf(venue.latitude);
      const lng = coordOf(venue.longitude);
      if (lat !== null) row.lat = lat;
      if (lng !== null) row.lng = lng;
      if (venueIndex) {
        const resolved = resolveVenueId(
          { name, address: venue.fullAddress, postcode: venue.postcode, lat, lng },
          venueIndex,
        );
        if (resolved) row.venueId = resolved;
      }
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

// ---------------------------------------------------------------------------
// main: read public/data/wetherspoons/pubs.json, write
// public/data/whats_on/deals_london.json
// ---------------------------------------------------------------------------

function main() {
  const observedAt = new Date().toISOString();
  const wetherspoons = JSON.parse(readFileSync(WETHERSPOONS_PATH, "utf8"));
  const allPubs = Array.isArray(wetherspoons?.pubs) ? wetherspoons.pubs : [];
  const londonPubs = filterGreaterLondonWetherspoons(allPubs);

  const venueIndex = loadCanonicalVenueIndex();
  const rows = buildWetherspoonsDealRows({
    deals: WETHERSPOONS_DEALS,
    venues: londonPubs,
    observedAt,
    venueIndex,
  });

  if (rows.length > 2000) {
    console.warn(
      `WARNING: ${rows.length} rows exceeds the 2000 soft cap for a single what's-on file — ` +
        "flag this in the PR before merging.",
    );
  }

  const payload = {
    generatedAt: observedAt,
    kind: "deal",
    region: "greater-london",
    sources: [
      {
        ...WETHERSPOONS_FOOD_DRINK_SOURCE,
        firstParty: true,
        chainPubsTotal: allPubs.length,
        chainPubsGreaterLondon: londonPubs.length,
        dealsPerVenue: WETHERSPOONS_DEALS.length,
        rowsEmitted: rows.length,
        notes:
          "Chain's own current club-days page (checked 2026-07-12): Small Plates " +
          "(Mon), Gourmet Burgers (Tue), Pizza Club (Wed), Curry Club (Thu), each " +
          "11:30-23:00. No Friday club is currently published (a legacy 'Fish " +
          "Friday' page now 404s) so none is emitted. Crossed against every " +
          "Wetherspoons pub whose postcode falls inside Greater London.",
      },
      {
        ...WETHERSPOONS_PRICING_SOURCE,
        firstParty: true,
        notes:
          "Source for the per-club prices quoted in each row's `detail`. The " +
          "article itself states prices are 'representative of most pubs' and " +
          "that 'price, dishes and participation may vary per pub' — carried " +
          "through honestly rather than asserted as this exact venue's price.",
      },
      {
        label: "Greene King",
        url: "https://www.greeneking.co.uk/pubs/",
        firstParty: true,
        rowsEmitted: 0,
        notes:
          "Investigated via the same first-party pub pages already scraped for " +
          "the sport vertical (data/greene_king/raw/*.menu.json) — no recurring " +
          "deal-day copy was found on any page (only generic menu-filter UI). " +
          "No rows emitted rather than guessing a program that was never " +
          "published; re-check on the next refresh.",
      },
    ],
    rows,
  };

  // Meta pretty-printed, rows one-per-line: reviewable diffs (mirrors
  // quizRefresh.mjs / sportFixtures.mjs).
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  const body = rows.length
    ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n`
    : `${meta},\n  "rows": []\n}\n`;

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, body);
  console.log(`wrote ${rows.length} deal rows -> ${OUT_PATH}`);
  console.log(
    `wetherspoons: ${allPubs.length} pubs total, ${londonPubs.length} in Greater London, ` +
      `${WETHERSPOONS_DEALS.length} deal days -> ${rows.length} rows`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
