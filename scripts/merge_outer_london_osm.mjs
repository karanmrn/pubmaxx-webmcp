#!/usr/bin/env node
/**
 * Cycle-4 `data/outer-london-osm` — merge the keyless OSM/Overpass seed pack
 * (`data/osm/outer_london_osm_pubs.json`, produced by
 * `scripts/fetch_city_osm_pubs.mjs --london`) into the app dataset JSON, then
 * callers rebuild the slim index (canonicalize:venues → build:slim).
 *
 * Mission: venue PRESENCE for the worst-covered Outer London boroughs. These
 * rows are UNPRICED on purpose — `price_gbp: null` renders an honest pin with no
 * price. Inventing a price is forbidden; a real pub with no price beats no pin.
 *
 * Provenance: every row is stamped source=OpenStreetMap Overpass, the OSM id,
 * and the seed's fetched-at date, mirroring the gazetteer seed conventions.
 *
 * Dedupe: a cheap name+coord key blocks re-adding the exact same OSM row, and a
 * strengthened distance + name-similarity check (shared with the canonicalize
 * step) skips an OSM pub that already exists in the dataset under a matching-ish
 * name within a few metres — so a re-fetch never doubles a pin. canonicalize is
 * still the backstop for anything that slips through.
 *
 * Idempotent: re-running with the same seed adds 0 rows. Safe no-op when the
 * seed is missing or empty (e.g. Overpass was unreachable at fetch time).
 *
 * Usage: node scripts/merge_outer_london_osm.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  haversineMeters,
  namesLikelySamePub,
  normalizeVenueIdentityName,
  postcodeOutward,
} from "./lib/venueCanonicalization.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = join(ROOT, "data/osm/outer_london_osm_pubs.json");
const APP_PATH = join(ROOT, "public/data/pint_prices_app_dataset.json");

// Greater London safety net (mirrors the export + validate-data bounds).
const LAT_MIN = 51.26;
const LAT_MAX = 51.72;
const LON_MIN = -0.55;
const LON_MAX = 0.3;
// Same tight radius the canonicalize fuzzy pass uses — a matching-ish name this
// close to an existing venue is the same pub.
const NEAR_METERS = 45;

function inLondon(lat, lng) {
  return LAT_MIN <= lat && lat <= LAT_MAX && LON_MIN <= lng && lng <= LON_MAX;
}

function normName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Cheap exact key: identical name + 4-dp coords. Only blocks re-adding the very
// same OSM row on a repeat run; the near-duplicate check below does the real work.
function venueKey(name, lat, lng) {
  return `${normName(name)}|${Number(lat).toFixed(4)}|${Number(lng).toFixed(4)}`;
}

function nextAppPriceId(existing) {
  let max = 0;
  for (const row of existing) {
    const m = String(row.app_price_id ?? "").match(/app_price_(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function main() {
  if (!existsSync(SEED_PATH)) {
    console.log(`no OSM seed at ${relative(ROOT, SEED_PATH)} — nothing to merge (no-op).`);
    console.log("run `npm run fetch:london-pubs` first (needs Overpass network access).");
    return;
  }
  const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  const pubs = Array.isArray(seed.pubs) ? seed.pubs : [];
  const fetchedAt = typeof seed.fetchedAt === "string" ? seed.fetchedAt : new Date().toISOString();
  const attribution = seed.attribution || "© OpenStreetMap contributors";

  const app = JSON.parse(readFileSync(APP_PATH, "utf8"));
  if (!Array.isArray(app)) throw new Error("app dataset must be an array");

  const existingKeys = new Set(app.map((row) => venueKey(row.pub_name, row.latitude, row.longitude)));
  // Pre-index existing venues for the near-duplicate check.
  const existingVenues = app
    .map((row) => ({
      normName: normalizeVenueIdentityName(row.pub_name),
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      pc: postcodeOutward(row.address),
    }))
    .filter((v) => v.normName && Number.isFinite(v.lat) && Number.isFinite(v.lng));

  const isNearDuplicate = (name, lat, lng) => {
    const nn = normalizeVenueIdentityName(name);
    if (!nn) return false;
    for (const v of existingVenues) {
      if (haversineMeters(lat, lng, v.lat, v.lng) > NEAR_METERS) continue;
      if (namesLikelySamePub(nn, v.normName)) return true;
    }
    return false;
  };

  let seq = nextAppPriceId(app);
  let added = 0;
  let skippedDup = 0;
  const byBorough = {};

  for (const pub of pubs) {
    const lat = Number(pub.lat ?? pub.latitude);
    const lng = Number(pub.lng ?? pub.longitude);
    const name = String(pub.name ?? pub.pub_name ?? "").trim();
    const borough = String(pub.primary_borough ?? "").trim();
    if (!name || !borough || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!inLondon(lat, lng)) continue;

    const key = venueKey(name, lat, lng);
    if (existingKeys.has(key)) {
      skippedDup += 1;
      continue;
    }
    if (isNearDuplicate(name, lat, lng)) {
      skippedDup += 1;
      continue;
    }
    existingKeys.add(key);
    existingVenues.push({ normName: normalizeVenueIdentityName(name), lat, lng, pc: postcodeOutward(pub.address) });
    seq += 1;
    added += 1;
    byBorough[borough] = (byBorough[borough] ?? 0) + 1;

    const osmId = String(pub.osmId ?? "");
    const amenity = pub.amenity ? String(pub.amenity) : "pub";
    app.push({
      app_price_id: `app_price_${String(seq).padStart(6, "0")}`,
      pub_name: name,
      pint_name: "",
      price_gbp: null, // UNPRICED — honest pin, never an invented price.
      price_text: "",
      address: pub.address || `${borough}, Greater London`,
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
      pub_key: createHash("sha1").update(`osm|${osmId}|${key}`).digest("hex").slice(0, 12),
      pint_position_for_pub: "",
      phone_number: pub.phone || "",
      email: "",
      website: pub.website || "",
      booking_link: "",
      image_url: "",
      description: "",
      comment: `Outer London OSM presence (Cycle 4). OpenStreetMap ${amenity} ${osmId}; fetched ${fetchedAt}. ${attribution}.`,
      food: "",
      cocktails: "",
      beer_garden: pub.outdoorSeating ? "yes" : "",
      live_sports: "",
      live_music: "",
      pub_quiz: "",
      darts: "",
      pool: "",
      happy_hour: "",
      karaoke: "",
      cool: "",
      locality: borough,
      source_datasets: "outer_london_osm",
      source_row_count: 1,
      visible_borough_source_row_count: 0,
      raw_embedded_source_row_count: 0,
      individual_pub_page_source_row_count: 0,
      has_visible_borough_row: false,
      has_raw_embedded_map_row: false,
      has_individual_pub_page_row: false,
      is_clean_canonical_app_row: false,
      data_quality_notes: `outer_london_osm|osm_overpass|${osmId}|sourced`,
      scraped_at_values: fetchedAt,
    });
  }

  writeFileSync(APP_PATH, `${JSON.stringify(app)}\n`, "utf8");
  console.log(`merged ${added} OSM pubs into ${relative(ROOT, APP_PATH)} (${skippedDup} skipped as duplicates)`);
  console.log("by borough:", byBorough);
  console.log(`app rows now: ${app.length}`);
}

main();
