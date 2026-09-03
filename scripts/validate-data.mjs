// Build-time data validation for the bundled datasets shipped in public/data.
//
// The app is deliberately keyless/offline and reads these JSON files directly,
// so a truncated or malformed dataset silently degrades the map instead of
// throwing. This script validates every bundled dataset with the SAME rules the
// app uses at runtime (mirroring lib/pois.ts isValidPoi) and exits non-zero on
// any error, so CI blocks a merge that would ship broken data.
//
// Plain Node ESM — no build step, no deps. Run: node scripts/validate-data.mjs

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateLateFoodEvidence } from "./lib/validateLateFoodEvidence.mjs";
import { canonicalObservationsPayload } from "../lib/pintIndexCanonical.mjs";
import { whatsOnRowProblems } from "../lib/whatsOnRowShape.mjs";
import {
  displayUkPlaceName,
  isPublishableUkPlaceName,
} from "../lib/ukPlaceName.mjs";
import {
  CORE_FILE,
  MANIFEST_FILE,
  SPATIAL_SHARD_VERSION,
  buildShardManifest,
  buildSpatialShardManifest,
  classifySlimShards,
  classifySpatialShards,
  spatialCellId,
  spatialCellIndex,
} from "./lib/slimShards.mjs";
import {
  POSTCODE_COORDINATE_MAX_DISTANCE_KM,
  findPostcodeCoordinateContradictions,
  parseUkPostcode,
  publishedQuarantineLeakValidationErrors,
  validatePostcodeCoordinateQuarantine,
} from "./lib/postcodeCoordinateConsistency.mjs";
import {
  nightOutPlaceRowValidationErrors,
} from "../lib/nightOutPlaceContract.mjs";
import { CITY_VENUE_PACKS } from "../lib/cityVenuePacks.mjs";
import { CITY_BOUNDS } from "../lib/cityBounds.mjs";
import { EDITORIAL_FEEDS, EDITORIAL_ITEM_KEYS } from "../lib/editorialRss.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const DATA_DIR = join(ROOT_DIR, "public", "data");
const GENERATED_DATA_DIR = join(ROOT_DIR, "data", "generated");
const FAMOUS_VENUES_DIR = join(ROOT_DIR, "data", "famous_venues");
const UK_OSM_PUBS_FILE = join(
  ROOT_DIR,
  "data",
  "osm",
  "uk",
  "uk_osm_pubs.json",
);
const POSTCODE_COORDINATE_EXCEPTIONS_FILE = join(
  ROOT_DIR,
  "data",
  "postcode_coordinate_exceptions.json",
);
const POSTCODE_COORDINATE_QUARANTINE_FILE = join(
  ROOT_DIR,
  "data",
  "postcode_coordinate_quarantine.json",
);
const POSTCODE_COORDINATE_CORRECTIONS_FILE = join(
  ROOT_DIR,
  "data",
  "postcode_coordinate_corrections.json",
);
const POSTCODE_COORDINATE_BUILD_REPORT_FILE = join(
  ROOT_DIR,
  "data",
  "postcode_coordinate_build_report.json",
);
const POSTCODE_COORDINATE_DECISION_INPUTS = [
  "data/pint_prices_canonical_enriched.csv",
  "data/borough_embedded_pint_prices.csv",
  "data/pub_page_pint_prices.csv",
  "data/osm/uk/uk_osm_pubs.json",
  "data/postcode_coordinate_corrections.json",
  "data/postcode_coordinate_quarantine.json",
  "data/postcode_coordinate_exceptions.json",
];
const DRINK_PRICE_UPDATES_DIR = join(DATA_DIR, "drink_price_updates");
const WHATS_ON_DIR = join(DATA_DIR, "whats_on");
const DRINK_CATEGORIES = new Set([
  "beer",
  "wine",
  "whisky",
  "gin",
  "vodka",
  "rum",
  "cocktail",
  "shot",
  "alcohol-free",
  "soft-drink",
  "coffee",
  "other",
]);

// ---------------------------------------------------------------------------
// Artifact classification. Single source of truth for what a missing or
// invalid artifact means to the build: a REQUIRED artifact fails the build
// with a one-line named error; an OPTIONAL artifact degrades to a named WARN
// and the build still exits 0. Judged by how the app itself degrades at
// runtime, not by how validation happens to be implemented.
//
// Two entries (postcode_coordinate_build_decisions, famous_venues_seed) are
// sub-artifacts enforced inline inside a larger REQUIRED validator, via
// runOptionalSubCheck below, rather than as a top-level dataset run; they
// are still listed here so the whole required/optional decision lives in one
// table, not scattered through the file.
const ARTIFACT_CLASSIFICATION = [
  { id: "london_pois", required: true, reason: "core map layer, no runtime fallback" },
  { id: "london_localities", required: true, reason: "area search and routing depend on it" },
  { id: "tfl_lines", required: true, reason: "core map layer, no runtime fallback" },
  { id: "pint_prices_app_dataset", required: true, reason: "source of the priced venue dataset" },
  { id: "venues_slim", required: true, reason: "the map's first-paint venue index" },
  { id: "city_venue_packs", required: true, reason: "each enabled non-London city map loads its pack whole; a missing or malformed pack is that city's whole map" },
  { id: "venues_slim_shards", required: true, reason: "lazy detail shards for the venue index" },
  { id: "uk_base_shards", required: true, reason: "base pub layer streamed per viewport" },
  { id: "venue_details", required: true, reason: "venue sheet detail data" },
  { id: "pubmaxxing_seed", required: true, reason: "seeds the curated venue anchors the index is built from" },
  { id: "drink_price_updates", required: true, reason: "the validator itself SKIPs cleanly (ok: true) when the directory or files are absent; a file that IS present with bad data is a genuine defect and stays a hard gate" },
  { id: "whats_on", required: true, reason: "the validator itself SKIPs cleanly (ok: true) when the directory or files are absent; a file that IS present with bad data is a genuine defect and stays a hard gate" },
  { id: "pint_index_editions", required: true, reason: "the validator itself passes cleanly (ok: true) when no dated editions exist yet; a published edition that fails its hash/shape checks is a genuine defect and stays a hard gate" },
  { id: "night_signals", required: false, reason: "advisory tonight signal; map and app work without it. Unlike the three above, a missing/unreadable file here is not internally self-guarded to ok: true, so this flag is what keeps that case a WARN instead of a build failure" },
  { id: "famous_venues_seed", required: false, reason: "heritage enrichment; venues_slim/venue_details validate fine without it" },
  { id: "postcode_coordinate_build_decisions", required: false, reason: "build-provenance cross-check on top of the already-validated pint_prices_app_dataset; not needed for the app to boot" },
  { id: "postcode_coordinate_reference_data", required: false, reason: "backs the postcode-coordinate contradiction cross-check only; pint_prices_app_dataset's own rows are already validated without it" },
  { id: "weather_snapshot", required: true, reason: "not yet reviewed for softening; keep as a hard gate" },
  { id: "pint_index_snapshot", required: true, reason: "not yet reviewed for softening; keep as a hard gate" },
  { id: "late_food_evidence", required: true, reason: "not yet reviewed for softening; keep as a hard gate" },
  { id: "editorial_overlay", required: true, reason: "the validator itself SKIPs cleanly (ok: true) when the file is absent; a file that IS present with a body or extra keys is a genuine defect and stays a hard gate" },
];

function classificationFor(id) {
  const entry = ARTIFACT_CLASSIFICATION.find((a) => a.id === id);
  if (!entry) {
    throw new Error(
      `validate-data.mjs: dataset "${id}" is missing from ARTIFACT_CLASSIFICATION`,
    );
  }
  return entry;
}

// Runs an optional sub-check embedded inside a REQUIRED validator's control
// flow (its data does not have its own top-level dataset run). If reading or
// verifying its artifact throws for any reason, including a missing file
// deep inside a helper this function doesn't control, the failure degrades
// to a named WARN instead of crashing or failing the required validator
// around it. This is the one sanctioned try/catch boundary for this class of
// check, not a scattered one.
function runOptionalSubCheck(id, fn) {
  try {
    return { skipped: false, errors: fn() };
  } catch (e) {
    const { reason } = classificationFor(id);
    console.log(
      `  WARN ${id}: optional check could not run (${e.message}), degrading, not failing the build (${reason})`,
    );
    return { skipped: true, errors: [] };
  }
}

// Prints the same named-WARN shape as runOptionalSubCheck, for optional
// artifacts read inline (not wrapped in a try/catch around a function call).
function warnOptionalArtifact(id, message) {
  const { reason } = classificationFor(id);
  console.log(`  WARN ${id}: ${message}, degrading, not failing the build (${reason})`);
}

// Kept dependency-free because validation tests copy this single script into a
// scratch repository. Mirrors refresh_night_signal_claims.mjs. Split into
// single-purpose predicates so no one check's branching swamps the shape of
// the whole claim contract; isValidNightSignalClaim below reads as the
// sequence of gates it always was.
function nightSignalClaimText(value, max) {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}

function nightSignalClaimIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nightSignalClaimPublicUrl(value) {
  if (!nightSignalClaimText(value, 2_000)) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function nightSignalClaimSource(value) {
  return (
    value &&
    typeof value === "object" &&
    nightSignalClaimPublicUrl(value.sourceUrl) &&
    nightSignalClaimText(value.publisher, 160) &&
    nightSignalClaimIso(value.publishedAt)
  );
}

function hasValidNightSignalShape(row) {
  if (
    !row ||
    typeof row !== "object" ||
    !nightSignalClaimText(row.id, 120) ||
    !nightSignalClaimText(row.claim, 500)
  )
    return false;
  if (!["event", "price", "access", "opening", "transport"].includes(row.kind))
    return false;
  return (
    !!row.entity &&
    ["venue", "night_area", "transport"].includes(row.entity.type) &&
    nightSignalClaimText(row.entity.id, 120)
  );
}

function hasValidNightSignalProvenance(row) {
  if (
    !nightSignalClaimSource(row) ||
    !nightSignalClaimIso(row.observedAt) ||
    !nightSignalClaimIso(row.expiresAt) ||
    Date.parse(row.expiresAt) <= Date.parse(row.observedAt)
  )
    return false;
  if (Date.parse(row.publishedAt) > Date.parse(row.observedAt)) return false;
  return (
    typeof row.confidence === "number" &&
    row.confidence >= 0 &&
    row.confidence <= 1
  );
}

function hasValidNightSignalStateFields(row) {
  return (
    ["pending", "approved", "rejected"].includes(row.reviewState) &&
    ["single_source", "corroborated", "manual_review"].includes(
      row.verification,
    ) &&
    ["none", "boost", "avoid"].includes(row.routeEffect)
  );
}

function hasValidCorroboratingSources(row) {
  if (
    !Array.isArray(row.corroboratingSources) ||
    row.corroboratingSources.length > 5 ||
    !row.corroboratingSources.every(nightSignalClaimSource)
  )
    return false;
  return !row.corroboratingSources.some(
    (item) => Date.parse(item.publishedAt) > Date.parse(row.observedAt),
  );
}

// Duplicate corroborating sources fail the same way as sources that all
// trace back to the one voice: both collapse to "not independent" here, so
// the caller's two independence gates apply to either case identically.
function corroboratingSourcesAreIndependent(row) {
  const keys = row.corroboratingSources.map(
    (item) =>
      `${new URL(item.sourceUrl).toString()}|${item.publisher.trim().toLocaleLowerCase("en-GB")}`,
  );
  if (new Set(keys).size !== keys.length) return false;
  return row.corroboratingSources.some(
    (item) =>
      new URL(item.sourceUrl).hostname !== new URL(row.sourceUrl).hostname &&
      item.publisher.trim().toLocaleLowerCase("en-GB") !==
        row.publisher.trim().toLocaleLowerCase("en-GB"),
  );
}

function nightSignalRoutingRuleSatisfied(row) {
  if (row.routeEffect !== "none" && row.verification === "single_source")
    return false;
  return !(
    row.routeEffect !== "none" &&
    row.verification === "manual_review" &&
    !["operations", "editorial"].includes(row.reviewAuthority)
  );
}

function nightSignalReviewApprovalValid(row) {
  return (
    row.reviewState !== "approved" ||
    (nightSignalClaimIso(row.reviewedAt) &&
      ["operations", "editorial", "automated"].includes(row.reviewAuthority) &&
      Date.parse(row.reviewedAt) >= Date.parse(row.observedAt))
  );
}

function isValidNightSignalClaim(row) {
  if (!hasValidNightSignalShape(row)) return false;
  if (!hasValidNightSignalProvenance(row)) return false;
  if (!hasValidNightSignalStateFields(row)) return false;
  if (!hasValidCorroboratingSources(row)) return false;
  const independent = corroboratingSourcesAreIndependent(row);
  if (row.corroboratingSources.length > 0 && !independent) return false;
  if (row.verification === "corroborated" && !independent) return false;
  if (!nightSignalRoutingRuleSatisfied(row)) return false;
  return nightSignalReviewApprovalValid(row);
}

// ---------------------------------------------------------------------------
// Shared rules (kept in sync with the app)
// ---------------------------------------------------------------------------

// Mirror of lib/pois.ts PoiCategory — keep this set identical to the app's.
const POI_CATEGORIES = new Set([
  "tube",
  "rail",
  "bus",
  "river",
  "park",
  "garden",
  "market",
  "historic",
  "viewpoint",
  "sight",
]);

// Generic bundled-map safety bounds. Night-out places do not use this helper:
// their authoritative bounds live in lib/nightOutPlaceContract.mjs.
const LON_MIN = -0.55;
const LON_MAX = 0.3;
const LAT_MIN = 51.26;
const LAT_MAX = 51.72;

// A healthy pint dataset is ~3k rows; anything well below that means the export
// truncated. Fail hard so we never ship a gutted map.
const PINT_ROW_FLOOR = 2500;
// Venue-count floors are MINIMUMS, not targets. The D1 canonicalization step
// (scripts/canonicalize_venue_dataset.mjs) collapses duplicate identities of
// the same physical pub across dataset lineages, so the London venue count
// drops honestly (e.g. the artifact generated for this change went 1,094 ->
// 1,021) — still comfortably above this floor. Deliberately not hard-coding
// that count here: it's a volatile, generated-artifact value, and this
// validator rebuilds its expectations from the same canonicalized rows, so
// slim/detail counts stay self-consistent after dedup regardless of the
// exact number. The floor stays at 900: a real dataset regression
// (truncation) would blow well past it.
const SLIM_VENUE_FLOOR = 900;
const DETAIL_VENUE_FLOOR = 900;
// Map sharding budgets. The manifest and central compatibility core have an
// eager budget; total covers every geographic cell. Kept in lockstep with
// scripts/build_slim_index.mjs.
const SLIM_EAGER_BUDGET_BYTES = 600 * 1024;
const SLIM_TOTAL_BUDGET_BYTES = 1200 * 1024;
// london_localities.json (OSM/ODbL gazetteer, scripts/gen_london_localities.mjs)
// carries ~760 rows. Floor is a MINIMUM that catches a truncated/gutted regen,
// not a target — a real dataset drop would blow well past it.
const LOCALITY_FLOOR = 300;
const PUBMAXXING_PUB_FLOOR = 150;
const PUBMAXXING_BEVERAGE_ROW_FLOOR = 1400;
const PUBMAXXING_HISTORY_SEED_FLOOR = 70;
const PUBMAXXING_ALCOHOLIC_ROW_FLOOR = 1250;
const PUBMAXXING_NON_ALCOHOLIC_ROW_FLOOR = 100;
const PUBMAXXING_UNKNOWN_ALCOHOLIC_ROW_CEILING = 150;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function inLondon(lng, lat) {
  return lng >= LON_MIN && lng <= LON_MAX && lat >= LAT_MIN && lat <= LAT_MAX;
}

function normaliseVenueKeyPart(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function venueGroupingKey(row) {
  return [
    normaliseVenueKeyPart(row.pub_name),
    normaliseVenueKeyPart(row.address),
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

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

function loadJson(name) {
  const path = join(DATA_DIR, name);
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function expectedVenueGroupsFromPintRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inLondon(lng, lat))
      continue;
    const key = venueGroupingKey(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  const byId = new Map();
  for (const [key, prices] of grouped) {
    byId.set(stableVenueIdFromKey(key), prices);
  }
  return byId;
}

// data/famous_venues/*.json: heritage seed rows (bars, late food,
// restaurants). Optional: the directory may not exist yet. Absence of the
// directory is NOT a failure; a bad file inside it IS (same idiom as
// drink_price_updates/whats_on below).
function loadFamousVenues() {
  if (!existsSync(FAMOUS_VENUES_DIR)) {
    console.log(
      "SKIP data/famous_venues/: directory does not exist (optional heritage enrichment)",
    );
    return [];
  }
  return ["bars.json", "late_food.json", "restaurants.json"].flatMap((name) =>
    JSON.parse(readFileSync(join(FAMOUS_VENUES_DIR, name), "utf8")),
  );
}

function isReplacedByFamousVenue(first, famousRows) {
  return famousRows.some(
    (row) =>
      normaliseVenueKeyPart(row.name) ===
        normaliseVenueKeyPart(first.pub_name) &&
      Math.abs(row.lat - Number(first.latitude)) < 0.001 &&
      Math.abs(row.lng - Number(first.longitude)) < 0.001,
  );
}

function famousPriceBands(rows) {
  const bands = new Map();
  for (const kind of ["bar", "food", "restaurant"]) {
    const ranked = rows
      .filter((row) => row.kind === kind)
      .slice()
      .sort(
        (a, b) => a.anchor.price - b.anchor.price || a.id.localeCompare(b.id),
      );
    const lowCutoff = ranked[Math.ceil(ranked.length / 3) - 1]?.anchor.price;
    const midCutoff =
      ranked[Math.ceil((ranked.length * 2) / 3) - 1]?.anchor.price;
    for (const row of ranked) {
      bands.set(
        row.id,
        row.anchor.price <= lowCutoff
          ? 0
          : row.anchor.price <= midCutoff
            ? 1
            : 2,
      );
    }
  }
  return bands;
}

// Collect errors per file so one broken row doesn't hide the rest. We cap the
// number of reported errors so a systemic failure doesn't dump thousands of
// lines, but still count them all.
function makeCollector(limit = 20) {
  const errors = [];
  let total = 0;
  return {
    add(msg) {
      total += 1;
      if (errors.length < limit) errors.push(msg);
    },
    get count() {
      return total;
    },
    report() {
      for (const e of errors) console.log(`    - ${e}`);
      if (total > errors.length) {
        console.log(`    - ...and ${total - errors.length} more`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Validators — each returns { ok, count } and logs its own detail.
// ---------------------------------------------------------------------------

// london_pois.json — mirrors lib/pois.ts isValidPoi, plus id-uniqueness and a
// Greater London bounds check.
function validatePois() {
  const name = "public/data/london_pois.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("london_pois.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (!Array.isArray(data)) {
    console.log(`FAIL ${name}: expected a top-level array`);
    return { ok: false, count: 0 };
  }

  const seenIds = new Set();
  data.forEach((row, i) => {
    const where = `row ${i}`;
    if (typeof row !== "object" || row === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    const id = row.id;
    if (typeof id !== "string" || id.length === 0) {
      errs.add(`${where}: missing/empty id`);
    } else if (seenIds.has(id)) {
      errs.add(`${where}: duplicate id "${id}"`);
    } else {
      seenIds.add(id);
    }
    if (typeof row.name !== "string" || row.name.length === 0) {
      errs.add(`${where} (${id}): missing/empty name`);
    }
    if (!POI_CATEGORIES.has(row.category)) {
      errs.add(`${where} (${id}): invalid category "${row.category}"`);
    }
    const coords = row.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) {
      errs.add(`${where} (${id}): coordinates must be a [lng, lat] pair`);
    } else {
      const [lng, lat] = coords;
      if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) {
        errs.add(`${where} (${id}): non-finite coordinates`);
      } else if (!inLondon(lng, lat)) {
        errs.add(
          `${where} (${id}): [${lng}, ${lat}] outside Greater London bounds`,
        );
      }
    }
  });

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${data.length} rows, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: data.length };
}

// london_localities.json — the Greater London locality gazetteer (OSM/ODbL, built
// by scripts/gen_london_localities.mjs). Mirrors lib/localities.ts isValidLocality:
// finite coords inside Greater London, non-empty name + borough, an ODbL
// attribution header, a count floor, and globally-unique normalised names (the
// dedupe invariant the generator guarantees).
function validateLondonLocalities() {
  const name = "public/data/london_localities.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("london_localities.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !Array.isArray(data.localities)
  ) {
    console.log(`FAIL ${name}: expected an object with a "localities" array`);
    return { ok: false, count: 0 };
  }

  // ODbL attribution must ship with the data (licence requirement).
  if (
    typeof data.attribution !== "string" ||
    !/openstreetmap/i.test(data.attribution)
  ) {
    errs.add("missing/invalid OpenStreetMap attribution header");
  }
  if (typeof data.license !== "string" || !/odbl/i.test(data.license)) {
    errs.add("missing/invalid ODbL licence header");
  }

  const rows = data.localities;
  const seenNames = new Set();
  rows.forEach((row, i) => {
    const where = `row ${i}`;
    if (typeof row !== "object" || row === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    if (typeof row.name !== "string" || row.name.trim().length === 0) {
      errs.add(`${where}: missing/empty name`);
    } else {
      const key = row.name.trim().toLowerCase().replace(/\s+/g, " ");
      if (seenNames.has(key))
        errs.add(`${where}: duplicate name "${row.name}" (dedupe invariant)`);
      else seenNames.add(key);
    }
    if (typeof row.borough !== "string" || row.borough.trim().length === 0) {
      errs.add(`${where} (${row.name}): missing/empty borough`);
    }
    const { lat, lng } = row;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
      errs.add(`${where} (${row.name}): non-finite coordinates`);
    } else if (!inLondon(lng, lat)) {
      errs.add(
        `${where} (${row.name}): [${lng}, ${lat}] outside Greater London bounds`,
      );
    }
  });

  if (rows.length < LOCALITY_FLOOR) {
    errs.add(
      `only ${rows.length} localities (< floor ${LOCALITY_FLOOR}) — likely a truncated regen`,
    );
  }
  if (typeof data.count === "number" && data.count !== rows.length) {
    errs.add(`header count ${data.count} !== ${rows.length} rows`);
  }

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${rows.length} rows, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: rows.length };
}

// tfl_lines.json — a GeoJSON FeatureCollection where each feature carries a line
// name + hex colour and a LineString geometry.
function validateTflLines() {
  const name = "public/data/tfl_lines.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("tfl_lines.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (
    typeof data !== "object" ||
    data === null ||
    data.type !== "FeatureCollection"
  ) {
    console.log(`FAIL ${name}: expected a GeoJSON FeatureCollection`);
    return { ok: false, count: 0 };
  }
  if (!Array.isArray(data.features)) {
    console.log(`FAIL ${name}: features must be an array`);
    return { ok: false, count: 0 };
  }

  data.features.forEach((f, i) => {
    const where = `feature ${i}`;
    if (typeof f !== "object" || f === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    const props = f.properties;
    if (typeof props !== "object" || props === null) {
      errs.add(`${where}: missing properties`);
    } else {
      if (typeof props.line !== "string" || props.line.length === 0) {
        errs.add(`${where}: missing properties.line`);
      }
      if (typeof props.color !== "string" || !HEX_COLOR.test(props.color)) {
        errs.add(
          `${where}: properties.color "${props.color}" is not a #hex colour`,
        );
      }
    }
    const geom = f.geometry;
    if (
      typeof geom !== "object" ||
      geom === null ||
      geom.type !== "LineString"
    ) {
      errs.add(`${where}: geometry must be a LineString`);
    } else if (
      !Array.isArray(geom.coordinates) ||
      geom.coordinates.length === 0
    ) {
      errs.add(`${where}: LineString has no coordinates`);
    }
  });

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${data.features.length} features, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: data.features.length };
}

// pint_prices_app_dataset.json — the app's core dataset. Sample-check row shape
// (pub_name + numeric-or-null price + finite lat/lng) and FAIL if the row count
// dropped below the sane floor, which catches a truncated export.
function sha256File(pathname) {
  return createHash("sha256")
    .update(readFileSync(pathname))
    .digest("hex");
}

function normalizeQuarantineDecision(entry) {
  return {
    appPriceId: entry?.appPriceId,
    pubName: entry?.pubName,
    postcode: parseUkPostcode(entry?.postcode)?.postcode,
    latitude: entry?.latitude,
    longitude: entry?.longitude,
    reason: entry?.reason,
  };
}

function normalizeCorrectionDecision(entry) {
  return {
    decisionId: entry?.decisionId,
    appPriceId: entry?.appPriceId,
    pubName: entry?.pubName,
    reason: entry?.reason,
    changes: entry?.changes,
    dataQualityNote: entry?.dataQualityNote,
  };
}

function sortedJson(entries) {
  return JSON.stringify(
    [...entries].sort((left, right) =>
      String(left?.appPriceId).localeCompare(String(right?.appPriceId)),
    ),
  );
}

function quarantineRegistryErrors(quarantineRegistry, osmPubs) {
  const quarantineRows = quarantineRegistry?.rows;
  const syntheticQuarantineRows = Array.isArray(quarantineRows)
    ? quarantineRows.map((entry) => ({
        app_price_id: entry?.appPriceId,
        pub_name: entry?.pubName,
        address: entry?.postcode,
        latitude: entry?.latitude,
        longitude: entry?.longitude,
      }))
    : [];
  const quarantineResult = validatePostcodeCoordinateQuarantine({
    rows: syntheticQuarantineRows,
    osmPubs,
    quarantineRegistry,
  });
  return quarantineResult.invalidQuarantines.map(
    (error) => `invalid postcode-coordinate quarantine: ${error}`,
  );
}

function buildReportArtifactErrors(buildReport) {
  const errors = [];
  const expectedOutputPath = "data/pint_prices_app_dataset.csv";
  if (
    buildReport?.output?.path !== expectedOutputPath ||
    buildReport?.output?.sha256 !==
      sha256File(join(ROOT_DIR, expectedOutputPath))
  ) {
    errors.push(
      `invalid postcode-coordinate quarantine: stale build decision output ${expectedOutputPath}; run python3 scripts/build_app_dataset.py`,
    );
  }

  const expectedInputs = new Set(POSTCODE_COORDINATE_DECISION_INPUTS);
  const reportInputs = buildReport?.inputs;
  if (!reportInputs || typeof reportInputs !== "object") {
    errors.push(
      "invalid postcode-coordinate quarantine: build report inputs must be an object",
    );
  } else {
    for (const relativePath of POSTCODE_COORDINATE_DECISION_INPUTS) {
      const expectedSha256 = sha256File(join(ROOT_DIR, relativePath));
      if (reportInputs[relativePath]?.sha256 !== expectedSha256) {
        errors.push(
          `invalid postcode-coordinate quarantine: stale build decision input ${relativePath}; run python3 scripts/build_app_dataset.py`,
        );
      }
    }
    for (const relativePath of Object.keys(reportInputs)) {
      if (!expectedInputs.has(relativePath)) {
        errors.push(
          `invalid postcode-coordinate quarantine: build report has unexpected input ${relativePath}`,
        );
      }
    }
  }
  return errors;
}

function expectedCorrectionDecisions(correctionRegistry) {
  if (!Array.isArray(correctionRegistry?.corrections)) {
    return {
      entries: [],
      errors: [
        "invalid postcode-coordinate correction: top-level corrections must be an array",
      ],
    };
  }
  return {
    entries: correctionRegistry.corrections.flatMap((correction) =>
      Array.isArray(correction?.appPriceIds)
        ? correction.appPriceIds.map((appPriceId) =>
            normalizeCorrectionDecision({
              decisionId: correction.decisionId,
              appPriceId,
              pubName: correction.match?.pubName,
              reason: correction.reason,
              changes: correction.changes,
              dataQualityNote: correction.dataQualityNote,
            }),
          )
        : [],
    ),
    errors: [],
  };
}

function decisionRegistryParity({
  quarantineRegistry,
  correctionRegistry,
  buildReport,
}) {
  const errors = [];
  const quarantineRows = quarantineRegistry?.rows;
  const expectedQuarantines = Array.isArray(quarantineRows)
    ? quarantineRows.map(normalizeQuarantineDecision)
    : [];
  const reportedQuarantines = Array.isArray(buildReport?.quarantines)
    ? buildReport.quarantines.map(normalizeQuarantineDecision)
    : [];
  if (sortedJson(expectedQuarantines) !== sortedJson(reportedQuarantines)) {
    errors.push(
      "invalid postcode-coordinate quarantine: build report quarantines do not exactly match registry rows",
    );
  }

  const expectedCorrections = expectedCorrectionDecisions(correctionRegistry);
  errors.push(...expectedCorrections.errors);
  const reportedCorrections = Array.isArray(buildReport?.corrections)
    ? buildReport.corrections.map(normalizeCorrectionDecision)
    : [];
  if (
    sortedJson(expectedCorrections.entries) !== sortedJson(reportedCorrections)
  ) {
    errors.push(
      "invalid postcode-coordinate correction: build report corrections do not exactly match registry rows",
    );
  }
  return { errors, reportedCorrections };
}

function publishedDecisionErrors({
  publishedRows,
  quarantineRows,
  reportedCorrections,
}) {
  const errors = [];
  const validQuarantineRows = Array.isArray(quarantineRows)
    ? quarantineRows
    : [];
  errors.push(
    ...publishedQuarantineLeakValidationErrors({
      publishedRows,
      quarantineRows: validQuarantineRows,
    }),
  );

  for (const correction of reportedCorrections) {
    const row = publishedRows.find(
      (candidate) =>
        candidate?.app_price_id === correction.appPriceId &&
        candidate?.pub_name === correction.pubName,
    );
    if (!row) {
      errors.push(
        `invalid postcode-coordinate correction: ${correction.appPriceId} is missing from the product dataset`,
      );
      continue;
    }
    const productIdentityFields = new Set([
      "latitude",
      "longitude",
      "primary_borough",
    ]);
    for (const [field, expected] of Object.entries(
      correction.changes ?? {},
    )) {
      if (
        productIdentityFields.has(field) &&
        Object.hasOwn(row, field) &&
        row[field] !== expected
      ) {
        errors.push(
          `invalid postcode-coordinate correction: ${correction.appPriceId} field ${field} does not match its build decision`,
        );
      }
    }
    const notes = String(row.data_quality_notes ?? "").split("|");
    if (!notes.includes(correction.dataQualityNote)) {
      errors.push(
        `invalid postcode-coordinate correction: ${correction.appPriceId} is missing data quality note ${correction.dataQualityNote}`,
      );
    }
  }

  return errors;
}

function validatePostcodeCoordinateBuildDecisions({
  publishedRows,
  osmPubs,
  quarantineRegistry,
  correctionRegistry,
  buildReport,
}) {
  const parity = decisionRegistryParity({
    quarantineRegistry,
    correctionRegistry,
    buildReport,
  });
  return [
    ...quarantineRegistryErrors(quarantineRegistry, osmPubs),
    ...buildReportArtifactErrors(buildReport),
    ...parity.errors,
    ...publishedDecisionErrors({
      publishedRows,
      quarantineRows: quarantineRegistry?.rows,
      reportedCorrections: parity.reportedCorrections,
    }),
  ];
}

function validatePintPrices() {
  const name = "public/data/pint_prices_app_dataset.json";
  const errs = makeCollector();
  let data;
  let osmPubs;
  let postcodeCoordinateExceptions;
  let postcodeCoordinateQuarantine;
  let postcodeCoordinateCorrections;
  let postcodeCoordinateBuildReport;
  try {
    data = loadJson("pint_prices_app_dataset.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (!Array.isArray(data)) {
    console.log(`FAIL ${name}: expected a top-level array`);
    return { ok: false, count: 0 };
  }

  try {
    const osmData = JSON.parse(readFileSync(UK_OSM_PUBS_FILE, "utf8"));
    if (!Array.isArray(osmData?.pubs)) {
      warnOptionalArtifact(
        "postcode_coordinate_reference_data",
        "data/osm/uk/uk_osm_pubs.json must contain a pubs array",
      );
    } else {
      osmPubs = osmData.pubs;
    }
  } catch (e) {
    warnOptionalArtifact(
      "postcode_coordinate_reference_data",
      `could not read/parse data/osm/uk/uk_osm_pubs.json (${e.message})`,
    );
  }

  try {
    postcodeCoordinateExceptions = JSON.parse(
      readFileSync(POSTCODE_COORDINATE_EXCEPTIONS_FILE, "utf8"),
    );
  } catch (e) {
    warnOptionalArtifact(
      "postcode_coordinate_reference_data",
      `could not read/parse data/postcode_coordinate_exceptions.json (${e.message})`,
    );
  }
  try {
    postcodeCoordinateQuarantine = JSON.parse(
      readFileSync(POSTCODE_COORDINATE_QUARANTINE_FILE, "utf8"),
    );
  } catch (e) {
    warnOptionalArtifact(
      "postcode_coordinate_build_decisions",
      `could not read/parse data/postcode_coordinate_quarantine.json (${e.message})`,
    );
  }
  try {
    postcodeCoordinateCorrections = JSON.parse(
      readFileSync(POSTCODE_COORDINATE_CORRECTIONS_FILE, "utf8"),
    );
  } catch (e) {
    warnOptionalArtifact(
      "postcode_coordinate_build_decisions",
      `could not read/parse data/postcode_coordinate_corrections.json (${e.message})`,
    );
  }
  try {
    postcodeCoordinateBuildReport = JSON.parse(
      readFileSync(POSTCODE_COORDINATE_BUILD_REPORT_FILE, "utf8"),
    );
  } catch (e) {
    warnOptionalArtifact(
      "postcode_coordinate_build_decisions",
      `could not read/parse data/postcode_coordinate_build_report.json (${e.message})`,
    );
  }

  const count = data.length;

  // Row-count floor: the primary guard against a truncated dataset.
  if (count < PINT_ROW_FLOOR) {
    errs.add(
      `row count ${count} is below the floor of ${PINT_ROW_FLOOR} — dataset looks truncated`,
    );
  }

  let outOfBounds = 0;
  data.forEach((row, i) => {
    const where = `row ${i}`;
    if (typeof row !== "object" || row === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    if (typeof row.pub_name !== "string" || row.pub_name.length === 0) {
      errs.add(`${where}: missing/empty pub_name`);
    }
    const price = row.price_gbp;
    if (price !== null && !isFiniteNumber(price)) {
      errs.add(
        `${where}: price_gbp must be a finite number or null (got ${JSON.stringify(price)})`,
      );
    }
    if (!isFiniteNumber(row.latitude) || !isFiniteNumber(row.longitude)) {
      errs.add(`${where}: latitude/longitude must be finite numbers`);
    } else if (!inLondon(row.longitude, row.latitude)) {
      // Out-of-London coordinates are a data-quality bug the export is meant to
      // strip. Fail the build so a regressed export can't ship scattered pins.
      outOfBounds += 1;
      errs.add(
        `${where} (${row.pub_name}): [${row.longitude}, ${row.latitude}] outside Greater London bounds`,
      );
    }
  });

  if (outOfBounds > 0) {
    console.log(`  ${outOfBounds} row(s) outside Greater London bounds`);
  }

  if (osmPubs && postcodeCoordinateExceptions) {
    const postcodeResult = findPostcodeCoordinateContradictions({
      rows: data,
      osmPubs,
      exceptionRegistry: postcodeCoordinateExceptions,
    });
    for (const error of postcodeResult.invalidExceptions) {
      errs.add(`invalid postcode-coordinate exception: ${error}`);
    }
    for (const contradiction of postcodeResult.contradictions) {
      errs.add(
        `row ${contradiction.rowIndex} (${contradiction.pubName}): postcode-coordinate contradiction: ${contradiction.postcode} (${contradiction.outwardCode}) distance ${contradiction.distanceKm.toFixed(2)} km exceeds ${POSTCODE_COORDINATE_MAX_DISTANCE_KM} km from its outward-code reference`,
      );
    }
    console.log(
      `  postcode-coordinate check: ${postcodeResult.checkedRows} row(s), ${postcodeResult.referenceCount} outward-code reference(s), ${postcodeResult.contradictions.length} contradiction(s)`,
    );
    if (postcodeResult.appliedExceptions.length > 0) {
      console.log(
        `  postcode-coordinate exceptions: ${postcodeResult.appliedExceptions.length} applied`,
      );
    }
  }

  if (
    osmPubs &&
    postcodeCoordinateQuarantine &&
    postcodeCoordinateCorrections &&
    postcodeCoordinateBuildReport
  ) {
    // This build-decision provenance check re-hashes files on disk
    // (POSTCODE_COORDINATE_DECISION_INPUTS and the output CSV) that are
    // never guarded elsewhere. It is an optional cross-check layered on top
    // of the required checks above, not something the app needs to boot, so
    // any failure to run it, including a missing input file, degrades to a
    // named WARN instead of failing this REQUIRED dataset.
    const { errors: decisionErrors, skipped } = runOptionalSubCheck(
      "postcode_coordinate_build_decisions",
      () =>
        validatePostcodeCoordinateBuildDecisions({
          publishedRows: data,
          osmPubs,
          quarantineRegistry: postcodeCoordinateQuarantine,
          correctionRegistry: postcodeCoordinateCorrections,
          buildReport: postcodeCoordinateBuildReport,
        }),
    );
    for (const error of decisionErrors) {
      errs.add(error);
    }
    if (!skipped) {
      console.log(
        `  postcode-coordinate build decisions: ${postcodeCoordinateBuildReport.corrections?.length ?? 0} correction row(s), ${postcodeCoordinateBuildReport.quarantines?.length ?? 0} quarantine row(s), ${decisionErrors.length} error(s)`,
      );
    }
  }

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${count} rows (floor ${PINT_ROW_FLOOR}), ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count };
}

// venues_slim.json - the complete compatibility artifact behind the map cells
// and whole-index readers. Legacy pub ids must stay aligned with the full pint
// dataset grouping seam, while curated venue ids and anchors must stay aligned
// with their seed packs. Otherwise pins can render fast but fail when opened
// for lazy detail. This validator rebuilds both lanes using the same plain-JS
// rules as scripts/build_slim_index.mjs.
function validateSlimVenues() {
  const name = "public/data/venues_slim.json";
  const errs = makeCollector();
  let slim;
  let rows;
  let famousRows;
  try {
    slim = loadJson("venues_slim.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }
  try {
    rows = loadJson("pint_prices_app_dataset.json");
  } catch (e) {
    console.log(
      `FAIL ${name}: could not read full pint dataset for parity check (${e.message})`,
    );
    return { ok: false, count: 0 };
  }
  try {
    famousRows = loadFamousVenues();
  } catch (e) {
    console.log(
      `FAIL ${name}: could not read famous venue seeds (${e.message})`,
    );
    return { ok: false, count: 0 };
  }

  if (
    !slim ||
    Array.isArray(slim) ||
    typeof slim.revision !== "string" ||
    slim.revision.trim().length === 0 ||
    !Array.isArray(slim.rows)
  ) {
    console.log(`FAIL ${name}: expected a revisioned rows payload`);
    return { ok: false, count: 0 };
  }
  slim = slim.rows;
  if (!Array.isArray(rows)) {
    console.log(
      `FAIL ${name}: expected full pint dataset to be a top-level array`,
    );
    return { ok: false, count: 0 };
  }

  if (slim.length < SLIM_VENUE_FLOOR) {
    errs.add(
      `venue count ${slim.length} is below the floor of ${SLIM_VENUE_FLOOR} — slim index looks truncated`,
    );
  }

  const grouped = new Map();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inLondon(lng, lat))
      continue;
    const key = venueGroupingKey(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const expected = new Map();
  for (const [key, prices] of grouped) {
    const first = prices[0];
    if (isReplacedByFamousVenue(first, famousRows)) continue;
    const numericPrices = prices
      .map((p) => p.price_gbp)
      .filter((p) => typeof p === "number" && Number.isFinite(p));
    expected.set(stableVenueIdFromKey(key), {
      name: String(first.pub_name),
      lat: Number(first.latitude),
      lng: Number(first.longitude),
      cheapestPrice: numericPrices.length ? Math.min(...numericPrices) : null,
      borough: String(first.primary_borough || ""),
      kind: undefined,
      priceBand: undefined,
    });
  }
  const priceBands = famousPriceBands(famousRows);
  for (const row of famousRows) {
    for (const error of nightOutPlaceRowValidationErrors(row)) {
      errs.add(`famous venue ${row.id}: ${error}`);
    }
    expected.set(row.id, {
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      cheapestPrice: row.anchor.price,
      borough: row.borough,
      kind: row.kind,
      priceBand: priceBands.get(row.id),
    });
  }

  // The rebuilt index can only be a true parity check when heritage seed
  // data is present. Without it, `expected` is missing every famous-venue
  // row on purpose (see loadFamousVenues), so a size/id mismatch here means
  // nothing about a real data problem. Downgrade to one named WARN instead
  // of failing the required venues_slim dataset.
  const famousVenuesAvailable = existsSync(FAMOUS_VENUES_DIR);
  if (slim.length !== expected.size) {
    if (famousVenuesAvailable) {
      errs.add(
        `venue count ${slim.length} does not match rebuilt expected count ${expected.size}`,
      );
    } else {
      warnOptionalArtifact(
        "famous_venues_seed",
        `venue count ${slim.length} does not match rebuilt expected count ${expected.size} (heritage seed data unavailable, parity unverifiable)`,
      );
    }
  }

  const seenIds = new Set();
  let unverifiableFamousRows = 0;
  slim.forEach((row, i) => {
    const where = `row ${i}`;
    if (typeof row !== "object" || row === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    const id = row.id;
    if (typeof id !== "string" || id.length === 0) {
      errs.add(`${where}: missing/empty id`);
      return;
    }
    if (seenIds.has(id)) {
      errs.add(`${where}: duplicate id "${id}"`);
    } else {
      seenIds.add(id);
    }
    if (typeof row.name !== "string" || row.name.length === 0) {
      errs.add(`${where} (${id}): missing/empty name`);
    }
    if (!isFiniteNumber(row.lat) || !isFiniteNumber(row.lng)) {
      errs.add(`${where} (${id}): lat/lng must be finite numbers`);
    } else if (!inLondon(row.lng, row.lat)) {
      errs.add(
        `${where} (${id}): [${row.lng}, ${row.lat}] outside Greater London bounds`,
      );
    }
    if (
      row.cheapestPrice !== null &&
      (!isFiniteNumber(row.cheapestPrice) || row.cheapestPrice < 0)
    ) {
      errs.add(
        `${where} (${id}): cheapestPrice must be a finite number >= 0 or null`,
      );
    }
    if (typeof row.borough !== "string") {
      errs.add(`${where} (${id}): borough must be a string`);
    }
    // zone (nearest-station fare zone) is optional; when present it must be a
    // positive integer (1–6 typically, up to 9 at the London edge).
    if (
      row.zone !== undefined &&
      (!Number.isInteger(row.zone) || row.zone < 1 || row.zone > 9)
    ) {
      errs.add(
        `${where} (${id}): zone must be an integer 1–9 when present (got ${row.zone})`,
      );
    }

    // Without heritage seed data, `expected` cannot tell a pint-derived row
    // that a real build would replace/enrich with famous-venue fields (kind,
    // cheapestPrice, priceBand) from one that legitimately stayed plain, so
    // id presence AND every field comparison below are unverifiable, not
    // just the count. Skip the whole parity check per row in that case.
    if (!famousVenuesAvailable) {
      unverifiableFamousRows += 1;
      return;
    }
    const exp = expected.get(id);
    if (!exp) {
      errs.add(
        `${where} (${id}): id is not present in rebuilt full-dataset index`,
      );
      return;
    }
    if (row.name !== exp.name) {
      errs.add(
        `${where} (${id}): name "${row.name}" does not match full dataset "${exp.name}"`,
      );
    }
    if (row.lat !== exp.lat || row.lng !== exp.lng) {
      errs.add(
        `${where} (${id}): coordinates [${row.lng}, ${row.lat}] do not match full dataset [${exp.lng}, ${exp.lat}]`,
      );
    }
    if (row.cheapestPrice !== exp.cheapestPrice) {
      errs.add(
        `${where} (${id}): cheapestPrice ${row.cheapestPrice} does not match full dataset ${exp.cheapestPrice}`,
      );
    }
    if (row.borough !== exp.borough) {
      errs.add(
        `${where} (${id}): borough "${row.borough}" does not match full dataset "${exp.borough}"`,
      );
    }
    if (row.kind !== exp.kind) {
      errs.add(
        `${where} (${id}): kind ${row.kind} does not match expected ${exp.kind}`,
      );
    }
    if (row.priceBand !== exp.priceBand) {
      errs.add(
        `${where} (${id}): priceBand ${row.priceBand} does not match expected ${exp.priceBand}`,
      );
    }
  });

  if (unverifiableFamousRows > 0) {
    warnOptionalArtifact(
      "famous_venues_seed",
      `${unverifiableFamousRows} venue row(s) could not be parity-checked against the rebuilt index (heritage seed data unavailable)`,
    );
  }

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${slim.length} venues (floor ${SLIM_VENUE_FLOOR}), ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: slim.length };
}

// public/data/cities/*/venues_slim.json — the per-city curated packs. Each one
// is fetched WHOLE when that city's map opens, so it carries its own payload
// ceiling; and each is unpriced by construction, because a curated city pack is
// built from OSM, which is not a price source. A price appearing in one would
// be a pin claiming a figure nobody logged, which is why cheapestPrice is
// checked here and not only in the builder that writes it.
const CITY_PACK_BUDGET_BYTES = 300 * 1024;

function validateCityPackRow(cityId, row, ids, bounds) {
  const errors = [];
  const { latMin, lonMin, latMax, lonMax } = bounds;
  const label = typeof row?.name === "string" && row.name ? row.name : "(unnamed)";
  if (typeof row?.id !== "string" || row.id.length === 0) {
    errors.push(`${cityId}: row "${label}" has no id`);
  } else if (ids.has(row.id)) {
    errors.push(`${cityId}: duplicate venue id "${row.id}"`);
  } else {
    ids.add(row.id);
  }
  if (typeof row?.name !== "string" || row.name.trim().length === 0) {
    errors.push(`${cityId}: venue "${row?.id}" has no name`);
  }
  if (typeof row?.borough !== "string" || row.borough.trim().length === 0) {
    errors.push(`${cityId}: venue "${label}" has no area label`);
  }
  if (row?.cheapestPrice !== null) {
    errors.push(
      `${cityId}: venue "${label}" carries a price (${row?.cheapestPrice}); a city pack is unpriced by construction`,
    );
  }
  const lat = row?.lat;
  const lng = row?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    errors.push(`${cityId}: venue "${label}" has no finite coordinates`);
  } else if (lat < latMin || lat > latMax || lng < lonMin || lng > lonMax) {
    errors.push(
      `${cityId}: venue "${label}" at ${lat},${lng} is outside the city bounds`,
    );
  }
  const searchText = row?.filterHints?.searchText;
  if (typeof searchText !== "string" || searchText.trim().length === 0) {
    errors.push(`${cityId}: venue "${label}" has no filterHints.searchText`);
  }
  return errors;
}

function validateCityPackManifest(cityId, packFile) {
  const errors = [];
  const manifestFile = packFile.replace(/\.json$/, ".manifest.json");
  if (!existsSync(manifestFile)) {
    return [`${cityId}: shard manifest ${manifestFile} is missing`];
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch (e) {
    return [`${cityId}: could not read/parse ${manifestFile} (${e.message})`];
  }

  if (manifest?.version !== 1 || !Array.isArray(manifest?.shards) || manifest.shards.length === 0) {
    return [`${cityId}: ${manifestFile} has no usable shard list`];
  }

  for (const shard of manifest.shards) {
    const url = typeof shard?.url === "string" ? shard.url : "";
    const relative = url.replace(/^\/data\//, "");
    const expectedPrefix = `cities/${cityId}/`;
    if (!url.startsWith(`/data/${expectedPrefix}`) || !relative || relative.includes("..")) {
      errors.push(`${cityId}: ${manifestFile} has unsafe shard URL "${url}"`);
      continue;
    }
    const asset = join(DATA_DIR, relative);
    if (!existsSync(asset)) {
      errors.push(`${cityId}: ${manifestFile} references missing ${url}`);
    }
  }
  return errors;
}

function validateCityVenuePacks() {
  const name = "public/data/cities/*/venues_slim.json";
  const errs = makeCollector();
  const ids = new Set();
  let venues = 0;
  let packs = 0;
  for (const [cityId, pack] of Object.entries(CITY_VENUE_PACKS)) {
    // London is the flagship index and has its own validator above.
    if (!pack.enabled || cityId === "london") continue;
    const bounds = CITY_BOUNDS[cityId];
    if (!bounds) {
      errs.add(`${cityId}: enabled pack has no box in lib/cityBounds.mjs`);
      continue;
    }
    const file = join(ROOT_DIR, "public", pack.slimVenuesPath);
    if (!existsSync(file)) {
      errs.add(`${cityId}: enabled pack ${pack.slimVenuesPath} is missing`);
      continue;
    }
    let raw;
    let rows;
    try {
      raw = readFileSync(file, "utf8");
      rows = JSON.parse(raw);
    } catch (e) {
      errs.add(`${cityId}: could not read/parse ${pack.slimVenuesPath} (${e.message})`);
      continue;
    }
    if (
      !rows ||
      Array.isArray(rows) ||
      typeof rows.revision !== "string" ||
      rows.revision.trim().length === 0 ||
      !Array.isArray(rows.rows) ||
      rows.rows.length === 0
    ) {
      errs.add(`${cityId}: ${pack.slimVenuesPath} is not a revisioned non-empty payload`);
      continue;
    }
    rows = rows.rows;
    const bytes = Buffer.byteLength(raw);
    if (bytes >= CITY_PACK_BUDGET_BYTES) {
      errs.add(
        `${cityId}: ${(bytes / 1024).toFixed(1)} KB exceeds the ${(CITY_PACK_BUDGET_BYTES / 1024).toFixed(0)} KB whole-pack budget`,
      );
    }
    for (const row of rows) {
      for (const error of validateCityPackRow(cityId, row, ids, bounds)) {
        errs.add(error);
      }
    }
    for (const error of validateCityPackManifest(cityId, file)) errs.add(error);
    packs += 1;
    venues += rows.length;
  }
  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${packs} city pack(s), ${venues} venues, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: venues };
}

// venues_slim shards - the map's first-paint payload is split into a manifest
// plus geographic cells, with the central cell also exposed as the compatibility
// core. This validator recomputes the expected split from the canonical
// venues_slim.json using the same shared module the build script uses, so the
// shipped manifest and cell files can never silently drift from the complete
// index. It also enforces eager and total-across-shard budgets.
function validateSlimShards() {
  const name = "public/data/venues_slim shards";
  const errs = makeCollector();
  let full;
  try {
    full = loadJson("venues_slim.json");
  } catch (e) {
    console.log(
      `FAIL ${name}: could not read/parse venues_slim.json (${e.message})`,
    );
    return { ok: false, count: 0 };
  }
  if (
    !full ||
    Array.isArray(full) ||
    typeof full.revision !== "string" ||
    full.revision.trim().length === 0 ||
    !Array.isArray(full.rows)
  ) {
    console.log(`FAIL ${name}: venues_slim.json is not a revisioned rows payload`);
    return { ok: false, count: 0 };
  }
  const fullRevision = full.revision;
  full = full.rows;

  const readRaw = (fileName) => readFileSync(join(DATA_DIR, fileName), "utf8");
  const fileFromUrl = (url) => url.replace(/^\/data\//, "");

  let manifest;
  let coreRows;
  try {
    manifest = JSON.parse(readRaw(MANIFEST_FILE));
    const corePayload = JSON.parse(readRaw(CORE_FILE));
    coreRows = Array.isArray(corePayload) ? corePayload : corePayload?.rows;
    if (!Array.isArray(coreRows)) coreRows = [];
  } catch (e) {
    console.log(
      `FAIL ${name}: missing/broken manifest or core shard (${e.message})`,
    );
    return { ok: false, count: 0 };
  }

  // Rebuild the expected plan from the monolith and compare structurally.
  // Version 2 is location-first: every row is in a geographic cell, with one
  // central compatibility core file. Version 1 remains accepted for city and
  // older fixtures that still use borough shards.
  let expectedCore;
  let expectedManifest;
  const expectedRowsByShard = new Map();
  if (manifest?.grid) {
    const grid = manifest.grid;
    const cells = classifySpatialShards(full, grid);
    const londonCentre = spatialCellIndex(51.5074, -0.1278, grid);
    const coreId = spatialCellId(londonCentre.lat, londonCentre.lon, grid);
    expectedCore = cells.get(coreId)?.venues ?? [];
    expectedManifest = buildSpatialShardManifest(cells, grid, coreId);
    for (const [id, cell] of cells) expectedRowsByShard.set(id, cell.venues);
  } else {
    const { core, outer } = classifySlimShards(full);
    expectedCore = core;
    expectedManifest = buildShardManifest({ core, outer });
    expectedRowsByShard.set("core", core);
    for (const [id, shard] of outer) expectedRowsByShard.set(id, shard.venues);
  }

  if (!manifest?.grid || manifest.version !== SPATIAL_SHARD_VERSION) {
    errs.add("manifest must use the spatial shard schema");
  }
  if (typeof manifest?.revision !== "string" || manifest.revision.trim().length === 0) {
    errs.add("manifest must carry a non-empty revision");
  }
  if (manifest?.revision !== fullRevision) {
    errs.add(`manifest revision ${manifest?.revision} !== monolith revision ${fullRevision}`);
  }

  if (manifest.version !== expectedManifest.version) {
    errs.add(
      `manifest version ${manifest.version} !== expected ${expectedManifest.version}`,
    );
  }
  const shipShards = Array.isArray(manifest.shards) ? manifest.shards : [];
  if (shipShards.length !== expectedManifest.shards.length) {
    errs.add(
      `manifest lists ${shipShards.length} shard(s), expected ${expectedManifest.shards.length}`,
    );
  }
  const shipById = new Map(shipShards.map((s) => [s.id, s]));
  const allIds = new Set();
  const shardRawById = new Map();
  let eagerBytes = Buffer.byteLength(readRaw(MANIFEST_FILE));
  let totalBytes = eagerBytes;

  for (const exp of expectedManifest.shards) {
    const got = shipById.get(exp.id);
    if (!got) {
      errs.add(`manifest is missing shard "${exp.id}"`);
      continue;
    }
    if (got.url !== exp.url)
      errs.add(`shard "${exp.id}": url "${got.url}" !== expected "${exp.url}"`);
    if (got.count !== exp.count) {
      errs.add(
        `shard "${exp.id}": count ${got.count} !== expected ${exp.count}`,
      );
    }
    if (got.core !== exp.core)
      errs.add(`shard "${exp.id}": core flag mismatch`);
    if (
      !Array.isArray(got.bbox) ||
      got.bbox.length !== 4 ||
      got.bbox.some((n, i) => n !== exp.bbox[i])
    ) {
      errs.add(
        `shard "${exp.id}": bbox ${JSON.stringify(got.bbox)} !== expected ${JSON.stringify(exp.bbox)}`,
      );
    }

    // Read the shard body, count its bytes, and fold its ids into the union.
    let rows;
    try {
      const raw = exp.core ? readRaw(CORE_FILE) : readRaw(fileFromUrl(exp.url));
      shardRawById.set(exp.id, raw);
      const payload = JSON.parse(raw);
      if (
        !payload ||
        Array.isArray(payload) ||
        typeof payload.revision !== "string" ||
        payload.revision !== manifest.revision ||
        !Array.isArray(payload.rows)
      ) {
        errs.add(`shard "${exp.id}": body has invalid spatial payload revision`);
        rows = [];
      } else {
        rows = payload.rows;
      }
      const bytes = Buffer.byteLength(raw);
      totalBytes += bytes;
      if (exp.core) eagerBytes += bytes;
    } catch (e) {
      errs.add(`shard "${exp.id}": could not read body (${e.message})`);
      continue;
    }
    if (!Array.isArray(rows) || rows.length !== exp.count) {
      errs.add(
        `shard "${exp.id}": body has ${rows?.length} rows, manifest says ${exp.count}`,
      );
      continue;
    }
    const expectedRows = expectedRowsByShard.get(exp.id) ?? [];
    const expectedIds = new Set(expectedRows.map((row) => row?.id));
    const expectedById = new Map(expectedRows.map((row) => [row?.id, row]));
    const shardIds = new Set();
    for (const r of rows) {
      if (!r || typeof r !== "object") {
        errs.add(`shard "${exp.id}": a row is not an object`);
        continue;
      }
      if (typeof r.id !== "string" || r.id.length === 0) {
        errs.add(`shard "${exp.id}": a row is missing an id`);
        continue;
      }
      if (typeof r.name !== "string" || r.name.length === 0) {
        errs.add(`shard "${exp.id}": row "${r.id}" is missing a name`);
      }
      if (!isFiniteNumber(r.lat) || !isFiniteNumber(r.lng)) {
        errs.add(`shard "${exp.id}": row "${r.id}" has invalid coordinates`);
      }
      if (typeof r.borough !== "string") {
        errs.add(`shard "${exp.id}": row "${r.id}" has invalid borough`);
      }
      if (
        r.cheapestPrice !== null &&
        (!isFiniteNumber(r.cheapestPrice) || r.cheapestPrice < 0)
      ) {
        errs.add(`shard "${exp.id}": row "${r.id}" has invalid cheapestPrice`);
      }
      if (
        r.zone !== undefined &&
        (!Number.isInteger(r.zone) || r.zone < 1 || r.zone > 9)
      ) {
        errs.add(`shard "${exp.id}": row "${r.id}" has invalid zone`);
      }
      if (!expectedIds.has(r.id)) {
        errs.add(`shard "${exp.id}": row "${r.id}" belongs to another cell`);
      }
      const expectedRow = expectedById.get(r.id);
      if (expectedRow && !isDeepStrictEqual(r, expectedRow)) {
        errs.add(`shard "${exp.id}": row "${r.id}" differs from monolith`);
      }
      shardIds.add(r.id);
      if (allIds.has(r.id))
        errs.add(`shard "${exp.id}": duplicate id "${r.id}" across shards`);
      allIds.add(r.id);
    }
    for (const id of expectedIds) {
      if (!shardIds.has(id)) {
        errs.add(`shard "${exp.id}": expected row "${id}" is missing`);
      }
    }
  }

  // The union of all shards must be exactly the monolith — no venue lost or
  // duplicated by the split.
  const fullIds = new Set(full.map((v) => v && v.id).filter(Boolean));
  if (allIds.size !== fullIds.size) {
    errs.add(
      `shard union has ${allIds.size} ids, monolith has ${fullIds.size}`,
    );
  }
  for (const id of fullIds) {
    if (!allIds.has(id)) {
      errs.add(`id "${id}" is in venues_slim.json but no shard`);
      break;
    }
  }
  if (coreRows.length !== expectedCore.length) {
    errs.add(
      `core shard has ${coreRows.length} venues, expected ${expectedCore.length}`,
    );
  }

  // Budgets — the whole point of this cycle.
  if (eagerBytes >= SLIM_EAGER_BUDGET_BYTES) {
    errs.add(
      `eager first-paint ${(eagerBytes / 1024).toFixed(1)} KB exceeds ${(SLIM_EAGER_BUDGET_BYTES / 1024).toFixed(0)} KB budget`,
    );
  }
  for (const exp of expectedManifest.shards) {
    const raw = shardRawById.get(exp.id);
    if (raw === undefined) continue;
    if (Buffer.byteLength(raw) >= 150 * 1024) {
      errs.add(`shard "${exp.id}" exceeds 150.0 KB spatial shard budget`);
    }
  }
  if (totalBytes >= SLIM_TOTAL_BUDGET_BYTES) {
    errs.add(
      `total shard payload ${(totalBytes / 1024).toFixed(1)} KB exceeds ${(SLIM_TOTAL_BUDGET_BYTES / 1024).toFixed(0)} KB budget`,
    );
  }

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${shipShards.length} shard(s), eager ${(eagerBytes / 1024).toFixed(1)} KB / ${(SLIM_EAGER_BUDGET_BYTES / 1024).toFixed(0)} KB, total ${(totalBytes / 1024).toFixed(1)} KB / ${(SLIM_TOTAL_BUDGET_BYTES / 1024).toFixed(0)} KB, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: shipShards.length };
}

// public/data/uk_base/** — the UK-wide unpriced base layer (built by
// scripts/build_uk_base_shards.mjs, consumed by lib/ukBasePubs.ts). It is the
// only dataset the map fetches WHILE PANNING, so the checks here are about the
// two ways it can hurt: a body the client would silently drop, and a cell fat
// enough to stall a pan. The per-cell budget mirrors the builder's own.
const UK_BASE_DIR = join(DATA_DIR, "uk_base");
const UK_BASE_SHARD_BUDGET_BYTES = 150 * 1024;
const UK_BASE_TOTAL_BUDGET_BYTES = 5 * 1024 * 1024;
const UK_BASE_MANIFEST_BUDGET_BYTES = 64 * 1024;
const UK_PLACE_INDEX_FILE = "places.json";
const UK_PLACE_INDEX_BUDGET_BYTES = 512 * 1024;
const UK_BASE_ID_PREFIX = "venue-uk-";

function isUkBaseRow(row) {
  return (
    Array.isArray(row) &&
    row.length === 6 &&
    typeof row[0] === "string" &&
    row[0].length > 0 &&
    typeof row[1] === "string" &&
    row[1].length > 0 &&
    typeof row[2] === "string" &&
    Number.isFinite(row[3]) &&
    Number.isFinite(row[4]) &&
    typeof row[5] === "string" &&
    (row[5] === "" || row[5].startsWith("venue-"))
  );
}

function listUkBaseJsonFiles(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listUkBaseJsonFiles(join(directory, entry.name), relative));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(relative);
    }
  }
  return files;
}

function addUkBaseErrors(errs, errors) {
  for (const error of errors) errs.add(error);
}

function validateUkPlaceIndex() {
  const errors = [];
  const file = join(UK_BASE_DIR, UK_PLACE_INDEX_FILE);
  if (!existsSync(file)) return [`missing ${UK_PLACE_INDEX_FILE}`];
  let raw;
  let index;
  try {
    raw = readFileSync(file, "utf8");
    index = JSON.parse(raw);
  } catch (e) {
    return [`${UK_PLACE_INDEX_FILE} is unreadable (${e.message})`];
  }
  const bytes = Buffer.byteLength(raw);
  if (bytes > UK_PLACE_INDEX_BUDGET_BYTES) {
    errors.push(
      `${UK_PLACE_INDEX_FILE} ${(bytes / 1024).toFixed(1)} KB exceeds the ${(UK_PLACE_INDEX_BUDGET_BYTES / 1024).toFixed(0)} KB chooser-search budget`,
    );
  }
  if (index?.source !== "OpenStreetMap via Overpass API") {
    errors.push(`${UK_PLACE_INDEX_FILE} has no recognised source`);
  }
  if (index?.license !== "ODbL 1.0") {
    errors.push(`${UK_PLACE_INDEX_FILE} has no ODbL 1.0 licence`);
  }
  if (!Array.isArray(index?.places) || index.places.length === 0) {
    errors.push(`${UK_PLACE_INDEX_FILE} has no place rows`);
    return errors;
  }
  const kinds = new Set(["city", "town", "village", "place", "suburb"]);
  const seen = new Set();
  let hasSheffield = false;
  for (const row of index.places) {
    const valid =
      Array.isArray(row) &&
      (row.length === 4 || row.length === 5) &&
      typeof row[0] === "string" &&
      isPublishableUkPlaceName(row[0]) &&
      row[0] === displayUkPlaceName(row[0]) &&
      Number.isFinite(row[1]) &&
      row[1] >= 49.8 &&
      row[1] <= 61 &&
      Number.isFinite(row[2]) &&
      row[2] >= -8.7 &&
      row[2] <= 1.9 &&
      kinds.has(row[3]) &&
      (row.length === 4 || typeof row[4] === "string");
    if (!valid) {
      errors.push(
        `${UK_PLACE_INDEX_FILE} has malformed row ${JSON.stringify(row)?.slice(0, 80)}`,
      );
      continue;
    }
    const key = `${row[0]}\0${row[1]}\0${row[2]}`;
    if (seen.has(key)) {
      errors.push(`${UK_PLACE_INDEX_FILE} repeats navigation target "${row[0]}"`);
    }
    seen.add(key);
    if (row[0] === "Sheffield") hasSheffield = true;
  }
  if (!hasSheffield) errors.push(`${UK_PLACE_INDEX_FILE} has no Sheffield result`);
  return errors;
}

function validateUkBaseManifestShape(manifest) {
  const errors = [];
  const shards = Array.isArray(manifest.shards) ? manifest.shards : [];
  if (shards.length === 0) errors.push("manifest lists no shards");
  const urlPrefix =
    typeof manifest.urlPrefix === "string" &&
    /^\/data\/uk_base\/packs\/[a-f0-9]{16}\/$/.test(manifest.urlPrefix)
      ? manifest.urlPrefix
      : "";
  if (!urlPrefix) errors.push("manifest has no usable shard URL prefix");
  return { errors, shards, urlPrefix };
}

function validateUkBasePayloadBudgets(manifestRaw, jsonFiles) {
  const manifestErrors = [];
  const manifestBytes = Buffer.byteLength(manifestRaw);
  if (manifestBytes >= UK_BASE_MANIFEST_BUDGET_BYTES) {
    manifestErrors.push(
      `manifest ${(manifestBytes / 1024).toFixed(1)} KB exceeds ${(UK_BASE_MANIFEST_BUDGET_BYTES / 1024).toFixed(0)} KB budget`,
    );
  }
  const totalBytes = jsonFiles.reduce(
    (sum, file) => sum + statSync(join(UK_BASE_DIR, file)).size,
    0,
  );
  const totalErrors = [];
  if (totalBytes >= UK_BASE_TOTAL_BUDGET_BYTES) {
    totalErrors.push(
      `total ${(totalBytes / 1024).toFixed(1)} KB exceeds ${(UK_BASE_TOTAL_BUDGET_BYTES / 1024).toFixed(0)} KB budget`,
    );
  }
  return { manifestErrors, totalErrors, totalBytes };
}

function loadUkBaseCuratedVenueIds() {
  const errors = [];
  const curatedVenueIds = new Set();
  try {
    const londonSlim = loadJson("venues_slim.json");
    const londonRows = Array.isArray(londonSlim) ? londonSlim : londonSlim?.rows;
    for (const venue of Array.isArray(londonRows) ? londonRows : []) {
      if (typeof venue?.id === "string") curatedVenueIds.add(venue.id);
    }
    const citiesDir = join(DATA_DIR, "cities");
    for (const entry of readdirSync(citiesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const citySlimPath = join(citiesDir, entry.name, "venues_slim.json");
      if (!existsSync(citySlimPath)) continue;
      const citySlim = JSON.parse(readFileSync(citySlimPath, "utf8"));
      const cityRows = Array.isArray(citySlim) ? citySlim : citySlim?.rows;
      for (const venue of Array.isArray(cityRows) ? cityRows : []) {
        if (typeof venue?.id === "string") curatedVenueIds.add(venue.id);
      }
    }
  } catch (e) {
    errors.push(`could not load curated owner ids (${e.message})`);
  }
  return { errors, curatedVenueIds };
}

function validateUkBaseShardBody(shard, urlPrefix, onDisk) {
  const errors = [];
  if (Object.hasOwn(shard ?? {}, "url")) {
    errors.push(`shard "${shard?.id}": repeats a derivable URL`);
  }
  const shardId =
    typeof shard?.id === "string" &&
    shard.id.length > 0 &&
    !shard.id.includes("/") &&
    !shard.id.includes("\\") &&
    !shard.id.includes("..")
      ? shard.id
      : "";
  if (!shardId) errors.push(`shard "${shard?.id}": invalid id`);
  const file = `${urlPrefix}${shardId}.json`.replace(/^\/data\/uk_base\//, "");
  if (!onDisk.delete(file)) {
    errors.push(`shard "${shard?.id}": body ${file} is missing`);
    return { errors, rows: null };
  }
  let raw;
  let body;
  try {
    raw = readFileSync(join(UK_BASE_DIR, file), "utf8");
    body = JSON.parse(raw);
  } catch (e) {
    errors.push(`shard "${shard.id}": unreadable body (${e.message})`);
    return { errors, rows: null };
  }
  const bytes = Buffer.byteLength(raw);
  if (bytes >= UK_BASE_SHARD_BUDGET_BYTES) {
    errors.push(
      `shard "${shard.id}": ${(bytes / 1024).toFixed(1)} KB exceeds the ${(UK_BASE_SHARD_BUDGET_BYTES / 1024).toFixed(0)} KB per-viewport budget`,
    );
  }
  if (body.cell !== shard.id)
    errors.push(`shard "${shard.id}": body cell is "${body.cell}"`);
  const rows = Array.isArray(body.pubs) ? body.pubs : null;
  if (!rows) {
    errors.push(`shard "${shard.id}": body has no pubs array`);
    return { errors, rows: null };
  }
  if (rows.length !== shard.count) {
    errors.push(
      `shard "${shard.id}": ${rows.length} rows, manifest says ${shard.count}`,
    );
  }
  return { errors, rows };
}

function validateUkBasePubIdentity(shard, row, ids, curatedVenueIds) {
  const errors = [];
  const id = `${UK_BASE_ID_PREFIX}${row[0]}`;
  if (ids.has(id)) errors.push(`duplicate base id "${id}"`);
  ids.add(id);
  if (row[5] && !curatedVenueIds.has(row[5])) {
    errors.push(`shard "${shard.id}": unknown curated owner "${row[5]}"`);
  }
  return errors;
}

function validateUkBasePubBbox(shard, row) {
  const [minLng, minLat, maxLng, maxLat] = shard.bbox ?? [];
  if (
    row[3] < minLat ||
    row[3] > maxLat ||
    row[4] < minLng ||
    row[4] > maxLng
  ) {
    return [
      `shard "${shard.id}": pub "${row[1]}" at ${row[3]},${row[4]} is outside the cell bbox`,
    ];
  }
  return [];
}

function validateUkBaseShardRows(shard, rows, ids, curatedVenueIds) {
  const errors = [];
  let pubCount = 0;
  for (const row of rows) {
    if (!isUkBaseRow(row)) {
      errors.push(
        `shard "${shard.id}": malformed row ${JSON.stringify(row)?.slice(0, 60)}`,
      );
      continue;
    }
    errors.push(...validateUkBasePubIdentity(shard, row, ids, curatedVenueIds));
    // A pub outside its own cell means the viewport that covers it would
    // never fetch the file it lives in — an invisible pub, not a loud bug.
    errors.push(...validateUkBasePubBbox(shard, row));
    pubCount += 1;
  }
  return { errors, pubCount };
}

function validateUkBaseOrphans(onDisk) {
  return [...onDisk].map(
    (orphan) => `orphan shard body ${orphan} is not in the manifest`,
  );
}

function validateUkBaseManifestReferences(shards, urlPrefix) {
  const errors = [];
  for (const shard of shards) {
    const id = typeof shard?.id === "string" ? shard.id : "";
    const file = `${urlPrefix}${id}.json`.replace(/^\/data\/uk_base\//, "");
    if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
      errors.push(`manifest references invalid shard id "${id}"`);
      continue;
    }
    if (!existsSync(join(UK_BASE_DIR, file))) {
      errors.push(`manifest references missing shard body ${file}`);
    }
  }
  return errors;
}

function validateUkBaseCuratedIdCollisions(ids) {
  const errors = [];
  // The base layer exists to fill the gaps the curated index leaves; an id in
  // both would double-pin that pub.
  try {
    const slim = loadJson("venues_slim.json");
    const slimRows = Array.isArray(slim) ? slim : slim?.rows;
    if (Array.isArray(slimRows)) {
      for (const venue of slimRows) {
        if (venue && ids.has(venue.id)) {
          errors.push(`base id "${venue.id}" also exists in venues_slim`);
        }
      }
    }
  } catch {
    // venues_slim has its own check above; don't double-report its absence.
  }
  return errors;
}

function validateUkBaseShards() {
  const name = "public/data/uk_base shards";
  const errs = makeCollector();
  if (!existsSync(UK_BASE_DIR)) {
    console.log(
      `FAIL ${name}: missing — run node scripts/build_uk_base_shards.mjs`,
    );
    return { ok: false, count: 0 };
  }
  let manifestRaw;
  let manifest;
  try {
    manifestRaw = readFileSync(join(UK_BASE_DIR, "manifest.json"), "utf8");
    manifest = JSON.parse(manifestRaw);
  } catch (e) {
    console.log(`FAIL ${name}: missing/broken manifest (${e.message})`);
    return { ok: false, count: 0 };
  }

  const {
    errors: manifestErrors,
    shards,
    urlPrefix,
  } = validateUkBaseManifestShape(manifest);
  addUkBaseErrors(errs, manifestErrors);

  // Files on disk must match the manifest exactly: an orphan is dead weight in
  // the repo, and a missing one is a 404 mid-pan.
  const jsonFiles = listUkBaseJsonFiles(UK_BASE_DIR);
  const shardJsonFiles = jsonFiles.filter((file) => file !== UK_PLACE_INDEX_FILE);
  const onDisk = new Set(
    shardJsonFiles.filter((file) => file !== "manifest.json"),
  );
  // The browser expands these paths directly from manifest.json while panning.
  // Keep this explicit beside the parser so a manifest can never point at a
  // file that exists only in a local build or in an incidental deployment.
  addUkBaseErrors(errs, validateUkBaseManifestReferences(shards, urlPrefix));
  const budgets = validateUkBasePayloadBudgets(manifestRaw, shardJsonFiles);
  addUkBaseErrors(errs, budgets.manifestErrors);
  addUkBaseErrors(errs, validateUkPlaceIndex());

  const { errors: curatedErrors, curatedVenueIds } =
    loadUkBaseCuratedVenueIds();
  addUkBaseErrors(errs, curatedErrors);

  const ids = new Set();
  let pubCount = 0;
  for (const shard of shards) {
    const bodyResult = validateUkBaseShardBody(shard, urlPrefix, onDisk);
    addUkBaseErrors(errs, bodyResult.errors);
    if (!bodyResult.rows) continue;
    const rowResult = validateUkBaseShardRows(
      shard,
      bodyResult.rows,
      ids,
      curatedVenueIds,
    );
    addUkBaseErrors(errs, rowResult.errors);
    pubCount += rowResult.pubCount;
  }
  addUkBaseErrors(errs, validateUkBaseOrphans(onDisk));
  addUkBaseErrors(errs, budgets.totalErrors);
  addUkBaseErrors(errs, validateUkBaseCuratedIdCollisions(ids));

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${shards.length} cell(s), ${pubCount} pubs, total ${(budgets.totalBytes / 1024).toFixed(1)} KB / ${(UK_BASE_TOTAL_BUDGET_BYTES / 1024).toFixed(0)} KB, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: shards.length };
}

function validateFamousDetailArtifact({
  artifact,
  famous,
  id,
  rowCount,
  where,
  errs,
}) {
  if (rowCount !== 1) {
    errs.add(`${where}: famous venue rowCount must be 1`);
  }
  if (
    artifact.famous?.seed?.id !== id ||
    artifact.famous?.slim?.id !== id ||
    JSON.stringify(artifact.famous.seed) !== JSON.stringify(famous)
  ) {
    errs.add(`${where}: famous venue artifact does not match seed`);
  }
}

// venue_detail_index.json + venue_details.jsonl - server-side lazy detail
// artifacts generated beside venues_slim.json. The manifest points each venue
// id to a byte range in the JSONL file, so /api/venue/[id] reads one venue's
// pub-price rows or curated facts without loading every source on cold start.
function validateVenueDetails() {
  const name = "data/generated/venue_details.jsonl";
  const manifestName = "data/generated/venue_detail_index.json";
  const errs = makeCollector();
  let rows;
  let famousRows;
  try {
    rows = loadJson("pint_prices_app_dataset.json");
  } catch (e) {
    console.log(
      `FAIL ${name}: could not read full pint dataset for parity check (${e.message})`,
    );
    return { ok: false, count: 0 };
  }
  if (!Array.isArray(rows)) {
    console.log(
      `FAIL ${name}: expected full pint dataset to be a top-level array`,
    );
    return { ok: false, count: 0 };
  }
  try {
    famousRows = loadFamousVenues();
  } catch (e) {
    console.log(
      `FAIL ${name}: could not read famous venue seeds (${e.message})`,
    );
    return { ok: false, count: 0 };
  }

  const manifestPath = join(GENERATED_DATA_DIR, "venue_detail_index.json");
  const detailsPath = join(GENERATED_DATA_DIR, "venue_details.jsonl");
  if (!existsSync(manifestPath) || !existsSync(detailsPath)) {
    console.log(
      `FAIL ${name}: generated files are missing; run npm run build:slim`,
    );
    return { ok: false, count: 0 };
  }

  const expectedGroups = expectedVenueGroupsFromPintRows(rows);
  for (const [id, prices] of expectedGroups) {
    if (isReplacedByFamousVenue(prices[0], famousRows))
      expectedGroups.delete(id);
  }
  const famousById = new Map(famousRows.map((row) => [row.id, row]));
  const expectedIds = new Set([...expectedGroups.keys(), ...famousById.keys()]);
  const seenIds = new Set();
  let manifest;
  let details;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    details = readFileSync(detailsPath);
  } catch (e) {
    console.log(
      `FAIL ${name}: could not read/parse generated files (${e.message})`,
    );
    return { ok: false, count: 0 };
  }

  const venues = manifest?.venues;
  const entries =
    typeof venues === "object" && venues !== null ? Object.entries(venues) : [];

  if (manifest?.version !== 1) {
    errs.add(`${manifestName}: version must be 1`);
  }
  if (manifest?.detailsFile !== "venue_details.jsonl") {
    errs.add(`${manifestName}: detailsFile must be "venue_details.jsonl"`);
  }
  if (manifest?.count !== entries.length) {
    errs.add(
      `${manifestName}: count ${manifest?.count} does not match ${entries.length} manifest entries`,
    );
  }

  if (entries.length < DETAIL_VENUE_FLOOR) {
    errs.add(
      `venue count ${entries.length} is below the floor of ${DETAIL_VENUE_FLOOR} — detail artifact looks truncated`,
    );
  }
  // Same rationale as validateSlimVenues: without heritage seed data,
  // expectedIds deliberately omits every famous-venue id, so a mismatch
  // here reflects that absence, not a real data problem.
  const famousVenuesAvailable = existsSync(FAMOUS_VENUES_DIR);
  if (entries.length !== expectedIds.size) {
    if (famousVenuesAvailable) {
      errs.add(
        `venue count ${entries.length} does not match rebuilt expected count ${expectedIds.size}`,
      );
    } else {
      warnOptionalArtifact(
        "famous_venues_seed",
        `venue count ${entries.length} does not match rebuilt expected count ${expectedIds.size} (heritage seed data unavailable, parity unverifiable)`,
      );
    }
  }

  const spans = [];
  let unverifiableFamousRows = 0;
  entries.forEach(([id, entry], i) => {
    const where = `entry ${i + 1} (${id})`;
    if (typeof id !== "string" || id.length === 0) {
      errs.add(`entry ${i + 1}: missing/empty id`);
      return;
    }
    if (seenIds.has(id)) {
      errs.add(`${where}: duplicate id`);
    } else {
      seenIds.add(id);
    }
    if (!expectedIds.has(id)) {
      if (famousVenuesAvailable) {
        errs.add(`${where}: id is not present in rebuilt full-dataset index`);
      } else {
        unverifiableFamousRows += 1;
      }
    }
    if (typeof entry !== "object" || entry === null) {
      errs.add(`${where}: manifest entry is not an object`);
      return;
    }
    const { offset, length, rowCount } = entry;
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      !Number.isSafeInteger(rowCount) ||
      offset < 0 ||
      length <= 0 ||
      rowCount <= 0
    ) {
      errs.add(
        `${where}: offset, length, and rowCount must be positive safe integers`,
      );
      return;
    }
    if (offset + length > details.length) {
      errs.add(
        `${where}: byte range ${offset}-${offset + length} exceeds details file length ${details.length}`,
      );
      return;
    }
    spans.push({ id, start: offset, end: offset + length });
    let artifact;
    try {
      artifact = JSON.parse(
        details
          .subarray(offset, offset + length)
          .toString("utf8")
          .trim(),
      );
    } catch (e) {
      errs.add(`${where}: invalid JSON detail row (${e.message})`);
      return;
    }
    if (typeof artifact !== "object" || artifact === null) {
      errs.add(`${where}: detail row is not an object`);
      return;
    }
    if (artifact.id !== id) {
      errs.add(
        `${where}: artifact id ${artifact.id} does not match manifest id`,
      );
      return;
    }
    const famous = famousById.get(id);
    if (famous) {
      validateFamousDetailArtifact({
        artifact,
        famous,
        id,
        rowCount,
        where,
        errs,
      });
      return;
    }
    // Without heritage seed data, famousById is empty and expectedGroups
    // never excludes a famous-replaced id (isReplacedByFamousVenue has
    // nothing to match against), so a genuine famous-venue detail artifact
    // (a different row shape entirely) is indistinguishable from a plain
    // pint-price artifact whose id happens to still group normally. Content
    // shape can't be determined for any entry in that state. Already
    // counted as unverifiable above; skip content validation rather than
    // misjudge it against the wrong shape.
    if (!famousVenuesAvailable) {
      return;
    }
    if (!Array.isArray(artifact.rows) || artifact.rows.length === 0) {
      errs.add(`${where}: rows must be a non-empty array`);
      return;
    }
    if (artifact.rows.length !== rowCount) {
      errs.add(
        `${where}: rowCount ${rowCount} does not match ${artifact.rows.length} detail rows`,
      );
    }
    const expectedRows = expectedGroups.get(id);
    if (expectedRows && artifact.rows.length !== expectedRows.length) {
      errs.add(
        `${where}: row count ${artifact.rows.length} does not match rebuilt group ${expectedRows.length}`,
      );
    }
    for (const [j, price] of artifact.rows.entries()) {
      if (typeof price !== "object" || price === null) {
        errs.add(`${where} row ${j}: not an object`);
        continue;
      }
      const priceId = stableVenueIdFromKey(venueGroupingKey(price));
      if (priceId !== id) {
        errs.add(`${where} row ${j}: row groups to ${priceId}`);
      }
      if (
        expectedRows &&
        JSON.stringify(price) !== JSON.stringify(expectedRows[j])
      ) {
        errs.add(
          `${where} row ${j}: row content does not match the source pint dataset`,
        );
      }
    }
  });

  spans.sort((a, b) => a.start - b.start);
  if (spans.length > 0 && spans[0].start !== 0) {
    errs.add(
      `${manifestName}: byte ranges start at ${spans[0].start}, expected 0`,
    );
  }
  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i].start < spans[i - 1].end) {
      errs.add(
        `${manifestName}: byte range for ${spans[i].id} overlaps ${spans[i - 1].id}`,
      );
    } else if (spans[i].start > spans[i - 1].end) {
      errs.add(`${manifestName}: byte range gap before ${spans[i].id}`);
    }
  }
  if (spans.length > 0 && spans[spans.length - 1].end !== details.length) {
    errs.add(
      `${manifestName}: byte ranges end at ${spans[spans.length - 1].end}, details file has ${details.length} bytes`,
    );
  }

  const missing = Array.from(expectedIds).filter((id) => !seenIds.has(id));
  for (const id of missing.slice(0, 20)) {
    errs.add(`missing detail row for ${id}`);
  }
  if (missing.length > 20) {
    errs.add(`...and ${missing.length - 20} more missing detail rows`);
  }

  if (unverifiableFamousRows > 0) {
    warnOptionalArtifact(
      "famous_venues_seed",
      `${unverifiableFamousRows} detail entrie(s) could not be parity-checked against the rebuilt index (heritage seed data unavailable)`,
    );
  }

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${entries.length} venues (floor ${DETAIL_VENUE_FLOOR}), ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: entries.length };
}

// drink_price_updates/*.json — permissible-source drink price update files
// (E2 of docs/PRD_ALL_DRINKS.md). Mirrors lib/drinkPriceUpdates.ts
// isValidDrinkPriceUpdate exactly: a shipped file with even one bad row fails
// CI, because a bad row here means either a broken generator or (worse) an
// un-attributed / stale-presented-as-live price slipping through.
//
// London-bounds are NOT checked here (drink rows carry no lat/lng of their
// own — they key off venueKey, which is validated at merge time against the
// venue dataset instead).
function isHttpUrlLocal(v) {
  if (typeof v !== "string" || v.length === 0) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function validateOneDrinkPriceUpdateFile(fileName) {
  const name = `public/data/drink_price_updates/${fileName}`;
  const errs = makeCollector();
  let data;
  try {
    const raw = readFileSync(join(DRINK_PRICE_UPDATES_DIR, fileName), "utf8");
    data = JSON.parse(raw);
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  const rows = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null && Array.isArray(data.updates)
      ? data.updates
      : null;

  if (rows === null) {
    console.log(
      `FAIL ${name}: expected a top-level array or a { updates: [...] } envelope`,
    );
    return { ok: false, count: 0 };
  }

  const now = Date.now();
  rows.forEach((row, i) => {
    const where = `row ${i}`;
    if (typeof row !== "object" || row === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    if (typeof row.venueKey !== "string" || row.venueKey.length === 0) {
      errs.add(`${where}: missing/empty venueKey`);
    }
    if (typeof row.drinkName !== "string" || row.drinkName.length === 0) {
      errs.add(`${where}: missing/empty drinkName`);
    }
    if (typeof row.category !== "string" || row.category.length === 0) {
      errs.add(`${where}: missing/empty category`);
    } else if (!DRINK_CATEGORIES.has(row.category)) {
      errs.add(`${where}: invalid category "${row.category}"`);
    }
    if (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0) {
      errs.add(
        `${where}: priceGbp must be a finite number >= 0 (got ${JSON.stringify(row.priceGbp)})`,
      );
    }
    const source = row.source;
    if (typeof source !== "object" || source === null) {
      errs.add(`${where}: missing source`);
    } else {
      if (typeof source.label !== "string" || source.label.length === 0) {
        errs.add(`${where}: missing/empty source.label`);
      }
      if (!isHttpUrlLocal(source.url)) {
        errs.add(
          `${where}: source.url "${source.url}" is not an absolute http(s) URL`,
        );
      }
      // Governance: every fact carries {source, licence, observedAt} — a
      // permissible source is documented with a licence string.
      if (typeof source.licence !== "string" || source.licence.length === 0) {
        errs.add(`${where}: missing/empty source.licence`);
      }
    }
    if (typeof row.observedAt !== "string" || row.observedAt.length === 0) {
      errs.add(`${where}: missing/empty observedAt`);
    } else {
      const ms = Date.parse(row.observedAt);
      if (!Number.isFinite(ms)) {
        errs.add(
          `${where}: observedAt "${row.observedAt}" is not a valid ISO timestamp`,
        );
      } else if (ms > now) {
        // Never present stale as live — but also never a fabricated FUTURE
        // observation. A price cannot be "observed" before it happened.
        errs.add(`${where}: observedAt "${row.observedAt}" is in the future`);
      }
    }
  });

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${rows.length} rows, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: rows.length };
}

// Validates every *.json file in public/data/drink_price_updates/ (if the
// directory exists at all — it's optional until E2's refresh script has
// written a real file). Absence of the directory is NOT a failure; a bad file
// inside it IS.
function validateDrinkPriceUpdates() {
  if (!existsSync(DRINK_PRICE_UPDATES_DIR)) {
    console.log(
      "SKIP public/data/drink_price_updates/: directory does not exist",
    );
    return { ok: true, count: 0 };
  }
  const files = readdirSync(DRINK_PRICE_UPDATES_DIR).filter((f) =>
    f.endsWith(".json"),
  );
  if (files.length === 0) {
    console.log(
      "SKIP public/data/drink_price_updates/: no .json files present",
    );
    return { ok: true, count: 0 };
  }
  const results = files.map(validateOneDrinkPriceUpdateFile);
  const ok = results.every((r) => r.ok);
  const count = results.reduce((sum, r) => sum + r.count, 0);
  return { ok, count };
}

// whats_on/*.json — What's-On rows (Task B1). Mirrors lib/whatsOn.ts
// isValidWhatsOnRow: every row carries non-negotiable provenance ({label,url};
// NO licence field for this layer), a non-future observedAt, and a valid
// kind/confidence/startsAt. Files that are not rows files, or that declare a
// non-row kind (e.g. the sport_attributes sidecar, whose attribute rows have
// no startsAt by design), are SKIPPED — only timed row files are validated.
function validateOneWhatsOnFile(fileName) {
  const name = `public/data/whats_on/${fileName}`;
  let data;
  try {
    data = JSON.parse(readFileSync(join(WHATS_ON_DIR, fileName), "utf8"));
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (data && typeof data === "object" && data.kind === "sport_attributes") {
    console.log(
      `SKIP ${name}: attribute sidecar (different contract, no startsAt)`,
    );
    return { ok: true, count: 0 };
  }

  const rows = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null && Array.isArray(data.rows)
      ? data.rows
      : null;

  if (rows === null) {
    console.log(
      `SKIP ${name}: not a rows file (no top-level array or { rows: [...] })`,
    );
    return { ok: true, count: 0 };
  }

  const now = Date.now();
  const errors = [];
  rows.forEach((row, i) => {
    // ONE implementation of the row shape (lib/whatsOnRowShape.mjs), shared
    // with the app spine and scripts/refresh_whats_on.mjs. A hand-kept mirror
    // here is what let a date-only row be valid to the app and a hard failure
    // to this gate.
    for (const problem of whatsOnRowProblems(row, now)) errors.push(`row ${i}: ${problem}`);
  });

  const ok = errors.length === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${rows.length} rows, ${errors.length} error(s)`,
  );
  if (!ok) for (const e of errors.slice(0, 20)) console.log(`  - ${e}`);
  return { ok, count: rows.length };
}

// Validates every *.json in public/data/whats_on/ (if the directory exists).
// Absence of the directory is NOT a failure; a bad row file inside IS.
function validateWhatsOnUpdates() {
  if (!existsSync(WHATS_ON_DIR)) {
    console.log("SKIP public/data/whats_on/: directory does not exist");
    return { ok: true, count: 0 };
  }
  const files = readdirSync(WHATS_ON_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("SKIP public/data/whats_on/: no .json files present");
    return { ok: true, count: 0 };
  }
  const results = files.map(validateOneWhatsOnFile);
  const ok = results.every((r) => r.ok);
  const count = results.reduce((sum, r) => sum + r.count, 0);
  return { ok, count };
}

function isHttpUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const EDITORIAL_OVERLAY_FILE = join(DATA_DIR, "editorial", "latest.json");
const EDITORIAL_ALLOWED_SOURCES = new Set(EDITORIAL_FEEDS.map((feed) => feed.id));
const EDITORIAL_ATTRIBUTION_LABELS = new Map(
  EDITORIAL_FEEDS.map((feed) => [feed.id, feed.name]),
);
const EDITORIAL_FORBIDDEN_ITEM_KEYS = [
  "body",
  "content",
  "content:encoded",
  "content_encoded",
  "html",
  "fullText",
  "full_text",
];

// Editorial overlay is a credited link-out pack, not a harvest. Absence of
// latest.json is SKIP (the rail degrades); a present file with a body, extra
// keys, or an off-allowlist source is a hard fail.
function validateEditorialOverlay() {
  const name = "public/data/editorial/latest.json";
  if (!existsSync(EDITORIAL_OVERLAY_FILE)) {
    console.log(`SKIP ${name}: file does not exist`);
    return { ok: true, count: 0 };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(EDITORIAL_OVERLAY_FILE, "utf8"));
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    errors.push("snapshot must be an object");
  } else {
    if (data.version !== 1) {
      errors.push(`version must be 1 (got ${JSON.stringify(data.version)})`);
    }
    if (data.status !== "ready" && data.status !== "degraded") {
      errors.push(`status must be ready or degraded (got ${JSON.stringify(data.status)})`);
    }
    if (typeof data.generatedAt !== "string" || !Number.isFinite(Date.parse(data.generatedAt))) {
      errors.push("generatedAt must be an ISO timestamp");
    }
    if ("state" in data) {
      errors.push("snapshot must not store poller state");
    }
    if (!Array.isArray(data.items)) {
      errors.push("items must be an array");
    } else {
      data.items.forEach((item, i) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          errors.push(`item ${i}: not an object`);
          return;
        }
        const keys = Object.keys(item);
        for (const key of keys) {
          if (!EDITORIAL_ITEM_KEYS.includes(key)) {
            errors.push(`item ${i}: extra key ${key}`);
          }
        }
        for (const key of EDITORIAL_ITEM_KEYS) {
          if (!(key in item)) errors.push(`item ${i}: missing ${key}`);
        }
        for (const key of EDITORIAL_FORBIDDEN_ITEM_KEYS) {
          if (key in item) errors.push(`item ${i}: forbidden key ${key}`);
        }
        if (typeof item.source_id !== "string" || !EDITORIAL_ALLOWED_SOURCES.has(item.source_id)) {
          errors.push(`item ${i}: source_id is not on the allowlist`);
        }
        if (typeof item.title !== "string" || item.title.trim().length === 0) {
          errors.push(`item ${i}: title must be a non-empty string`);
        }
        if (!isHttpUrl(item.canonical_url)) {
          errors.push(`item ${i}: canonical_url must be an http(s) URL`);
        }
        if (typeof item.published_at !== "string" || !Number.isFinite(Date.parse(item.published_at))) {
          errors.push(`item ${i}: published_at must be an ISO timestamp`);
        }
        if (typeof item.excerpt !== "string") {
          errors.push(`item ${i}: excerpt must be a string`);
        } else {
          if (item.excerpt.length > 240) {
            errors.push(`item ${i}: excerpt exceeds 240 characters`);
          }
          if (/<[^>]+>/.test(item.excerpt)) {
            errors.push(`item ${i}: excerpt still has tags`);
          }
        }
        if (typeof item.attribution_label !== "string" || item.attribution_label.trim().length === 0) {
          errors.push(`item ${i}: attribution_label must be a non-empty string`);
        } else if (
          EDITORIAL_ATTRIBUTION_LABELS.get(item.source_id) !== item.attribution_label
        ) {
          errors.push(
            `item ${i}: attribution_label must match the allowlisted source name`,
          );
        }
      });
    }
  }

  const count = Array.isArray(data?.items) ? data.items.length : 0;
  const ok = errors.length === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${count} item(s), ${errors.length} error(s)`,
  );
  if (!ok) for (const error of errors.slice(0, 20)) console.log(`  - ${error}`);
  return { ok, count };
}

function validatePubmaxxingSource(data, errs) {
  if (data.version !== 1) {
    errs.add(`version must be 1 (got ${JSON.stringify(data.version)})`);
  }
  if (!data.source || !isHttpUrl(data.source.sourceRepo)) {
    errs.add("source.sourceRepo must be an http(s) URL");
  }
  if (
    !data.source ||
    typeof data.source.sourceCommit !== "string" ||
    data.source.sourceCommit.length < 7
  ) {
    errs.add("source.sourceCommit must be a git commit-ish string");
  }
  if (
    !data.source ||
    typeof data.source.importedAt !== "string" ||
    data.source.importedAt.length === 0
  ) {
    errs.add("source.importedAt must be a non-empty string");
  }
  if (
    typeof data.sourceImportedAt !== "string" ||
    data.sourceImportedAt.length === 0
  ) {
    errs.add("sourceImportedAt must be a non-empty string");
  } else if (
    data.source?.importedAt &&
    data.sourceImportedAt !== data.source.importedAt
  ) {
    errs.add("sourceImportedAt must match source.importedAt");
  }
}

function validatePubmaxxingSummary(data, rows, errs) {
  const { pubs, beverages, historySeeds, discountMentions } = rows;
  const summary =
    data.summary && typeof data.summary === "object" ? data.summary : null;
  if (!summary) {
    errs.add("summary must be an object");
  }

  const alcoholicRows = beverages.filter(
    (row) => row?.isAlcoholic === true,
  ).length;
  const nonAlcoholicRows = beverages.filter(
    (row) => row?.isAlcoholic === false,
  ).length;
  const unknownAlcoholicRows = beverages.filter(
    (row) => row?.isAlcoholic !== true && row?.isAlcoholic !== false,
  ).length;
  const expectedSummary = {
    pubs: pubs.length,
    beverageRows: beverages.length,
    alcoholicRows,
    nonAlcoholicRows,
    unknownAlcoholicRows,
    historySeeds: historySeeds.length,
    discountMentions: discountMentions.length,
    uniquePubIds: new Set(
      [
        ...pubs.map((row) => row?.pubId),
        ...beverages.map((row) => row?.pubId),
      ].filter(Boolean),
    ).size,
  };
  for (const [field, expected] of Object.entries(expectedSummary)) {
    if (summary?.[field] !== expected) {
      errs.add(`summary.${field} must equal computed count ${expected}`);
    }
  }
  return { alcoholicRows, nonAlcoholicRows, unknownAlcoholicRows };
}

// pubmaxxing_seed_snapshot.json — compact Firecrawl handoff seed from the
// sibling pubmaxxing repo. This data is not yet normalized into canonical live
// venue ids; validate it as an external seed so the all-drinks/history source
// import cannot silently disappear or truncate.
function validatePubmaxxingSeed() {
  const name = "public/data/pubmaxxing_seed_snapshot.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("pubmaxxing_seed_snapshot.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    console.log(`FAIL ${name}: expected a top-level object`);
    return { ok: false, count: 0 };
  }

  validatePubmaxxingSource(data, errs);

  const pubs = Array.isArray(data.pubs) ? data.pubs : [];
  const beverages = Array.isArray(data.beverages) ? data.beverages : [];
  const historySeeds = Array.isArray(data.historySeeds)
    ? data.historySeeds
    : [];
  const discountMentions = Array.isArray(data.discountMentions)
    ? data.discountMentions
    : [];

  if (pubs.length < PUBMAXXING_PUB_FLOOR) {
    errs.add(`pub count ${pubs.length} is below floor ${PUBMAXXING_PUB_FLOOR}`);
  }
  if (beverages.length < PUBMAXXING_BEVERAGE_ROW_FLOOR) {
    errs.add(
      `beverage row count ${beverages.length} is below floor ${PUBMAXXING_BEVERAGE_ROW_FLOOR}`,
    );
  }
  if (historySeeds.length < PUBMAXXING_HISTORY_SEED_FLOOR) {
    errs.add(
      `history seed count ${historySeeds.length} is below floor ${PUBMAXXING_HISTORY_SEED_FLOOR}`,
    );
  }

  const { alcoholicRows, nonAlcoholicRows, unknownAlcoholicRows } =
    validatePubmaxxingSummary(
      data,
      { pubs, beverages, historySeeds, discountMentions },
      errs,
    );
  if (alcoholicRows < PUBMAXXING_ALCOHOLIC_ROW_FLOOR) {
    errs.add(
      `alcoholic rows ${alcoholicRows} below floor ${PUBMAXXING_ALCOHOLIC_ROW_FLOOR}`,
    );
  }
  if (nonAlcoholicRows < PUBMAXXING_NON_ALCOHOLIC_ROW_FLOOR) {
    errs.add(
      `non-alcoholic rows ${nonAlcoholicRows} below floor ${PUBMAXXING_NON_ALCOHOLIC_ROW_FLOOR}`,
    );
  }
  if (unknownAlcoholicRows > PUBMAXXING_UNKNOWN_ALCOHOLIC_ROW_CEILING) {
    errs.add(
      `unknown isAlcoholic rows ${unknownAlcoholicRows} above ceiling ${PUBMAXXING_UNKNOWN_ALCOHOLIC_ROW_CEILING}`,
    );
  }

  pubs.forEach((row, i) => {
    if (!row || typeof row.pubId !== "string" || row.pubId.length === 0) {
      errs.add(`pub ${i}: missing pubId`);
    }
    if (!row || typeof row.name !== "string" || row.name.length === 0) {
      errs.add(`pub ${i}: missing name`);
    }
    if (row?.venueUrl && !isHttpUrl(row.venueUrl)) {
      errs.add(`pub ${i}: invalid venueUrl`);
    }
    if (row?.menuUrl && !isHttpUrl(row.menuUrl)) {
      errs.add(`pub ${i}: invalid menuUrl`);
    }
  });

  beverages.forEach((row, i) => {
    if (!row || typeof row.pubId !== "string" || row.pubId.length === 0) {
      errs.add(`beverage ${i}: missing pubId`);
    }
    if (!row || typeof row.name !== "string" || row.name.length === 0) {
      errs.add(`beverage ${i}: missing name`);
    }
    if (!row || typeof row.category !== "string" || row.category.length === 0) {
      errs.add(`beverage ${i}: missing category`);
    }
    if (row?.basePriceGbp !== null && !isFiniteNumber(row?.basePriceGbp)) {
      errs.add(`beverage ${i}: basePriceGbp must be number or null`);
    }
    if (
      row?.isAlcoholic !== true &&
      row?.isAlcoholic !== false &&
      row?.isAlcoholic !== null &&
      row?.isAlcoholic !== undefined
    ) {
      errs.add(`beverage ${i}: isAlcoholic must be boolean, null, or omitted`);
    }
    if (row?.sourceUrl && !isHttpUrl(row.sourceUrl)) {
      errs.add(`beverage ${i}: invalid sourceUrl`);
    }
  });

  historySeeds.forEach((row, i) => {
    if (!row || typeof row.pubId !== "string" || row.pubId.length === 0) {
      errs.add(`history ${i}: missing pubId`);
    }
    if (!row || !isHttpUrl(row.sourceUrl)) {
      errs.add(`history ${i}: invalid sourceUrl`);
    }
  });

  discountMentions.forEach((row, i) => {
    if (!row || typeof row.pubId !== "string" || row.pubId.length === 0) {
      errs.add(`discount ${i}: missing pubId`);
    }
    if (!row || !isHttpUrl(row.sourceUrl)) {
      errs.add(`discount ${i}: invalid sourceUrl`);
    }
  });

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${pubs.length} pubs, ${beverages.length} beverages, ${historySeeds.length} history seeds, ${discountMentions.length} discount mentions, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: beverages.length };
}

function validateNightSignalSnapshot() {
  const name = "public/data/night_signals/latest.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("night_signals/latest.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }
  if (
    data?.version !== 1 ||
    typeof data?.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(data.generatedAt)) ||
    !Array.isArray(data?.claims)
  ) {
    console.log(
      `FAIL ${name}: expected a v1 snapshot with generatedAt and claims`,
    );
    return { ok: false, count: 0 };
  }
  const seen = new Set();
  data.claims.forEach((claim, index) => {
    if (!isValidNightSignalClaim(claim))
      errs.add(
        `claim ${index}: invalid provenance, review, expiry, or route-effect contract`,
      );
    if (claim?.reviewState !== "approved")
      errs.add(
        `claim ${index}: public snapshot may only contain approved claims`,
      );
    if (seen.has(claim?.id))
      errs.add(`claim ${index}: duplicate id ${claim?.id}`);
    if (
      claim?.reviewedAt &&
      Date.parse(claim.reviewedAt) > Date.parse(data.generatedAt)
    )
      errs.add(`claim ${index}: review is newer than the snapshot`);
    seen.add(claim?.id);
  });
  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${data.claims.length} reviewed claims, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: data.claims.length };
}

// One per-observation check each, so the loop in validateWeatherSnapshotData
// reads as the checklist it enforces rather than one long branch chain.
function isKnownUniqueNightArea(row, areas, seen) {
  return areas.has(row?.nightArea) && !seen.has(row?.nightArea);
}

function hasValidWeatherEvidenceInterval(row, iso) {
  return (
    iso(row?.observedAt) &&
    iso(row?.expiresAt) &&
    Date.parse(row.expiresAt) > Date.parse(row.observedAt)
  );
}

function isWeatherObservationNoNewerThanSnapshot(row, generatedAt) {
  return Date.parse(row?.observedAt) <= Date.parse(generatedAt);
}

function hasValidWeatherCondition(row) {
  return typeof row?.condition === "string" && !!row.condition.trim();
}

function hasValidFeelsLikeC(row) {
  return (
    typeof row?.feelsLikeC === "number" &&
    row.feelsLikeC >= -40 &&
    row.feelsLikeC <= 60
  );
}

function hasValidPrecipitationProbability(row) {
  return (
    typeof row?.precipitationProbabilityPct === "number" &&
    row.precipitationProbabilityPct >= 0 &&
    row.precipitationProbabilityPct <= 100
  );
}

function hasValidWindKph(row) {
  return (
    row?.windKph === null ||
    (typeof row?.windKph === "number" && row.windKph >= 0 && row.windKph <= 300)
  );
}

function hasValidWeatherSourceProvenance(row, iso) {
  return (
    !!row?.source &&
    isHttpUrl(row.source.sourceUrl) &&
    typeof row.source.publisher === "string" &&
    !!row.source.publisher.trim() &&
    iso(row.source.publishedAt) &&
    Date.parse(row.source.publishedAt) <= Date.parse(row.observedAt)
  );
}

function validateWeatherObservation(row, index, areas, seen, iso, errs, generatedAt) {
  if (!isKnownUniqueNightArea(row, areas, seen))
    errs.add(`observation ${index}: invalid or duplicate Night Area`);
  seen.add(row?.nightArea);
  if (!hasValidWeatherEvidenceInterval(row, iso))
    errs.add(`observation ${index}: invalid evidence interval`);
  if (!isWeatherObservationNoNewerThanSnapshot(row, generatedAt))
    errs.add(`observation ${index}: newer than snapshot`);
  if (!hasValidWeatherCondition(row))
    errs.add(`observation ${index}: condition is required`);
  if (!hasValidFeelsLikeC(row))
    errs.add(`observation ${index}: invalid feelsLikeC`);
  if (!hasValidPrecipitationProbability(row))
    errs.add(`observation ${index}: invalid precipitation probability`);
  if (!hasValidWindKph(row)) errs.add(`observation ${index}: invalid windKph`);
  if (!hasValidWeatherSourceProvenance(row, iso))
    errs.add(`observation ${index}: invalid source provenance`);
}

function validateWeatherSnapshotData() {
  const name = "public/data/weather/latest.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("weather/latest.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }
  const areas = new Set([
    "clapham",
    "victoria",
    "piccadilly-soho",
    "canary-wharf",
    "barnes",
    "chiswick",
    "shoreditch",
    "camden",
    "brixton",
    "bermondsey-london-bridge",
    "kings-cross",
    "islington",
    "dalston",
    "peckham",
    "greenwich",
    "hammersmith",
    "balham",
    "marylebone",
    "richmond",
    "putney",
  ]);
  const iso = (value) =>
    typeof value === "string" && Number.isFinite(Date.parse(value));
  if (
    data?.version !== 1 ||
    !iso(data?.generatedAt) ||
    !Array.isArray(data?.observations)
  ) {
    console.log(
      `FAIL ${name}: expected a v1 snapshot with generatedAt and observations`,
    );
    return { ok: false, count: 0 };
  }
  const seen = new Set();
  for (const [index, row] of data.observations.entries()) {
    validateWeatherObservation(row, index, areas, seen, iso, errs, data.generatedAt);
  }
  if (data.observations.length !== 0 && data.observations.length !== areas.size)
    errs.add("a non-empty refresh must be atomic across all 20 Night Areas");
  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${data.observations.length} cached observations, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: data.observations.length };
}

// The snapshot's own top-level shape: status/generatedAt, classification
// provenance, and the three required arrays. Kept as one small gate so
// validatePintIndexSnapshot reads as "shape, then sources, then observations,
// then counts" rather than one long branch chain.
function validatePintIndexSnapshotShape(data, errs, iso) {
  if (
    data?.schemaVersion !== 1 ||
    !["published", "partial", "empty"].includes(data?.status) ||
    !iso(data?.generatedAt)
  )
    errs.add("expected a v1 snapshot with valid status and generatedAt");
  if (
    data?.classification?.version !== "london-borough-point-v1" ||
    data?.classification?.method !== "point_in_polygon" ||
    typeof data?.classification?.licence !== "string"
  )
    errs.add("invalid classification provenance");
  if (
    !Array.isArray(data?.sources) ||
    !Array.isArray(data?.observations) ||
    !Array.isArray(data?.excluded)
  )
    errs.add("sources, observations and excluded must be arrays");
}

// One source's eligibility: id/dup, kind, public URL, then the kind-specific
// evidence each pint-index source type must carry. Mutates `ids` exactly as
// the original inline loop did, so later observations can check membership.
function validatePintIndexSource(source, index, ids, errs, publicUrl, hostname) {
  if (!source?.id || ids.has(source.id))
    errs.add(`source ${index}: missing or duplicate id`);
  ids.add(source?.id);
  if (
    !["confirmed_pint_drop", "official_publisher", "open_data"].includes(
      source?.kind,
    )
  )
    errs.add(`source ${index}: ineligible kind`);
  if (!publicUrl(source?.sourceUrl))
    errs.add(`source ${index}: invalid public URL`);
  if (
    source?.kind === "confirmed_pint_drop" &&
    (source?.reviewState !== "confirmed" || !source?.confirmationId)
  ) {
    errs.add(`source ${index}: Pint Drop requires confirmed review evidence`);
  }
  if (source?.kind === "official_publisher") {
    const domain =
      typeof source?.officialDomain === "string"
        ? source.officialDomain.toLowerCase().replace(/^www\./, "")
        : "";
    const sourceHost = hostname(source?.sourceUrl);
    if (
      !["pub", "brewery"].includes(source?.publisherType) ||
      !domain ||
      !sourceHost ||
      (sourceHost !== domain && !sourceHost.endsWith(`.${domain}`))
    ) {
      errs.add(
        `source ${index}: official pub/brewery domain must match source URL`,
      );
    }
  }
  if (
    source?.kind === "open_data" &&
    (!source?.licence || !source?.datasetName)
  )
    errs.add(`source ${index}: open data requires a named, licensed dataset`);
}

// One observation's borough, price, timestamp, and source-id checks.
function validatePintIndexObservation(row, index, ids, errs, boroughs, code, iso) {
  if (
    !boroughs.has(row?.boroughName) ||
    code(row.boroughName ?? "") !== row?.boroughCode
  )
    errs.add(`observation ${index}: non-canonical borough`);
  if (!Number.isInteger(row?.pricePence) || row.pricePence <= 0)
    errs.add(`observation ${index}: invalid pricePence`);
  if (!iso(row?.observedAt)) errs.add(`observation ${index}: invalid observedAt`);
  if (!ids.has(row?.sourceId)) errs.add(`observation ${index}: unknown source`);
}

function validatePintIndexObservationCounts(data, errs) {
  if (data?.status === "empty" && (data?.observations?.length ?? 0) !== 0)
    errs.add("empty snapshot contains observations");
  if (data?.status !== "empty" && (data?.observations?.length ?? 0) === 0)
    errs.add("non-empty snapshot has no observations");
}

function validatePintIndexSnapshot() {
  const name = "public/data/pint_index_snapshot.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("pint_index_snapshot.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }
  const iso = (value) =>
    typeof value === "string" && Number.isFinite(Date.parse(value));
  const publicUrl = (value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  };
  const hostname = (value) => {
    try {
      return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return null;
    }
  };
  const boroughs = new Set([
    "Barking and Dagenham",
    "Barnet",
    "Bexley",
    "Brent",
    "Bromley",
    "Camden",
    "City of London",
    "Croydon",
    "Ealing",
    "Enfield",
    "Greenwich",
    "Hackney",
    "Hammersmith and Fulham",
    "Haringey",
    "Harrow",
    "Havering",
    "Hillingdon",
    "Hounslow",
    "Islington",
    "Kensington and Chelsea",
    "Kingston upon Thames",
    "Lambeth",
    "Lewisham",
    "Merton",
    "Newham",
    "Redbridge",
    "Richmond upon Thames",
    "Southwark",
    "Sutton",
    "Tower Hamlets",
    "Waltham Forest",
    "Wandsworth",
    "Westminster",
  ]);
  const code = (value) =>
    value
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  validatePintIndexSnapshotShape(data, errs, iso);
  const ids = new Set();
  for (const [index, source] of (data?.sources ?? []).entries()) {
    validatePintIndexSource(source, index, ids, errs, publicUrl, hostname);
  }
  for (const [index, row] of (data?.observations ?? []).entries()) {
    validatePintIndexObservation(row, index, ids, errs, boroughs, code, iso);
  }
  validatePintIndexObservationCounts(data, errs);
  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${data?.observations?.length ?? 0} public observations, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: data?.observations?.length ?? 0 };
}

function validatePintIndexEditionArchiveMeta(file, month, archive, data, start, end, errs, iso) {
  if (archive?.month !== month) errs.add(`${file}: archive.month does not match the file`);
  if (!iso(archive?.publishedAt)) errs.add(`${file}: archive.publishedAt must be an ISO date`);
  if (Date.parse(archive?.publishedAt) <= end.getTime()) errs.add(`${file}: published before the month closed`);
  if (data?.observationWindow?.start !== start.toISOString() ||
      data?.observationWindow?.end !== end.toISOString()) {
    errs.add(`${file}: observationWindow is not exactly ${month}`);
  }
}

function validatePintIndexEditionCorrections(file, archive, errs, iso, hex64) {
  const corrections = Array.isArray(archive?.corrections) ? archive.corrections : null;
  if (!corrections) errs.add(`${file}: archive.corrections must be an array`);
  else if (archive?.revision !== corrections.length + 1) errs.add(`${file}: revision must be corrections + 1`);
  corrections?.forEach((correction, index) => {
    if (!iso(correction?.issuedAt)) errs.add(`${file}: correction ${index} needs an ISO issuedAt`);
    if (typeof correction?.note !== "string" || !correction.note.trim()) errs.add(`${file}: correction ${index} needs a note`);
    if (correction?.previousRevision !== index + 1) errs.add(`${file}: correction ${index} must replace revision ${index + 1}`);
    if (!hex64.test(correction?.previousObservationsSha256 ?? "")) errs.add(`${file}: correction ${index} needs the replaced hash`);
  });
}

// Which month an observation belongs to, parsed to UTC exactly as
// lib/pintIndexArchive.ts pintIndexMonthOf does. A raw string prefix would
// read "2026-06-30T23:30:00-05:00" as June while the runtime validator reads
// it as July, and the build would stay green while the edition, its CSV and
// its sitemap entry silently stopped being served.
function validatePintIndexEditionObservationDates(file, month, rows, errs, observedMonth) {
  let datesParse = true;
  for (const [index, row] of rows.entries()) {
    const observed = observedMonth(row?.observedAt);
    if (observed === null) {
      datesParse = false;
      errs.add(`${file}: observation ${index} has no parseable observedAt`);
    } else if (observed !== month) {
      errs.add(`${file}: observation ${index} was not observed in ${month}`);
    }
  }
  return datesParse;
}

// A published month that no longer hashes to its stored digest has been
// rewritten, which is exactly the thing a citation must be able to rule out.
// The canonical form is imported, never restated here: a copy that drifts by
// one character would fail a correctly published edition, and the only
// reading of that failure is that someone rewrote a citation.
function validatePintIndexEditionIntegrityHash(file, archive, rows, errs, hex64) {
  if (!hex64.test(archive?.observationsSha256 ?? "")) {
    errs.add(`${file}: archive.observationsSha256 must be a hex sha256`);
  } else if (
    createHash("sha256").update(canonicalObservationsPayload(rows), "utf8").digest("hex") !==
    archive.observationsSha256
  ) {
    errs.add(`${file}: observations no longer match the published integrity hash`);
  }
}

// Validates one dated edition file and returns how many observations it
// contributes. Returns 0 (contributing nothing) for the two cases that used
// to `continue` past the whole file: unparseable JSON and a non-YYYY-MM name.
function validatePintIndexEditionFile(file, dir, errs, iso, hex64, observedMonth) {
  const month = file.slice(0, -".json".length);
  let data;
  try {
    data = JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch (e) {
    errs.add(`${file}: could not read/parse (${e.message})`);
    return 0;
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    errs.add(`${file}: not a YYYY-MM edition`);
    return 0;
  }

  const archive = data?.archive;
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) - 1);
  validatePintIndexEditionArchiveMeta(file, month, archive, data, start, end, errs, iso);
  validatePintIndexEditionCorrections(file, archive, errs, iso, hex64);

  const rows = Array.isArray(data?.observations) ? data.observations : [];
  const datesParse = validatePintIndexEditionObservationDates(file, month, rows, errs, observedMonth);
  // The canonical form the hash covers needs every date to parse; an
  // unparseable one is already reported, so do not crash re-deriving it.
  if (datesParse) {
    validatePintIndexEditionIntegrityHash(file, archive, rows, errs, hex64);
  }
  return rows.length;
}

function validatePintIndexEditions() {
  const name = "public/data/pint_index/*.json";
  const dir = join(DATA_DIR, "pint_index");
  const errs = makeCollector();
  if (!existsSync(dir)) {
    console.log(`PASS ${name}: no dated editions published yet`);
    return { ok: true, count: 0 };
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const hex64 = /^[0-9a-f]{64}$/;
  const observedMonth = (value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 7) : null;
  };
  let observations = 0;
  for (const file of files) {
    observations += validatePintIndexEditionFile(file, dir, errs, iso, hex64, observedMonth);
  }
  const ok = errs.count === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${files.length} dated edition(s), ${observations} frozen observation(s), ${errs.count} error(s)`);
  if (!ok) errs.report();
  return { ok, count: files.length };
}

function validateLateFoodEvidenceSnapshot() {
  const name = "public/data/late_food_evidence.json";
  let data;
  let localityNames;
  try {
    data = loadJson("late_food_evidence.json");
    localityNames = (
      loadJson("london_localities.json")?.localities ?? []
    ).map((locality) => locality?.name);
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }
  const errors = validateLateFoodEvidence(data, localityNames);
  const count = Object.values(data?.areas ?? {}).reduce(
    (sum, area) =>
      sum + (Array.isArray(area?.options) ? area.options.length : 0),
    0,
  );
  const ok = errors.length === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${Object.keys(data?.areas ?? {}).length} Night Areas, ${count} evidenced option(s), ${errors.length} error(s)`,
  );
  if (!ok)
    errors.slice(0, 20).forEach((error) => console.log(`    - ${error}`));
  return { ok, count };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

// One id/run pair per top-level dataset, in report order. Each id must have a
// matching entry in ARTIFACT_CLASSIFICATION: that is what decides whether a
// failing run below fails the build or degrades to a WARN.
const DATASET_RUNS = [
  { id: "london_pois", run: validatePois },
  { id: "london_localities", run: validateLondonLocalities },
  { id: "tfl_lines", run: validateTflLines },
  { id: "pint_prices_app_dataset", run: validatePintPrices },
  { id: "venues_slim", run: validateSlimVenues },
  { id: "city_venue_packs", run: validateCityVenuePacks },
  { id: "venues_slim_shards", run: validateSlimShards },
  { id: "uk_base_shards", run: validateUkBaseShards },
  { id: "venue_details", run: validateVenueDetails },
  { id: "drink_price_updates", run: validateDrinkPriceUpdates },
  { id: "whats_on", run: validateWhatsOnUpdates },
  { id: "night_signals", run: validateNightSignalSnapshot },
  { id: "weather_snapshot", run: validateWeatherSnapshotData },
  { id: "pint_index_snapshot", run: validatePintIndexSnapshot },
  { id: "pint_index_editions", run: validatePintIndexEditions },
  { id: "late_food_evidence", run: validateLateFoodEvidenceSnapshot },
  { id: "pubmaxxing_seed", run: validatePubmaxxingSeed },
  { id: "editorial_overlay", run: validateEditorialOverlay },
];

async function main() {
  console.log("Validating bundled datasets in public/data …\n");
  const results = DATASET_RUNS.map(({ id, run }) => ({
    id,
    ...classificationFor(id),
    ...run(),
  }));
  const hardFailures = results.filter((r) => !r.ok && r.required);
  const softDegradations = results.filter((r) => !r.ok && !r.required);
  if (softDegradations.length > 0) {
    console.log("");
    for (const r of softDegradations) {
      console.log(
        `  WARN ${r.id}: optional artifact missing or invalid, degrading, not failing the build (${r.reason})`,
      );
    }
  }

  // Freshness spine (WARN, never fail): schema validation above is a build gate
  // — a malformed dataset must block the merge. Cadence is different: a daily
  // cron that hasn't merged its PR yet, or a source still awaiting a provider
  // key, is stale-but-valid. That is owner-visibility, not a broken build, so a
  // freshness breach here only WARNs. The hard, non-zero gate lives in the
  // dedicated `node scripts/check_freshness.mjs`.
  // Dynamically imported so the "this script copies standalone into a scratch
  // repo" contract (see the drink-price validation test) still holds: when
  // check_freshness.mjs / the registry aren't alongside it, this SKIPs cleanly.
  try {
    const { evaluateFreshness } = await import("./check_freshness.mjs");
    const { results: fresh, breached } = await evaluateFreshness();
    const stale = fresh.filter((r) => r.status === "stale");
    const unknown = fresh.filter((r) => r.status === "unknown");
    console.log(
      "\nFreshness registry (advisory — see scripts/check_freshness.mjs):",
    );
    if (breached) {
      for (const r of [...stale, ...unknown]) {
        console.log(`  WARN ${r.id}: ${r.detail}`);
      }
      console.log(
        `  ${stale.length} stale, ${unknown.length} unresolved of ${fresh.length} datasets (not a build failure).`,
      );
    } else {
      console.log(
        `  OK: ${fresh.length} datasets within budget (or live/untracked).`,
      );
    }
  } catch (e) {
    // A registry problem must not break the data gate — it only dims a warning.
    console.log(`\nFreshness registry: SKIPPED (${e.message}).`);
  }

  console.log("");
  if (hardFailures.length > 0) {
    console.log(
      `DATA VALIDATION FAILED: ${hardFailures.length} of ${results.length} dataset(s) invalid (required).` +
        (softDegradations.length > 0
          ? ` ${softDegradations.length} optional dataset(s) also degraded.`
          : ""),
    );
    process.exit(1);
  }
  if (softDegradations.length > 0) {
    console.log(
      `DATA VALIDATION PASSED with ${softDegradations.length} optional dataset(s) degraded: all required datasets valid.`,
    );
    return;
  }
  console.log(`DATA VALIDATION PASSED: all ${results.length} datasets valid.`);
}

main();
