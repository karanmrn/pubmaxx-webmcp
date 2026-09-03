// Reproducible generator for the Greater London locality gazetteer shipped at
// public/data/london_localities.json.
//
// WHY THIS EXISTS
// The map's search popup (lib/mapSearchSuggest.ts) only knew the 20 modelled
// Night Areas plus boroughs derived from venue pins. The basemap, however,
// paints hundreds of locality labels (Willesden, Cricklewood, Brondesbury,
// Gospel Oak, Dollis Hill…) that returned nothing when searched. This script
// builds the full gazetteer of Greater London localities so every place a
// Londoner would name flies the camera to the right spot.
//
// SOURCE + LICENCE
// OpenStreetMap place nodes (place=suburb | neighbourhood | quarter | town |
// village) inside the 33 Greater London administrative areas, fetched once via
// the Overpass API. OSM data is © OpenStreetMap contributors, made available
// under the Open Database Licence (ODbL 1.0). The attribution and licence are
// written into the output file's header fields and noted in the repo README.
//
// HOW BOROUGH IS DERIVED
// We fetch the 33 London borough boundary relations with geometry, stitch their
// outer ways into rings, and assign each locality to the borough polygon that
// contains it (point-in-polygon). A locality outside every borough polygon is
// dropped — that clips the coarse bbox query down to the true Greater London
// administrative area.
//
// DEDUPE
//  - Against the 20 modelled Night Areas (name + aliases): a locality that IS a
//    modelled area is dropped, because the search surface already lists that
//    area with its coverage chip. (Runtime dedup in lib/mapSearchSuggest.ts is
//    the authoritative safety net; this is a clean-data convenience.)
//  - Against itself: same-name localities collapse to one entry (highest place
//    tier, then most central), so the dataset carries globally-unique names and
//    a search resolves to a single fly target.
//
// This is a ONE-TIME fetch. The committed JSON is the source of truth the app
// and the tests read; this script is never run in tests or at build time.
//
// Run: node scripts/gen_london_localities.mjs
// Plain Node ESM — no deps, no build step.

import { realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { haversineKmLngLat } from "./lib/geo.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const OUT_PATH = join(ROOT_DIR, "public", "data", "london_localities.json");

// Coarse Greater London bounding box — matches scripts/validate-data.mjs
// (LON_MIN/MAX, LAT_MIN/MAX). Used both to pre-filter the Overpass query and as
// the recorded bbox the validator checks every row against.
const BBOX = { latMin: 51.26, lonMin: -0.55, latMax: 51.72, lonMax: 0.3 };

const USER_AGENT = "pubmax-london-localities/1.0 (https://pubmaxxing.com; karanszdy@gmail.com)";

// Public Overpass endpoints, tried in order. The generator is resilient to a
// single busy mirror; the data is identical whichever one answers.
const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Greater London relation id on OSM — the container we clip the borough query to.
const GREATER_LONDON_REL = 175342;

// Place tiers we treat as "a locality a Londoner would name", most-locality-like
// first. The tier order breaks same-name ties when collapsing duplicates.
const PLACE_TIERS = ["suburb", "quarter", "neighbourhood", "town", "village"];

export function localityDistanceKm(aLng, aLat, bLng, bLat) {
  return haversineKmLngLat(aLng, aLat, bLng, bLat);
}

// The 20 modelled Night Areas (lib/nightAreas.ts) — names + aliases, normalised.
// A locality matching any of these is dropped so search never double-lists a
// modelled area (which carries a coverage chip) as a plain locality. Kept inline
// so this .mjs script has no cross-language import; lib/mapSearchSuggest.ts holds
// the authoritative runtime dedup against the live catalogue.
const MODELLED_AREA_LABELS = new Set(
  [
    "Clapham", "Clapham Common", "Clapham Junction",
    "Victoria", "Pimlico",
    "Piccadilly & Soho", "Piccadilly", "Soho",
    "Canary Wharf", "West India Quay",
    "Barnes", "Barnes Bridge",
    "Chiswick", "Turnham Green",
    "Shoreditch", "Old Street", "Hoxton",
    "Camden", "Camden Town", "Chalk Farm",
    "Brixton", "Brixton Village",
    "Bermondsey & London Bridge", "Bermondsey", "London Bridge", "Borough",
    "King's Cross", "Kings Cross", "Coal Drops Yard",
    "Islington", "Angel", "Upper Street",
    "Dalston", "Dalston Junction", "Dalston Kingsland",
    "Peckham", "Peckham Rye", "Bellenden Road",
    "Greenwich", "Greenwich Market", "Cutty Sark",
    "Hammersmith", "Hammersmith Broadway", "Ravenscourt Park",
    "Balham", "Balham Station",
    "Marylebone", "Baker Street", "Marylebone High Street",
    "Richmond", "Richmond Station", "Richmond Riverside",
    "Putney", "Putney Bridge", "East Putney",
  ].map(normalize),
);

function normalize(value) {
  return String(value).trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

async function overpass(query) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(180_000),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`non-JSON from ${endpoint}: ${text.slice(0, 160)}`);
        }
        if (!Array.isArray(json.elements)) throw new Error(`no elements from ${endpoint}`);
        console.log(`  ok: ${json.elements.length} elements from ${endpoint}`);
        return json.elements;
      } catch (err) {
        lastErr = err;
        console.log(`  retry (${endpoint}, attempt ${attempt + 1}): ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  throw new Error(`all Overpass endpoints failed: ${lastErr?.message ?? "unknown"}`);
}

// --- Geometry: ring stitching + point-in-polygon --------------------------

function ptEq(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

// Stitch a borough's outer ways (each an ordered [lon,lat] list sharing exact
// endpoint node coords) into closed rings.
function assembleRings(ways) {
  const segs = ways.map((w) => w.slice());
  const used = new Array(segs.length).fill(false);
  const rings = [];
  for (let i = 0; i < segs.length; i += 1) {
    if (used[i]) continue;
    let ring = segs[i].slice();
    used[i] = true;
    let extended = true;
    while (extended) {
      extended = false;
      const end = ring[ring.length - 1];
      for (let j = 0; j < segs.length; j += 1) {
        if (used[j]) continue;
        const s = segs[j];
        if (ptEq(end, s[0])) {
          ring = ring.concat(s.slice(1));
          used[j] = true;
          extended = true;
          break;
        }
        if (ptEq(end, s[s.length - 1])) {
          ring = ring.concat(s.slice(0, -1).reverse());
          used[j] = true;
          extended = true;
          break;
        }
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// Ray-casting point-in-polygon for a single ring of [lon,lat] pairs.
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function boundingBoxOf(rings) {
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < lonMin) lonMin = lon;
      if (lon > lonMax) lonMax = lon;
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
    }
  }
  return { lonMin, lonMax, latMin, latMax };
}

// --- Borough display names -------------------------------------------------

function boroughDisplayName(osmName) {
  if (osmName === "City of London") return "City of London";
  return osmName
    .replace(/^London Borough of /, "")
    .replace(/^Royal Borough of /, "")
    .replace(/^City of /, "")
    .trim();
}

export async function main() {
  console.log("Building Greater London locality gazetteer from OpenStreetMap…\n");

  // 1) Borough boundaries with geometry.
  console.log("Fetching 33 Greater London borough boundaries…");
  const boroughEls = await overpass(
    `[out:json][timeout:120];` +
      `rel(${GREATER_LONDON_REL});map_to_area->.gl;` +
      `(relation["admin_level"="8"]["boundary"="administrative"](area.gl);` +
      `relation["admin_level"="6"]["boundary"="administrative"]["name"="City of London"](area.gl););` +
      `out geom;`,
  );

  const boroughs = [];
  for (const rel of boroughEls) {
    const osmName = rel.tags?.name;
    if (!osmName || !Array.isArray(rel.members)) continue;
    const ways = rel.members
      .filter((m) => m.type === "way" && m.role === "outer" && Array.isArray(m.geometry))
      .map((m) => m.geometry.map((p) => [p.lon, p.lat]));
    if (ways.length === 0) continue;
    const rings = assembleRings(ways);
    if (rings.length === 0) continue;
    boroughs.push({
      name: boroughDisplayName(osmName),
      rings,
      box: boundingBoxOf(rings),
    });
  }
  console.log(`  assembled ${boroughs.length} borough polygons\n`);

  function boroughFor(lon, lat) {
    for (const b of boroughs) {
      if (lon < b.box.lonMin || lon > b.box.lonMax || lat < b.box.latMin || lat > b.box.latMax) {
        continue;
      }
      for (const ring of b.rings) {
        if (pointInRing(lon, lat, ring)) return b.name;
      }
    }
    return null;
  }

  // 2) Place nodes across the coarse Greater London bbox.
  console.log("Fetching OSM place nodes (suburb | neighbourhood | quarter | town | village)…");
  const placeEls = await overpass(
    `[out:json][timeout:120];` +
      `(node["place"~"^(suburb|neighbourhood|quarter|town|village)$"]` +
      `(${BBOX.latMin},${BBOX.lonMin},${BBOX.latMax},${BBOX.lonMax}););` +
      `out body;`,
  );
  console.log("");

  // 3) Filter, assign borough, drop modelled-area collisions.
  const candidates = [];
  let droppedNoBorough = 0;
  let droppedModelled = 0;
  for (const el of placeEls) {
    const name = el.tags?.name;
    const place = el.tags?.place;
    if (!name || !PLACE_TIERS.includes(place)) continue;
    const lat = el.lat;
    const lon = el.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lon < BBOX.lonMin || lon > BBOX.lonMax || lat < BBOX.latMin || lat > BBOX.latMax) continue;
    if (MODELLED_AREA_LABELS.has(normalize(name))) {
      droppedModelled += 1;
      continue;
    }
    const borough = boroughFor(lon, lat);
    if (!borough) {
      droppedNoBorough += 1;
      continue;
    }
    candidates.push({
      name: String(name).trim(),
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lon * 1e5) / 1e5,
      borough,
      tier: PLACE_TIERS.indexOf(place),
    });
  }
  console.log(
    `Candidates in a borough: ${candidates.length} ` +
      `(dropped ${droppedNoBorough} outside boroughs, ${droppedModelled} modelled-area collisions)`,
  );

  // 4) Collapse same-name duplicates to a single entry: highest place tier, then
  //    closest to the geometric centre of that name's cluster (the "dominant"
  //    node). Yields globally-unique normalised names.
  const byName = new Map();
  for (const c of candidates) {
    const key = normalize(c.name);
    const bucket = byName.get(key);
    if (bucket) bucket.push(c);
    else byName.set(key, [c]);
  }
  const localities = [];
  let collapsed = 0;
  for (const bucket of byName.values()) {
    if (bucket.length === 1) {
      const { tier, ...row } = bucket[0];
      void tier;
      localities.push(row);
      continue;
    }
    collapsed += bucket.length - 1;
    const cLon = bucket.reduce((s, r) => s + r.lng, 0) / bucket.length;
    const cLat = bucket.reduce((s, r) => s + r.lat, 0) / bucket.length;
    bucket.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return (
        localityDistanceKm(cLon, cLat, a.lng, a.lat)
        - localityDistanceKm(cLon, cLat, b.lng, b.lat)
      );
    });
    const { tier, ...row } = bucket[0];
    void tier;
    localities.push(row);
  }
  console.log(`Collapsed ${collapsed} same-name duplicate(s)`);

  // Deterministic order: borough, then name — stable diffs on regeneration.
  localities.sort(
    (a, b) => a.borough.localeCompare(b.borough) || a.name.localeCompare(b.name),
  );

  const output = {
    source: "OpenStreetMap via Overpass API",
    license: "ODbL 1.0",
    attribution: "© OpenStreetMap contributors — data licensed under the Open Database Licence (ODbL) 1.0, https://www.openstreetmap.org/copyright",
    generatedAt: new Date().toISOString().slice(0, 10),
    generator: "scripts/gen_london_localities.mjs",
    bbox: [BBOX.lonMin, BBOX.latMin, BBOX.lonMax, BBOX.latMax],
    placeTiers: PLACE_TIERS,
    count: localities.length,
    localities,
  };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${localities.length} localities → public/data/london_localities.json`);
  const perBorough = {};
  for (const l of localities) perBorough[l.borough] = (perBorough[l.borough] || 0) + 1;
  console.log("Per borough:", perBorough);
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch((err) => {
    console.error("FAILED:", err.message);
    process.exit(1);
  });
}
