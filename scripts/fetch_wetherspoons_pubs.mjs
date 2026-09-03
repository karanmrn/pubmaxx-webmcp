#!/usr/bin/env node
/**
 * Refresh the J D Wetherspoon first-party pub directory via Firecrawl.
 *
 * Why Firecrawl: direct curl to /wp-json/wp/v2/pubs is Cloudflare-cached
 * (always returns the same ~10 pubs). Firecrawl scrapes return real pages.
 *
 * Output:
 *   public/data/wetherspoons/pubs.json (single committed source — the app
 *     fetches this path at runtime) + pubs.geojson (kept in both locations)
 *   data/wetherspoons/ (facilities/region/pub_status taxonomies, raw dump)
 *
 * Requires FIRECRAWL_API_KEY in the environment (see .env / .env.example).
 * Does NOT invent food/drink prices — the website does not publish them.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "wetherspoons");
const PUBLIC_OUT = join(ROOT, "public", "data", "wetherspoons");
const FC_DIR = join(ROOT, ".firecrawl", "wetherspoons", "wp-pubs-refresh");

const BASE = "https://www.jdwetherspoon.com/wp-json/wp/v2";

function requireFirecrawl() {
  if (!process.env.FIRECRAWL_API_KEY) {
    console.error("FIRECRAWL_API_KEY is not set. Add it to .env and: set -a; source .env; set +a");
    process.exit(1);
  }
}

function firecrawlScrape(url, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  execFileSync(
    "firecrawl",
    ["scrape", url, "--format", "markdown", "-o", outPath],
    { stdio: "inherit", env: process.env },
  );
}

function parseMarkdownJson(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const md = raw.markdown || raw.data?.markdown || "";
  const fenced = md.match(/```json\s*(\[[\s\S]*\])\s*```/);
  const bare = md.match(/(\[\s*\{[\s\S]*\}\s*\])/);
  const match = fenced || bare;
  if (!match) throw new Error(`No JSON array in ${path}`);
  return JSON.parse(match[1]);
}

function scrapePaged(endpoint, outPrefix, maxPages = 20) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${BASE}/${endpoint}?per_page=100&page=${page}`;
    const outPath = join(FC_DIR, `${outPrefix}-page-${page}.json`);
    console.log(`Firecrawl scrape ${url}`);
    firecrawlScrape(url, outPath);
    const batch = parseMarkdownJson(outPath);
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    console.log(`  page ${page}: ${batch.length} (running ${items.length})`);
    if (batch.length < 100) break;
  }
  // Dedupe by id
  const byId = new Map();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function htmlTitle(t) {
  if (t && typeof t === "object") return String(t.rendered || "").trim();
  return String(t || "").trim();
}

function toFloat(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalize(pubs, facById, regionById, statusById) {
  return pubs
    .map((p) => {
      const acf = p.acf || {};
      return {
        wpId: p.id,
        jdwPubId: String(acf.jdw_pub_id || "") || null,
        slug: p.slug,
        name: htmlTitle(p.title),
        pageUrl: p.link,
        menuUrl: p.slug
          ? `https://www.jdwetherspoon.com/pub-menus/${p.slug}/`
          : null,
        phone: String(acf.phone_number || "").trim() || null,
        fullAddress: acf.full_address || null,
        addressLine1: acf.address_line_1 || null,
        addressLine2: acf.address_line_2 || null,
        townCity: acf.towncity || null,
        county: acf.county || null,
        postcode: acf.postcode || null,
        country: acf.country || null,
        latitude: toFloat(acf.latitude),
        longitude: toFloat(acf.longitude),
        bookATableLink: String(acf.book_a_table_link || "").trim() || null,
        regularOpeningTimes: acf.regular_opening_times || [],
        holidayOpeningTimes: acf.holiday_opening_times ?? null,
        childrensOpeningHour: acf.childrens_opening_hour || null,
        childrensTerminalHour: acf.childrens_terminal_hour || null,
        openingTimeNotes: acf.opening_time_notes || null,
        pubStatusNotes: acf.pub_status_notes || null,
        pubWithHotel: Boolean(acf.pub_with_hotel),
        pubHotelLink: String(acf.pub_hotel_link || "").trim() || null,
        facilities: (p.facilities || []).map((id) => facById.get(id) || `facility:${id}`),
        regions: (p.region || []).map((id) => regionById.get(id) || `region:${id}`),
        statuses: (p["pub-status"] || []).map(
          (id) => statusById.get(id) || `status:${id}`,
        ),
        modified: p.modified,
        menuPricesAvailableOnWeb: false,
        source: {
          label: "J D Wetherspoon official site (WP REST via Firecrawl)",
          url: p.link || "https://www.jdwetherspoon.com/",
          licence: "first-party public website / REST API",
        },
      };
    })
    .sort((a, b) =>
      `${a.country}|${a.townCity}|${a.name}`.localeCompare(
        `${b.country}|${b.townCity}|${b.name}`,
      ),
    );
}

function main() {
  requireFirecrawl();
  mkdirSync(OUT, { recursive: true });
  mkdirSync(PUBLIC_OUT, { recursive: true });
  mkdirSync(FC_DIR, { recursive: true });

  const pubs = scrapePaged("pubs", "pubs", 12);
  const facilities = scrapePaged("facilities", "facilities", 5);
  const regions = scrapePaged("region", "region", 5);
  const statuses = scrapePaged("pub-status", "pub-status", 2);

  const facById = new Map(facilities.map((f) => [f.id, f.name || f.slug]));
  const regionById = new Map(regions.map((r) => [r.id, r.name || r.slug]));
  const statusById = new Map(statuses.map((s) => [s.id, s.name || s.slug]));

  const slim = normalize(pubs, facById, regionById, statusById);
  const observedAt = new Date().toISOString();
  // Provenance invariant: every pub carries {source, observedAt}. This is
  // scraped/observed directory data — never presented as community data.
  for (const p of slim) p.observedAt = observedAt;
  const payload = {
    generatedAt: observedAt,
    source: `${BASE}/pubs`,
    discoveredVia: "Firecrawl map + WP REST scrape (Cloudflare bypass)",
    provenance: {
      source: `${BASE}/pubs`,
      observedAt,
      kind: "scraped-directory",
    },
    count: slim.length,
    notes: [
      "Full Wetherspoon pub directory from first-party WP REST API.",
      "Per-pub food/drink ITEM PRICES are NOT on the website (see data/wetherspoons/README.md).",
      "Each pub carries {source:{label,url,licence}, observedAt} — scraped/observed provenance, never presented as community data.",
    ],
    pubs: slim,
  };

  // pubs.json has a single committed home: public/data/wetherspoons/ (the
  // path the app fetches at runtime). data/wetherspoons/ keeps the other
  // build-only artifacts below, but no longer carries a duplicate copy.
  writeFileSync(join(PUBLIC_OUT, "pubs.json"), JSON.stringify(payload, null, 2));
  writeFileSync(
    join(OUT, "facilities.json"),
    JSON.stringify(
      [...facById.entries()].map(([id, name]) => ({ id, name })),
      null,
      2,
    ),
  );
  writeFileSync(
    join(OUT, "region.json"),
    JSON.stringify(
      [...regionById.entries()].map(([id, name]) => ({ id, name })),
      null,
      2,
    ),
  );
  writeFileSync(
    join(OUT, "pub_status.json"),
    JSON.stringify(
      [...statusById.entries()].map(([id, name]) => ({ id, name })),
      null,
      2,
    ),
  );

  const geo = {
    type: "FeatureCollection",
    provenance: { source: `${BASE}/pubs`, observedAt, kind: "scraped-directory" },
    features: slim
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [p.longitude, p.latitude],
        },
        properties: {
          name: p.name,
          slug: p.slug,
          jdwPubId: p.jdwPubId,
          townCity: p.townCity,
          postcode: p.postcode,
          country: p.country,
          pageUrl: p.pageUrl,
          menuUrl: p.menuUrl,
          facilities: p.facilities,
          regions: p.regions,
          source: p.source.label,
          observedAt: p.observedAt,
        },
      })),
  };
  writeFileSync(join(OUT, "pubs.geojson"), JSON.stringify(geo));
  writeFileSync(join(PUBLIC_OUT, "pubs.geojson"), JSON.stringify(geo));

  console.log(`Wrote ${slim.length} pubs → public/data/wetherspoons/ (+ taxonomies in data/wetherspoons/)`);
  if (existsSync(join(OUT, "pubs_raw.json"))) {
    console.log("(Leaving existing pubs_raw.json untouched — refresh does not rewrite the 12MB dump.)");
  }
}

main();
