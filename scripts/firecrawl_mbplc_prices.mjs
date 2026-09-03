#!/usr/bin/env node
/**
 * Mitchells & Butlers (Nicholson's) drink price harvester using local refresh providers.
 *
 * Merges into public/data/drink_price_updates/latest.json (preserves Greene King rows).
 *
 * Usage:
 *   node scripts/firecrawl_mbplc_prices.mjs [--limit N] [--brand nicholsons]
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
  buildVenueIndexes,
  mergeDrinkUpdates,
  normalisePubName,
  resolveVenueKeyFromHints,
  resolveVenueKeyFromPubName,
  slugFromMbplcDrinksUrl,
} from "./lib/venueMatch.mjs";
import {
  assertProviderCredentials,
  discoverRefreshPages,
  fetchRefreshPage,
} from "./lib/localRefreshProviders.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "data", "drink_price_updates");
const MENU_CACHE = join(ROOT, ".firecrawl", "menus", "nicholsons");
const DEFAULT_URLS = join(ROOT, "data", "nicholsons_london_drink_urls.txt");
const DATASET_PATH = join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const LATEST_PATH = join(OUT_DIR, "latest.json");

const SOURCE = {
  label: "Nicholson's — official drinks menu",
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

// --- parser ------------------------------------------------------------------

const TOP_SECTION = /^##\s+(.+)$/;
const SUB_SECTION = /^###\s+(.+)$/;
const ITEM_HEADING = /^####\s+(.+)$/;
const POUND_PRICE = /£\s*(\d+(?:\.\d{2})?)/;
const BARE_PRICE = /^\s*(\d+\.\d{2})\s*$/;

function mapMbplcSectionToCategory(section) {
  const s = section.toLowerCase();
  if (
    s.includes("fever-tree") ||
    s.includes("mixer") ||
    s.includes("tonic") ||
    s.includes("main menu") ||
    s.includes("sandwich") ||
    s.includes("buffet") ||
    s.includes("breakfast") ||
    s.includes("food")
  ) {
    return null;
  }
  if (s.includes("wine") || s.includes("champagne") || s.includes("spark")) return "wine";
  if (s.includes("cocktail") || s.includes("spritz")) return "cocktail";
  if (s.includes("coffee") || s.includes("hot drink")) return "coffee";
  if (
    s.includes("alcohol-free") ||
    s.includes("alcohol free") ||
    s.includes("non-alcoholic") ||
    s.includes("low and no") ||
    s.includes("no & low") ||
    s.includes("no and low") ||
    s.includes("0.0")
  ) {
    return "alcohol-free";
  }
  if (s.includes("soft drink") || s.includes("soda")) return "soft-drink";
  if (
    s.includes("beer") ||
    s.includes("lager") ||
    s.includes("ale") ||
    s.includes("cider") ||
    s.includes("draught") ||
    s.includes("craft")
  ) {
    return "beer";
  }
  if (s.includes("whisk") || s.includes("whiskey")) return "whisky";
  if (s.includes("gin")) return "gin";
  if (s.includes("vodka")) return "vodka";
  if (s.includes("rum")) return "rum";
  if (s.includes("tequila")) return "shot";
  if (s.includes("spirit") || s.includes("shot")) return "shot";
  // Unrecognised section: DROP (null), never coerce into "other".
  if (s.includes("other")) return "other";
  return null;
}

function priceFromLines(lines) {
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (
      trimmed === "glass" ||
      trimmed === "bottle" ||
      trimmed === "pint" ||
      trimmed.endsWith(" kcal") ||
      trimmed.endsWith("% vol.") ||
      trimmed.includes(" vol.")
    ) {
      continue;
    }
    const pound = line.match(POUND_PRICE);
    if (pound) return parseFloat(pound[1]);
    const bare = line.match(BARE_PRICE);
    if (bare) {
      const value = parseFloat(bare[1]);
      if (value >= 1.5 && value <= 80) return value;
    }
  }
  return null;
}

function parseMbplcMenuMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let topSection = null;
  let subSection = null;
  let itemName = null;
  let itemLines = [];

  const activeSection = () => subSection ?? topSection;

  const resolveCategory = () => {
    const fromTop = topSection ? mapMbplcSectionToCategory(topSection) : null;
    const fromSub = subSection ? mapMbplcSectionToCategory(subSection) : null;
    if (fromSub && fromSub !== "other") return fromSub;
    return fromTop;
  };

  const flushItem = () => {
    if (!itemName) {
      itemLines = [];
      return;
    }
    const section = activeSection();
    if (!section) {
      itemName = null;
      itemLines = [];
      return;
    }
    const category = resolveCategory();
    if (!category) {
      itemName = null;
      itemLines = [];
      return;
    }
    const price = priceFromLines(itemLines);
    if (price !== null) {
      out.push({ drinkName: itemName.trim(), category, priceGbp: price });
    }
    itemName = null;
    itemLines = [];
  };

  for (const line of lines) {
    const topMatch = line.match(TOP_SECTION);
    if (topMatch) {
      flushItem();
      topSection = topMatch[1].trim();
      subSection = null;
      continue;
    }
    const subMatch = line.match(SUB_SECTION);
    if (subMatch) {
      flushItem();
      subSection = subMatch[1].trim();
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

function pubNameFromMbplcMarkdown(markdown) {
  const match = markdown.match(/^##\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

/** Nicholson's slug tokens for fuzzy match (theoldthamesideinnlondonbridge). */
function hintsFromNicholsonsSlug(slug) {
  const stripped = slug
    .replace(/^the/, "")
    .replace(/london$/, "")
    .replace(/(southbank|londonbridge|soholondon|mayfairlondon|coventgardenlondon)/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  const chunks = stripped.match(/[a-z]{4,}/g) ?? [];
  return [...new Set(chunks)].slice(0, 6);
}

function resolveNicholsonsVenueKey(url, markdown, indexes) {
  const pubName = pubNameFromMbplcMarkdown(markdown);
  const byName = resolveVenueKeyFromPubName(pubName, indexes);
  if (byName) return byName;

  const slug = slugFromMbplcDrinksUrl(url);
  if (!slug) return null;
  const hints = hintsFromNicholsonsSlug(slug);
  return resolveVenueKeyFromHints(hints, indexes);
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

function parseArgs(argv) {
  let limit = 43;
  let urlsFile = DEFAULT_URLS;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--limit" && argv[i + 1]) {
      limit = parseInt(argv[++i], 10);
    } else if (argv[i] === "--urls-file" && argv[i + 1]) {
      urlsFile = argv[++i];
    }
  }
  return { limit, urlsFile };
}

function loadExistingUpdates() {
  if (!existsSync(LATEST_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(LATEST_PATH, "utf8"));
    return Array.isArray(raw) ? raw : (raw.updates ?? []);
  } catch {
    return [];
  }
}

async function main() {
  const { limit, urlsFile } = parseArgs(process.argv);
  const observedAt = new Date().toISOString();
  assertProviderCredentials(["pub-discovery", "rendered-menu"]);

  const knownUrls = readFileSync(urlsFile, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http"));
  const discoveries = await discoverRefreshPages({
    query: "new London Nicholson's pub official drinks menu prices",
    includeDomains: ["nicholsonspubs.co.uk"],
    numResults: Math.min(10, Math.max(1, limit)),
  });
  const discoveredUrls = discoveries
    .map((result) => result.url)
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.hostname.endsWith("nicholsonspubs.co.uk") && /\/drinks\/?$/i.test(parsed.pathname);
      } catch {
        return false;
      }
    });
  const candidates = limit > 1 && discoveredUrls.length
    ? [discoveredUrls[0], ...knownUrls]
    : knownUrls;
  const urls = [...new Set(candidates)].slice(0, limit);

  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  const indexes = buildVenueIndexes(dataset);
  const existing = loadExistingUpdates();

  const updates = [];
  let scraped = 0;
  let matched = 0;
  let unmatched = 0;

  for (const url of urls) {
    const slug = slugFromMbplcDrinksUrl(url) ?? "unknown";
    const cachePath = join(MENU_CACHE, `${slug}.md`);
    const markdown = await scrapeMenu(url, cachePath);
    scraped += 1;

    const venueKey = resolveNicholsonsVenueKey(url, markdown, indexes);
    if (!venueKey) {
      unmatched += 1;
      const pubName = pubNameFromMbplcMarkdown(markdown);
      console.warn(`UNMATCHED ${pubName ?? slug} for ${url}`);
      continue;
    }
    matched += 1;

    const drinks = parseMbplcMenuMarkdown(markdown);
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
    const pubName = pubNameFromMbplcMarkdown(markdown) ?? slug;
    console.log(`  ${pubName}: ${drinks.length} drinks → ${venueKey.slice(0, 45)}…`);
  }

  const merged = mergeDrinkUpdates(existing, updates);
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = observedAt.slice(0, 10).replace(/-/g, "");
  const payload = { version: 1, generatedAt: observedAt, updates: merged };
  const dated = join(OUT_DIR, `prices_${stamp}.json`);
  writeFileSync(dated, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(LATEST_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(
    `\nDone: scraped=${scraped} matched=${matched} unmatched=${unmatched} newRows=${updates.length} totalRows=${merged.length}`,
  );
  console.log(`Wrote ${dated} and latest.json (merged with existing)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
