// Build the SLIM venue index the map needs to render pins + labels + price
// colour, WITHOUT shipping the ~6 MB raw price dataset to every visitor.
//
// The map only needs, per venue: a stable id (to deep-link + fetch heavy detail
// on open), name, lat/lng, the cheapest numeric price (for the label + colour),
// and a borough. This script groups the raw rows the SAME way
// lib/venues.ts#groupVenuePrices does — same FNV-1a stable id, same grouping
// key — so every slim id is byte-identical to the "venue-…" id the rest of the
// app links by. The heavy detail (all prices, amenities, curation) is fetched
// lazily per-id via /api/venue/[id].
//
// Run once at build/refresh:  node scripts/build_slim_index.mjs
//
// The grouping/id logic below is a plain-JS MIRROR of lib/venues.ts (importing
// TS from a .mjs is awkward); __tests__/venuesSlim.test.ts asserts a sample of
// the ids this produces equals stableVenueIdFromKey(venueGroupingKey(...)) from
// the real TS, so the mirror can never silently drift.

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CORE_FILE,
  buildShardPayload,
  MANIFEST_FILE,
  SPATIAL_GRID,
  buildSpatialShardManifest,
  classifySpatialShards,
  spatialCellIndex,
  spatialCellId,
  spatialShardFile,
} from "./lib/slimShards.mjs";
import { loadStationZones, nearestStationZone } from "./lib/stationZones.mjs";
import { isCurrentNightOutPlace } from "../lib/nightOutPlaceContract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_PATH = path.join(
  ROOT,
  "public",
  "data",
  "pint_prices_app_dataset.json",
);
const SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");
const DATA_DIR = path.join(ROOT, "public", "data");
const FAMOUS_VENUE_PATHS = [
  path.join(ROOT, "data", "famous_venues", "bars.json"),
  path.join(ROOT, "data", "famous_venues", "late_food.json"),
  path.join(ROOT, "data", "famous_venues", "restaurants.json"),
];

// A region is loaded from the manifest plus the viewport and one grid ring.
// Keep individual cells small enough that a phone never pays for London-wide
// presence pins before it has looked there.
const SHARD_BUDGET_BYTES = 150 * 1024;
// All-in budget across every shard (core + outer). A regression that bloats the
// whole index — not just first paint — still fails CI.
const TOTAL_BUDGET_BYTES = 1200 * 1024;
const GENERATED_DIR = path.join(ROOT, "data", "generated");
const DETAIL_INDEX_PATH = path.join(GENERATED_DIR, "venue_detail_index.json");
const DETAIL_ROWS_PATH = path.join(GENERATED_DIR, "venue_details.jsonl");

// Greater London bounding box — a safety net mirroring
// scripts/export_app_dataset_json.py and scripts/validate-data.mjs. The export
// already drops out-of-bounds rows; this guards the slim index against any that
// slip through a hand-edited JSON.
const LAT_MIN = 51.26;
const LAT_MAX = 51.72;
const LON_MIN = -0.55;
const LON_MAX = 0.3;

function inLondon(lat, lng) {
  return lat >= LAT_MIN && lat <= LAT_MAX && lng >= LON_MIN && lng <= LON_MAX;
}

function typeRelativePriceBands(rows) {
  const bands = new Map();
  for (const kind of ["bar", "food", "restaurant"]) {
    const ranked = rows
      .filter((row) => row.kind === kind)
      .slice()
      .sort(
        (a, b) => a.anchor.price - b.anchor.price || a.id.localeCompare(b.id),
      );
    const lowCutoff = ranked[Math.ceil(ranked.length / 3) - 1]?.anchor.price;
    const midCutoff =
      ranked[Math.ceil((ranked.length * 2) / 3) - 1]?.anchor.price;
    for (const row of ranked) {
      bands.set(
        row.id,
        row.anchor.price <= lowCutoff
          ? 0
          : row.anchor.price <= midCutoff
            ? 1
            : 2,
      );
    }
  }
  return bands;
}

function famousVenueFilterHints(row) {
  return {
    searchText: `${row.name} ${row.address} ${row.borough}`.toLowerCase(),
    amenities: {
      food: row.kind === "food" || row.kind === "restaurant",
      cocktails: row.kind === "bar" && row.anchor.kind === "house_cocktail",
      beerGarden: false,
      liveSports: false,
      nonAlcoholic: false,
    },
    curation: { nearWater: false, hasStory: true },
    canonical: true,
    ...(row.kind === "bar"
      ? {
          drinkCategories: [
            row.anchor.kind === "pint"
              ? "beer"
              : row.anchor.kind === "wine"
                ? "wine"
                : "cocktail",
          ],
        }
      : {}),
    ...(row.kind === "food" || row.kind === "restaurant"
      ? { cuisineTags: ["kitchen"] }
      : {}),
  };
}

function assertCurrentFamousVenueRows(rows, now) {
  const invalid = rows.filter((row) => !isCurrentNightOutPlace(row, now));
  if (invalid.length > 0) {
    const nowMs = now instanceof Date ? now.getTime() : Number(now);
    const checkedAt = Number.isFinite(nowMs)
      ? new Date(nowMs).toISOString()
      : String(now);
    throw new Error(
      `Famous venue current-trading verification failed at ${checkedAt}: ${invalid
        .map((row) => `${row.id} (${row.observedAt} to ${row.expiresAt})`)
        .join(", ")}`,
    );
  }
  return rows;
}

// --- mirror of lib/venues.ts grouping + id logic (keep in lockstep) ----------

function normaliseVenueKeyPart(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function venueGroupingKey(row) {
  return [
    normaliseVenueKeyPart(row.pub_name),
    normaliseVenueKeyPart(row.address),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join("|");
}

function stableVenueIdFromKey(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

// --- filter hint helpers ------------------------------------------------------

function truthyFlag(value) {
  return ["yes", "true", "y", "1"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

const NA_BRANDS = [
  "lucky saint",
  "nanny state",
  "big drop",
  "mash gang",
  "days brewing",
  "beck's blue",
  "becks blue",
  "free damm",
  "erdinger alkoholfrei",
  "infinite session",
  "impossibrew",
  "st peter's without",
];

const NA_PATTERNS = [
  /alcohol[\s-]?free/i,
  /non[\s-]?alcoholic/i,
  /\balcohol[\s-]?free\b/i,
  /\b0[.,]0\b/,
  /\b0[.,]5\s*%/,
  /\b0\s*%/,
  /\bAF\b/,
  /(guinness|heineken|peroni|san miguel|corona|stella|birra moretti|estrella|madri|asahi)\s*0/i,
];

function isNonAlcoholicDrinkName(name) {
  const raw = String(name ?? "");
  const lower = raw.toLowerCase();
  if (!lower.trim()) return false;
  if (NA_BRANDS.some((brand) => lower.includes(brand))) return true;
  return NA_PATTERNS.some((pattern) => pattern.test(raw));
}

const WATER_TERMS = [
  "riverside",
  "river",
  "thames",
  "strand-on-the-green",
  "strand on the green",
  "wapping wall",
  "narrow st",
  "narrow street",
  "upper mall",
  "wharf",
  "dock",
  "canal",
  "waterside",
];

const HERITAGE_TERMS = [
  "victorian",
  "georgian",
  "edwardian",
  "tudor",
  "grade ii listed",
  "grade i listed",
  "oldest pub",
  "dating back",
  "since 18",
  "since 17",
  "since 16",
];

// Compact mirrors of lib/drinkBrands.ts + category tokens — keep pragmatic;
// the slim index only needs soft drink-lens hints, not a full menu DB.
const DRINK_BRAND_HINTS = [
  { id: "guinness", category: "beer", needles: ["guinness"] },
  {
    id: "neck-oil",
    category: "beer",
    needles: ["neck oil", "beavertown", "bevertown"],
  },
  { id: "estrella", category: "beer", needles: ["estrella"] },
  { id: "peroni", category: "beer", needles: ["peroni"] },
  { id: "amstel", category: "beer", needles: ["amstel"] },
  { id: "madri", category: "beer", needles: ["madri", "madrí"] },
  {
    id: "camden-hells",
    category: "beer",
    needles: ["camden hell", "hells lager", "camden hells"],
  },
  {
    id: "birra-moretti",
    category: "beer",
    needles: ["moretti", "birra moretti"],
  },
  { id: "sipsmith", category: "gin", needles: ["sipsmith"] },
  { id: "tanqueray", category: "gin", needles: ["tanqueray"] },
  { id: "bombay-sapphire", category: "gin", needles: ["bombay"] },
  { id: "hendricks", category: "gin", needles: ["hendrick", "hendricks"] },
  { id: "gordon", category: "gin", needles: ["gordon"] },
  { id: "beefeater", category: "gin", needles: ["beefeater"] },
  { id: "absolut", category: "vodka", needles: ["absolut"] },
  { id: "smirnoff", category: "vodka", needles: ["smirnoff"] },
  {
    id: "grey-goose",
    category: "vodka",
    needles: ["grey goose", "gray goose"],
  },
  { id: "belvedere", category: "vodka", needles: ["belvedere"] },
  { id: "ketel-one", category: "vodka", needles: ["ketel one"] },
  { id: "jameson", category: "whisky", needles: ["jameson"] },
  {
    id: "jack-daniels",
    category: "whisky",
    needles: ["jack daniel", "jack daniels"],
  },
  {
    id: "johnnie-walker",
    category: "whisky",
    needles: ["johnnie walker", "johnny walker"],
  },
  { id: "bacardi", category: "rum", needles: ["bacardi"] },
  { id: "captain-morgan", category: "rum", needles: ["captain morgan"] },
  { id: "havana-club", category: "rum", needles: ["havana club"] },
  { id: "prosecco", category: "wine", needles: ["prosecco"] },
  { id: "rioja", category: "wine", needles: ["rioja"] },
  { id: "malbec", category: "wine", needles: ["malbec"] },
  { id: "chardonnay", category: "wine", needles: ["chardonnay"] },
  { id: "negroni", category: "cocktail", needles: ["negroni"] },
  {
    id: "espresso-martini",
    category: "cocktail",
    needles: ["espresso martini"],
  },
  { id: "aperol-spritz", category: "cocktail", needles: ["aperol"] },
  { id: "mojito", category: "cocktail", needles: ["mojito"] },
];

const CATEGORY_HINT_TOKENS = [
  ["wine", ["wine", "prosecco", "champagne", "rioja", "malbec", "chardonnay"]],
  ["whisky", ["whisky", "whiskey", "scotch", "bourbon"]],
  ["gin", ["gin"]],
  ["vodka", ["vodka"]],
  ["rum", ["rum"]],
  [
    "cocktail",
    ["cocktail", "spritz", "negroni", "martini", "margarita", "mojito"],
  ],
  ["shot", ["shot", "shots", "tequila", "sambuca"]],
];

// Soft cuisine tokens (mirrors lib/cuisineTags.ts KNOWN_CUISINE_TAGS).
const CUISINE_HINT_TAGS = [
  "roast",
  "thai",
  "pizza",
  "burger",
  "tapas",
  "italian",
  "indian",
  "steak",
  "grill",
  "pie",
  "fish",
  "kitchen",
  "gastropub",
  "chinese",
  "mexican",
];

// Hand-curated cuisine by stable venue id (mirrors CURATED_CUISINE_BY_VENUE_ID).
const CURATED_CUISINE_BY_VENUE_ID = {
  "venue-1ufn31x": ["roast", "gastropub"],
  "venue-1t8siin": ["gastropub"],
  "venue-xiesdn": ["gastropub"],
  "venue-phqazo": ["gastropub"],
  "venue-15i2wst": ["roast", "gastropub"],
  "venue-16ze6b1": ["roast", "pie"],
  "venue-2e3otf": ["gastropub"],
  "venue-ral8ik": ["burger"],
  "venue-140rjwt": ["tapas"],
  "venue-xmy0sb": ["italian"],
  "venue-17zuc81": ["italian"],
  "venue-11lnj4t": ["steak"],
  "venue-pzbwmw": ["burger", "kitchen"],
  "venue-1226a9v": ["gastropub", "kitchen"],
  "venue-1ie3w8u": ["grill"],
  "venue-11n82fd": ["burger"],
  "venue-1u2v4eh": ["burger"],
  "venue-16s3et4": ["burger"],
  "venue-1y5lg8a": ["pie"],
  "venue-7g6jxt": ["pie"],
  "venue-we3mzn": ["kitchen"],
  "venue-5zogu6": ["kitchen"],
  "venue-1yd70c7": ["gastropub", "roast"],
  "venue-fr71bp": ["gastropub"],
  "venue-gv8lwa": ["gastropub", "fish"],
  "venue-1x50b6d": ["gastropub"],
  "venue-16pnwmm": ["gastropub", "fish"],
  "venue-ekvkuv": ["gastropub"],
  "venue-1d8a5xb": ["gastropub"],
  "venue-fpmfjs": ["gastropub"],
  "venue-133uf6h": ["gastropub", "kitchen"],
  "venue-dbukrn": ["gastropub"],
  "venue-lrlyh8": ["gastropub", "roast"],
  "venue-1sx1vco": ["gastropub"],
  "venue-erabed": ["gastropub"],
};

function normaliseDrinkHaystack(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function haystackHasCategoryToken(hay, tokens) {
  return tokens.some((token) => {
    const n = normaliseDrinkHaystack(token);
    if (!n) return false;
    if (n.includes(" ")) return hay.includes(n);
    const re = new RegExp(`(^| )${n}( |$)`);
    return re.test(hay);
  });
}

function buildDrinkHints(prices) {
  const categories = new Set();
  const brands = new Set();
  const drinkText = normaliseDrinkHaystack(
    prices.map((price) => price.pint_name).join(" "),
  );
  const hay = normaliseDrinkHaystack(
    [
      ...prices.map((price) => price.pint_name),
      ...prices.map((price) => price.comment),
      prices[0]?.description,
    ].join(" "),
  );

  // Beer is the dataset spine — any pint row implies beer coverage.
  if (prices.some((price) => String(price.pint_name ?? "").trim())) {
    categories.add("beer");
  }
  if (prices.some((price) => truthyFlag(price.cocktails))) {
    categories.add("cocktail");
  }

  for (const [category, tokens] of CATEGORY_HINT_TOKENS) {
    if (haystackHasCategoryToken(hay, tokens)) {
      categories.add(category);
    }
  }

  for (const brand of DRINK_BRAND_HINTS) {
    // Word-boundary brand needles (same approach as category tokens) so short
    // aliases like "jd" do not match inside unrelated words.
    if (
      brand.needles.some((needle) => {
        const n = normaliseDrinkHaystack(needle);
        if (!n) return false;
        if (n.includes(" ")) return hay.includes(n);
        const re = new RegExp(`(^| )${n}( |$)`);
        return re.test(hay);
      })
    ) {
      brands.add(brand.id);
      categories.add(brand.category);
    }
  }

  return {
    drinkCategories: Array.from(categories).sort(),
    drinkBrands: Array.from(brands).sort(),
    drinkText,
  };
}

function cuisineTagsFromHaystack(hay) {
  return CUISINE_HINT_TAGS.filter((tag) => {
    const re = new RegExp(`(?:^|[^a-z])${tag}(?:[^a-z]|$)`);
    return re.test(hay);
  });
}

function buildCuisineHints(venueId, prices) {
  const curated = CURATED_CUISINE_BY_VENUE_ID[venueId] ?? [];
  const hay = normaliseDrinkHaystack(
    [
      prices[0]?.pub_name,
      prices[0]?.description,
      ...prices.map((price) => price.comment),
      ...prices.map((price) => price.pint_name),
    ].join(" "),
  );
  const fromText = cuisineTagsFromHaystack(hay);
  const found = new Set([...curated, ...fromText]);
  return CUISINE_HINT_TAGS.filter((tag) => found.has(tag));
}

// Mirrors the curated names in lib/curation.ts. Keep this compact: the slim
// artifact only needs the derived filter booleans, not the display copy.
// Address-qualified keys use `name|token` (token must appear in the address).
const CURATED_VENUES = {
  "prospect of whitby": { nearWater: true, hasHeritage: true },
  "the grapes": { nearWater: true, hasHeritage: true },
  "the dove": { nearWater: true, hasHeritage: true },
  "the old pack horse": { hasHeritage: true },
  "the lamb": { hasHeritage: true },
  "the sun tavern": { hasHeritage: true },
  "the queens head": { hasHeritage: true },
  "the queens arms": { hasHeritage: true },
  // Eating Europe guide — heritage rings on first paint (never prices).
  "the mayflower": { nearWater: true, hasHeritage: true },
  "lord wargrave": { hasHeritage: true },
  "ye old mitre": { hasHeritage: true },
  "ye olde mitre": { hasHeritage: true },
  "the albion|barnsbury": { hasHeritage: true },
  "the spaniards inn": { hasHeritage: true },
  "the ship soho": { hasHeritage: true },
  "the grenadier": { hasHeritage: true },
};

function normaliseVenueName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function lookupCuratedVenue(pubName, address = "") {
  const name = normaliseVenueName(pubName);
  const addr = normaliseVenueName(address);
  for (const [key, value] of Object.entries(CURATED_VENUES)) {
    const pipe = key.indexOf("|");
    if (pipe === -1) continue;
    const base = key.slice(0, pipe);
    const token = key.slice(pipe + 1);
    if (base === name && token && addr.includes(token)) return value;
  }
  return CURATED_VENUES[name] ?? {};
}

function buildCurationHints(prices) {
  const sortedPrices = [...prices].sort((a, b) => {
    const left = a.price_gbp ?? Number.POSITIVE_INFINITY;
    const right = b.price_gbp ?? Number.POSITIVE_INFINITY;
    return left - right;
  });
  const first = sortedPrices[0] ?? prices[0];
  const explicit = lookupCuratedVenue(first.pub_name, first.address ?? "");
  const haystack = [
    first.pub_name,
    first.address,
    first.description,
    ...prices.map((price) => price.comment),
  ]
    .join(" ")
    .toLowerCase();
  const inferredHeritage =
    explicit.hasHeritage !== true &&
    HERITAGE_TERMS.some((term) => haystack.includes(term));
  // Wikipedia "List of pubs in London" venues carry a sourced heritage note in
  // curation (getVenueCuration). Mirror that here so the build-time slim
  // `hasStory` flag matches the runtime heritage filter — otherwise the map's
  // heritage lens under-counts the Wikipedia-listed pubs.
  //
  // This MUST stay in lock-step with `hasWikipediaList` in lib/curation.ts: a
  // matching row alone is not enough — it also needs a renderable heritage note
  // (a resolvable Wikipedia URL / non-empty citation in `comment`). Without the
  // URL check the slim index sets hasStory=true for venues that render no
  // heritage note, so the flag and the note disagree.
  const wikipediaRow = prices.find((price) =>
    String(price.source_datasets ?? "").includes("wikipedia_london_list"),
  );
  const wikipediaUrl =
    wikipediaRow?.comment?.match(
      /https:\/\/en\.wikipedia\.org\/wiki\/\S+/,
    )?.[0] ?? wikipediaRow?.comment?.replace(/^Wikipedia:\s*/i, "").trim();
  const wikipediaListed = Boolean(wikipediaRow && wikipediaUrl);

  return {
    nearWater:
      explicit.nearWater ?? WATER_TERMS.some((term) => haystack.includes(term)),
    hasStory:
      explicit.hasHeritage === true || inferredHeritage || wikipediaListed,
  };
}

function buildFilterHints(prices, venueId, scrapedIds) {
  const first = prices[0];
  const searchParts = new Set(
    [
      first.pub_name,
      first.address,
      first.primary_borough,
      first.boroughs_visible,
      ...prices.map((price) => price.pint_name),
    ]
      .map((part) =>
        String(part ?? "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  const curation = buildCurationHints(prices);
  const drinkHints = buildDrinkHints(prices);
  const cuisineTags = buildCuisineHints(venueId, prices);
  const scraped =
    scrapedIds.has(venueId) ||
    prices.some((price) =>
      /london_chain|greene.?king|nicholson|youngs|eating.?europe/i.test(
        String(price.source_datasets ?? ""),
      ),
    );

  // Stable drink accent for scraped pubs that have no pint-name categories yet,
  // so map pins match the /pubs gallery drink pictures.
  const ACCENT_POOL = [
    "beer",
    "wine",
    "cocktail",
    "whisky",
    "gin",
    "rum",
    "vodka",
    "shot",
  ];
  let drinkCategories = drinkHints.drinkCategories;
  if (scraped && (!drinkCategories || drinkCategories.length === 0)) {
    let hash = 2166136261;
    for (let i = 0; i < venueId.length; i += 1) {
      hash ^= venueId.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    drinkCategories = [ACCENT_POOL[(hash >>> 0) % ACCENT_POOL.length]];
  }

  return {
    searchText: Array.from(searchParts).join(" "),
    amenities: {
      food: prices.some((price) => truthyFlag(price.food)),
      cocktails: prices.some((price) => truthyFlag(price.cocktails)),
      beerGarden: prices.some((price) => truthyFlag(price.beer_garden)),
      liveSports: prices.some((price) => truthyFlag(price.live_sports)),
      nonAlcoholic: prices.some((price) =>
        isNonAlcoholicDrinkName(price.pint_name),
      ),
    },
    curation,
    canonical: prices.some(
      (price) => price.is_clean_canonical_app_row === true,
    ),
    ...(scraped ? { scraped: true } : {}),
    ...(drinkCategories.length ? { drinkCategories } : {}),
    ...(drinkHints.drinkBrands.length
      ? { drinkBrands: drinkHints.drinkBrands }
      : {}),
    ...(drinkHints.drinkText ? { drinkText: drinkHints.drinkText } : {}),
    ...(cuisineTags.length ? { cuisineTags } : {}),
  };
}

// --- build -------------------------------------------------------------------

async function main() {
  const rawText = await readFile(RAW_PATH, "utf8");
  const rows = JSON.parse(rawText);
  if (!Array.isArray(rows)) {
    throw new Error(`Expected an array in ${RAW_PATH}, got ${typeof rows}`);
  }

  // Enrichment venue ids (Young's / Nicholson's / Greene King) — stamp scraped
  // + drink accents even when the underlying pint row is already canonical.
  const scrapedIds = new Set();
  try {
    const enrichmentPath = path.join(
      ROOT,
      "public",
      "data",
      "venue_menu_enrichment.json",
    );
    const enrichment = JSON.parse(await readFile(enrichmentPath, "utf8"));
    for (const id of Object.keys(enrichment?.venues ?? {})) scrapedIds.add(id);
  } catch {
    // Missing enrichment is fine — gazetteer source_datasets still stamps scraped.
  }

  // Group rows by the canonical key. Preserve first-seen order so the first row
  // of a group supplies name/lat/lng/borough — matching groupVenuePrices, whose
  // Map preserves insertion order and reads name/coords/borough off `first`
  // (the first row inserted, not the price-sorted first).
  const grouped = new Map();
  let droppedOob = 0;
  for (const row of rows) {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inLondon(lat, lng)) {
      droppedOob += 1;
      continue;
    }
    const key = venueGroupingKey(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  if (droppedOob > 0) {
    console.log(`dropped ${droppedOob} row(s) outside Greater London bounds`);
  }

  // Fare-zone table (nearest-station assignment). Load once; each venue is
  // stamped with the zone of its nearest station — an honest approximation,
  // labelled as such in the UI. See scripts/lib/stationZones.mjs.
  const stationZones = await loadStationZones();
  const famousRows = assertCurrentFamousVenueRows(
    (
      await Promise.all(
        FAMOUS_VENUE_PATHS.map(async (file) =>
          JSON.parse(await readFile(file, "utf8")),
        ),
      )
    ).flat(),
    new Date(),
  );
  const famousPriceBands = typeRelativePriceBands(famousRows);

  const slim = [];
  const detailLines = [];
  const detailIndex = {
    version: 1,
    detailsFile: "venue_details.jsonl",
    count: 0,
    venues: {},
  };
  let detailOffset = 0;
  const appendDetailArtifact = (id, artifact, rowCount) => {
    const detailLine = `${JSON.stringify(artifact)}\n`;
    const detailLength = Buffer.byteLength(detailLine);
    detailIndex.venues[id] = {
      offset: detailOffset,
      length: detailLength,
      rowCount,
    };
    detailOffset += detailLength;
    detailLines.push(detailLine);
  };
  const zoneCounts = {};
  let zoneUnknown = 0;
  for (const [key, prices] of grouped) {
    const first = prices[0];
    const duplicateFamousVenue = famousRows.some(
      (row) =>
        normaliseVenueKeyPart(row.name) ===
          normaliseVenueKeyPart(first.pub_name) &&
        Math.abs(row.lat - Number(first.latitude)) < 0.001 &&
        Math.abs(row.lng - Number(first.longitude)) < 0.001,
    );
    if (duplicateFamousVenue) continue;
    const numericPrices = prices
      .map((p) => p.price_gbp)
      .filter((p) => typeof p === "number" && Number.isFinite(p));
    const cheapestPrice = numericPrices.length
      ? Math.min(...numericPrices)
      : null;
    const id = stableVenueIdFromKey(key);

    const lat = Number(first.latitude);
    const lng = Number(first.longitude);
    const nearest = nearestStationZone(lat, lng, stationZones);
    const zone = nearest ? nearest.zone : null;
    if (zone === null) zoneUnknown += 1;
    else zoneCounts[zone] = (zoneCounts[zone] ?? 0) + 1;

    slim.push({
      id,
      name: String(first.pub_name),
      lat,
      lng,
      cheapestPrice,
      borough: String(first.primary_borough || ""),
      // Nearest-station fare zone (1–6, occasionally 7–9 at the London edge).
      // null when no station is comparable — kept honest, never bucketed.
      ...(zone !== null ? { zone } : {}),
      filterHints: buildFilterHints(prices, id, scrapedIds),
    });

    appendDetailArtifact(id, { id, rows: prices }, prices.length);
  }

  for (const row of famousRows) {
    const nearest = nearestStationZone(row.lat, row.lng, stationZones);
    const famousSlim = {
      id: row.id,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      cheapestPrice: row.anchor.price,
      borough: row.borough,
      ...(nearest ? { zone: nearest.zone } : {}),
      kind: row.kind,
      priceBand: famousPriceBands.get(row.id),
      anchorLabel: row.anchor.label,
      ...(row.anchor.course ? { anchorCourse: row.anchor.course } : {}),
      anchorObservedAt: row.anchor.observedAt,
      anchorSourceUrl: row.anchor.sourceUrl,
      filterHints: famousVenueFilterHints(row),
    };
    slim.push(famousSlim);
    appendDetailArtifact(
      row.id,
      { id: row.id, famous: { seed: row, slim: famousSlim } },
      1,
    );
  }
  detailIndex.count = detailLines.length;

  // Compact JSON (no whitespace) — the map never reads this file by hand.
  const slimText = JSON.stringify(buildShardPayload(slim));
  const detailText = detailLines.join("");
  const detailIndexText = JSON.stringify(detailIndex);
  await mkdir(GENERATED_DIR, { recursive: true });
  // The monolithic index stays the canonical artifact server-side name
  // resolution (lib/venueIndex.ts), the OG coverage image, and the by-id
  // consumers (crawls, rounds) read — they need ALL venues by id, not a
  // viewport. The sharded files below are the CLIENT MAP first-paint
  // optimization derived from the same rows.
  await writeFile(SLIM_PATH, slimText);
  await writeFile(DETAIL_ROWS_PATH, detailText);
  await writeFile(DETAIL_INDEX_PATH, detailIndexText);

  // --- spatially shard the slim index for the map's first paint --------------
  const cells = classifySpatialShards(slim, SPATIAL_GRID);
  const londonCentreCell = spatialCellIndex(51.5074, -0.1278, SPATIAL_GRID);
  const coreId = spatialCellId(
    londonCentreCell.lat,
    londonCentreCell.lon,
    SPATIAL_GRID,
  );
  const manifest = buildSpatialShardManifest(cells, SPATIAL_GRID, coreId);
  const coreCell = cells.get(coreId);
  if (!coreCell) throw new Error(`Spatial core cell ${coreId} is missing`);
  const coreText = JSON.stringify(buildShardPayload(coreCell.venues));
  const manifestText = JSON.stringify(manifest);
  await writeFile(path.join(DATA_DIR, CORE_FILE), coreText);
  await writeFile(path.join(DATA_DIR, MANIFEST_FILE), manifestText);

  // The previous borough pack is generated output. Remove only its known
  // venue-slim shard family before writing the new cell family.
  const oldShardFiles = (await readdir(DATA_DIR)).filter(
    (file) => /^venues_slim\.(?!manifest|core)[^.].*\.json$/.test(file),
  );
  await Promise.all(oldShardFiles.map((file) => unlink(path.join(DATA_DIR, file))));

  let spatialBytesTotal = 0;
  const shardReport = [];
  for (const [id, { lat, lon, venues }] of cells) {
    if (id === coreId) continue;
    const text = JSON.stringify(buildShardPayload(venues));
    spatialBytesTotal += Buffer.byteLength(text);
    await writeFile(path.join(DATA_DIR, spatialShardFile(lat, lon, SPATIAL_GRID)), text);
    shardReport.push({
      slug: id,
      count: venues.length,
      bytes: Buffer.byteLength(text),
    });
  }

  const manifestBytes = Buffer.byteLength(manifestText);
  const coreBytes = Buffer.byteLength(coreText);
  const totalShardBytes = manifestBytes + coreBytes + spatialBytesTotal;

  const rawBytes = Buffer.byteLength(rawText);
  const slimBytes = Buffer.byteLength(slimText);
  const detailBytes = Buffer.byteLength(detailText);
  const kb = (bytes) => (bytes / 1024).toFixed(1);
  const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2);

  console.log(
    `raw:   ${rows.length} price rows   ${mb(rawBytes)} MB (${rawBytes} bytes)`,
  );
  console.log(
    `slim:  ${slim.length} venues       ${kb(slimBytes)} KB (${slimBytes} bytes)`,
  );
  console.log(
    `saved: ${mb(rawBytes - slimBytes)} MB   (slim is ${(100 - (slimBytes / rawBytes) * 100).toFixed(1)}% smaller)`,
  );
  console.log(`wrote: ${path.relative(ROOT, SLIM_PATH)}`);
  console.log(
    `detail rows: ${slim.length} venues ${mb(detailBytes)} MB (${detailBytes} bytes)`,
  );
  console.log(`wrote: ${path.relative(ROOT, DETAIL_ROWS_PATH)}`);
  console.log(`wrote: ${path.relative(ROOT, DETAIL_INDEX_PATH)}`);

  // Zone coverage (nearest-station fare zone) — stamped per venue above, so the
  // spatial shards inherit it. Logged here, after
  // the shard budgets, as a build-time honesty spot-check.
  const zoneSummary = Object.keys(zoneCounts)
    .map(Number)
    .sort((a, b) => a - b)
    .map((z) => `z${z}:${zoneCounts[z]}`)
    .join(" ");
  console.log(
    `zones: ${zoneSummary}${zoneUnknown ? ` unknown:${zoneUnknown}` : ""} (nearest-station)`,
  );

  console.log("");
  console.log(`shards: ${cells.size} spatial cell(s), one central compatibility core`);
  console.log(
    `  core compatibility cell: ${coreCell.venues.length} venues   ${kb(coreBytes)} KB   (+ manifest ${kb(manifestBytes)} KB)`,
  );
  for (const { slug, count, bytes } of shardReport) {
    console.log(
      `  ${slug.padEnd(24)} ${String(count).padStart(4)} venues   ${kb(bytes)} KB`,
    );
  }
  console.log(
    `  core compatibility cell: ${coreId}`,
  );
  console.log(
    `  TOTAL all shards:  ${kb(totalShardBytes)} KB / ${kb(TOTAL_BUDGET_BYTES)} KB budget`,
  );

  if (coreBytes >= SHARD_BUDGET_BYTES) {
    throw new Error(
      `spatial core cell ${kb(coreBytes)} KB exceeds ${kb(SHARD_BUDGET_BYTES)} KB budget`,
    );
  }
  const oversized = shardReport.filter(({ bytes }) => bytes >= SHARD_BUDGET_BYTES);
  if (oversized.length > 0) {
    throw new Error(
      `spatial shard(s) exceed ${kb(SHARD_BUDGET_BYTES)} KB budget: ${oversized
        .map(({ slug, bytes }) => `${slug} (${kb(bytes)} KB)`)
        .join(", ")}`,
    );
  }
  if (totalShardBytes >= TOTAL_BUDGET_BYTES) {
    throw new Error(
      `total shard payload ${kb(totalShardBytes)} KB exceeds ${kb(TOTAL_BUDGET_BYTES)} KB budget.`,
    );
  }
}

export {
  assertCurrentFamousVenueRows,
  buildCurationHints,
  typeRelativePriceBands,
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
