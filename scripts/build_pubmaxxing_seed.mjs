// Build a compact, provenance-preserving snapshot from the pubmaxxing.git
// Firecrawl handoff CSVs. This intentionally does NOT merge rows into the
// canonical pint-price dataset yet: the external repo uses separate pub ids and
// needs a normalization pass before it can be treated as live venue truth.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const SOURCE_DIR = join(ROOT_DIR, "data", "pubmaxxing");
const OUT_PATH = join(ROOT_DIR, "public", "data", "pubmaxxing_seed_snapshot.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
}

function csvRecords(relativePath) {
  const fullPath = join(SOURCE_DIR, relativePath);
  const rows = parseCsv(readFileSync(fullPath, "utf8"));
  const headers = rows.shift() ?? [];
  return rows.map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    if (cells.length > headers.length) {
      record._extra = cells.slice(headers.length).join(",").trim();
    }
    return record;
  });
}

function nonEmpty(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function numberOrNull(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function shortText(value, limit = 320) {
  const trimmed = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function parseHttpUrl(value, label, { rowCritical = false } = {}) {
  const url = nonEmpty(value);
  if (!url) {
    if (rowCritical) {
      console.warn(`[pubmaxxing-seed] ${label} is missing; skipping row`);
    }
    return { ok: !rowCritical, url: undefined };
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`protocol ${parsed.protocol} is not http(s)`);
    }
    return { ok: true, url: parsed.toString() };
  } catch (error) {
    console.warn(
      `[pubmaxxing-seed] ${label} is not a valid http(s) URL; ${
        rowCritical ? "skipping row" : "omitting value"
      }: ${url} (${error.message})`,
    );
    return { ok: false, url: undefined };
  }
}

function optionalHttpUrl(value, label) {
  return parseHttpUrl(value, label).url;
}

function rowCriticalHttpUrl(value, label) {
  return parseHttpUrl(value, label, { rowCritical: true });
}

function compactMap(records, mapper) {
  const mapped = [];
  records.forEach((record, index) => {
    const row = mapper(record, index);
    if (row) mapped.push(row);
  });
  return mapped;
}

function build() {
  const source = JSON.parse(readFileSync(join(SOURCE_DIR, "source.json"), "utf8"));
  const beverages = csvRecords("london_pub_all_beverages_expanded.csv").map((row, index) => ({
    priceId: nonEmpty(row.price_id),
    pubId: nonEmpty(row.pub_id),
    pubName: nonEmpty(row.pub_name),
    rank: numberOrNull(row.rank),
    chainName: nonEmpty(row.chain_name),
    area: nonEmpty(row.area),
    sourceUrl: optionalHttpUrl(row.source_url, `beverage source_url row ${index + 2}`),
    sourceType: nonEmpty(row.source_type),
    menuPageTitle: nonEmpty(row.menu_page_title),
    category: nonEmpty(row.beverage_category),
    subcategory: nonEmpty(row.beverage_subcategory),
    name: nonEmpty(row.beverage_name),
    servingSize: nonEmpty(row.serving_size),
    unitVolumeMl: numberOrNull(row.unit_volume_ml),
    abv: numberOrNull(row.abv),
    isAlcoholic: boolOrNull(row.is_alcoholic),
    basePriceGbp: numberOrNull(row.base_price_gbp),
    priceOptionsGbp: nonEmpty(row.price_options_gbp),
    bottlePriceGbp: numberOrNull(row.bottle_price_gbp),
    happyHourPriceGbp: numberOrNull(row.happy_hour_price_gbp),
    discountType: nonEmpty(row.discount_type),
    discountDesc: shortText(row.discount_desc),
    currency: nonEmpty(row.currency) ?? "GBP",
    priceObservedDate: nonEmpty(row.price_observed_date),
    sourceObservedAt: nonEmpty(row.source_observed_at),
    parseConfidence: numberOrNull(row.parse_confidence),
  }));

  const pubs = csvRecords("london_pubs_expanded.csv").map((row, index) => ({
    pubId: nonEmpty(row.pub_id),
    name: nonEmpty(row.pub_name),
    rank: numberOrNull(row.rank),
    chainName: nonEmpty(row.chain_name),
    area: nonEmpty(row.area),
    fullAddress: nonEmpty(row.full_address),
    rating: numberOrNull(row.rating),
    reviewCount: numberOrNull(row.review_count),
    priceTier: nonEmpty(row.price_tier),
    venueTags: nonEmpty(row.venue_tags),
    venueUrl: optionalHttpUrl(row.venue_url, `pub venue_url row ${index + 2}`),
    menuUrl: optionalHttpUrl(row.menu_url, `pub menu_url row ${index + 2}`),
    discoverySourceName: nonEmpty(row.discovery_source_name),
    discoverySourceUrl: optionalHttpUrl(row.discovery_source_url, `pub discovery_source_url row ${index + 2}`),
    // Keep the raw non-empty reference string; discoverySourceUrl is the normalized URL form.
    discoverySourceRef: nonEmpty(row.discovery_source_url),
    discoveredAt: nonEmpty(row.discovered_at),
    notes: nonEmpty(row.notes),
  }));

  const historySeeds = compactMap(csvRecords("london_pub_history_seed.csv"), (row, index) => {
    const sourceUrl = rowCriticalHttpUrl(row.source_url, `history source_url row ${index + 2}`);
    const kgObject = rowCriticalHttpUrl(row.kg_object, `history kg_object row ${index + 2}`);
    if (!sourceUrl.ok || !kgObject.ok) return undefined;
    return {
      pubId: nonEmpty(row.pub_id),
      pubName: nonEmpty(row.pub_name),
      area: nonEmpty(row.area),
      sourceTitle: nonEmpty(row.source_title),
      sourceUrl: sourceUrl.url,
      sourceDescription: shortText(row.source_description),
      sourcePosition: numberOrNull(row.source_position),
      observedAt: nonEmpty(row.observed_at),
      kgSubject: nonEmpty(row.kg_subject),
      kgPredicate: nonEmpty(row.kg_predicate),
      kgObject: kgObject.url,
      confidence: nonEmpty(row.confidence),
      notes: nonEmpty(row.notes),
    };
  });

  const discountMentionRecords = [
    ...csvRecords("london_pub_discount_mentions.csv").map((row, index) => ({
      ...row,
      sourceFile: "london_pub_discount_mentions.csv",
      sourceRow: index + 2,
    })),
    ...csvRecords("area-expansion/london_pub_discount_mentions.csv").map((row, index) => ({
      ...row,
      sourceFile: "area-expansion/london_pub_discount_mentions.csv",
      sourceRow: index + 2,
    })),
  ];
  const discountMentions = compactMap(discountMentionRecords, (row) => {
    const sourceUrl = rowCriticalHttpUrl(
      row.source_url,
      `discount source_url row ${row.sourceRow} in ${row.sourceFile}`,
    );
    if (!sourceUrl.ok) return undefined;
    return {
      pubId: nonEmpty(row.pub_id),
      pubName: nonEmpty(row.pub_name),
      rank: numberOrNull(row.rank),
      sourceUrl: sourceUrl.url,
      discountType: nonEmpty(row.discount_type),
      discountDesc: shortText(row.discount_desc),
      discountDays: nonEmpty(row.discount_days),
      discountTimeRange: nonEmpty(row.discount_time_range),
      sourceObservedAt: nonEmpty(row.source_observed_at),
      sourceFile: row.sourceFile,
    };
  });

  const alcoholicRows = beverages.filter((row) => row.isAlcoholic === true).length;
  const nonAlcoholicRows = beverages.filter((row) => row.isAlcoholic === false).length;
  const unknownAlcoholicRows = beverages.filter(
    (row) => row.isAlcoholic !== true && row.isAlcoholic !== false,
  ).length;
  const uniquePubIds = new Set([
    ...pubs.map((row) => row.pubId),
    ...beverages.map((row) => row.pubId),
  ].filter(Boolean));

  const snapshot = {
    version: 1,
    sourceImportedAt: source.importedAt,
    source,
    summary: {
      pubs: pubs.length,
      beverageRows: beverages.length,
      alcoholicRows,
      nonAlcoholicRows,
      unknownAlcoholicRows,
      historySeeds: historySeeds.length,
      discountMentions: discountMentions.length,
      uniquePubIds: uniquePubIds.size,
    },
    pubs,
    beverages,
    historySeeds,
    discountMentions,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `Wrote ${OUT_PATH} (${pubs.length} pubs, ${beverages.length} beverage rows, ${historySeeds.length} history seeds)`,
  );
}

build();
