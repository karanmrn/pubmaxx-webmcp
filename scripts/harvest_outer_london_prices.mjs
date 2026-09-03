#!/usr/bin/env node
/**
 * Cycle-6 PRD item 1 — honest DRAUGHT PINT prices for the new Outer-London OSM
 * presence pubs (added on data/outer-london-osm, currently price_gbp: null).
 *
 * EVIDENCE RULES (absolute — mirror /pint-index methodology + lib/pintFacts.ts):
 *  - A price needs an EXPLICIT first-party source: the pub's OWN published
 *    material (its website / menu page). No aggregator scraping. No invented or
 *    LLM-guessed prices.
 *  - Every accepted price is verbatim-validated: the £ value returned by the
 *    extractor MUST appear literally in the first-party page text we scraped, or
 *    it is DROPPED as a possible hallucination.
 *  - Every accepted price is provenance-stamped: source url + label + licence +
 *    observedAt, written into the app-dataset row (comment / data_quality_notes /
 *    scraped_at_values / pub_url) AND into the sanctioned per-drink store
 *    public/data/drink_price_updates/latest.json (same schema the other
 *    harvesters + validate-data use).
 *  - Chains whose web pages carry NO per-drink prices (prices live only in their
 *    Order & Pay apps — proven by prior probes: Wetherspoon, Mitchells & Butlers
 *    brands, Stonegate/Craft Union, Greene King image-menus, Great Local Pubs,
 *    Slug & Lettuce) are logged honestly as no-web-price WITHOUT spending API
 *    credits on them.
 *
 * Output:
 *  - mutates public/data/pint_prices_app_dataset.json (sets price_gbp on the
 *    matched OSM row to the cheapest validated draught pint; unpriced rows are
 *    left null — a real pin with no price beats an invented one).
 *  - merges sourced rows into public/data/drink_price_updates/latest.json.
 *  - writes a per-venue result log JSON to data/osm/outer_price_harvest_log.json.
 *
 * Requires EXA_API_KEY and TAVILY_API_KEY in the environment (never commit them).
 *
 * Usage:
 *   node scripts/harvest_outer_london_prices.mjs \
 *     [--limit N] [--budget N] [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPintPrices } from "./lib/tavilyPubEnrichment.mjs";
import {
  assertProviderCredentials,
  discoverRefreshPages,
  fetchRefreshPage,
} from "./lib/localRefreshProviders.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT = join(dirname(MODULE_PATH), "..");
const APP_PATH = join(ROOT, "public/data/pint_prices_app_dataset.json");
const DRINK_UPDATES_DIR = join(ROOT, "public/data/drink_price_updates");
const LATEST_PATH = join(DRINK_UPDATES_DIR, "latest.json");
const DEFAULT_LOG_PATH = join(ROOT, "data/osm/outer_price_harvest_log.json");
function logPathArg() {
  const i = process.argv.indexOf("--log");
  return i !== -1 && process.argv[i + 1] ? join(ROOT, process.argv[i + 1]) : DEFAULT_LOG_PATH;
}
const LOG_PATH = logPathArg();

function drinkIdentityName(name) {
  return String(name)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+pint$/, "")
    .replace(/\s+/g, " ");
}

export function mergeDrinkUpdates(existing, incoming) {
  const keyOf = (update) =>
    `${update.venueKey}|${drinkIdentityName(update.drinkName)}|${update.source.url}`;
  const merged = new Map(existing.map((update) => [keyOf(update), update]));
  for (const update of incoming) merged.set(keyOf(update), update);
  return [...merged.values()];
}

// Chains proven to publish NO per-drink prices on their public web pages
// (prices live only in native Order & Pay apps / image-only menus). Skipped to
// save credits; logged honestly as chain-no-web-price.
const NO_WEB_PRICE_CHAINS = [
  { re: /jdwetherspoon/, label: "J D Wetherspoon (prices in Order & Pay app only)" },
  { re: /greeneking|hungryhorse|farmhouseinns|flaminggrill|metropolitanpubcompany/, label: "Greene King / Hungry Horse (image menus + app-only deals)" },
  { re: /emberinns|vintageinn|oneills|nicholsonspubs|sizzlingpubs|allbarone|toby|harvester|castlepubs|premiummeasures/, label: "Mitchells & Butlers (prices in app only)" },
  { re: /craftunionpubs|slugandlettuce|stonegate|craftedsocial|crafted-social/, label: "Stonegate (prices in app only)" },
  { re: /greatukpubs|greatlocalpubs/, label: "Great Local Pubs / Stonegate (no web prices)" },
  { re: /facebook\.com|instagram\.com|google\.|linktr\.ee|wixsite/, label: "Social/holding page (no first-party menu)" },
];

// Draught-pint signal: a beer keyword must co-occur with a £ price for a page to
// be worth an extraction call.
const DRAUGHT_KW = /\b(pint|draught|draft|on tap|lager|real ale|\bale\b|cider|stout|guinness|ipa|pale ale|bitter|neck oil|birra|moretti|estrella|madri|camden|amstel|carling|fosters|foster's|peroni|heineken|cruzcampo|kronenbourg|paulaner|beavertown|gamma ray|lucky saint|inches|thatchers|aspall|carlsberg|san miguel|stella)\b/i;
const POUND_RE = /£\s?(\d{1,2}(?:\.\d{2})?)/g;

const SOURCE_LICENCE =
  "All rights reserved — first-party publisher of its own pub menu/prices; read-only, attributed use only.";

// A draught pint's plausible price band in Greater London (guards against
// grabbing a food / bottle / carafe / spirit-double number).
const MIN_PINT = 3.0;
const MAX_PINT = 9.5;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

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

export function priorPublishedSourceFor(row, priorEntries) {
  for (let index = priorEntries.length - 1; index >= 0; index -= 1) {
    const entry = priorEntries[index];
    if (
      entry.result === "priced" &&
      entry.website === row.website &&
      typeof entry.sourceUrl === "string" &&
      /^https?:\/\//i.test(entry.sourceUrl)
    ) {
      return entry.sourceUrl;
    }
  }
  return row.website;
}

async function scrape(url) {
  const page = await fetchRefreshPage({ job: "plain-page", url });
  return {
    ...page,
    json: {
      draughtPints: extractPintPrices(page.markdown).map(({ drinkName, priceGbp }) => ({
        drinkName,
        priceGbp,
      })),
    },
  };
}

/** All £ values present verbatim in the page text (as a Set of "3.80" strings). */
function poundsInText(md) {
  const set = new Set();
  let m;
  POUND_RE.lastIndex = 0;
  while ((m = POUND_RE.exec(md)) !== null) set.add(Number(m[1]).toFixed(2));
  return set;
}

/** Pick the best drink/menu candidate link from a homepage. */
function bestDrinkLink(links, baseHost) {
  const cands = links
    .filter((l) => typeof l === "string" && host(l) === baseHost)
    .filter((l) => /drink|menu|tap|beer|bar\b/i.test(l))
    .filter((l) => !/\.(jpg|jpeg|png|pdf|gif|webp)$/i.test(l))
    .filter((l) => !/food-?(menu|and)|breakfast|sunday|lunch|book|reserv|event|christmas|gift/i.test(l));
  // Prefer an explicit "drink" page, then "menu".
  cands.sort((a, b) => {
    const score = (u) => (/drink|tap/i.test(u) ? 0 : /menu/i.test(u) ? 1 : 2);
    return score(a) - score(b);
  });
  return cands[0] || null;
}

function main() {
  assertProviderCredentials(["pub-discovery", "plain-page"]);
  const limit = Number(arg("--limit", "0")) || 0;
  const budget = Number(arg("--budget", "280")) || 280;
  const dryRun = arg("--dry-run", false) === true;
  // --resume: reprocess ONLY the independents that a prior run left credit-blocked
  // (result "blocked" + "Insufficient credits"), and carry forward every prior
  // definitive entry so the log stays a complete per-venue record.
  const resume = arg("--resume", false) === true;
  let priorKeep = [];
  let reblockedUrls = new Set();
  let priorEntries = [];
  if (existsSync(LOG_PATH)) {
    const prior = JSON.parse(readFileSync(LOG_PATH, "utf8"));
    priorEntries = Array.isArray(prior) ? prior : prior.log || [];
  }
  if (resume) {
    for (const e of priorEntries) {
      if (e.result === "blocked" && /Insufficient credits/i.test(String(e.reason || ""))) {
        reblockedUrls.add(e.website);
      } else {
        priorKeep.push(e);
      }
    }
    console.log(`[resume] carrying ${priorKeep.length} prior entries; reprocessing ${reblockedUrls.size} credit-blocked venues`);
  }

  // --scope osm (default): the outer-London OSM presence cohort.
  // --scope non-osm: every OTHER unpriced venue (all-London expansion) whose
  //   venue group carries no numeric price anywhere.
  const scope = arg("--scope", "osm");
  const app = JSON.parse(readFileSync(APP_PATH, "utf8"));
  const previouslyPricedWebsites = new Set(
    priorEntries
      .filter((entry) => entry.result === "priced" && entry.website)
      .map((entry) => entry.website),
  );

  let osmRows;
  if (scope === "non-osm") {
    // group by venueKey; keep groups with NO numeric price; one representative
    // row per group (prefer a row that has a website).
    const groups = new Map();
    for (const r of app) {
      const k = venueGroupingKey(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    osmRows = [];
    for (const rows of groups.values()) {
      const hasPrice = rows.some((r) => typeof r.price_gbp === "number" && Number.isFinite(r.price_gbp));
      if (hasPrice) continue;
      if (rows.some((r) => String(r.source_datasets || "").includes("outer_london_osm"))) continue; // already done
      const rep = rows.find((r) => r.website) || rows[0];
      osmRows.push(rep);
    }
  } else {
    osmRows = app.filter(
      (r) =>
        String(r.source_datasets || "").includes("outer_london_osm") &&
        (r.price_gbp == null || previouslyPricedWebsites.has(r.website)),
    );
  }

  // Bucket by host; keep the first row per host as the harvest target (all rows
  // remain individually priceable, but one representative site drives the fetch).
  const observedAt = new Date().toISOString();
  const observedDate = observedAt.slice(0, 10);

  const withSite = osmRows.filter((r) => r.website && host(r.website));
  const log = [];
  const drinkUpdates = [];
  let requests = 0;
  let priced = 0;

  // Order: independents first (highest yield), skip-chains logged for free.
  const chainOf = (h) => NO_WEB_PRICE_CHAINS.find((c) => c.re.test(h));

  const targets = [];
  for (const row of withSite) {
    const h = host(row.website);
    const chain = chainOf(h);
    if (chain) {
      if (!resume) {
        log.push({
          borough: row.primary_borough,
          pub: row.pub_name,
          website: row.website,
          host: h,
          result: "no-price-published",
          reason: `chain: ${chain.label}`,
        });
      }
      continue;
    }
    targets.push(row);
  }

  // In resume mode, seed the log with every carried-forward prior entry and
  // narrow the queue to just the previously credit-blocked venues.
  if (resume) {
    log.push(...priorKeep);
  }
  const activeTargets = resume ? targets.filter((r) => reblockedUrls.has(r.website)) : targets;
  const orderedTargets = activeTargets.toSorted((left, right) => {
    const leftKnown = previouslyPricedWebsites.has(left.website) ? 0 : 1;
    const rightKnown = previouslyPricedWebsites.has(right.website) ? 0 : 1;
    return leftKnown - rightKnown;
  });
  const queue = limit ? orderedTargets.slice(0, limit) : orderedTargets;
  console.log(
    `Independents to sweep: ${queue.length} (of ${targets.length}); chains logged: ${log.length}; budget ${budget} requests`,
  );

  return (async () => {
    for (const row of queue) {
      if (requests >= budget) {
        log.push({
          borough: row.primary_borough,
          pub: row.pub_name,
          website: row.website,
          host: host(row.website),
          result: "skipped-budget",
          reason: "request budget exhausted",
        });
        continue;
      }
      const h = host(row.website);
      const rec = { borough: row.primary_borough, pub: row.pub_name, website: row.website, host: h };

      // 1) revisit the exact prior evidence page, or start from the official homepage.
      const initialUrl = priorPublishedSourceFor(row, priorEntries);
      const home = await scrape(initialUrl);
      requests += 1;

      let md = home.markdown;
      let pageUrl = initialUrl;
      let extracted = home.json?.draughtPints || [];

      // 2) if the homepage has no validated pint, follow a drinks/menu link.
      const homePounds = poundsInText(md);
      const homeHasSignal = DRAUGHT_KW.test(md) && homePounds.size > 0;
      let usedSecond = false;
      if ((!extracted.length || !homeHasSignal) && requests < budget) {
        let link = bestDrinkLink(home.links, h);
        if (!link) {
          const discoveries = await discoverRefreshPages({
            query: `${row.pub_name} drinks menu pint price`,
            includeDomains: [h],
            numResults: 3,
          });
          link = discoveries.map((result) => result.url).find((url) => /drink|menu|tap|beer/i.test(url)) ?? null;
        }
        if (link && link !== initialUrl) {
          const drink = await scrape(link);
          requests += 1;
          usedSecond = true;
          if (DRAUGHT_KW.test(drink.markdown) || (drink.json?.draughtPints || []).length) {
            md = drink.markdown;
            pageUrl = link;
            extracted = drink.json?.draughtPints || [];
          }
        }
      }

      // 3) verbatim-validate every extracted price against the scraped page text.
      const pagePounds = poundsInText(md);
      const validated = [];
      for (const item of extracted) {
        const price = Number(item.priceGbp);
        if (!Number.isFinite(price)) continue;
        if (price < MIN_PINT || price > MAX_PINT) continue; // pint band guard
        if (!pagePounds.has(price.toFixed(2))) continue; // MUST appear verbatim
        const name = String(item.drinkName || "").trim();
        if (!name) continue;
        validated.push({ drinkName: name, priceGbp: price });
      }

      if (!validated.length) {
        log.push({
          ...rec,
          result: "no-price-published",
          reason: DRAUGHT_KW.test(md)
            ? "draught listed but no extractable/verbatim pint price"
            : "no draught pint pricing on site",
          requests: usedSecond ? 2 : 1,
        });
        continue;
      }

      // cheapest validated draught pint drives the map price.
      validated.sort((a, b) => a.priceGbp - b.priceGbp);
      const cheapest = validated[0];
      priced += 1;

      // stamp the app-dataset row (all rows for this venue key share cheapestPrice
      // via build:slim, but there is exactly one OSM row per venue here).
      row.price_gbp = cheapest.priceGbp;
      row.pint_name = cheapest.drinkName;
      row.price_text = `£${cheapest.priceGbp.toFixed(2)}`;
      row.pub_url = pageUrl;
      row.constructed_pub_url = pageUrl;
      row.comment = `${row.comment} Draught pint price from first-party site ${pageUrl}, observed ${observedDate}.`;
      row.data_quality_notes = `${row.data_quality_notes}|price:first_party_web|${pageUrl}|observed=${observedDate}`;
      row.scraped_at_values = observedAt;

      // sanctioned per-drink store rows (same schema as the other harvesters).
      const venueKey = venueGroupingKey(row);
      for (const v of validated) {
        drinkUpdates.push({
          venueKey,
          drinkName: v.drinkName,
          category: "beer",
          priceGbp: v.priceGbp,
          source: { label: `${row.pub_name} — official website`, url: pageUrl, licence: SOURCE_LICENCE },
          observedAt,
        });
      }

      log.push({
        ...rec,
        result: "priced",
        cheapestPint: cheapest.priceGbp,
        drink: cheapest.drinkName,
        allDraught: validated,
        sourceUrl: pageUrl,
        observedAt,
        requests: usedSecond ? 2 : 1,
      });
      console.log(`  PRICED ${row.pub_name} (${row.primary_borough}): £${cheapest.priceGbp.toFixed(2)} ${cheapest.drinkName}`);
    }

    // --- write outputs -------------------------------------------------------
    const summary = {
      generatedAt: observedAt,
      totalOsmUnpriced: osmRows.length,
      withWebsite: withSite.length,
      chainsSkipped: log.filter((l) => l.result === "no-price-published" && String(l.reason).startsWith("chain")).length,
      independentsSwept: queue.length,
      requestsUsed: requests,
      priced,
    };
    console.log("\nSUMMARY", JSON.stringify(summary, null, 2));

    if (dryRun) {
      console.log("[dry-run] not writing dataset / updates.");
      writeFileSync(LOG_PATH, `${JSON.stringify({ summary, log }, null, 2)}\n`);
      console.log(`Wrote log to ${LOG_PATH}`);
      return;
    }

    writeFileSync(APP_PATH, `${JSON.stringify(app)}\n`);
    console.log(`Updated ${APP_PATH} (${priced} rows priced)`);

    if (drinkUpdates.length) {
      mkdirSync(DRINK_UPDATES_DIR, { recursive: true });
      let existing = [];
      if (existsSync(LATEST_PATH)) {
        try {
          const raw = JSON.parse(readFileSync(LATEST_PATH, "utf8"));
          existing = Array.isArray(raw) ? raw : raw.updates || [];
        } catch {
          existing = [];
        }
      }
      // De-dupe on venue, normalised drink identity, and publisher. A current
      // source may add or remove the redundant trailing word "pint" without
      // creating two current observations for one drink.
      const merged = mergeDrinkUpdates(existing, drinkUpdates);
      const stamp = observedDate.replace(/-/g, "");
      const payload = { version: 1, generatedAt: observedAt, updates: merged };
      writeFileSync(join(DRINK_UPDATES_DIR, `prices_${stamp}.json`), `${JSON.stringify(payload, null, 2)}\n`);
      writeFileSync(LATEST_PATH, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Merged ${drinkUpdates.length} drink rows into latest.json (total ${merged.length})`);
    }

    writeFileSync(LOG_PATH, `${JSON.stringify({ summary, log }, null, 2)}\n`);
    console.log(`Wrote per-venue log to ${LOG_PATH}`);
  })();
}

if (process.argv[1] === MODULE_PATH) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
