#!/usr/bin/env node
/**
 * Geocode unmatched London chain/guide pubs for the gazetteer seed.
 * Sources: postcodes.io (Eating Europe postcodes) + OSM Nominatim (1 req/s).
 * Never invents prices. Writes data/london_chain_gazetteer_seed.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANDS = process.env.CANDS_PATH || "/tmp/cands_geo.json";
const OUT = join(ROOT, "data/london_chain_gazetteer_seed.json");

const LAT_MIN = 51.26;
const LAT_MAX = 51.72;
const LON_MIN = -0.55;
const LON_MAX = 0.3;

const NAME_FIXES = {
  theconstitutioncamden: "The Constitution",
  theship: "The Ship",
  canonbury: "The Canonbury",
  nightingale: "The Nightingale",
};

function inLondon(lat, lng) {
  return LAT_MIN <= lat && lat <= LAT_MAX && LON_MIN <= lng && lng <= LON_MAX;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanName(raw) {
  let name = String(raw ?? "").trim();
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (NAME_FIXES[key]) return NAME_FIXES[key];
  if (/camden$/i.test(name) && /constitution/i.test(name)) return "The Constitution";
  return name;
}

function boroughFromNominatim(addr) {
  if (!addr || typeof addr !== "object") return "";
  return (
    addr.city_district ||
    addr.borough ||
    addr.suburb ||
    addr.town ||
    addr.city ||
    addr.county ||
    ""
  );
}

async function geocodePostcode(postcode) {
  const pc = encodeURIComponent(String(postcode).replace(/\s+/g, ""));
  const res = await fetch(`https://api.postcodes.io/postcodes/${pc}`);
  if (!res.ok) return null;
  const data = await res.json();
  const r = data?.result;
  if (!r) return null;
  const lat = Number(r.latitude);
  const lng = Number(r.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
    address: `${r.admin_ward || r.parish || ""}, ${r.postcode}`.replace(/^,\s*/, ""),
    primary_borough: r.admin_district || r.parliamentary_constituency || "London",
    method: "postcodes.io",
  };
}

async function geocodeNominatim(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "gb");
  const res = await fetch(url, {
    headers: {
      "User-Agent": "PubMaxxing/1.0 (+https://pubmaxxing.com; london-chain-gazetteer)",
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const hit = Array.isArray(rows) ? rows[0] : null;
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const addr = hit.address || {};
  const road = [addr.house_number, addr.road].filter(Boolean).join(" ");
  const locality = addr.suburb || addr.neighbourhood || addr.city_district || "";
  const postcode = addr.postcode || "";
  const address = [road, locality, postcode, "London"].filter(Boolean).join(", ");
  return {
    latitude: lat,
    longitude: lng,
    address,
    primary_borough: boroughFromNominatim(addr) || "London",
    method: "nominatim",
    osmDisplay: hit.display_name,
  };
}

function sourceMeta(chain) {
  if (chain === "nicholsons") {
    return {
      source_note: "Nicholson's official restaurant page — identity + menu links; no extractable £ prices",
      comment: "London chain gazetteer seed. Nicholson's first-party pub.",
      food: "yes",
      beer_garden: "",
      description: "Nicholson's historic pub — menu linked from first-party site.",
    };
  }
  if (chain === "youngs") {
    return {
      source_note: "Young's official best-pub-gardens listing + pub microsite",
      comment: "London chain gazetteer seed. Young's beer-garden pub.",
      food: "yes",
      beer_garden: "yes",
      description: "Young's pub with a beer garden — listed on youngs.co.uk garden guides.",
    };
  }
  return {
    source_note: "Eating Europe London pubs guide (editorial) — heritage pin, never prices",
    comment: "London chain gazetteer seed. Eating Europe editorial guide pub.",
    food: "yes",
    beer_garden: "",
    description: "Historic / guide-highlighted London pub from Eating Europe.",
  };
}

async function main() {
  const cands = JSON.parse(readFileSync(CANDS, "utf8"));
  const pubs = [];
  const failed = [];

  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const pubName = cleanName(c.pub_name);
    process.stdout.write(`[${i + 1}/${cands.length}] ${pubName} … `);

    let geo = null;
    try {
      if (c.postcode) {
        geo = await geocodePostcode(c.postcode);
        await sleep(200);
      }
      if (!geo) {
        const q =
          c.chain === "nicholsons" && c.slug
            ? `${pubName} pub London`
            : c.query || `${pubName}, London, UK`;
        geo = await geocodeNominatim(q);
        await sleep(1100);
      }
    } catch (err) {
      console.log("ERR", err?.message || err);
      failed.push({ ...c, pub_name: pubName, error: String(err?.message || err) });
      continue;
    }

    if (!geo || !inLondon(geo.latitude, geo.longitude)) {
      console.log("MISS", geo ? `${geo.latitude},${geo.longitude}` : "null");
      failed.push({ ...c, pub_name: pubName, geo });
      continue;
    }

    const meta = sourceMeta(c.chain);
    pubs.push({
      pub_name: pubName,
      pint_name: "",
      price_gbp: null,
      latitude: Number(geo.latitude.toFixed(5)),
      longitude: Number(geo.longitude.toFixed(5)),
      primary_borough: String(geo.primary_borough || "London").replace(/London Borough of /i, ""),
      address: geo.address || `${geo.primary_borough}, Greater London`,
      website: c.website || "",
      provenance: "sourced",
      source_note: meta.source_note,
      is_clean_canonical_app_row: false,
      food: meta.food,
      cocktails: "",
      beer_garden: c.beer_garden || meta.beer_garden,
      live_sports: "",
      comment: meta.comment,
      description: meta.description,
      chain: c.chain,
      geocode_method: geo.method,
    });
    console.log(`OK ${geo.latitude.toFixed(4)},${geo.longitude.toFixed(4)} (${geo.method})`);
  }

  const seed = {
    version: 1,
    wave: "london-chains",
    notes:
      "Curated real pubs from Nicholson's / Young's / Eating Europe scrapes. price_gbp is null — never invent prices. Geocoded via Nominatim / postcodes.io.",
    generatedAt: new Date().toISOString(),
    pubs,
    failed,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(seed, null, 2) + "\n");
  console.log(`\nWrote ${pubs.length} pubs → ${OUT} (${failed.length} failed)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
