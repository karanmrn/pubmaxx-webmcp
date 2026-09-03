#!/usr/bin/env node
/**
 * Greene King drink price harvester using local refresh providers.
 *
 * Governance: first-party Greene King menus only (see data/price_sources.json).
 * Writes public/data/drink_price_updates/latest.json — sourced rows with licence.
 *
 * Usage:
 *   node scripts/firecrawl_greene_king_prices.mjs [--limit N]
 *   node scripts/firecrawl_greene_king_prices.mjs --urls-file .firecrawl/gk-london-menu-urls.txt
 *
 * Requires EXA_API_KEY for discovery and BROWSERBASE_API_KEY for rendered menus.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GK_SLUG_HINTS,
  buildVenueIndexes,
  menuUrlToVenueId,
  mergeDrinkUpdates,
  normalisePubName,
  resolveVenueKeyFromHints,
} from "./lib/venueMatch.mjs";
import {
  assertProviderCredentials,
  discoverRefreshPages,
  fetchRefreshPage,
} from "./lib/localRefreshProviders.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "data", "drink_price_updates");
const MENU_CACHE = join(ROOT, ".firecrawl", "menus");
const DEFAULT_URLS = join(ROOT, "data", "greene_king_london_menu_urls.txt");
const ENRICHMENT_PATH = join(ROOT, "public", "data", "venue_menu_enrichment.json");
const DATASET_PATH = join(ROOT, "public", "data", "pint_prices_app_dataset.json");

const SOURCE = {
  label: "Greene King — official menu",
  licence:
    "All rights reserved — first-party publisher of its own pub menus/prices; read-only, attributed use only.",
};

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

// --- parser -----------------------------------------------------------------

const SECTION_HEADING = /^###\s+(.+)$/;
const ITEM_HEADING = /^####\s+(.+)$/;
const PRICE_LINE = /£\s*(\d+(?:\.\d{2})?)/;

function mapSectionToCategory(section) {
  const s = section.toLowerCase();
  if (
    s.includes("main menu") ||
    s.includes("dessert") ||
    s.includes("snack") ||
    s.includes("kids") ||
    s.includes("ciabatta") ||
    s.includes("sunday menu") ||
    s.includes("gluten")
  ) {
    return null;
  }
  if (s.includes("wine") || s.includes("champagne") || s.includes("spark")) return "wine";
  if (s.includes("cocktail") || s.includes("spritz") || s.includes("0%")) return "cocktail";
  if (
    s.includes("beer") ||
    s.includes("lager") ||
    s.includes("ale") ||
    s.includes("cider") ||
    s.includes("draught") ||
    s.includes("keg") ||
    s.includes("stout")
  ) {
    return "beer";
  }
  if (s.includes("whisk") || s.includes("whiskey")) return "whisky";
  if (s.includes("gin")) return "gin";
  if (s.includes("vodka")) return "vodka";
  if (s.includes("rum")) return "rum";
  if (s.includes("spirit") || s.includes("shot")) return "shot";
  if (s.includes("coffee") || s.includes("hot drink")) return "coffee";
  if (
    s.includes("alcohol-free") ||
    s.includes("alcohol free") ||
    s.includes("non-alcoholic") ||
    s.includes("no & low") ||
    s.includes("no and low")
  ) {
    return "alcohol-free";
  }
  if (s.includes("soft drink")) return "soft-drink";
  if (s.includes("drink")) return "soft-drink";
  // Unknown headings are food sections (sharers, burgers, pizza, grills, sides,
  // …), never drinks — skip them so food never leaks into the drink payload.
  return null;
}

function firstPriceFromLines(lines) {
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed === "glass" || trimmed === "bottle" || trimmed === "pint") continue;
    const prices = [...line.matchAll(/£\s*(\d+(?:\.\d{2})?)/g)].map((m) => parseFloat(m[1]));
    if (prices.length === 0) continue;
    return Math.min(...prices);
  }
  return null;
}

function parseGreeneKingMenuMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let section = null;
  let itemName = null;
  let itemLines = [];

  const flushItem = () => {
    if (!itemName || !section) {
      itemName = null;
      itemLines = [];
      return;
    }
    const category = mapSectionToCategory(section);
    if (!category) {
      itemName = null;
      itemLines = [];
      return;
    }
    const price = firstPriceFromLines(itemLines);
    if (price !== null) {
      out.push({ drinkName: itemName.trim(), category, priceGbp: price });
    }
    itemName = null;
    itemLines = [];
  };

  for (const line of lines) {
    const sectionMatch = line.match(SECTION_HEADING);
    if (sectionMatch) {
      flushItem();
      section = sectionMatch[1].trim();
      continue;
    }
    const itemMatch = line.match(ITEM_HEADING);
    if (itemMatch) {
      flushItem();
      itemName = itemMatch[1].trim();
      itemLines = [];
      continue;
    }
    if (itemName) itemLines.push(line);
  }
  flushItem();
  return out;
}

function slugFromMenuUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const menuIdx = parts.lastIndexOf("menu");
    if (menuIdx < 1) return null;
    return parts[menuIdx - 1] ?? null;
  } catch {
    return null;
  }
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((w) => (w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// --- venue keys (shared: scripts/lib/venueMatch.mjs) ------------------------

function resolveVenueKey(url, indexes, menuUrlToId) {
  const normalised = url.replace(/\/$/, "");
  const venueId = menuUrlToId.get(normalised);
  if (venueId && indexes.idToKey.has(venueId)) {
    return indexes.idToKey.get(venueId);
  }
  const slug = slugFromMenuUrl(url);
  if (!slug) return null;

  const hints = GK_SLUG_HINTS[slug];
  if (hints) {
    const keyed = resolveVenueKeyFromHints(hints, indexes);
    if (keyed) return keyed;
  }

  const title = titleFromSlug(slug);
  const norm = normalisePubName(title);
  const keys = indexes.nameToKeys.get(norm);
  if (keys?.length === 1) return keys[0];
  if (keys && keys.length > 1) return keys[0];

  const tokens = slug.split("-").filter((t) => t.length > 2 && t !== "the");
  return resolveVenueKeyFromHints(tokens, indexes);
}

// Keep this cache path stable. Downstream merge scripts treat it as an input contract.

async function scrapeMenu(url, outPath) {
  if (existsSync(outPath)) {
    return readFileSync(outPath, "utf8");
  }
  mkdirSync(dirname(outPath), { recursive: true });
  const page = await fetchRefreshPage({ job: "rendered-menu", url });
  writeFileSync(outPath, `${page.markdown.trim()}\n`);
  return page.markdown;
}

// --- main -------------------------------------------------------------------

function parseArgs(argv) {
  let limit = 14;
  let urlsFile = DEFAULT_URLS;
  let merge = false;
  let onlyUrlsFile = false;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--limit" && argv[i + 1]) {
      limit = parseInt(argv[++i], 10);
    } else if (argv[i] === "--urls-file" && argv[i + 1]) {
      urlsFile = argv[++i];
      onlyUrlsFile = true;
    } else if (argv[i] === "--merge") {
      merge = true;
    }
  }
  return { limit, urlsFile, merge, onlyUrlsFile };
}

function loadExistingUpdates() {
  const latest = join(OUT_DIR, "latest.json");
  if (!existsSync(latest)) return [];
  try {
    const raw = JSON.parse(readFileSync(latest, "utf8"));
    return Array.isArray(raw) ? raw : (raw.updates ?? []);
  } catch {
    return [];
  }
}

async function main() {
  const { limit, urlsFile, merge, onlyUrlsFile } = parseArgs(process.argv);
  const observedAt = new Date().toISOString();
  assertProviderCredentials(["pub-discovery", "rendered-menu"]);

  const enrichment = JSON.parse(readFileSync(ENRICHMENT_PATH, "utf8"));
  const enrichmentUrls = Object.values(enrichment.venues ?? {})
    .map((v) => v.menuUrl)
    .filter(Boolean);

  let bulkUrls = [];
  if (existsSync(urlsFile)) {
    bulkUrls = readFileSync(urlsFile, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));
  }
  const knownUrls = [...new Set([...enrichmentUrls, ...bulkUrls])];
  let discoveredUrls = [];
  if (!onlyUrlsFile) {
    const discoveries = await discoverRefreshPages({
      query: "new London Greene King pub official drinks menu prices",
      includeDomains: ["greeneking.co.uk"],
      numResults: Math.min(10, Math.max(1, limit)),
    });
    discoveredUrls = discoveries
      .map((result) => result.url)
      .filter((url) => {
        try {
          const parsed = new URL(url);
          return parsed.hostname.endsWith("greeneking.co.uk") && /\/menu\/?$/i.test(parsed.pathname);
        } catch {
          return false;
        }
      });
  }
  const candidates = onlyUrlsFile
    ? bulkUrls
    : limit > 1 && discoveredUrls.length
      ? [discoveredUrls[0], ...knownUrls]
      : knownUrls;
  const urls = [...new Set(candidates)].slice(0, limit);

  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  const indexes = buildVenueIndexes(dataset);
  const menuUrlToId = menuUrlToVenueId(enrichment);

  const updates = [];
  let scraped = 0;
  let matched = 0;
  let unmatched = 0;

  for (const url of urls) {
    const slug = slugFromMenuUrl(url) ?? "unknown";
    const cachePath = join(MENU_CACHE, `${slug}.md`);
    const markdown = await scrapeMenu(url, cachePath);
    scraped += 1;

    const venueKey = resolveVenueKey(url, indexes, menuUrlToId);
    if (!venueKey) {
      unmatched += 1;
      console.warn(`UNMATCHED venue for ${url}`);
      continue;
    }
    matched += 1;

    const drinks = parseGreeneKingMenuMarkdown(markdown);
    for (const d of drinks) {
      if (!DRINK_CATEGORIES.has(d.category)) continue;
      updates.push({
        venueKey,
        drinkName: d.drinkName,
        category: d.category,
        priceGbp: d.priceGbp,
        source: { ...SOURCE, url },
        observedAt,
      });
    }
    console.log(`  ${slug}: ${drinks.length} drinks → ${venueKey.slice(0, 40)}…`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = observedAt.slice(0, 10).replace(/-/g, "");
  const existing = merge ? loadExistingUpdates() : [];
  const merged = merge ? mergeDrinkUpdates(existing, updates) : updates;
  const payload = { version: 1, generatedAt: observedAt, updates: merged };
  const dated = join(OUT_DIR, `prices_${stamp}.json`);
  writeFileSync(dated, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, "latest.json"), `${JSON.stringify(payload, null, 2)}\n`);

  console.log(
    `\nDone: scraped=${scraped} matched=${matched} unmatched=${unmatched} newRows=${updates.length} totalRows=${merged.length}`,
  );
  console.log(`Wrote ${dated} and latest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
