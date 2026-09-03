// Enrich the shipped heritage cache from keyless open data.
//
// Usage:
//   node scripts/enrich_heritage.mjs            # curated demo pubs
//   node scripts/enrich_heritage.mjs --limit 20 # first N deduped dataset venues
//
// Reads public/data/pint_prices_app_dataset.json, dedupes venues by name, and
// for each looks up Wikidata (P571 inception, P1435 heritage designation) via
// SPARQL and the Wikipedia REST summary. Any hits are MERGED into
// public/data/heritage_cache.json in the shape:
//   { [normalisedName]: { source, fact, sourceRef? }[] }
// Existing hand-written entries are preserved; we only add facts whose text
// isn't already present, so re-running is safe and non-destructive.
//
// All network is wrapped in try/catch — misses are skipped silently, which is
// honest: the hand-written cache is what ships. This script may never run here
// (network is often blocked); it exists to regenerate/extend the cache later.
//
// Optional Supabase: if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, new
// facts are also POSTed to a `pub_heritage` table (best-effort, failures
// swallowed). No supabase-js dependency — plain REST. ponytail: stubbed via the
// PostgREST endpoint; swap for the SDK if this grows real write logic.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET = join(ROOT, "public/data/pint_prices_app_dataset.json");
const CACHE = join(ROOT, "public/data/heritage_cache.json");

// Mirrors normaliseVenueName in lib/curation.ts: lowercase, single-spaced.
function normaliseVenueName(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// Curated demo set (the pubs "The Landlord" walks by default).
const DEMO_PUBS = [
  "prospect of whitby",
  "the grapes",
  "the dove",
  "the old pack horse",
  "the lamb",
  "the sun tavern",
  "the queens head",
  "the queens arms",
];

function parseLimit(argv) {
  const i = argv.indexOf("--limit");
  if (i === -1) return null;
  const n = Number.parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

// Deduped venue names from the dataset, in first-seen order.
function datasetVenueNames() {
  const rows = loadJson(DATASET, []);
  const seen = new Set();
  const names = [];
  for (const row of rows) {
    const raw = row && row.pub_name;
    if (!raw) continue;
    const norm = normaliseVenueName(raw);
    if (seen.has(norm)) continue;
    seen.add(norm);
    names.push({ norm, display: raw.trim() });
  }
  return names;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "pubmax-heritage-enrich/0.1 (demo)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Wikidata SPARQL: match a pub by label, pull inception + heritage designation.
async function queryWikidata(displayName) {
  const facts = [];
  const query = `SELECT ?item ?itemLabel ?inception ?desigLabel WHERE {
    ?item rdfs:label "${displayName.replace(/"/g, "")}"@en .
    ?item wdt:P31/wdt:P279* wd:Q178706 .
    OPTIONAL { ?item wdt:P571 ?inception . }
    OPTIONAL { ?item wdt:P1435 ?desig . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
  } LIMIT 1`;
  const url =
    "https://query.wikidata.org/sparql?format=json&query=" +
    encodeURIComponent(query);
  try {
    const data = await fetchJson(url);
    const b = data && data.results && data.results.bindings && data.results.bindings[0];
    if (!b) return facts;
    const ref = b.item && b.item.value;
    if (b.inception && b.inception.value) {
      const year = String(b.inception.value).slice(0, 4);
      facts.push({ source: "wikidata", fact: `Inception recorded as ${year} (Wikidata P571).`, sourceRef: ref });
    }
    if (b.desigLabel && b.desigLabel.value) {
      facts.push({ source: "wikidata", fact: `Heritage designation: ${b.desigLabel.value} (Wikidata P1435).`, sourceRef: ref });
    }
  } catch {
    // skip on failure — a miss is honest
  }
  return facts;
}

// Wikipedia REST summary: one short factual sentence if the page looks like a pub.
async function queryWikipedia(displayName) {
  const title = encodeURIComponent(displayName.replace(/\s+/g, "_"));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`;
  try {
    const data = await fetchJson(url);
    if (!data || data.type === "disambiguation" || !data.extract) return [];
    const extract = String(data.extract).split(/(?<=\.)\s/)[0];
    if (!/pub|tavern|inn|public house/i.test(data.extract)) return [];
    const ref =
      data.content_urls &&
      data.content_urls.desktop &&
      data.content_urls.desktop.page;
    return [{ source: "wikipedia", fact: extract, sourceRef: ref }];
  } catch {
    return [];
  }
}

// Best-effort Supabase write via PostgREST. No-op unless env is set.
async function writeSupabase(norm, facts) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || facts.length === 0) return;
  try {
    await fetch(`${base.replace(/\/$/, "")}/rest/v1/pub_heritage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(
        // venue_key = normaliseVenueName(name); matches the migration column and
        // the retrieval query in lib/heritage.ts. `norm` is already normalised.
        facts.map((f) => ({ venue_key: norm, source: f.source, fact: f.fact, source_ref: f.sourceRef ?? null })),
      ),
    });
  } catch {
    // best-effort only
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const limit = parseLimit(argv);

  let targets;
  if (limit) {
    targets = datasetVenueNames().slice(0, limit);
  } else {
    // Demo set: resolve display names from the dataset where possible.
    const byNorm = new Map(datasetVenueNames().map((v) => [v.norm, v.display]));
    targets = DEMO_PUBS.map((norm) => ({ norm, display: byNorm.get(norm) ?? norm }));
  }

  const cache = loadJson(CACHE, {});
  let added = 0;

  for (const { norm, display } of targets) {
    const existing = cache[norm] ?? [];
    const seenFacts = new Set(existing.map((f) => f.fact));
    const hits = [...(await queryWikidata(display)), ...(await queryWikipedia(display))];
    const fresh = hits.filter((f) => f.fact && !seenFacts.has(f.fact));
    if (fresh.length === 0) continue;
    cache[norm] = [...existing, ...fresh];
    added += fresh.length;
    await writeSupabase(norm, fresh);
    console.log(`+ ${norm}: ${fresh.length} fact(s)`);
  }

  writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n");
  console.log(`Done. Added ${added} fact(s) across ${targets.length} venue(s).`);
}

main().catch((err) => {
  console.error("enrich failed:", err && err.message);
  process.exit(1);
});
