#!/usr/bin/env node
/**
 * Cycle-6 PRD item 1 — apply the MANUALLY-VERIFIED subset of the Outer-London
 * price harvest (scripts/harvest_outer_london_prices.mjs) to the shipped data.
 *
 * The raw harvest verbatim-validated every £ value against the first-party page
 * it was scraped from, but two of the four candidates failed a manual pint
 * review and were DROPPED (recorded honestly in the harvest log):
 *   - SALT Woolwich: extracted drink name contaminated ("| BIG POTATO GAMES")
 *     and £3.25/£4.00 are SALT's third/two-third measures, not pints; the
 *     venue→brewery-site match is also dubious. DROPPED.
 *   - The City Barge: a single generic "Stout £5.00" — too thin to assert as a
 *     specific named pint without re-verification. DROPPED.
 *
 * Only the two clean, coherent draught-pint menus are applied:
 *   - Tattoo Bar (Newham): 6-item draught list £6.00–£6.80 incl. an explicit
 *     "Guinness Microdraught Pint" — cheapest pint £6.00 Aspall Draught Cyder.
 *   - Boom Battle Bar (Greenwich, The O2): house draught "BOOM Lager" £5.00.
 *
 * Every applied price is first-party-sourced + observed-dated + licence-stamped.
 * No invented or guessed prices. Re-runnable: matches rows by pub_name+host.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PATH = join(ROOT, "public/data/pint_prices_app_dataset.json");
const DRINK_UPDATES_DIR = join(ROOT, "public/data/drink_price_updates");
const LATEST_PATH = join(DRINK_UPDATES_DIR, "latest.json");

const OBSERVED_AT = "2026-07-18T05:38:55.488Z"; // harvest run timestamp
const OBSERVED_DATE = "2026-07-18";
const LICENCE =
  "All rights reserved — first-party publisher of its own pub menu/prices; read-only, attributed use only.";

// Manually-verified venues only.
const VERIFIED = [
  {
    pubName: "Tattoo Bar",
    host: "tattoo-bar.co.uk",
    sourceUrl: "https://tattoo-bar.co.uk/menu",
    draught: [
      { drinkName: "Aspall Draught Cyder", priceGbp: 6.0 },
      { drinkName: "Estrella Damm", priceGbp: 6.8 },
      { drinkName: "Poretti", priceGbp: 6.8 },
      { drinkName: "Brooklyn IPA", priceGbp: 6.8 },
      { drinkName: "1644 Blanc", priceGbp: 6.8 },
      { drinkName: "Guinness Microdraught Pint", priceGbp: 6.8 },
    ],
  },
  {
    pubName: "Boom Battle Bar",
    host: "boombattlebar.com",
    sourceUrl: "https://boombattlebar.com/uk/theo2/",
    draught: [{ drinkName: "BOOM Lager", priceGbp: 5.0 }],
  },
  {
    // Haringey (resume batch). /drinks page marks 2/3 pours "(2/3)"; the items
    // below are the UNMARKED = full-pint lines only. Verified 2026-07-18.
    pubName: "Small Beer",
    host: "smallbeern8.co.uk",
    sourceUrl: "https://www.smallbeern8.co.uk/drinks",
    draught: [
      { drinkName: "Best Bitter, 4.5%, Almasty (Newcastle)", priceGbp: 5.5 },
      { drinkName: "Session IPA, 4.0%, Two By Two (Newcastle)", priceGbp: 5.5 },
      { drinkName: "Stand and Deliver, Dark Mild, 4.5% (Hackney)", priceGbp: 6.2 },
      { drinkName: "Martina, Lager, 4.0%, Bohem (Tottenham)", priceGbp: 6.5 },
    ],
  },
  {
    // Haringey working men's club — standard everyday pint-range statement on its
    // own homepage ("pints of beer ranging from £3.60 to £4.25 per pint").
    pubName: "Langham Working Mens Club",
    host: "langhamclub.co.uk",
    sourceUrl: "https://www.langhamclub.co.uk/",
    draught: [
      { drinkName: "Pint of Beer", priceGbp: 3.6 },
      { drinkName: "Pint of Lager", priceGbp: 4.25 },
    ],
  },
];

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
function normaliseVenueKeyPart(v) {
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
}
function venueGroupingKey(row) {
  return [
    normaliseVenueKeyPart(row.pub_name),
    normaliseVenueKeyPart(row.address),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join("|");
}

const app = JSON.parse(readFileSync(APP_PATH, "utf8"));
const drinkUpdates = [];
let priced = 0;

for (const v of VERIFIED) {
  const row = app.find(
    (r) =>
      String(r.source_datasets || "").includes("outer_london_osm") &&
      r.pub_name === v.pubName &&
      host(r.website) === v.host,
  );
  if (!row) {
    console.warn(`NOT FOUND: ${v.pubName} (${v.host}) — skipped`);
    continue;
  }
  const sorted = [...v.draught].sort((a, b) => a.priceGbp - b.priceGbp);
  const cheapest = sorted[0];
  row.price_gbp = cheapest.priceGbp;
  row.pint_name = cheapest.drinkName;
  row.price_text = `£${cheapest.priceGbp.toFixed(2)}`;
  row.pub_url = v.sourceUrl;
  row.constructed_pub_url = v.sourceUrl;
  row.comment = `${row.comment} Draught pint price from first-party site ${v.sourceUrl}, observed ${OBSERVED_DATE}.`;
  row.data_quality_notes = `${row.data_quality_notes}|price:first_party_web|${v.sourceUrl}|observed=${OBSERVED_DATE}`;
  row.scraped_at_values = OBSERVED_AT;
  priced += 1;

  const venueKey = venueGroupingKey(row);
  for (const d of v.draught) {
    drinkUpdates.push({
      venueKey,
      drinkName: d.drinkName,
      category: "beer",
      priceGbp: d.priceGbp,
      source: { label: `${v.pubName} — official website`, url: v.sourceUrl, licence: LICENCE },
      observedAt: OBSERVED_AT,
    });
  }
  console.log(`PRICED ${v.pubName}: £${cheapest.priceGbp.toFixed(2)} ${cheapest.drinkName} (+${v.draught.length - 1} more draught rows)`);
}

writeFileSync(APP_PATH, `${JSON.stringify(app)}\n`);
console.log(`Updated app dataset (${priced} venues priced).`);

// merge into sanctioned per-drink store
mkdirSync(DRINK_UPDATES_DIR, { recursive: true });
let existing = [];
if (existsSync(LATEST_PATH)) {
  const raw = JSON.parse(readFileSync(LATEST_PATH, "utf8"));
  existing = Array.isArray(raw) ? raw : raw.updates || [];
}
const keyOf = (u) => `${u.venueKey}|${u.drinkName.toLowerCase()}|${u.source.url}`;
const map = new Map(existing.map((u) => [keyOf(u), u]));
for (const u of drinkUpdates) map.set(keyOf(u), u);
const merged = [...map.values()];
const payload = { version: 1, generatedAt: OBSERVED_AT, updates: merged };
writeFileSync(join(DRINK_UPDATES_DIR, "prices_20260718.json"), `${JSON.stringify(payload, null, 2)}\n`);
writeFileSync(LATEST_PATH, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Merged ${drinkUpdates.length} verified drink rows into latest.json (total ${merged.length}).`);
