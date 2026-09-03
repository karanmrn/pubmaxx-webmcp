#!/usr/bin/env node
// Pull notable UK pubs from Wikidata (CC0) that have an English Wikipedia
// article and coordinates. Writes a seed file for heritage/POI join work.
// Does NOT invent prices or merge into venues_slim.

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "public", "data", "wikidata_notable_pubs.json");
const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "PubMaxingNotablePubs/0.1 (https://pubmaxxing.com; coverage research)";

const QUERY = `
SELECT ?item ?itemLabel ?coord ?enwiki WHERE {
  ?item wdt:P31/wdt:P279* wd:Q212198 .
  ?item wdt:P17 wd:Q145 .
  ?item wdt:P625 ?coord .
  ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 800
`;

function parsePoint(wkt) {
  // Point(lng lat)
  const match = /^Point\(([-\d.]+)\s+([-\d.]+)\)$/i.exec(String(wkt ?? "").trim());
  if (!match) return null;
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  if (![lat, lng].every(Number.isFinite)) return null;
  return { lat, lng };
}

function qidFromUri(uri) {
  const match = /\/(Q\d+)$/.exec(String(uri ?? ""));
  return match ? match[1] : "";
}

function wikiTitleFromUri(uri) {
  try {
    const url = new URL(String(uri));
    const parts = url.pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1] || "").replace(/_/g, " ");
  } catch {
    return "";
  }
}

async function main() {
  const url = new URL(ENDPOINT);
  url.searchParams.set("format", "json");
  url.searchParams.set("query", QUERY);
  const response = await fetch(url, {
    headers: {
      accept: "application/sparql-results+json",
      "user-agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Wikidata SPARQL failed: HTTP ${response.status}`);
  }
  const json = await response.json();
  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings)) throw new Error("Unexpected SPARQL shape");

  const pubs = [];
  const seen = new Set();
  for (const row of bindings) {
    const qid = qidFromUri(row.item?.value);
    const name = String(row.itemLabel?.value ?? "").trim();
    const point = parsePoint(row.coord?.value);
    const wikipediaTitle = wikiTitleFromUri(row.enwiki?.value);
    if (!qid || !name || !point || !wikipediaTitle) continue;
    if (seen.has(qid)) continue;
    seen.add(qid);
    pubs.push({
      qid,
      name,
      lat: Math.round(point.lat * 1e5) / 1e5,
      lng: Math.round(point.lng * 1e5) / 1e5,
      wikipediaTitle,
      wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(
        wikipediaTitle.replace(/ /g, "_"),
      )}`,
    });
  }

  if (pubs.length < 50) {
    throw new Error(`Only ${pubs.length} notable pubs returned (expected many more)`);
  }

  const body = `${JSON.stringify(
    {
      source: "Wikidata Query Service",
      license: "CC0",
      attribution: "https://www.wikidata.org/wiki/Wikidata:Licensing",
      wikipediaTextLicense: "CC BY-SA 4.0",
      generatedAt: new Date().toISOString(),
      count: pubs.length,
      pubs,
    },
    null,
    2,
  )}\n`;

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  const temporaryPath = `${OUTPUT}.tmp`;
  await writeFile(temporaryPath, body);
  await rename(temporaryPath, OUTPUT);
  console.log(`Wikidata notable pubs → ${pubs.length} rows`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
