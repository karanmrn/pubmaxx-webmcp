#!/usr/bin/env node
/**
 * Integrate Wikipedia "List of pubs in London" into the canonical dataset,
 * heritage cache, and (optionally) Supabase pub_heritage.
 *
 * Usage:
 *   node scripts/integrate_wikipedia_london_pubs.mjs
 *   node scripts/integrate_wikipedia_london_pubs.mjs --limit 50 --dry-run
 *   node scripts/integrate_wikipedia_london_pubs.mjs --heritage-only
 *
 * After a full merge, run: npm run build:slim
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { boroughForPoint, loadBoroughIndex } from "./lib/boroughFromPoint.mjs";
import { haversineMeters } from "./lib/geo.mjs";
import {
  buildVenueIndexes,
  normalisePubName,
  resolveVenueKeyFromPubName,
  venueGroupingKey,
} from "./lib/venueMatch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = join(ROOT, "data/wikipedia_london_pubs.json");
const APP_PATH = join(ROOT, "public/data/pint_prices_app_dataset.json");
const CACHE_PATH = join(ROOT, "public/data/heritage_cache.json");
const GENERATED_DIR = join(ROOT, "data/generated");
const FETCH_CACHE_PATH = join(GENERATED_DIR, "wikipedia_fetch_cache.json");
const REPORT_PATH = join(GENERATED_DIR, "wikipedia_integration_report.json");

const LAT_MIN = 51.26;
const LAT_MAX = 51.72;
const LON_MIN = -0.55;
const LON_MAX = 0.3;
const MATCH_RADIUS_M = 350;

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const heritageOnly = argv.includes("--heritage-only");
  const skipFetch = argv.includes("--skip-fetch");
  const limitIdx = argv.indexOf("--limit");
  const limit =
    limitIdx === -1
      ? null
      : Number.parseInt(argv[limitIdx + 1], 10) > 0
        ? Number.parseInt(argv[limitIdx + 1], 10)
        : null;
  return { dryRun, heritageOnly, skipFetch, limit };
}

function normaliseVenueName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function inLondon(lat, lng) {
  return LAT_MIN <= lat && lat <= LAT_MAX && LON_MIN <= lng && lng <= LON_MAX;
}

function wikiTitleFromUrl(url) {
  const slug = decodeURIComponent(String(url).split("/wiki/")[1] ?? "").split("#")[0];
  return slug.replace(/_/g, " ").trim();
}

function dedupeByUrl(pubs) {
  const byUrl = new Map();
  for (const pub of pubs) {
    const url = String(pub.url ?? "").trim();
    if (!url) continue;
    const existing = byUrl.get(url);
    if (!existing) {
      byUrl.set(url, pub);
      continue;
    }
    const preferTable =
      pub.sources?.includes("table") && !existing.sources?.includes("table");
    const preferLonger = String(pub.name).length > String(existing.name).length;
    if (preferTable || (!existing.sources?.includes("table") && preferLonger)) {
      byUrl.set(url, {
        ...pub,
        sources: [...new Set([...(existing.sources ?? []), ...(pub.sources ?? [])])],
      });
    } else {
      existing.sources = [...new Set([...(existing.sources ?? []), ...(pub.sources ?? [])])];
    }
  }
  return [...byUrl.values()];
}

function loadJson(path, fallback) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    // File-missing is expected on a first run: fall back to the seed value.
    if (err?.code === "ENOENT") return fallback;
    // Any other read error (permissions, IO) must fail loudly rather than
    // silently rebuilding over an unreadable-but-present dataset.
    throw new Error(`Failed to read ${path}: ${err?.message ?? err}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    // A corrupt/partial existing dataset must not be silently overwritten.
    throw new Error(`Failed to parse ${path} as JSON: ${err?.message ?? err}`);
  }
}

function venueKey(name, lat, lng) {
  return `${normaliseVenueName(name)}|${Number(lat).toFixed(4)}|${Number(lng).toFixed(4)}`;
}

function nextAppPriceId(existing) {
  let max = 0;
  for (const row of existing) {
    const m = String(row.app_price_id ?? "").match(/app_price_(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

const FETCH_TIMEOUT_MS = 30000;

// The abort timer must stay armed until the RESPONSE BODY is consumed, not just
// until headers arrive — otherwise res.json()/res.text() can hang indefinitely
// past the timeout. Callers that read the body pass a `consume(res)` callback so
// the read happens inside the timeout window; the timer only clears once it
// resolves.
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS, consume) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return consume ? await consume(res) : res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await fetchWithTimeout(
      url,
      {
        headers: {
          "user-agent": "pubmax-wikipedia-integrate/0.1 (contact: demo@pubmax.local)",
        },
      },
      FETCH_TIMEOUT_MS,
      async (res) => {
        if (res.status === 429 && attempt < retries) return { retry: true };
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { data: await res.json() };
      },
    );
    if (result.retry) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    return result.data;
  }
  throw new Error("HTTP 429");
}

async function loadWikipediaSummaries(urls, fetchCache, skipFetch) {
  const pending = urls.filter((url) => {
    if (skipFetch) return false;
    const cached = fetchCache[url];
    return !cached || cached.error;
  });

  for (let i = 0; i < pending.length; i += 80) {
    const batchUrls = pending.slice(i, i + 80);
    const values = batchUrls
      .map((url) => `<${url.replace(/ /g, "_")}>`)
      .join(" ");
    const query = `SELECT ?wiki ?itemLabel ?lat ?lon ?desc WHERE {
      VALUES ?wiki { ${values} }
      ?wiki schema:about ?item .
      OPTIONAL {
        ?item wdt:P625 ?coord .
        BIND(geof:latitude(?coord) AS ?lat)
        BIND(geof:longitude(?coord) AS ?lon)
      }
      OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;

    try {
      const data = await fetchJson(
        `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`,
      );
      const byWiki = new Map();
      for (const row of data?.results?.bindings ?? []) {
        const wiki = row.wiki?.value;
        if (!wiki) continue;
        byWiki.set(wiki, row);
      }

      for (const url of batchUrls) {
        const row = byWiki.get(url);
        if (!row) {
          fetchCache[url] = { error: true, pageUrl: url, title: wikiTitleFromUrl(url) };
          continue;
        }
        const title = row.itemLabel?.value ?? wikiTitleFromUrl(url);
        const desc = row.desc?.value ?? "";
        fetchCache[url] = {
          title,
          extract: desc,
          pageUrl: url,
          lat: row.lat?.value ? Number(row.lat.value) : null,
          lng: row.lon?.value ? Number(row.lon.value) : null,
          type: desc ? "standard" : "no-extract",
          source: "wikidata",
        };
      }
    } catch (err) {
      for (const url of batchUrls) {
        fetchCache[url] = {
          error: true,
          pageUrl: url,
          title: wikiTitleFromUrl(url),
          message: String(err?.message ?? err),
        };
      }
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  return fetchCache;
}

function getWikipediaSummary(url, fetchCache) {
  return fetchCache[url] ?? null;
}

export function resolveMatch(pub, summary, indexes) {
  if (summary?.lat == null || summary?.lng == null) return null;

  const candidates = new Map();
  for (const name of [pub.name, summary?.title, wikiTitleFromUrl(pub.url)]) {
    if (!name) continue;
    const norm = normalisePubName(name);
    const exact = indexes.nameToKeys.get(norm);
    if (exact?.length === 1) {
      candidates.set(exact[0], "exact_name");
    }
    const key = resolveVenueKeyFromPubName(name, indexes);
    if (key) candidates.set(key, "fuzzy_name");
  }

  if (candidates.size === 0) return null;

  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const key of candidates.keys()) {
    const row = indexes.rowsByKey.get(key);
    if (!row) continue;
    const dist = haversineMeters(summary.lat, summary.lng, row.latitude, row.longitude);
    if (dist < bestDist) {
      bestDist = dist;
      best = key;
    }
  }

  if (!best || bestDist > MATCH_RADIUS_M) return null;
  return best;
}

function firstSentence(text) {
  if (!text) return "";
  return String(text).split(/(?<=\.)\s/)[0]?.trim() ?? String(text).trim();
}

async function writeSupabase(norm, facts) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || facts.length === 0) return;
  try {
    const failure = await fetchWithTimeout(
      `${base.replace(/\/$/, "")}/rest/v1/pub_heritage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: key,
          authorization: `Bearer ${key}`,
          prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(
          facts.map((f) => ({
            venue_key: norm,
            source: f.source,
            fact: f.fact,
            source_ref: f.sourceRef ?? null,
          })),
        ),
      },
      FETCH_TIMEOUT_MS,
      async (res) => {
        // Read the error body inside the timeout window so a slow/hung body
        // can't outlive the abort timer.
        if (res.ok) return null;
        return { status: res.status, detail: await res.text().catch(() => "") };
      },
    );
    if (failure) {
      console.warn(
        `writeSupabase: pub_heritage upsert for "${norm}" failed: HTTP ${failure.status}${failure.detail ? ` — ${failure.detail.slice(0, 200)}` : ""}`,
      );
    }
  } catch (err) {
    // Best-effort persistence, but surface the failure so a broken/timed-out
    // Supabase write is visible rather than silently dropped.
    console.warn(
      `writeSupabase: pub_heritage upsert for "${norm}" errored: ${err?.message ?? err}`,
    );
  }
}

function makeDatasetRow({ name, lat, lng, borough, description, wikipediaUrl, seq }) {
  const key = venueKey(name, lat, lng);
  return {
    app_price_id: `app_price_${String(seq).padStart(6, "0")}`,
    pub_name: name,
    pint_name: "",
    price_gbp: null,
    price_text: "",
    address: `${borough}, Greater London`,
    latitude: lat,
    longitude: lng,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: borough,
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    pub_key: createHash("sha1").update(key).digest("hex").slice(0, 12),
    pint_position_for_pub: "1",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: description || "",
    comment: `Wikipedia: ${wikipediaUrl}`,
    food: "",
    cocktails: "",
    beer_garden: "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    locality: borough,
    source_datasets: "wikipedia_london_list",
    source_row_count: 1,
    visible_borough_source_row_count: 0,
    raw_embedded_source_row_count: 0,
    individual_pub_page_source_row_count: 0,
    has_visible_borough_row: false,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: false,
    data_quality_notes: "wikipedia_london_list|no_price|geocoded",
    scraped_at_values: "",
  };
}

async function main() {
  const { dryRun, heritageOnly, skipFetch, limit } = parseArgs(process.argv.slice(2));
  const seed = loadJson(SEED_PATH, null);
  if (!seed?.pubs?.length) throw new Error(`Missing seed at ${SEED_PATH}`);

  const pubs = dedupeByUrl(seed.pubs);
  const targets = limit ? pubs.slice(0, limit) : pubs;
  const app = loadJson(APP_PATH, []);
  if (!Array.isArray(app)) throw new Error("app dataset must be an array");

  const heritageCache = loadJson(CACHE_PATH, {});
  const fetchCache = loadJson(FETCH_CACHE_PATH, {});
  const indexes = buildVenueIndexes(app);
  const boroughIndex = loadBoroughIndex();

  const existingKeys = new Set(
    app.map((row) => venueKey(row.pub_name, row.latitude, row.longitude)),
  );

  let seq = nextAppPriceId(app);
  const report = {
    source: seed.source,
    processed: 0,
    matched: 0,
    heritageAdded: 0,
    venuesAdded: 0,
    skippedNoCoords: 0,
    skippedOutOfLondon: 0,
    skippedDuplicate: 0,
    skippedNoExtract: 0,
    errors: 0,
    matches: [],
    additions: [],
    unmatched: [],
  };

  console.log(`Processing ${targets.length} Wikipedia pubs (${pubs.length} unique URLs)…`);
  await loadWikipediaSummaries(
    targets.map((pub) => pub.url),
    fetchCache,
    skipFetch,
  );

  for (const pub of targets) {
    report.processed += 1;
    try {
      const summary = getWikipediaSummary(pub.url, fetchCache);
      if (!summary || summary.error) {
        report.errors += 1;
        continue;
      }

      const extract = firstSentence(summary.extract);
      if (!extract || summary.type === "disambiguation") {
        report.skippedNoExtract += 1;
        continue;
      }

      const matchKey = resolveMatch(pub, summary, indexes);
      if (matchKey) {
        const row = indexes.rowsByKey.get(matchKey);
        const norm = normaliseVenueName(row.pub_name);
        const fact = {
          source: summary.source === "wikidata" ? "wikidata" : "wikipedia",
          fact: extract,
          sourceRef: summary.pageUrl || pub.url,
        };
        const existing = heritageCache[norm] ?? [];
        if (!existing.some((f) => f.fact === fact.fact)) {
          heritageCache[norm] = [...existing, fact];
          report.heritageAdded += 1;
          if (!dryRun) await writeSupabase(norm, [fact]);
        }

        const wikiUrl = summary.pageUrl || pub.url;
        if (!String(row.source_datasets ?? "").includes("wikipedia_london_list")) {
          row.source_datasets = row.source_datasets
            ? `${row.source_datasets}|wikipedia_london_list`
            : "wikipedia_london_list";
        }
        if (!row.description?.trim()) row.description = extract;
        if (!row.comment?.includes("wikipedia.org")) {
          row.comment = row.comment
            ? `${row.comment} | Wikipedia: ${wikiUrl}`
            : `Wikipedia: ${wikiUrl}`;
        }

        report.matched += 1;
        report.matches.push({
          wikipediaName: pub.name,
          venueName: row.pub_name,
          venueKey: matchKey,
          url: pub.url,
        });
        continue;
      }

      if (heritageOnly) {
        report.unmatched.push({ name: pub.name, url: pub.url, reason: "no_dataset_match" });
        continue;
      }

      const lat = summary.lat;
      const lng = summary.lng;
      if (lat == null || lng == null) {
        report.skippedNoCoords += 1;
        report.unmatched.push({ name: pub.name, url: pub.url, reason: "no_coordinates" });
        continue;
      }
      if (!inLondon(lat, lng)) {
        report.skippedOutOfLondon += 1;
        report.unmatched.push({ name: pub.name, url: pub.url, reason: "out_of_london" });
        continue;
      }

      const borough = boroughForPoint(lat, lng, boroughIndex) || "London";
      const displayName = summary.title || pub.name;
      const key = venueKey(displayName, lat, lng);
      if (existingKeys.has(key)) {
        report.skippedDuplicate += 1;
        continue;
      }

      seq += 1;
      existingKeys.add(key);
      const row = makeDatasetRow({
        name: displayName,
        lat,
        lng,
        borough,
        description: extract,
        wikipediaUrl: summary.pageUrl || pub.url,
        seq,
      });
      app.push(row);
      indexes.rowsByKey.set(venueGroupingKey(row), row);
      const normName = normalisePubName(displayName);
      const nameList = indexes.nameToKeys.get(normName) ?? [];
      nameList.push(venueGroupingKey(row));
      indexes.nameToKeys.set(normName, nameList);

      const norm = normaliseVenueName(displayName);
      heritageCache[norm] = [
        ...(heritageCache[norm] ?? []),
        {
          source: summary.source === "wikidata" ? "wikidata" : "wikipedia",
          fact: extract,
          sourceRef: summary.pageUrl || pub.url,
        },
      ];

      report.venuesAdded += 1;
      report.additions.push({
        name: displayName,
        borough,
        lat,
        lng,
        url: pub.url,
      });
    } catch (err) {
      report.errors += 1;
      report.unmatched.push({
        name: pub.name,
        url: pub.url,
        reason: String(err?.message ?? err),
      });
    }
  }

  mkdirSync(GENERATED_DIR, { recursive: true });
  if (!dryRun) {
    writeFileSync(APP_PATH, `${JSON.stringify(app)}\n`, "utf8");
    writeFileSync(CACHE_PATH, `${JSON.stringify(heritageCache, null, 2)}\n`, "utf8");
    writeFileSync(FETCH_CACHE_PATH, `${JSON.stringify(fetchCache, null, 2)}\n`, "utf8");
  }
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("Done.");
  console.log(`  matched existing venues: ${report.matched}`);
  console.log(`  heritage facts added: ${report.heritageAdded}`);
  console.log(`  new venues merged: ${report.venuesAdded}`);
  console.log(`  unmatched (no coords): ${report.skippedNoCoords}`);
  console.log(`  report: ${REPORT_PATH}`);
  if (dryRun) console.log("  (dry-run — no files written except report)");
  else console.log("  Run: npm run build:slim");
}

export { inLondon, loadJson, venueKey };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("integrate_wikipedia_london_pubs failed:", err?.message ?? err);
    process.exit(1);
  });
}
