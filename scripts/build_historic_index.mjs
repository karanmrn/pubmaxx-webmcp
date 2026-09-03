// Build the HISTORIC PUBS index the "Historic Pubs" feature reads.
//
// This is a deterministic JOIN of two server-owned files:
//   • public/data/heritage_cache.json      — cited heritage facts, keyed by the
//     SAME normalised venue name the app keys by (normaliseVenueName in
//     lib/curation.ts = trim + lowercase + collapse-spaces).
//   • public/data/pint_prices_app_dataset.json — the canonical venue rows, from
//     which we recover the stable "venue-…" id via venueGroupingKey +
//     stableVenueIdFromKey (the exact id the map + /api/venue/[id] link by).
//
// It writes public/data/historic_pubs.json: one record per heritage_cache entry.
//
// Provenance contract: we NEVER invent facts. `hook`/`facts` are copied verbatim
// from the cache. `era` and `listed` are EXTRACTED from the cited fact text by
// regex only — if the text doesn't say it, the field is null.
//
// Determinism: output is sorted (era ascending, nulls last, then name) and
// pretty-printed with a trailing newline, so running twice is byte-identical.
//
// Run once at build/refresh:  node scripts/build_historic_index.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CACHE_PATH = path.join(ROOT, "public", "data", "heritage_cache.json");
const DATASET_PATH = path.join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const ALIAS_PATH = path.join(ROOT, "public", "data", "venue_id_aliases.json");
const OUT_PATH = path.join(ROOT, "public", "data", "historic_pubs.json");

// --- venue id + name matching (mirror of scripts/lib/venueMatch.mjs) ---------
// Kept as a plain mirror so this generator has no TS import gymnastics; the
// logic is identical to venueGroupingKey / stableVenueIdFromKey / the
// normaliseVenueName the app uses to key heritage facts.

function normaliseVenueName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function venueGroupingKey(row) {
  return [
    normaliseVenueName(row.pub_name),
    normaliseVenueName(row.address),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join("|");
}

function stableVenueIdFromKey(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

// Index the dataset by normalised pub name → the FIRST-SEEN venue group's
// identity. Grouping mirrors groupVenuePrices / build_slim_index: rows share a
// venueGroupingKey, and the first row of a group supplies name/lat/lng/borough.
// When several distinct groups share a normalised name (e.g. two "The Grapes"),
// the first in dataset order wins — a stable, deterministic choice.
export function buildVenueNameIndex(dataset) {
  const seenGroups = new Set();
  const byName = new Map();
  for (const row of dataset) {
    const key = venueGroupingKey(row);
    if (seenGroups.has(key)) continue;
    seenGroups.add(key);
    const name = normaliseVenueName(row.pub_name);
    if (byName.has(name)) {
      // First group per normalised name wins (deterministic), but flag the
      // collision so a genuinely distinct second venue isn't silently dropped.
      console.warn(
        `buildVenueNameIndex: duplicate normalised venue name "${name}" — keeping first group, ignoring "${row.pub_name}"`,
      );
      continue;
    }
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    byName.set(name, {
      venueId: stableVenueIdFromKey(key),
      name: String(row.pub_name),
      borough: row.primary_borough ? String(row.primary_borough) : null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    });
  }
  return byName;
}

// Index the dataset by the stable venue id, so a heritage key whose name has
// drifted apart from the dataset spelling can still be joined by identity.
export function buildVenueIdIndex(dataset) {
  const byId = new Map();
  for (const row of dataset) {
    const venueId = stableVenueIdFromKey(venueGroupingKey(row));
    if (byId.has(venueId)) continue;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    byId.set(venueId, {
      venueId,
      name: String(row.pub_name),
      borough: row.primary_borough ? String(row.primary_borough) : null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    });
  }
  return byId;
}

// Heritage keys whose venue the dataset no longer spells the same way, joined
// by IDENTITY instead. A venue that is renamed ("The George Inn" is listed as
// "George (Southwark)") or merged into another lineage drops out of the name
// index, and the record silently loses its map link, its borough and its
// coordinates. Each entry names the CANONICAL venue id, which is then resolved
// through public/data/venue_id_aliases.json and looked up in the dataset, so a
// later merge follows rather than breaking, and an id the dataset no longer
// holds joins nothing rather than printing a link that leads nowhere. The
// record keeps its heritage NAME: the dataset spelling is what drifted, so
// adopting it would rename the pub and move its page.
export const VENUE_ID_BY_CACHE_KEY = {
  "the george inn": "venue-16ze6b1",
  "owl and pussycat": "venue-t3ii33",
};

export function resolveVenueAlias(venueId, aliases) {
  let current = venueId;
  const seen = new Set();
  while (aliases && typeof aliases[current] === "string" && !seen.has(current)) {
    seen.add(current);
    current = aliases[current];
  }
  return current;
}

// A curated join carries no name: the heritage key owns that.
function curatedVenueMatch(cacheKey, idIndex, aliases, curatedIds) {
  const curated = curatedIds[cacheKey];
  if (!curated) return null;
  const row = idIndex.get(resolveVenueAlias(curated, aliases));
  if (!row) return null;
  return { venueId: row.venueId, name: null, borough: row.borough, lat: row.lat, lng: row.lng };
}

// --- text helpers ------------------------------------------------------------

// Joining words stay lowercase inside a name, so a key with no dataset row
// still reads as a pub name rather than a headline ("Owl and Pussycat", never
// "Owl And Pussycat"). The first word is always capitalised.
const TITLE_CASE_SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
]);

export function titleCase(value) {
  return String(value ?? "")
    .split(" ")
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && TITLE_CASE_SMALL_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

// Extract the EARLIEST cited era from fact text. Two candidate forms:
//   • a 4-digit year 1400–1999          → sort value = the year
//   • an "Nth century" (space or hyphen) → sort value = (N-1)*100
// Returns { era, eraSort } where era is the display string (year digits, or a
// normalised "Nth century"), or { era: null, eraSort: null } if neither appears.
// Nothing is invented: a period is only emitted if the cited text states it.
export function extractEra(text) {
  const haystack = String(text ?? "");
  const candidates = [];

  for (const m of haystack.matchAll(/\b(1[4-9]\d{2})\b/g)) {
    const year = Number(m[1]);
    // type rank 0 (year) so a year beats a same-sort century on ties.
    candidates.push({ sort: year, rank: 0, era: String(year) });
  }
  for (const m of haystack.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)[\s-]+centur(?:y|ies)\b/gi)) {
    const n = Number(m[1]);
    if (n < 1) continue;
    candidates.push({ sort: (n - 1) * 100, rank: 1, era: `${n}${ordinalSuffix(n)} century` });
  }

  if (candidates.length === 0) return { era: null, eraSort: null };
  candidates.sort((a, b) => a.sort - b.sort || a.rank - b.rank || (a.era < b.era ? -1 : a.era > b.era ? 1 : 0));
  const best = candidates[0];
  return { era: best.era, eraSort: best.sort };
}

// Extract an English Heritage listing grade from cited fact text: I, II* or II.
// NOTE ON THE REGEX: the alternation is ordered longest-first (II* before II
// before I) so a Grade II* pub captures the star rather than backtracking to a
// bare "II" — provenance-honesty is a hard rule, and a Grade II* pub is
// materially rarer/older than a Grade II one. The trailing (?![I\w]) rejects a
// following I or word char, so a stray "Grade III" (not a real English Heritage
// grade) matches nothing rather than being mis-read as "II" or "I".
export function extractListed(text) {
  const m = String(text ?? "").match(/Grade\s+(II\*|II|I)(?![I\w])/);
  return m ? m[1] : null;
}

// The single headline fact: prefer a wikipedia-source fact, else the first fact.
export function pickHook(facts) {
  const wiki = facts.find((f) => f && f.source === "wikipedia" && typeof f.fact === "string");
  const chosen = wiki ?? facts.find((f) => f && typeof f.fact === "string");
  return chosen ? String(chosen.fact).trim() : "";
}

// Normalise a raw cache fact to exactly {source, fact, sourceRef?}.
function normaliseFact(fact) {
  // Trim the cited text so downstream era/listed extraction and the citation
  // hook match operate on the same clean string the UI renders — otherwise
  // leading/trailing whitespace can skew the hook and text-scan matches.
  const out = { source: fact.source, fact: String(fact.fact).trim() };
  if (fact.sourceRef != null && fact.sourceRef !== "") out.sourceRef = fact.sourceRef;
  return out;
}

// Curated venue status for historic pubs (captain audit lane E). Keyed by the
// same normalised cache key heritage_cache uses — never guessed at render time.
const VENUE_STATUS_BY_CACHE_KEY = {
  "the colony room": "closed",
  "the black cap": "closed",
  "the sir george robey": "demolished",
};

// Pure builder: heritage cache (object keyed by normalised name) + dataset rows
// → sorted, slugged HistoricPub records. Deterministic and side-effect free.
export function buildHistoricIndex({
  heritageCache,
  dataset,
  venueAliases = {},
  venueIdsByCacheKey = VENUE_ID_BY_CACHE_KEY,
}) {
  const venueIndex = buildVenueNameIndex(dataset);
  const venueIdIndex = buildVenueIdIndex(dataset);

  const records = [];
  // Iterate cache keys in sorted order so the pre-slug build order is stable
  // (slugs are assigned after the final sort, but sorting the input first keeps
  // the whole pipeline order-independent of JS object insertion order).
  for (const cacheKey of Object.keys(heritageCache).sort()) {
    const rawFacts = heritageCache[cacheKey];
    if (!Array.isArray(rawFacts) || rawFacts.length === 0) continue;
    const facts = rawFacts
      .filter((f) => f && typeof f.fact === "string" && f.fact.trim())
      .map(normaliseFact);
    if (facts.length === 0) continue;

    const match =
      venueIndex.get(cacheKey) ??
      curatedVenueMatch(cacheKey, venueIdIndex, venueAliases, venueIdsByCacheKey);
    const name = match && match.name ? match.name : titleCase(cacheKey);

    // era/listed are scanned across ALL fact text for this venue.
    const allText = facts.map((f) => f.fact).join("  ");
    const { era, eraSort } = extractEra(allText);
    const listed = extractListed(allText);

    records.push({
      venueId: match ? match.venueId : null,
      name,
      borough: match ? match.borough : null,
      lat: match ? match.lat : null,
      lng: match ? match.lng : null,
      hook: pickHook(facts),
      facts,
      era,
      listed,
      sourced: true,
      venueStatus: VENUE_STATUS_BY_CACHE_KEY[cacheKey] ?? null,
      _eraSort: eraSort, // private sort key, stripped before emit
    });
  }

  // Sort: era ascending (earliest first), records with no era last, then name.
  records.sort((a, b) => {
    const aNull = a._eraSort == null;
    const bNull = b._eraSort == null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && a._eraSort !== b._eraSort) return a._eraSort - b._eraSort;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  // Assign slugs in final (sorted) order so collisions resolve deterministically.
  const usedSlugs = new Map();
  return records.map((rec) => {
    const base = slugify(rec.name) || "pub";
    const count = usedSlugs.get(base) ?? 0;
    usedSlugs.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count + 1}`;
    const { _eraSort, ...rest } = rec;
    // Emit keys in the documented schema order.
    return {
      venueId: rest.venueId,
      name: rest.name,
      slug,
      borough: rest.borough,
      lat: rest.lat,
      lng: rest.lng,
      hook: rest.hook,
      facts: rest.facts,
      era: rest.era,
      listed: rest.listed,
      sourced: rest.sourced,
      ...(rest.venueStatus ? { venueStatus: rest.venueStatus } : {}),
    };
  });
}

// --- io ----------------------------------------------------------------------

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

// The alias file is a courtesy input: a run without it still joins by name.
async function readVenueAliases(aliasPath) {
  try {
    const parsed = await readJson(aliasPath);
    const aliases = parsed && typeof parsed === "object" ? parsed.aliases : null;
    return aliases && typeof aliases === "object" ? aliases : {};
  } catch {
    return {};
  }
}

export async function generate({
  cachePath = CACHE_PATH,
  datasetPath = DATASET_PATH,
  aliasPath = ALIAS_PATH,
  outPath = OUT_PATH,
} = {}) {
  const heritageCache = await readJson(cachePath);
  const dataset = await readJson(datasetPath);
  const venueAliases = await readVenueAliases(aliasPath);
  const records = buildHistoricIndex({ heritageCache, dataset, venueAliases });
  // Pretty-printed + trailing newline for a clean, diff-friendly, stable file.
  await writeFile(outPath, `${JSON.stringify(records, null, 2)}\n`);

  const matched = records.filter((r) => r.venueId != null).length;
  const withEra = records.filter((r) => r.era != null).length;
  const withListed = records.filter((r) => r.listed != null).length;
  return { records, total: records.length, matched, withEra, withListed, outPath };
}

async function main() {
  const summary = await generate();
  console.log(`historic pubs: ${summary.total} records`);
  console.log(`  matched to a venue id: ${summary.matched}`);
  console.log(`  with an extracted era: ${summary.withEra}`);
  console.log(`  with a listing grade:  ${summary.withListed}`);
  console.log(`wrote: ${path.relative(ROOT, summary.outPath)}`);
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
