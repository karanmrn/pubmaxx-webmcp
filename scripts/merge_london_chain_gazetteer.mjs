#!/usr/bin/env node
/**
 * Merge London chain/guide gazetteer seed into pint_prices_app_dataset.json.
 * Mirrors merge_outer_london_gazetteer.mjs but stamps website + chain provenance.
 *
 * Usage: node scripts/merge_london_chain_gazetteer.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = join(ROOT, "data/london_chain_gazetteer_seed.json");
const APP_PATH = join(ROOT, "public/data/pint_prices_app_dataset.json");

const LAT_MIN = 51.26;
const LAT_MAX = 51.72;
const LON_MIN = -0.55;
const LON_MAX = 0.3;

function inLondon(lat, lng) {
  return LAT_MIN <= lat && lat <= LAT_MAX && LON_MIN <= lng && lng <= LON_MAX;
}

function normName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

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
  const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  const pubs = Array.isArray(seed.pubs) ? seed.pubs : [];
  const app = JSON.parse(readFileSync(APP_PATH, "utf8"));
  if (!Array.isArray(app)) throw new Error("app dataset must be an array");

  const existingKeys = new Set(
    app.map((row) => venueKey(row.pub_name, row.latitude, row.longitude)),
  );
  // Also skip if same website already present (avoid near-dup pins)
  const existingWebsites = new Set(
    app
      .map((row) => String(row.website ?? "").trim().toLowerCase().replace(/\/$/, ""))
      .filter(Boolean),
  );

  let seq = nextAppPriceId(app);
  let added = 0;
  let skipped = 0;
  const byChain = {};

  for (const pub of pubs) {
    const lat = Number(pub.latitude);
    const lng = Number(pub.longitude);
    const name = String(pub.pub_name ?? "").trim();
    const borough = String(pub.primary_borough ?? "").trim();
    if (!name || !borough || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      skipped += 1;
      continue;
    }
    if (!inLondon(lat, lng)) {
      skipped += 1;
      continue;
    }
    const key = venueKey(name, lat, lng);
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    const website = String(pub.website ?? "").trim();
    const websiteKey = website.toLowerCase().replace(/\/$/, "");
    if (websiteKey && existingWebsites.has(websiteKey)) {
      skipped += 1;
      continue;
    }
    existingKeys.add(key);
    if (websiteKey) existingWebsites.add(websiteKey);
    seq += 1;
    added += 1;
    const chain = pub.chain || "unknown";
    byChain[chain] = (byChain[chain] ?? 0) + 1;

    app.push({
      app_price_id: `app_price_${String(seq).padStart(6, "0")}`,
      pub_name: name,
      pint_name: pub.pint_name || "",
      price_gbp: pub.price_gbp == null ? null : Number(pub.price_gbp),
      price_text:
        pub.price_gbp != null && Number.isFinite(Number(pub.price_gbp))
          ? `£${Number(pub.price_gbp).toFixed(2)}`
          : "",
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
      pub_key: createHash("sha1").update(key).digest("hex").slice(0, 12),
      pint_position_for_pub: "1",
      phone_number: "",
      email: "",
      website,
      booking_link: "",
      image_url: "",
      description: pub.description || "",
      comment: pub.comment || "London chain gazetteer seed.",
      food: pub.food || "",
      cocktails: pub.cocktails || "",
      beer_garden: pub.beer_garden || "",
      live_sports: pub.live_sports || "",
      live_music: "",
      pub_quiz: "",
      darts: "",
      pool: "",
      happy_hour: "",
      karaoke: "",
      cool: "",
      locality: borough,
      source_datasets: "london_chain_gazetteer_seed",
      data_quality_notes: "london_chain_gazetteer_seed|price_unknown",
      source_row_count: 1,
      visible_borough_source_row_count: 0,
      raw_embedded_source_row_count: 0,
      individual_pub_page_source_row_count: 0,
      has_visible_borough_row: false,
      has_raw_embedded_map_row: false,
      has_individual_pub_page_row: false,
      is_clean_canonical_app_row: false,
    });
  }

  writeFileSync(APP_PATH, JSON.stringify(app) + "\n");
  console.log(
    `Merged ${added} chain gazetteer pubs (skipped ${skipped}). By chain:`,
    byChain,
  );
  console.log(`Wrote ${APP_PATH} (${app.length} rows)`);
}

main();
