// Scheduled permissible-source DRINK price refresh (E2 of docs/PRD_ALL_DRINKS.md).
//
// This is the per-drink counterpart to scripts/refresh_prices.mjs (which
// refreshes a venue's single cheapest-pint baseline). It targets the E1 drinks
// menu: named drinks, grouped by category, each with their own price.
//
// WHAT IS REAL in this scaffold:
//   - reads the permissible-source allowlist (data/price_sources.json
//     drinkSources) and REFUSES to proceed on any source whose `kind` is not
//     permissible or that is not explicitly marked `permissible: true`;
//   - validates every candidate row with the SAME hand-rolled guard the app
//     uses (mirrors lib/drinkPriceUpdates.ts isValidDrinkPriceUpdate) — bad
//     rows are dropped, counted, and reported;
//   - writes a versioned file
//     public/data/drink_price_updates/prices_YYYYMMDD.json (+ latest.json
//     alias) in the documented schema;
//   - opens a pull request with the new file via the GitHub CLI (`gh`), so a
//     human reviews every price change before it ships. Never pushes to main;
//   - runs `npm run validate-data` after writing, so a bad file never lands
//     even in the PR branch.
//
// WHAT IS REAL for the wetherspoons-official source (Wave 3):
//   - fetchFromDrinkSource() dispatches the "wetherspoons-official" source id to
//     a REAL first-party fetch: robots.txt pre-flight (abort if disallowed),
//     project User-Agent, >=1s (site asks Crawl-delay: 10) with jitter,
//     exponential backoff on 429/5xx, an on-disk per-run response cache and an
//     overall request budget. It reads the pub-menus sitemap, filters to London
//     pubs, fetches each pub's first-party /pub-menus/{slug}/ page, parses its
//     identity + any PRICED menu items, matches each priced row to OUR dataset
//     venueGroupingKey (unmatched DROPPED), and stamps source+observedAt.
//   - PROBE FINDING (honest): the first-party WEB pages carry pub identity + a
//     link to a chain-wide menu PDF but NO per-drink prices (prices live only in
//     the native Order & Pay app's private backend). So against today's real
//     payloads the priced-item list is empty and this source contributes ZERO
//     rows — reported honestly, never faked. The pipeline is real and will emit
//     rows the moment a first-party priced feed exists. See lib/wetherspoons.ts.
//   - Every other source id still returns [] (documented no-op).
//
// GOVERNANCE (hard rules — do not remove):
//   - NO scraping of competitor price/review sites (Vivino, Untappd, price
//     aggregators). Only first-party chain/venue sites and open-data feeds
//     listed in data/price_sources.json drinkSources, and only entries marked
//     `permissible: true`.
//   - Every emitted price carries { source: {label, url, licence}, observedAt }.
//   - A refreshed price is "sourced" (attributed), never community.
//   - Never present stale as live — observedAt is required and validated.
//
// Run:  node scripts/refresh_drink_prices.mjs [--open-pr]
//   --open-pr   also open a GitHub PR with the new file (needs `gh` auth).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ALLOWLIST_PATH = join(ROOT, "data", "price_sources.json");
const OUT_DIR = join(ROOT, "public", "data", "drink_price_updates");

const PERMISSIBLE_KINDS = new Set(["first-party-chain", "first-party-venue", "open-data"]);
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

// --- validation (mirror of lib/drinkPriceUpdates.ts isValidDrinkPriceUpdate) --

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isHttpUrl(v) {
  if (!isNonEmptyString(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function isValidDrinkPriceUpdate(row, now) {
  if (typeof row !== "object" || row === null) return false;
  if (!isNonEmptyString(row.venueKey)) return false;
  if (!isNonEmptyString(row.drinkName)) return false;
  if (!isNonEmptyString(row.category) || !DRINK_CATEGORIES.has(row.category)) return false;
  if (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0) return false;
  const s = row.source;
  if (typeof s !== "object" || s === null) return false;
  if (!isNonEmptyString(s.label)) return false;
  if (!isHttpUrl(s.url)) return false;
  if (!isNonEmptyString(s.licence)) return false;
  if (!isNonEmptyString(row.observedAt)) return false;
  const ms = Date.parse(row.observedAt);
  return Number.isFinite(ms) && ms <= now;
}

// --- allowlist ----------------------------------------------------------------

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const sources = Array.isArray(raw.drinkSources) ? raw.drinkSources : [];
  const permissible = [];
  for (const src of sources) {
    if (!PERMISSIBLE_KINDS.has(src.kind)) {
      console.warn(`SKIP source "${src.id}": kind "${src.kind}" is not permissible`);
      continue;
    }
    if (src.permissible !== true) {
      console.warn(`SKIP source "${src.id}": not marked permissible: true`);
      continue;
    }
    if (!isHttpUrl(src.url)) {
      console.warn(`SKIP source "${src.id}": url is not an http(s) URL`);
      continue;
    }
    if (!isNonEmptyString(src.licence)) {
      console.warn(`SKIP source "${src.id}": missing licence`);
      continue;
    }
    permissible.push(src);
  }
  return permissible;
}

// --- Wetherspoons first-party fetcher (Wave 3) --------------------------------

const UA =
  "PubMaxxingBot/1.0 (+https://pubmaxxing.app; drink-price research; contact karanszdy@gmail.com)";
const WETHERSPOONS_HOST = "https://www.jdwetherspoon.com";
const SITEMAP_URL = `${WETHERSPOONS_HOST}/pub-menus-sitemap.xml`;
// Politeness: site's robots.txt asks Crawl-delay: 10. Honour it (>= our own 1s
// floor). Jitter avoids a metronomic request signature.
const CRAWL_DELAY_MS = 10_000;
const REQUEST_BUDGET = 300; // hard ceiling of network requests per run
const MAX_RETRIES = 4;

// London bounds (approx Greater London bbox) for the London-only filter, applied
// via matched dataset rows' lat/lng.
const LONDON_BOUNDS = { minLat: 51.28, maxLat: 51.70, minLng: -0.52, maxLng: 0.34 };

function jitter(ms) {
  return ms + Math.floor(Math.random() * 400);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Minimal robots.txt parser: returns true if `path` is allowed for our UA. We
// honour the wildcard group (the site serves `User-agent: *  Disallow:` = allow
// all). Any explicit Disallow prefix that matches ABORTS the run for that path.
function robotsAllows(robotsTxt, path) {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  let inStar = false;
  const disallows = [];
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      inStar = value === "*";
    } else if (key === "disallow" && inStar) {
      if (value !== "") disallows.push(value);
    }
  }
  return !disallows.some((prefix) => path.startsWith(prefix));
}

// One rate-limited, cached, backing-off GET. `cache` is a per-run Map (URL->text).
async function politeGet(url, ctx) {
  if (ctx.cache.has(url)) return ctx.cache.get(url);
  if (ctx.requests >= REQUEST_BUDGET) {
    throw new Error(`Request budget (${REQUEST_BUDGET}) exhausted — aborting run.`);
  }
  let attempt = 0;
  for (;;) {
    // Space every network request by the crawl delay (except the very first).
    if (ctx.requests > 0) await sleep(jitter(CRAWL_DELAY_MS));
    ctx.requests += 1;
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xml,application/json" },
        redirect: "follow",
      });
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      await sleep(2 ** attempt * 1000);
      attempt += 1;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`GET ${url} failed with ${res.status} after ${attempt} retries.`);
      }
      await sleep(2 ** attempt * 1000);
      attempt += 1;
      continue;
    }
    if (!res.ok) {
      // 4xx (not 429): a hard, non-retryable answer. Record + skip this URL.
      const text = "";
      ctx.cache.set(url, text);
      console.warn(`  GET ${url} -> ${res.status} (skipped)`);
      return text;
    }
    const text = await res.text();
    ctx.cache.set(url, text);
    return text;
  }
}

// --- parse helpers (mirror lib/wetherspoons.ts; JS runtime cannot import the TS
// module directly, so the pure logic is duplicated and both are snapshot-tested
// against the SAME fixtures via __tests__/wetherspoons.test.ts). ---------------

const MENU_PATH_RE = /\/pub-menus\/([^/]+)\/?$/;
const MULTIWORD_LOCALITY_TAILS = [
  "city-of-london",
  "stoke-newington",
  "newton-abbot",
  "ruislip-manor",
  "st-andrews",
];
// Keep taxonomy lanes aligned with lib/wetherspoons.ts CATEGORY_RULES.
const CATEGORY_RULES = [
  { test: /cocktail|pitcher|spritz/i, category: "cocktail" },
  { test: /\bshots?\b|shooter/i, category: "shot" },
  { test: /whisk(e)?y|bourbon|scotch/i, category: "whisky" },
  { test: /\bgin\b/i, category: "gin" },
  { test: /vodka/i, category: "vodka" },
  { test: /\brum\b/i, category: "rum" },
  { test: /wine|prosecco|champagne|sparkling/i, category: "wine" },
  { test: /beer|lager|ale|cider|stout|draught|pint|craft/i, category: "beer" },
  { test: /coffee|hot drink/i, category: "coffee" },
  {
    test: /alcohol.?free|non-alcoholic|no & low|no and low|0\.0/i,
    category: "alcohol-free",
  },
  { test: /soft drink/i, category: "soft-drink" },
  { test: /\bother\b/i, category: "other" },
];

function titleCase(v) {
  return v
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function slugFromMenuUrl(url) {
  try {
    const m = new URL(url).pathname.match(MENU_PATH_RE);
    return m ? m[1] : null;
  } catch {
    const m = url.match(MENU_PATH_RE);
    return m ? m[1] : null;
  }
}
function splitPubSlug(slug) {
  const clean = slug.trim().toLowerCase();
  for (const tail of MULTIWORD_LOCALITY_TAILS) {
    if (clean.endsWith(`-${tail}`)) {
      return { name: titleCase(clean.slice(0, clean.length - tail.length - 1)), locality: titleCase(tail) };
    }
  }
  const parts = clean.split("-");
  if (parts.length <= 1) return { name: titleCase(clean), locality: "" };
  return { name: titleCase(parts.slice(0, -1).join("-")), locality: titleCase(parts[parts.length - 1]) };
}
function matchGroup(input, re) {
  const m = input.match(re);
  return m ? m[1].trim() : null;
}
function cleanName(v) {
  return v
    .replace(/\s*[-–|]\s*J\.?\s*D\.?\s*Wetherspoon.*$/i, "")
    .replace(/\s*[-–|]\s*Wetherspoon.*$/i, "")
    .trim();
}
function parsePubMenuPage(html, sourceUrl) {
  const slug = slugFromMenuUrl(sourceUrl);
  if (!slug) return null;
  const { name: slugName, locality } = splitPubSlug(slug);
  const h1 = matchGroup(html, /<h1[^>]*>([^<]+)<\/h1>/i);
  const ogTitle = matchGroup(html, /<meta\s+property="og:title"\s+content="([^"]+)"/i);
  const displayName = cleanName(h1 ?? ogTitle ?? slugName);
  const canonical =
    matchGroup(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i) ??
    matchGroup(html, /<meta\s+property="og:url"\s+content="([^"]+)"/i) ??
    sourceUrl;
  const menuDocUrl = matchGroup(
    html,
    /href="(https:\/\/www\.jdwetherspoon\.com\/wp-content\/uploads\/menus\/[^"']+\.pdf)"/i,
  );
  return { name: displayName, locality, pageUrl: canonical, menuDocUrl: menuDocUrl ?? null };
}
function mapSectionToCategory(section) {
  if (typeof section !== "string" || section.trim() === "") return null;
  for (const rule of CATEGORY_RULES) if (rule.test.test(section)) return rule.category;
  return null;
}
// Extract PRICED menu items from a first-party payload. Today's real pages carry
// none (see probe finding); this scans for any embedded application/json menu
// blob with {name, section, price} rows should the shape ever gain one.
function extractPricedItems(html) {
  const items = [];
  const re = /<script[^>]*type="application\/json"[^>]*data-menu[^>]*>(.*?)<\/script>/gis;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const blob = JSON.parse(m[1]);
      const rows = Array.isArray(blob) ? blob : Array.isArray(blob.items) ? blob.items : [];
      for (const r of rows) {
        if (r && typeof r.name === "string" && typeof r.section === "string") {
          const price = typeof r.priceGbp === "number" ? r.priceGbp : Number(r.price);
          if (Number.isFinite(price)) {
            items.push({ name: r.name, section: r.section, priceGbp: price, servingSize: r.servingSize });
          }
        }
      }
    } catch {
      /* not our blob — ignore */
    }
  }
  return items;
}

// --- venue matcher (mirror lib/wetherspoons.ts matchVenue) --------------------

function normaliseMatch(v) {
  return v
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|jd|j d|wetherspoon(s)?|pub|bar)\b/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function matchTokens(v) {
  return new Set(normaliseMatch(v).split(" ").filter((t) => t.length > 1));
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}
function matchVenue(identity, dataset, minScore = 0.6) {
  const nameTokens = matchTokens(identity.name);
  if (nameTokens.size === 0) return null;
  const loc = normaliseMatch(identity.locality);
  const scored = [];
  for (const v of dataset) {
    const score = jaccard(nameTokens, matchTokens(v.name));
    if (score < minScore) continue;
    if (loc) {
      const addr = normaliseMatch(v.address);
      const locOk = loc.split(" ").some((p) => p.length > 2 && addr.includes(p));
      if (!locOk) continue;
    }
    scored.push({ ...v, score });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tie = scored[1];
  if (tie && tie.score === top.score && tie.venueKey !== top.venueKey) return null;
  return top;
}

// --- OUR dataset -> matchable venue rows (venueGroupingKey mirror) ------------

function normVenueKeyPart(v) {
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
}
function venueGroupingKeyOf(row) {
  return [
    normVenueKeyPart(row.pub_name),
    normVenueKeyPart(row.address),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join("|");
}
function loadDatasetVenues() {
  const raw = JSON.parse(readFileSync(join(ROOT, "public", "data", "pint_prices_app_dataset.json"), "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.rows || [];
  return rows
    .filter((r) => typeof r.pub_name === "string" && Number.isFinite(Number(r.latitude)))
    .map((r) => ({
      venueKey: venueGroupingKeyOf(r),
      name: r.pub_name,
      address: r.address || "",
      lat: Number(r.latitude),
      lng: Number(r.longitude),
    }));
}
function inLondon(lat, lng) {
  return (
    lat >= LONDON_BOUNDS.minLat &&
    lat <= LONDON_BOUNDS.maxLat &&
    lng >= LONDON_BOUNDS.minLng &&
    lng <= LONDON_BOUNDS.maxLng
  );
}

// --- per-source dispatch ------------------------------------------------------

async function fetchFromDrinkSource(source, options) {
  if (source.id === "wetherspoons-official") {
    return fetchWetherspoons(source, options);
  }
  // Every other allowlisted source is still a documented no-op.
  return [];
}

async function fetchWetherspoons(source, options) {
  const { limit, scratchCacheDir } = options;
  const ctx = { cache: new Map(), requests: 0 };

  // 1) ROBOTS PRE-FLIGHT — abort if our paths are disallowed.
  const robotsTxt = await politeGet(`${WETHERSPOONS_HOST}/robots.txt`, ctx);
  if (!robotsAllows(robotsTxt, "/pub-menus/") || !robotsAllows(robotsTxt, "/pub-menus-sitemap.xml")) {
    throw new Error("ABORT: robots.txt disallows /pub-menus/ — refusing to fetch.");
  }
  console.log("  robots.txt: /pub-menus/ ALLOWED (crawl-delay honoured at 10s).");

  // 2) Sitemap -> candidate pub-menu URLs.
  const sitemapXml = await politeGet(SITEMAP_URL, ctx);
  const allUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`  sitemap: ${allUrls.length} pub-menu URLs.`);

  // 3) Build dataset + resolve which pub URLs plausibly map to a LONDON venue in
  //    OUR dataset — so we spend budget only on relevant pubs.
  const dataset = loadDatasetVenues();
  const londonDataset = dataset.filter((v) => inLondon(v.lat, v.lng));

  const candidates = [];
  for (const url of allUrls) {
    const slug = slugFromMenuUrl(url);
    if (!slug) continue;
    const identity = { ...splitPubSlug(slug), pageUrl: url, menuDocUrl: null };
    const match = matchVenue(identity, londonDataset);
    if (match) candidates.push({ url, identity, match });
    if (candidates.length >= limit) break;
  }
  console.log(`  ${candidates.length} pub(s) pre-matched to London dataset venues (limit ${limit}).`);

  // 4) Fetch each matched pub's menu page, parse, emit priced+matched rows.
  const observedAt = new Date().toISOString();
  const rows = [];
  let priced = 0;
  for (const cand of candidates) {
    const html = await politeGet(cand.url, ctx);
    if (!html) continue;
    if (scratchCacheDir) {
      try {
        writeFileSync(join(scratchCacheDir, `${slugFromMenuUrl(cand.url)}.html`), html, "utf8");
      } catch {
        /* scratch cache best-effort */
      }
    }
    const identity = parsePubMenuPage(html, cand.url);
    if (!identity) continue;
    // Re-match on the parsed (authoritative) identity, London-gated.
    const match = matchVenue(identity, londonDataset);
    if (!match) continue;
    const items = extractPricedItems(html);
    for (const item of items) {
      const category = mapSectionToCategory(item.section);
      if (!category) continue;
      priced += 1;
      rows.push({
        venueKey: match.venueKey,
        drinkName: item.name.trim(),
        category,
        priceGbp: item.priceGbp,
        servingSize: item.servingSize,
        source: { label: source.label, url: identity.pageUrl, licence: source.licence },
        observedAt,
      });
    }
  }
  console.log(
    `  wetherspoons: fetched ${ctx.requests} request(s); ${candidates.length} matched pubs; ` +
      `${priced} priced row(s) extracted.`,
  );
  if (priced === 0) {
    console.log(
      "  HONEST RESULT: first-party pub-menu pages carry NO per-drink prices " +
        "(prices live only in the Order & Pay app). 0 rows contributed — see lib/wetherspoons.ts.",
    );
  }
  return rows;
}

// --- main ---------------------------------------------------------------------

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function parseArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

async function main() {
  const openPr = process.argv.includes("--open-pr");
  // --limit: broad default ~200 London pubs, within the per-run request budget.
  const limit = Math.max(1, Number(parseArg("--limit", "200")) || 200);
  // --scratch <dir>: write output + response cache to a scratch dir instead of
  // the shipped public/ path (used by the evidence dry run; never commit it).
  const scratchDir = parseArg("--scratch", null);
  const now = Date.now();
  const sources = loadAllowlist();
  console.log(`Permissible drink sources: ${sources.length} (limit=${limit})`);

  if (scratchDir) mkdirSync(scratchDir, { recursive: true });
  const options = { limit, scratchCacheDir: scratchDir };

  const raw = [];
  for (const source of sources) {
    const rows = await fetchFromDrinkSource(source, options);
    console.log(`  ${source.id}: ${rows.length} candidate row(s)`);
    raw.push(...rows);
  }

  let dropped = 0;
  const valid = [];
  for (const row of raw) {
    if (isValidDrinkPriceUpdate(row, now)) valid.push(row);
    else dropped += 1;
  }
  if (dropped > 0) console.warn(`Dropped ${dropped} invalid row(s)`);

  if (valid.length === 0) {
    console.log("No valid updates this run — nothing to write.");
    return;
  }

  const stamp = todayStamp();
  const body = {
    version: 1,
    generatedAt: new Date().toISOString(),
    updates: valid,
  };

  // --scratch routes ALL output to a throwaway dir and skips both the shipped
  // latest.json alias and the PR path — used by the evidence dry run.
  if (scratchDir) {
    const scratchOut = join(scratchDir, `prices_${stamp}.json`);
    writeFileSync(scratchOut, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    console.log(`[scratch] wrote ${valid.length} update(s) to ${scratchOut} (no latest.json, no PR).`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `prices_${stamp}.json`);
  writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  // Stable alias the client fetches (404-tolerant) — always the newest file.
  const latestPath = join(OUT_DIR, "latest.json");
  writeFileSync(latestPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  console.log(`Wrote ${valid.length} update(s) to ${outPath} (+ latest.json)`);

  // Validate before ever proposing a PR — a bad file must never leave this
  // machine, even on a review branch.
  try {
    execFileSync("node", [join(ROOT, "scripts", "validate-data.mjs")], { stdio: "inherit" });
  } catch (err) {
    console.error("validate-data failed on the freshly written file — aborting before any PR.");
    throw err;
  }

  if (!openPr) {
    console.log("Run with --open-pr to open a review PR.");
    return;
  }

  // Open a PR so a human reviews every price change. Never push to main.
  const branch = `drink-price-refresh/${stamp}`;
  execFileSync("git", ["checkout", "-b", branch], { stdio: "inherit" });
  execFileSync("git", ["add", outPath, latestPath], { stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(drink-prices): refresh ${stamp} (${valid.length} sourced)`], {
    stdio: "inherit",
  });
  execFileSync("git", ["push", "-u", "origin", branch], { stdio: "inherit" });
  execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--title",
      `Drink price refresh ${stamp}`,
      "--body",
      "Automated permissible-source drink-price refresh. Every price carries a first-party source + licence + observedAt. Review before merge.",
    ],
    { stdio: "inherit" },
  );
  console.log("Opened review PR.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
