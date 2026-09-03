/**
 * Merge London chain scrapes (Young's, Nicholson's, Eating Europe) into
 * venue_menu_enrichment.json + a match report.
 *
 * Governance:
 * - Young's + Nicholson's = first-party OK for menus/prices.
 * - Eating Europe = editorial ONLY (heritage/crawl) — NEVER prices.
 * - Prefer honest enrichment links over invented £ prices.
 * - Do not copy secrets (FIRECRAWL_API_KEY etc.) into data/.
 *
 * Matching helpers are mirrored from lib/nicholsons.ts + lib/youngs.ts
 * (plain Node cannot import TS; unit tests pin the TS originals).
 *
 * Usage: node scripts/merge_london_chain_scrapes.mjs
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const FIRECRAWL_DIR = join(ROOT, ".firecrawl");
const CHAINS_DIR = join(ROOT, "data", "london_chains");
const ENRICHMENT_PATH = join(ROOT, "public", "data", "venue_menu_enrichment.json");
const DATASET_PATH = join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const MATCH_REPORT_PATH = join(CHAINS_DIR, "match_report.json");

// --- mirror of lib/venues.ts grouping + id (keep in lockstep with build_slim_index) ---

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

// --- mirror of lib/nicholsons.ts (subset used by merge) ---

const LOCALITY_SUFFIXES = [
  "cambridgecircus",
  "claphamjunction",
  "leicestersquare",
  "liverpoolstreet",
  "oxfordcircus",
  "oxfordstreet",
  "charingcross",
  "canarywharf",
  "coventgarden",
  "carnabystreet",
  "hattongarden",
  "brewerstreet",
  "kinglystreet",
  "bishopsgate",
  "rathbonestreet",
  "fleetstreet",
  "watlingstreet",
  "grovelandcourt",
  "talbotcourt",
  "londonbridge",
  "cannonstreet",
  "blackfriars",
  "kensington",
  "westminster",
  "hammersmith",
  "moorgate",
  "islington",
  "southbank",
  "monument",
  "mayfair",
  "victoria",
  "aldgate",
  "strand",
  "soho",
];

const SLUG_DISPLAY_NAMES = {
  doggettscoatandbadgesouthbanklondon: "Doggett's Coat and Badge",
  theargyllarmsoxfordcircuslondon: "The Argyll Arms",
  thebearandstaffleicestersquarelondon: "The Bear and Staff",
  theblackfriarblackfriarslondon: "The Blackfriar",
  thecambridgecambridgecircuslondon: "The Cambridge",
  theclachankinglystreetlondon: "The Clachan",
  theclarencemayfairlondon: "The Clarence",
  thecoalholestrandlondon: "The Coal Hole",
  thecrownbrewerstreetlondon: "The Crown",
  thedogandducksoholondon: "The Dog and Duck",
  theelephantandcastlekensingtonlondon: "The Elephant and Castle",
  thefalconclaphamjunctionlondon: "The Falcon",
  thefeatherswestminsterlondon: "The Feathers",
  theflyinghorseoxfordstreetlondon: "The Flying Horse",
  theglobemoorgatelondon: "The Globe",
  thehenryaddingtoncanarywharflondon: "The Henry Addington",
  thehoopandgrapesaldgatelondon: "The Hoop and Grapes",
  thehornimanathayslondonbridge: "The Horniman at Hays",
  thekingsheadmayfairlondon: "The Kings Head",
  thelordaberconwayliverpoolstreetlondon: "The Lord Aberconway",
  themagpiebishopsgatelondon: "The Magpie",
  themarquisofgranbyrathbonestreetlondon: "The Marquis of Granby",
  themarquisofgranbywestminsterlondon: "The Marquis of Granby",
  themudlarklondonbridge: "The Mudlark",
  theobservatory: "The Observatory",
  theoldbelltavernfleetstreetlondon: "The Old Bell Tavern",
  theoldthamesideinnlondonbridge: "The Old Thameside Inn",
  theporcupineleicestersquarelondon: "The Porcupine",
  theprincessofwalescharingcrosslondon: "The Princess of Wales",
  theshiptalbotcourtlondon: "The Ship",
  thesirchristopherhattonhattongardenlondon: "The Sir Christopher Hatton",
  thestgeorgestavernvictorialondon: "The St George's Tavern",
  thesugarloafcannonstreet: "The Sugar Loaf",
  theswanhammersmithlondon: "The Swan",
  thethreegreyhoundssoholondon: "The Three Greyhounds",
  thewalrusandthecarpentermonumentlondon: "The Walrus and the Carpenter",
  thewellingtonstrandlondon: "The Wellington",
  thewhitehorsecarnabystreetlondon: "The White Horse",
  thewhitelioncoventgardenlondon: "The White Lion",
  thewhiteswanlondon: "The White Swan",
  thewoodinsshadesbishopsgatelondon: "The Woodins Shades",
  theyorkislingtonlondon: "The York",
  williamsonstaverngrovelandcourtlondon: "Williamson's Tavern",
  yeoldewatlingwatlingstreetlondon: "Ye Olde Watling",
};

function titleCaseWords(raw) {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^(and|at|of|the)$/i.test(word)) return word.toLowerCase();
      if (/^st$/i.test(word)) return "St";
      if (/^ye$/i.test(word)) return "Ye";
      if (/^olde$/i.test(word)) return "Olde";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/^the /i, "The ")
    .replace(/^ye /i, "Ye ");
}

function nicholsonSlugToName(slug) {
  const key = slug.trim().toLowerCase();
  if (!key) return "";
  if (SLUG_DISPLAY_NAMES[key]) return SLUG_DISPLAY_NAMES[key];
  let body = key;
  if (body.endsWith("london")) body = body.slice(0, -"london".length);
  for (const suffix of LOCALITY_SUFFIXES) {
    if (body.endsWith(suffix)) {
      body = body.slice(0, -suffix.length);
      break;
    }
  }
  const spaced = body
    .replace(/^yeolde/, "ye olde ")
    .replace(/^the/, "the ")
    .replace(/and/g, " and ")
    .replace(/arms$/, " arms")
    .replace(/tavern$/, " tavern")
    .replace(/inn$/, " inn")
    .replace(/hole$/, " hole")
    .replace(/head$/, " head")
    .replace(/horse$/, " horse")
    .replace(/lion$/, " lion")
    .replace(/swan$/, " swan")
    .replace(/castle$/, " castle")
    .replace(/\s+/g, " ")
    .trim();
  return titleCaseWords(spaced || body) || slug;
}

function nicholsonSlugLocality(slug) {
  let body = slug.trim().toLowerCase();
  if (body.endsWith("london")) body = body.slice(0, -"london".length);
  for (const suffix of LOCALITY_SUFFIXES) {
    if (body.endsWith(suffix)) return suffix;
  }
  return "";
}

function nicholsonIdentityFromSlug(slug) {
  const clean = slug.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  const base = `https://www.nicholsonspubs.co.uk/restaurants/london/${clean}`;
  return {
    slug: clean,
    name: nicholsonSlugToName(clean),
    baseUrl: base,
    foodmenuUrl: `${base}/foodmenu`,
    bookingsUrl: `${base}/bookings`,
    drinksUrl: `${base}/drinks`,
    localityHint: nicholsonSlugLocality(clean),
  };
}

function nicholsonSlugFromUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.replace(/^www\./, "").includes("nicholsonspubs.co.uk")) return null;
    const m = u.pathname.match(/\/restaurants\/london\/([^/]+)/i);
    return m?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function normaliseName(value) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|pub|bar|tavern|inn|hotel|arms)\b/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value) {
  return new Set(normaliseName(value).split(" ").filter((t) => t.length > 1));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const GENERIC_LOCALITY_TOKENS = new Set([
  "street",
  "square",
  "road",
  "lane",
  "hill",
  "court",
  "garden",
  "bridge",
  "bank",
  "fair",
  "gate",
  "circus",
  "wharf",
  "london",
]);

function localityTokens(hint) {
  const raw = hint
    .replace(/circus/g, " circus")
    .replace(/street/g, " street")
    .replace(/square/g, " square")
    .replace(/wharf/g, " wharf")
    .replace(/garden/g, " garden")
    .replace(/bridge/g, " bridge")
    .replace(/court/g, " court")
    .replace(/bank/g, " bank")
    .replace(/fair/g, " fair")
    .replace(/gate/g, " gate")
    .replace(/\s+/g, " ")
    .trim();
  return raw
    .split(" ")
    .filter((t) => t.length > 2 && !GENERIC_LOCALITY_TOKENS.has(t));
}

function matchNicholsonVenue(identity, dataset, minScore = 0.6) {
  const slug = identity.slug.toLowerCase();
  const byWebsite = [];
  for (const venue of dataset) {
    const web = (venue.website ?? "").toLowerCase();
    if (!web.includes("nicholsonspubs")) continue;
    if (web.includes(slug) || web.includes(`/london/${slug}`)) {
      byWebsite.push({
        venueKey: venue.venueKey,
        venueId: venue.venueId,
        score: 1,
        matchedName: venue.name,
        method: "website",
      });
    }
  }
  if (byWebsite.length === 1) return byWebsite[0];
  if (byWebsite.length > 1) {
    const keys = new Set(byWebsite.map((m) => m.venueKey));
    if (keys.size === 1) return byWebsite[0];
    return null;
  }

  const nTokens = nameTokens(identity.name);
  if (nTokens.size === 0) return null;
  const locParts = localityTokens(identity.localityHint);
  if (nTokens.size <= 1 && locParts.length === 0) return null;
  const scored = [];
  for (const venue of dataset) {
    const score = jaccard(nTokens, nameTokens(venue.name));
    const effectiveMin = nTokens.size <= 1 ? Math.max(minScore, 0.85) : minScore;
    if (score < effectiveMin) continue;
    const addr = normaliseName(venue.address);
    if (locParts.length > 0) {
      const locOk = locParts.some((part) => addr.includes(part));
      const distinctive = nTokens.size >= 2 && [...nTokens].some((t) => t.length >= 8);
      if (!locOk && !(score >= 0.85 && distinctive)) continue;
      if (
        !locOk &&
        !/\blondon\b|\bec\d|\bw\d|\bsw\d|\bse\d|\bn\d|\be\d|\bnw\d/i.test(venue.address)
      ) {
        continue;
      }
    } else if (!/\blondon\b|\bec\d|\bw\d|\bsw\d|\bse\d|\bn\d|\be\d|\bnw\d/i.test(venue.address)) {
      continue;
    }
    scored.push({
      venueKey: venue.venueKey,
      venueId: venue.venueId,
      score,
      matchedName: venue.name,
      method: "fuzzy-name",
    });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tie = scored[1];
  if (tie && tie.score === top.score && tie.venueKey !== top.venueKey) return null;
  return top;
}

// --- mirror of lib/youngs.ts (subset) ---

function youngsHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function parseYoungsGardenMarkdown(markdown, sourcePage) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const link = lines[i].match(/\[Explore the pub\]\((https?:\/\/[^)\s]+)\)/i);
    if (!link) continue;
    const url = link[1].replace(/\/garden\/?$/i, "/").replace(/\/+$/, "") || link[1];
    let name = "";
    for (let back = 1; back <= 6; back += 1) {
      const prev = (lines[i - back] ?? "").trim();
      if (!prev || prev.startsWith("!") || prev.startsWith("[") || prev.startsWith("#")) continue;
      if (/^scroll for more$/i.test(prev)) continue;
      if (/^[A-ZÀ-ÖØ-Ý]/.test(prev) && prev.length < 80) {
        name = prev.replace(/,+\s*$/, "").trim();
        break;
      }
    }
    if (!name) {
      const host = youngsHostname(url);
      name = host ? host.split(".")[0] : url;
    }
    const key = `${normaliseName(name)}|${youngsHostname(url) ?? url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, url, sourcePage });
  }
  return out;
}

function matchYoungsVenue(pub, dataset, minScore = 0.75) {
  const host = youngsHostname(pub.url);
  if (host) {
    const byWeb = [];
    for (const venue of dataset) {
      const web = (venue.website ?? "").toLowerCase();
      if (!web) continue;
      try {
        const venueHost = new URL(web.startsWith("http") ? web : `https://${web}`).hostname.replace(
          /^www\./,
          "",
        );
        if (venueHost === host || web.includes(host)) {
          byWeb.push({
            venueKey: venue.venueKey,
            venueId: venue.venueId,
            score: 1,
            matchedName: venue.name,
            method: "website",
          });
        }
      } catch {
        if (web.includes(host)) {
          byWeb.push({
            venueKey: venue.venueKey,
            venueId: venue.venueId,
            score: 1,
            matchedName: venue.name,
            method: "website",
          });
        }
      }
    }
    if (byWeb.length === 1) return byWeb[0];
    if (byWeb.length > 1) {
      const keys = new Set(byWeb.map((m) => m.venueKey));
      if (keys.size === 1) return byWeb[0];
      return null;
    }
  }

  const nTokens = nameTokens(pub.name);
  if (nTokens.size === 0) return null;
  const scored = [];
  for (const venue of dataset) {
    const score = jaccard(nTokens, nameTokens(venue.name));
    if (score < minScore) continue;
    if (!/\blondon\b|\bec\d|\bw\d|\bsw\d|\bse\d|\bn\d|\be\d|\bnw\d/i.test(venue.address)) continue;
    scored.push({
      venueKey: venue.venueKey,
      venueId: venue.venueId,
      score,
      matchedName: venue.name,
      method: "fuzzy-name",
    });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tie = scored[1];
  if (tie && tie.score === top.score && tie.venueKey !== top.venueKey) return null;
  return top;
}

// --- I/O helpers ---

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function archiveMarkdown(patterns, destDir) {
  ensureDir(destDir);
  if (!existsSync(FIRECRAWL_DIR)) return [];
  const files = readdirSync(FIRECRAWL_DIR).filter((f) => f.endsWith(".md"));
  const copied = [];
  for (const file of files) {
    if (!patterns.some((re) => re.test(file))) continue;
    copyFileSync(join(FIRECRAWL_DIR, file), join(destDir, file));
    copied.push(file);
  }
  return copied;
}

function hasReliablePoundPrices(markdown) {
  const pounds = markdown.match(/£\s?\d+(?:\.\d{1,2})?/g) ?? [];
  return pounds.length >= 3;
}

function main() {
  const archived = {
    youngs: archiveMarkdown([/^youngs\.co\.uk-/], join(CHAINS_DIR, "youngs", "raw")),
    nicholsons: archiveMarkdown(
      [/^nicholsonspubs\.co\.uk/],
      join(CHAINS_DIR, "nicholsons", "raw"),
    ),
    eatingeurope: archiveMarkdown(
      [/^eatingeurope\.com-/],
      join(CHAINS_DIR, "eatingeurope", "raw"),
    ),
  };

  const rows = loadJson(DATASET_PATH);
  const byKey = new Map();
  for (const row of rows) {
    const venueKey = venueGroupingKey(row);
    if (byKey.has(venueKey)) continue;
    byKey.set(venueKey, {
      venueKey,
      venueId: stableVenueIdFromKey(venueKey),
      name: row.pub_name,
      address: row.address ?? "",
      website: row.website ?? "",
    });
  }
  const dataset = [...byKey.values()];

  const nichUrls = loadJson(join(CHAINS_DIR, "nicholsons", "london_pub_urls.json"));
  const nichMatched = [];
  const nichUnmatched = [];
  const enrichmentAdditions = {};

  for (const url of nichUrls) {
    const slug = nicholsonSlugFromUrl(url) ?? url.split("/").filter(Boolean).pop();
    if (!slug) continue;
    const identity = nicholsonIdentityFromSlug(slug);
    const match = matchNicholsonVenue(identity, dataset);
    const foodmenuFile = join(
      FIRECRAWL_DIR,
      `nicholsonspubs.co.uk-restaurants-london-${slug}-foodmenu.md`,
    );
    let pricesReliable = false;
    if (existsSync(foodmenuFile)) {
      pricesReliable = hasReliablePoundPrices(readFileSync(foodmenuFile, "utf8"));
    }
    const entry = {
      slug: identity.slug,
      name: identity.name,
      baseUrl: identity.baseUrl,
      match: match
        ? {
            venueId: match.venueId,
            venueKey: match.venueKey,
            matchedName: match.matchedName,
            method: match.method,
            score: match.score,
          }
        : null,
      pricesReliable,
      drinkPricesEmitted: false,
    };
    if (match) {
      nichMatched.push(entry);
      enrichmentAdditions[match.venueId] = {
        source: "nicholsonspubs.co.uk",
        menuUrl: identity.foodmenuUrl,
        bookingUrl: identity.bookingsUrl,
        categoryTiles: [
          {
            id: "food-1",
            label: "Food",
            hint: "Opens the Nicholson's food menu",
            href: identity.foodmenuUrl,
          },
          {
            id: "drinks-1",
            label: "Drinks",
            hint: "Opens the Nicholson's drinks menu",
            href: identity.drinksUrl,
          },
        ],
      };
    } else {
      nichUnmatched.push(entry);
    }
  }

  const gardenRaw = loadJson(join(CHAINS_DIR, "youngs", "garden_pubs_raw.json"));
  const gardenByHost = new Map();
  for (const row of gardenRaw) {
    if (!row?.url) continue;
    const host = youngsHostname(row.url);
    if (!host) continue;
    const existing = gardenByHost.get(host) ?? {
      url: row.url.split("/garden")[0].replace(/\/+$/, "") || row.url,
      region: row.region,
      sourcePage: row.sourcePage,
      name: "",
    };
    if (
      row.name &&
      !/^explore/i.test(row.name) &&
      row.name.length < 80 &&
      !/best pub gardens|for those looking|burger shack/i.test(row.name)
    ) {
      existing.name = row.name;
    }
    if (row.region) existing.region = row.region;
    gardenByHost.set(host, existing);
  }

  const youngsMdFiles = [
    ...archived.youngs.map((f) => join(CHAINS_DIR, "youngs", "raw", f)),
    ...readdirSync(FIRECRAWL_DIR)
      .filter((f) => f.startsWith("youngs.co.uk-best-pub-gardens"))
      .map((f) => join(FIRECRAWL_DIR, f)),
  ];
  for (const file of [...new Set(youngsMdFiles)]) {
    if (!existsSync(file)) continue;
    const pubs = parseYoungsGardenMarkdown(
      readFileSync(file, "utf8"),
      file.split(/[\\/]/).pop(),
    );
    for (const pub of pubs) {
      const host = youngsHostname(pub.url);
      if (!host) continue;
      const existing = gardenByHost.get(host) ?? {
        url: pub.url,
        region: undefined,
        sourcePage: pub.sourcePage,
        name: pub.name,
      };
      if (pub.name) existing.name = pub.name;
      if (pub.sourcePage) existing.sourcePage = pub.sourcePage;
      gardenByHost.set(host, existing);
    }
  }

  const youngsMatched = [];
  const youngsUnmatched = [];
  const beerGardenHints = [];

  for (const [host, pub] of gardenByHost) {
    const identity = {
      name: pub.name || host,
      url: pub.url.startsWith("http") ? pub.url : `https://${host}`,
      region: pub.region,
      sourcePage: pub.sourcePage,
    };
    const match = matchYoungsVenue(identity, dataset);
    const entry = {
      host,
      name: identity.name,
      url: identity.url,
      region: pub.region ?? null,
      match: match
        ? {
            venueId: match.venueId,
            venueKey: match.venueKey,
            matchedName: match.matchedName,
            method: match.method,
            score: match.score,
          }
        : null,
    };
    if (match) {
      youngsMatched.push(entry);
      beerGardenHints.push({
        venueId: match.venueId,
        venueKey: match.venueKey,
        hint: "beerGarden",
        source: "youngs.co.uk",
        note: "Listed on Young's official best pub gardens guides; apply on slim rebuild or via curated UI.",
      });
      if (!enrichmentAdditions[match.venueId]) {
        enrichmentAdditions[match.venueId] = {
          source: "youngs.co.uk",
          menuUrl: identity.url,
          categoryTiles: [
            {
              id: "garden-1",
              label: "Pub site",
              hint: "Young's beer garden pub — opens the official pub website",
              href: identity.url,
            },
          ],
        };
      }
    } else {
      youngsUnmatched.push(entry);
    }
  }

  const eeMd = join(FIRECRAWL_DIR, "eatingeurope.com-blog-londons-pubs.md");
  const eePubs = [
    { name: "The Mayflower", aliases: ["mayflower"], postcode: "SE16 4NF" },
    { name: "Lord Wargrave", aliases: ["wargrave"], postcode: "W1H 5HE" },
    {
      name: "Ye Old Mitre",
      aliases: ["ye olde mitre", "ye old mitre", "olde mitre"],
      postcode: "EC1N 6SJ",
    },
    { name: "The Albion", aliases: ["the albion"], postcode: "N1 1HW" },
    { name: "The Spaniards Inn", aliases: ["spaniards"], postcode: "NW3 7JJ" },
    { name: "The Ship Soho", aliases: ["ship soho"], postcode: "W1F 0TT" },
    { name: "The Grenadier", aliases: ["grenadier"], postcode: "SW1X 7NR" },
  ];
  const eeMatched = [];
  const eeUnmatched = [];
  for (const pub of eePubs) {
    const pc = pub.postcode.toLowerCase().replace(/\s+/g, "");
    let hit = null;
    for (const venue of dataset) {
      const addr = (venue.address ?? "").toLowerCase().replace(/\s+/g, "");
      if (pc && addr.includes(pc)) {
        hit = venue;
        break;
      }
    }
    if (!hit && pub.name === "The Grenadier") {
      hit =
        dataset.find((v) => /grenadier/i.test(v.name) && /wilton|sw1x/i.test(v.address)) ?? null;
    }
    if (!hit) {
      for (const venue of dataset) {
        const nameL = venue.name.toLowerCase();
        if (!pub.aliases.some((a) => nameL.includes(a))) continue;
        if (!/\blondon\b|\bec\d|\bw\d|\bsw\d|\bse\d|\bn\d|\be\d|\bnw\d/i.test(venue.address)) {
          continue;
        }
        // Ambiguous common names require postcode (already tried).
        if (["the albion", "ship soho", "ye olde mitre", "ye old mitre", "olde mitre"].some((a) =>
          pub.aliases.includes(a),
        )) {
          continue;
        }
        hit = venue;
        break;
      }
    }
    if (hit) {
      eeMatched.push({
        name: pub.name,
        venueId: hit.venueId,
        venueKey: hit.venueKey,
        matchedName: hit.name,
      });
    } else {
      eeUnmatched.push({ name: pub.name, postcode: pub.postcode });
    }
  }

  const existing = existsSync(ENRICHMENT_PATH)
    ? loadJson(ENRICHMENT_PATH)
    : { version: 1, venues: {} };
  if (!existing.venues || typeof existing.venues !== "object") existing.venues = {};
  existing.version = 1;

  for (const [venueId, rec] of Object.entries(enrichmentAdditions)) {
    const prev = existing.venues[venueId];
    if (prev && prev.source === "greene-king.co.uk") {
      // Keep Greene King as the primary overlay; do not graft another chain's tiles.
      existing.venues[venueId] = prev;
    } else if (prev && prev.source === "nicholsonspubs.co.uk" && rec.source === "youngs.co.uk") {
      existing.venues[venueId] = prev;
    } else {
      existing.venues[venueId] = { ...prev, ...rec };
    }
  }
  writeFileSync(ENRICHMENT_PATH, `${JSON.stringify(existing, null, 2)}\n`);

  const report = {
    generatedAt: new Date().toISOString(),
    archived,
    nicholsons: {
      total: nichUrls.length,
      matched: nichMatched.length,
      unmatched: nichUnmatched.length,
      matchedVenues: nichMatched,
      unmatchedPubs: nichUnmatched,
      note: "Foodmenu scrapes are image hubs without extractable £ prices — enrichment links only; no drink_price_updates invented.",
    },
    youngs: {
      total: gardenByHost.size,
      matched: youngsMatched.length,
      unmatched: youngsUnmatched.length,
      matchedVenues: youngsMatched,
      unmatchedPubs: youngsUnmatched,
      beerGardenHints,
      note: "beerGardenHints are documented for slim rebuild / curated UI; not forced into venues_slim here.",
    },
    eatingeurope: {
      sourceUrl: "https://www.eatingeurope.com/blog/londons-pubs/",
      governance: "editorial-only — never prices",
      markdownPresent: existsSync(eeMd),
      matched: eeMatched.length,
      unmatched: eeUnmatched.length,
      matchedVenues: eeMatched,
      unmatchedPubs: eeUnmatched,
    },
    enrichment: {
      path: "public/data/venue_menu_enrichment.json",
      totalVenues: Object.keys(existing.venues).length,
      addedOrUpdated: Object.keys(enrichmentAdditions).length,
    },
  };
  ensureDir(CHAINS_DIR);
  writeFileSync(MATCH_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        nicholsons: { matched: nichMatched.length, unmatched: nichUnmatched.length },
        youngs: { matched: youngsMatched.length, unmatched: youngsUnmatched.length },
        eatingeurope: { matched: eeMatched.length, unmatched: eeUnmatched.length },
        enrichmentVenues: Object.keys(existing.venues).length,
        archivedCounts: {
          youngs: archived.youngs.length,
          nicholsons: archived.nicholsons.length,
          eatingeurope: archived.eatingeurope.length,
        },
      },
      null,
      2,
    ),
  );
}

main();
