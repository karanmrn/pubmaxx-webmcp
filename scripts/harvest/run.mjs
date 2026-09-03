#!/usr/bin/env node
// `npm run harvest:run` - the London harvest's durable pass.
//
// This is the half of the harvest that WRITES. The scheduled route runs the same
// fetchers and parsers and can only report, because a Vercel function's file
// system is read-only; here the output is committed files a human reviews in a
// diff, which is the pattern /api/cron/enrich-city-pubs already set.
//
// Three lanes, each independently switchable:
//   --deals   chain offers pages -> public/data/whats_on/deals_london.json
//   --events  venues' own what's-on pages -> public/data/whats_on/events_london.json
//   --facts   operator pages -> public/data/harvest/pub_facts_london.json
// No flag runs --deals alone, which is the cheap, high-yield lane. --all runs
// every lane. Every lane shares ONE request budget, so `--budget` is the whole
// run's ceiling however the lanes divide it.
//
// The run report always lands at data/harvest/last_run.json, whatever ran.
//
// FAIL CLOSED: without FIRECRAWL_API_KEY nothing is fetched and no file is
// written - the report says every source was skipped for `no-firecrawl-key`.
// A lane that fetched nothing NEVER overwrites its output file: a good file is
// worth more than a fresh empty one, exactly as eventsRefresh.mjs argues.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

import {
  createFirecrawlClient,
  createHarvestBudget,
  HARVEST_CLI_REQUEST_BUDGET,
} from "../../lib/harvest/firecrawl.ts";
import { parseChainDealDays } from "../../lib/harvest/chainDeals.ts";
import {
  countDrops,
  createHarvestReporter,
  harvestShortfallLines,
  summariseHarvestRun,
} from "../../lib/harvest/runReport.ts";
import { HARVEST_SOURCES, harvestSourcesOfKind, isHarvestableOperatorUrl } from "../../lib/harvest/sourcePolicy.ts";
import { createRobotsChecker } from "../../lib/harvest/robots.ts";
import { buildPubFacts, pickOperatorUrl } from "../../lib/harvest/pubFacts.ts";
import { findEventsPageUrl, parseVenueEventListings } from "../../lib/harvest/venueEvents.ts";
import {
  buildWetherspoonsDealRows,
  filterGreaterLondonWetherspoons,
  londonWallClockToIso,
} from "../whatson/dealsRefresh.mjs";
import { nextWeeklyOccurrence } from "../whatson/quizParsers.mjs";
import { loadCanonicalVenueIndex, resolveVenueId } from "../whatson/resolveVenueId.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
nextEnv.loadEnvConfig(ROOT);

const WETHERSPOONS_PATH = join(ROOT, "public", "data", "wetherspoons", "pubs.json");
const DATASET_PATH = join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const DEALS_OUT = join(ROOT, "public", "data", "whats_on", "deals_london.json");
const EVENTS_OUT = join(ROOT, "public", "data", "whats_on", "events_london.json");
const FACTS_OUT = join(ROOT, "public", "data", "harvest", "pub_facts_london.json");
const REPORT_OUT = join(ROOT, "data", "harvest", "last_run.json");

// Every source page is read once per run, so a host's declared Crawl-delay never
// binds - except in the events lane, which follows a venue's own link to a
// second page on the same host. This is the pause between those two.
const SAME_HOST_PAUSE_MS = 10_000;

// The facts lane sends a search plus a scrape per venue, back to back, dozens of
// times. Pace it: the first harvest lost twenty lookups to rate limiting that
// retries alone did not outlast.
const FACTS_VENUE_PACE_MS = 1_500;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = new Set(argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.split("=")[0]));
  const valueOf = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) return Number(argv[index + 1]);
    const inline = argv.find((a) => a.startsWith(`--${name}=`));
    if (inline) return Number(inline.split("=")[1]);
    return fallback;
  };
  const all = flags.has("--all");
  const anyLane = all || flags.has("--deals") || flags.has("--events") || flags.has("--facts");
  return {
    deals: all || flags.has("--deals") || !anyLane,
    events: all || flags.has("--events"),
    facts: all || flags.has("--facts"),
    dryRun: flags.has("--dry-run"),
    budget: valueOf("budget", HARVEST_CLI_REQUEST_BUDGET),
    venueLimit: valueOf("venue-limit", 12),
    fresh: flags.has("--fresh"),
  };
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

// Meta pretty-printed, rows one-per-line: reviewable diffs (the shape every
// other whats_on generator writes).
function serialiseWhatsOnFile(payload) {
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = payload.rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  return payload.rows.length
    ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n`
    : `${meta},\n  "rows": []\n}\n`;
}

function write(path, body, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] would write ${path} (${body.length} bytes)`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  console.log(`  wrote ${path}`);
}

/** Pick the soonest occurrence among the days a deal states. */
function soonestDay(days, startTime, observedAt) {
  let best = null;
  for (const dayName of days) {
    const startsAt = nextWeeklyOccurrence(dayName, startTime, observedAt);
    if (!startsAt) continue;
    if (!best || startsAt < best.startsAt) best = { dayName, startsAt };
  }
  return best;
}

// ---------------------------------------------------------------------------
// lane 1: chain deals
// ---------------------------------------------------------------------------

async function harvestDeals({ client, reporter, observedAt, venueIndex, dryRun, fresh }) {
  const wetherspoons = readJson(WETHERSPOONS_PATH, {});
  const allPubs = Array.isArray(wetherspoons?.pubs) ? wetherspoons.pubs : [];
  const londonPubs = filterGreaterLondonWetherspoons(allPubs);

  const rows = [];
  const sources = [];

  for (const source of harvestSourcesOfKind("chain-deals")) {
    if (!source.access.allowed) {
      reporter.record({
        sourceId: source.id,
        label: source.label,
        url: source.url,
        kind: source.kind,
        firstParty: source.firstParty,
        status: "skipped",
        statedItems: 0,
        rowsEmitted: 0,
        drops: [],
        skipReason: source.access.reason,
        evidence: source.access.evidence,
      });
      sources.push({
        label: source.label,
        url: source.url,
        firstParty: source.firstParty,
        rowsEmitted: 0,
        notes: `Not harvested (${source.access.reason}). ${source.access.evidence}`,
      });
      continue;
    }
    if (!client) {
      reporter.record({
        sourceId: source.id,
        label: source.label,
        url: source.url,
        kind: source.kind,
        firstParty: source.firstParty,
        status: "skipped",
        statedItems: 0,
        rowsEmitted: 0,
        drops: [],
        skipReason: "no-firecrawl-key",
        evidence: "FIRECRAWL_API_KEY is not configured, so nothing was fetched.",
      });
      continue;
    }

    const outcome = await client.scrape(source.url, { maxAgeMs: fresh ? 0 : undefined });
    if (!outcome.ok) {
      const budgetGone = outcome.failure.reason === "budget-exhausted";
      reporter.record({
        sourceId: source.id,
        label: source.label,
        url: source.url,
        kind: source.kind,
        firstParty: source.firstParty,
        status: budgetGone ? "skipped" : "failed",
        statedItems: 0,
        rowsEmitted: 0,
        drops: [],
        ...(budgetGone
          ? { skipReason: "budget-exhausted", evidence: outcome.failure.detail }
          : {
              failure: {
                reason: outcome.failure.reason,
                detail: outcome.failure.detail,
                ...(outcome.failure.status !== undefined ? { status: outcome.failure.status } : {}),
              },
            }),
      });
      continue;
    }

    const parsed = parseChainDealDays(outcome.page.markdown);
    let emitted = 0;
    let venuesForChain = [];
    let idPrefix = source.id;
    if (source.id === "wetherspoon-food-drink") {
      venuesForChain = londonPubs;
      idPrefix = "jdw";
    }

    // A deal that names a SISTER BRAND may not be hung on this chain's pubs.
    // We hold no London venue list for those brands, so such a deal is read,
    // counted and left unattached rather than mis-attributed.
    const ownDeals = parsed.deals.filter((deal) => deal.brand === null);
    const brandedAway = parsed.deals.length - ownDeals.length;

    if (venuesForChain.length > 0 && ownDeals.length > 0) {
      const defs = [];
      for (const deal of ownDeals) {
        const soonest = soonestDay(deal.days, deal.startTime, observedAt);
        if (!soonest) continue;
        defs.push({
          id: deal.id,
          dayName: soonest.dayName,
          startTime: deal.startTime,
          endTime: deal.endTime,
          title: deal.title,
          terms: deal.detail ?? "See the chain's own page for the full terms.",
          cadenceLabel: deal.cadenceLabel,
        });
      }
      const built = buildWetherspoonsDealRows({
        deals: defs,
        venues: venuesForChain,
        observedAt,
        venueIndex,
        idPrefix,
        source: { label: source.label, url: source.url },
      });
      rows.push(...built);
      emitted = built.length;
    }

    const dropCounts = countDrops(parsed.drops.map((d) => d.reason));
    reporter.record({
      sourceId: source.id,
      label: source.label,
      url: source.url,
      kind: source.kind,
      firstParty: source.firstParty,
      status: parsed.deals.length > 0 ? "harvested" : "empty",
      statedItems: parsed.deals.length,
      rowsEmitted: emitted,
      drops: dropCounts,
      ...(parsed.deals.length === 0
        ? { evidence: "Page was read and stated no deal day with both a weekday and a window." }
        : {}),
    });

    const noteBits = [
      `Harvested ${observedAt.slice(0, 10)} from the chain's own page: ${parsed.deals.length} stated deal day(s), ${emitted} row(s).`,
    ];
    if (brandedAway > 0) {
      noteBits.push(
        `${brandedAway} deal day(s) name a sister brand rather than this chain, so they are recorded and not attached to any pub here.`,
      );
    }
    for (const drop of dropCounts) {
      noteBits.push(
        drop.reason === "no-stated-window"
          ? `${drop.count} offer(s) state a weekday but no hours, so no row: a deal is an interval and inventing one would be a guess.`
          : `${drop.count} offer(s) state hours but no weekday, so no row.`,
      );
    }
    // The hand-seeded table this replaced carried per-club prices quoted from a
    // separate news article. The offers page itself states none, so no row does
    // either: a price the source stopped publishing is a price we stopped
    // knowing, and repeating last year's figure would be the older, worse lie.
    if (ownDeals.length > 0 && !ownDeals.some((deal) => /£/.test(deal.detail ?? ""))) {
      noteBits.push("The page states no per-club price, so no row carries one.");
    }
    if (venuesForChain.length === 0 && parsed.deals.length > 0) {
      noteBits.push("No London venue list is held for this chain, so its stated deals are recorded here rather than emitted as rows.");
    }
    sources.push({
      label: source.label,
      url: source.url,
      firstParty: source.firstParty,
      ...(source.id === "wetherspoon-food-drink"
        ? { chainPubsTotal: allPubs.length, chainPubsGreaterLondon: londonPubs.length }
        : {}),
      statedDealDays: parsed.deals.length,
      rowsEmitted: emitted,
      notes: noteBits.join(" "),
    });
  }

  if (rows.length === 0) {
    console.log("  deals: no rows harvested - leaving deals_london.json untouched.");
    return { rows: 0 };
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));
  write(
    DEALS_OUT,
    serialiseWhatsOnFile({
      generatedAt: observedAt,
      kind: "deal",
      region: "greater-london",
      sources,
      rows,
    }),
    dryRun,
  );
  return { rows: rows.length };
}

// ---------------------------------------------------------------------------
// lane 2: events from venues' own what's-on pages
// ---------------------------------------------------------------------------

// Venues to ASK first, not venues to believe. The curated live-music and quiz
// flags say where a what's-on page is likeliest to exist; whether one exists,
// and what it says, still comes from the venue's own page.
function londonVenuesWithWebsites(limit) {
  const dataset = readJson(DATASET_PATH, []);
  const seen = new Map();
  for (const row of Array.isArray(dataset) ? dataset : []) {
    if (!row?.is_clean_canonical_app_row) continue;
    const website = typeof row.website === "string" ? row.website.trim() : "";
    if (website.length === 0) continue;
    const key = `${row.pub_name}|${row.address}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      name: row.pub_name,
      address: row.address,
      website,
      lat: typeof row.latitude === "number" ? row.latitude : null,
      lng: typeof row.longitude === "number" ? row.longitude : null,
      listingsLikely: Boolean(row.live_music) || Boolean(row.pub_quiz),
    });
  }
  return [...seen.values()]
    .sort((a, b) => Number(b.listingsLikely) - Number(a.listingsLikely))
    .slice(0, limit);
}

async function harvestEvents({ client, reporter, robots, observedAt, nowMs, venueIndex, dryRun, venueLimit, fresh }) {
  // Every refused aggregator still goes in the report, so "no events" reads as
  // a set of recorded decisions rather than as coverage nobody looked for.
  for (const source of harvestSourcesOfKind("venue-events")) {
    if (source.access.allowed) continue;
    reporter.record({
      sourceId: source.id,
      label: source.label,
      url: source.url,
      kind: source.kind,
      firstParty: source.firstParty,
      status: "skipped",
      statedItems: 0,
      rowsEmitted: 0,
      drops: [],
      skipReason: source.access.reason,
      evidence: source.access.evidence,
    });
  }
  if (!client) return { rows: 0 };

  const venues = londonVenuesWithWebsites(venueLimit);
  const rows = [];
  const drops = [];
  let venuesRead = 0;
  let venuesWithPage = 0;

  for (const venue of venues) {
    if (!isHarvestableOperatorUrl(venue.website)) {
      drops.push("host-refused-by-policy");
      continue;
    }
    const permitted = await robots(venue.website);
    if (!permitted.allowed) {
      drops.push(permitted.reason);
      continue;
    }
    // A site's what's-on link lives in its NAV, which onlyMainContent strips, so
    // the home page is read whole. The listings page itself is read main-content
    // only, where the listings are.
    const home = await client.scrape(venue.website, {
      maxAgeMs: fresh ? 0 : undefined,
      onlyMainContent: false,
    });
    if (!home.ok) {
      if (home.failure.reason === "budget-exhausted") break;
      drops.push("venue-site-unreadable");
      continue;
    }
    venuesRead += 1;
    const eventsUrl = findEventsPageUrl(home.page.markdown, venue.website);
    if (!eventsUrl) {
      drops.push("no-whats-on-page-published");
      continue;
    }

    const eventsPermitted = await robots(eventsUrl);
    if (!eventsPermitted.allowed) {
      drops.push(eventsPermitted.reason);
      continue;
    }
    // The only place this harvest sends a SECOND request to the same host in one
    // run. Pause between them so a small pub's site is never hit back to back.
    await new Promise((resolve) => setTimeout(resolve, SAME_HOST_PAUSE_MS));
    const page = await client.scrape(eventsUrl, { maxAgeMs: fresh ? 0 : undefined });
    if (!page.ok) {
      if (page.failure.reason === "budget-exhausted") break;
      drops.push("whats-on-page-unreadable");
      continue;
    }
    venuesWithPage += 1;

    const parsed = parseVenueEventListings(page.page.markdown, nowMs);
    for (const drop of parsed.drops) drops.push(drop.reason);

    for (const event of parsed.events) {
      const dateStr = `${event.date.year}-${String(event.date.month).padStart(2, "0")}-${String(event.date.day).padStart(2, "0")}`;
      const startsAt = londonWallClockToIso(dateStr, event.startClock);
      if (!startsAt) continue;
      const row = {
        id: `events-venue-${slugId(`${venue.name}|${event.title}|${startsAt}`)}`,
        placeName: venue.name,
        kind: event.kind,
        startsAt,
        title: event.title,
        source: { label: `${venue.name} - official site`, url: eventsUrl },
        observedAt,
        confidence: "listed",
      };
      if (event.detail) row.detail = event.detail;
      if (venue.lat !== null) row.lat = venue.lat;
      if (venue.lng !== null) row.lng = venue.lng;
      const resolved = venueIndex
        ? resolveVenueId(
            { name: venue.name, address: venue.address, postcode: postcodeOf(venue.address), lat: venue.lat, lng: venue.lng },
            venueIndex,
          )
        : null;
      if (resolved) row.venueId = resolved;
      rows.push(row);
    }
  }

  reporter.record({
    sourceId: "venue-own-pages",
    label: "Venues' own what's-on pages",
    url: "https://www.pubmaxxing.com/",
    kind: "venue-events",
    firstParty: true,
    status: rows.length > 0 ? "harvested" : "empty",
    statedItems: rows.length,
    rowsEmitted: rows.length,
    drops: countDrops(drops),
    ...(rows.length === 0
      ? {
          evidence: `Read ${venuesRead} venue site(s); ${venuesWithPage} published a what's-on page, and none of those listings stated a kind, a date and a time together.`,
        }
      : {}),
  });

  if (rows.length === 0) {
    console.log("  events: no rows harvested - leaving events_london.json untouched.");
    return { rows: 0 };
  }

  rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const existing = readJson(EVENTS_OUT, { sources: [] });
  write(
    EVENTS_OUT,
    serialiseWhatsOnFile({
      generatedAt: observedAt,
      kind: "events",
      region: "greater-london",
      sources: [
        ...(Array.isArray(existing.sources) ? existing.sources : []),
        {
          label: "Venues' own what's-on pages",
          url: "https://www.pubmaxxing.com/",
          firstParty: true,
          rowsEmitted: rows.length,
          notes:
            `Harvested ${observedAt.slice(0, 10)} from each venue's OWN site, reached by the link that site publishes. ` +
            "A listing becomes a row only when it states a kind we already have, a resolvable date and a start time; anything else is dropped and counted in data/harvest/last_run.json.",
        },
      ],
      rows,
    }),
    dryRun,
  );
  return { rows: rows.length };
}

function slugId(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function postcodeOf(address) {
  const match = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i.exec(String(address ?? ""));
  return match ? match[1].toUpperCase() : "";
}

// ---------------------------------------------------------------------------
// lane 3: pub facts for venues missing a website
// ---------------------------------------------------------------------------

function londonVenuesMissingWebsite(limit) {
  const dataset = readJson(DATASET_PATH, []);
  const seen = new Map();
  for (const row of Array.isArray(dataset) ? dataset : []) {
    if (!row?.is_clean_canonical_app_row) continue;
    const website = typeof row.website === "string" ? row.website.trim() : "";
    if (website.length > 0) continue;
    const key = `${row.pub_name}|${row.address}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      name: row.pub_name,
      address: row.address,
      lat: typeof row.latitude === "number" ? row.latitude : null,
      lng: typeof row.longitude === "number" ? row.longitude : null,
    });
  }
  return [...seen.values()].slice(0, limit);
}

async function harvestFacts({ client, reporter, robots, observedAt, venueIndex, dryRun, venueLimit, fresh }) {
  if (!client) {
    reporter.record({
      sourceId: "operator-pages",
      label: "Operator pages for venues missing a website",
      url: "https://www.pubmaxxing.com/",
      kind: "pub-facts",
      firstParty: true,
      status: "skipped",
      statedItems: 0,
      rowsEmitted: 0,
      drops: [],
      skipReason: "no-firecrawl-key",
      evidence: "FIRECRAWL_API_KEY is not configured, so nothing was fetched.",
    });
    return { rows: 0 };
  }

  const venues = londonVenuesMissingWebsite(venueLimit);
  const facts = [];
  const drops = [];
  let searched = 0;

  for (const venue of venues) {
    if (searched > 0) await new Promise((resolve) => setTimeout(resolve, FACTS_VENUE_PACE_MS));
    const found = await client.search(`${venue.name} ${venue.address} official website`, { limit: 5 });
    if (!found.ok) {
      if (found.failure.reason === "budget-exhausted") break;
      // Name the failure mode, so "the search step is broken" and "that pub is
      // genuinely not findable" stay two different findings.
      drops.push(`search-failed:${found.failure.reason}`);
      continue;
    }
    searched += 1;
    const operatorUrl = pickOperatorUrl(found.results, venue.name);
    if (!operatorUrl) {
      drops.push("no-operator-page");
      continue;
    }
    if (!isHarvestableOperatorUrl(operatorUrl)) {
      drops.push("host-refused-by-policy");
      continue;
    }
    const permitted = await robots(operatorUrl);
    if (!permitted.allowed) {
      drops.push(permitted.reason);
      continue;
    }

    // Hours live in a footer far more often than in the article body, and
    // onlyMainContent strips exactly that. This is the one lane that wants the
    // whole document.
    const page = await client.scrape(operatorUrl, {
      maxAgeMs: fresh ? 0 : undefined,
      onlyMainContent: false,
    });
    if (!page.ok) {
      if (page.failure.reason === "budget-exhausted") break;
      drops.push("operator-page-unreadable");
      continue;
    }

    const venueId = venueIndex
      ? resolveVenueId(
          { name: venue.name, address: venue.address, postcode: postcodeOf(venue.address), lat: venue.lat, lng: venue.lng },
          venueIndex,
        )
      : null;
    if (!venueId) {
      // Without a confident venue identity the facts cannot be attached to
      // anything, and attaching them to a guess is worse than not having them.
      drops.push("venue-unresolved");
      continue;
    }

    const record = buildPubFacts({
      venueId,
      placeName: venue.name,
      operatorUrl,
      markdown: page.page.markdown,
      hadWebsite: false,
      observedAt,
    });
    if (!record) {
      drops.push("page-stated-nothing");
      continue;
    }
    facts.push(record);
  }

  reporter.record({
    sourceId: "operator-pages",
    label: "Operator pages for venues missing a website",
    url: "https://www.pubmaxxing.com/",
    kind: "pub-facts",
    firstParty: true,
    status: facts.length > 0 ? "harvested" : "empty",
    statedItems: facts.length,
    rowsEmitted: facts.length,
    drops: countDrops(drops),
    ...(facts.length === 0
      ? { evidence: `Searched ${searched} venue(s); none produced an operator page stating a fact this harvest may take.` }
      : {}),
  });

  if (facts.length === 0) {
    console.log("  facts: nothing stated - leaving pub_facts_london.json untouched.");
    return { rows: 0 };
  }

  // Pub facts ACCUMULATE, unlike the deal and event files. Those are re-derived
  // whole every run and their rows are time-bound; a venue's website and hours
  // are not, and a venue this run could not reach must not lose what a previous
  // run read off its page. Merge on venueId, freshest observation wins.
  const existingFacts = readJson(FACTS_OUT, { venues: [] });
  const merged = new Map();
  for (const record of Array.isArray(existingFacts.venues) ? existingFacts.venues : []) {
    if (record?.venueId) merged.set(record.venueId, record);
  }
  let refreshed = 0;
  for (const record of facts) {
    const previous = merged.get(record.venueId);
    if (previous && Date.parse(previous.observedAt) > Date.parse(record.observedAt)) continue;
    if (previous) refreshed += 1;
    merged.set(record.venueId, record);
  }
  const allFacts = [...merged.values()].sort((a, b) => a.venueId.localeCompare(b.venueId));
  console.log(`  facts: ${facts.length} read this run (${refreshed} refreshed), ${allFacts.length} venues held.`);

  const payload = {
    version: 1,
    generatedAt: observedAt,
    region: "greater-london",
    notes:
      "Website and opening hours read off each venue's OWN page, and only where the page states them. " +
      "A day the page never mentions is absent rather than assumed; an explicitly closed day is an empty window list. " +
      "`statedDays` says how much of the week the page actually spoke about. " +
      "Records accumulate across runs and are replaced only by a fresher reading of the same venue.",
    venues: allFacts,
  };
  write(FACTS_OUT, `${JSON.stringify(payload, null, 2)}\n`, dryRun);
  return { rows: facts.length };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();
  const reporter = createHarvestReporter({ mode: "cli", startedAt: observedAt });

  const budget = createHarvestBudget(args.budget);
  const client = createFirecrawlClient({ budget });
  if (!client) {
    console.warn(
      "harvest: FIRECRAWL_API_KEY is not set. Nothing will be fetched and no data file will be written. " +
        "Put the key in .env.local to run a real harvest.",
    );
  }

  const robots = createRobotsChecker();
  const venueIndex = loadCanonicalVenueIndex();
  console.log(`harvest: budget ${budget.limit} requests; lanes: ${[args.deals && "deals", args.events && "events", args.facts && "facts"].filter(Boolean).join(", ")}`);

  if (args.deals) {
    await harvestDeals({ client, reporter, observedAt, venueIndex, dryRun: args.dryRun, fresh: args.fresh });
  }
  if (args.events) {
    await harvestEvents({
      client,
      reporter,
      robots,
      observedAt,
      nowMs,
      venueIndex,
      dryRun: args.dryRun,
      venueLimit: args.venueLimit,
      fresh: args.fresh,
    });
  }
  if (args.facts) {
    await harvestFacts({
      client,
      reporter,
      robots,
      observedAt,
      venueIndex,
      dryRun: args.dryRun,
      venueLimit: args.venueLimit,
      fresh: args.fresh,
    });
  }

  // Sources the policy refuses that no lane above walked past still belong in
  // the report, so it maps the whole field rather than the part that was run.
  const recorded = new Set(reporter.outcomes().map((o) => o.sourceId));
  for (const source of HARVEST_SOURCES) {
    if (recorded.has(source.id) || source.access.allowed) continue;
    reporter.record({
      sourceId: source.id,
      label: source.label,
      url: source.url,
      kind: source.kind,
      firstParty: source.firstParty,
      status: "skipped",
      statedItems: 0,
      rowsEmitted: 0,
      drops: [],
      skipReason: source.access.reason,
      evidence: source.access.evidence,
    });
  }

  const report = reporter.finish({
    finishedAt: new Date().toISOString(),
    budget: { limit: budget.limit, spent: budget.spent(), remaining: budget.remaining() },
  });

  console.log(`\n${summariseHarvestRun(report)}`);
  for (const line of harvestShortfallLines(report)) console.log(`  ${line}`);
  write(REPORT_OUT, `${JSON.stringify(report, null, 2)}\n`, args.dryRun);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
