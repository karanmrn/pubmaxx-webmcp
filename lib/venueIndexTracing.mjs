import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  CITY_VENUE_PACKS,
  enabledVenuePackIncludes,
  LAST_RIDE_CITY_IDS,
  venuePackIncludesFor,
} from "./cityVenuePacks.mjs";
import { MAP_EAGER_VENUE_INDEX_TRACING_INCLUDES } from "./mapEagerVenueIndexFile.mjs";
import { UK_PLACE_INDEX_TRACING_INCLUDE } from "./ukPlaceIndexFile.mjs";
import { UK_PUB_SEARCH_INDEX_TRACING_INCLUDE } from "./ukPubSearchIndexFile.mjs";
import { VENUE_ALIASES_TRACING_INCLUDE } from "./venueAliasesFile.mjs";
import { VENUE_IMAGE_HOST_TRACING_INCLUDES } from "./venueImageHostFiles.mjs";
import { VENUE_MENU_ENRICHMENT_TRACING_INCLUDE } from "./venueMenuEnrichmentFile.mjs";
import { PINT_INDEX_SNAPSHOT_TRACING_INCLUDE } from "./pintIndexSnapshotFile.mjs";
import { UK_OSM_PUBS_TRACING_INCLUDE } from "./ukOsmPubsFile.mjs";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const RUNTIME_SOURCE_ROOTS = ["app", "components", "lib"];
const APP_ENTRY_NAMES = new Set(["page", "route", "opengraph-image", "sitemap"]);

function enabledVenueOsmPackIncludes() {
  return Object.entries(CITY_VENUE_PACKS)
    .filter(([, pack]) => pack.enabled)
    .map(([cityId]) =>
      cityId === "london"
        ? UK_OSM_PUBS_TRACING_INCLUDE
        : `./data/cities/${cityId}/osm_pubs.json`,
    );
}

/**
 * Every module that opens a data file whose path it ASSEMBLES at request time,
 * with the files that module can open. Next traces only paths it can see
 * statically, so a reader of one of these ships the data only when the route is
 * declared in outputFileTracingIncludes; otherwise it is an accident of which
 * routes Vercel grouped into that lambda.
 *
 * A pack is declared ONCE here and its reader routes are derived from the import
 * graph, so a new pack needs one entry and a new reader needs nothing at all.
 * `modules` holds every module that assembles a path to the SAME files, so the
 * readers of each are found without restating the file list. Those lists are
 * themselves taken from the registry or the one-string module that owns the
 * path, never hand-copied.
 *
 * @type {ReadonlyArray<{ id: string, modules: string[], files: string[] }>}
 */
export const RUNTIME_DATA_PACKS = [
  {
    id: "venue-index",
    modules: [
      "lib/venueIndex.ts",
      "lib/venueDetailIndex.ts",
      "lib/cityRivalry.ts",
      "lib/concierge/venues.server.ts",
      "lib/ask/deskVenues.server.ts",
      "lib/ogCityPriceBands.server.ts",
      "app/map/[city]/opengraph-image.tsx",
    ],
    files: enabledVenuePackIncludes(),
  },
  {
    id: "venue-osm-index",
    modules: ["lib/venueIndexOsm.ts"],
    files: enabledVenueOsmPackIncludes(),
  },
  {
    id: "venue-detail-index",
    modules: ["lib/venueDetailIndex.ts"],
    files: [
      "./data/generated/venue_detail_index.json",
      "./data/generated/venue_details.jsonl",
      "./public/data/pint_prices_app_dataset.json",
    ],
  },
  {
    // The governed landing pages (and /sitemap.xml) read the dataset through
    // this ONE seam. It delegates to lib/venuePriceIndex.ts rather than opening
    // the file itself, and the declaration stays here so the include follows
    // the seam whoever the reader behind it is.
    id: "pint-price-landing-dataset",
    modules: ["lib/pintPriceLandingDataset.server.ts"],
    files: ["./public/data/pint_prices_app_dataset.json"],
  },
  {
    // A landing page names a pub in a `?sel=` link only when the map's EAGER
    // shard carries it, so the page opens that shard at request time.
    id: "map-eager-venue-index",
    modules: ["lib/mapEagerVenueIndex.server.ts"],
    files: MAP_EAGER_VENUE_INDEX_TRACING_INCLUDES,
  },
  {
    id: "venue-aliases",
    modules: ["lib/venueAliases.ts"],
    files: [VENUE_ALIASES_TRACING_INCLUDE],
  },
  {
    id: "venue-menu-enrichment",
    modules: ["lib/venueMenuEnrichment.ts"],
    files: [VENUE_MENU_ENRICHMENT_TRACING_INCLUDE],
  },
  {
    id: "uk-place-index",
    modules: ["lib/ukPlaceIndex.server.ts"],
    files: [UK_PLACE_INDEX_TRACING_INCLUDE],
  },
  {
    id: "uk-pub-search-index",
    modules: ["lib/ukNationalPubSearch.server.ts"],
    files: [UK_PUB_SEARCH_INDEX_TRACING_INCLUDE],
  },
  {
    id: "venue-image-hosts",
    modules: ["lib/venueImageHosts.server.ts"],
    files: VENUE_IMAGE_HOST_TRACING_INCLUDES,
  },
  {
    // The three last-ride routes share one helper, which opens the slim pack of
    // the city its caller names. Before the extraction each route joined string
    // literals and Next traced the file itself.
    id: "last-ride-city-venues",
    modules: ["lib/lastRideRoute.ts"],
    files: venuePackIncludesFor(LAST_RIDE_CITY_IDS),
  },
  {
    id: "public-pint-index-snapshot",
    modules: ["lib/publicPintIndexSnapshot.server.ts"],
    files: [PINT_INDEX_SNAPSHOT_TRACING_INCLUDE],
  },
  {
    id: "scheduled-city-enrichment-pubs",
    modules: ["lib/tavilyPubEnrichment.server.ts"],
    files: [UK_OSM_PUBS_TRACING_INCLUDE],
  },
];

/**
 * Runtime-path modules whose files reach their routes through a DIFFERENT
 * derivation, named here so the fence can tell "declared elsewhere" from
 * "nobody declared it". Each value is the next.config.mjs key that carries them.
 */
export const RUNTIME_PATH_MODULES_TRACED_ELSEWHERE = {
  "app/api/freshness/route.ts": "/api/freshness",
  "app/api/cron/freshness-audit/route.ts": "/api/cron/freshness-audit",
  "lib/freshnessArtifact.ts": "/api/freshness + /api/cron/freshness-audit",
  "app/feed/feedSightings.server.ts": "/feed",
};

/**
 * Runtime-path modules that are NOT declared yet, each with what it opens and
 * the condition for removing it from this list. A documented exception, not a
 * mute button: the fence fails on any runtime-path module in neither this list
 * nor RUNTIME_DATA_PACKS, so new debt cannot arrive quietly, and it fails again
 * once a listed module is declared so the list can only shrink.
 */
export const RUNTIME_PATH_MODULES_PENDING_DECLARATION = {
  // Streams UK base shards + their manifest per viewport, several MB in total.
  // Declare once the per-route payload of the shard set has been sized.
  "lib/ukBaseIndex.ts": "public/data/uk_base shards and manifest",
  // Reads the published-edition DIRECTORY, so it needs a glob rather than a
  // file list. Declare with the archive glob once that glob is agreed.
  "lib/pintIndexSnapshot.server.ts": "every published month",
  // The 6.7 MB bundled price dataset. Declare once its weight on the Pint Index
  // routes is a decision somebody has taken deliberately.
  "lib/venueDataset.ts": "public/data/pint_prices_app_dataset.json",
  // Brand fonts for the OG image renderers.
  "lib/ogBrand.tsx": "the bundled Space Grotesk font files",
};

function collectSourceFiles(directory, files) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(file, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(path.resolve(file));
    }
  }
}

function runtimeImportSpecifiers(source) {
  const specifiers = [];
  const staticImport =
    /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const commonJsRequire = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const pattern of [staticImport, dynamicImport, commonJsRequire]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function resolveLocalImport(importer, specifier, projectRoot, sourceFiles) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.resolve(projectRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => sourceFiles.has(candidate)) ?? null;
}

function appEntryRouteGlob(file, appRoot) {
  const extension = path.extname(file);
  const entryName = path.basename(file, extension);
  if (!APP_ENTRY_NAMES.has(entryName)) return null;

  const directory = path.relative(appRoot, path.dirname(file));
  const routeSegments = directory
    .split(path.sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .filter((segment) => !segment.startsWith("@"));

  if (entryName === "opengraph-image") routeSegments.push(entryName);
  // A sitemap entry serves `<its own segments>/sitemap.xml`, so the key is
  // derived like every other route. Returning the root key here would attach a
  // nested app/<segment>/sitemap.ts to `/sitemap.xml` instead.
  if (entryName === "sitemap") routeSegments.push("sitemap.xml");
  const route = routeSegments.length > 0 ? `/${routeSegments.join("/")}` : "/";

  // outputFileTracingIncludes keys are picomatch globs. Dynamic segment
  // brackets must be escaped or `[id]` becomes a one-character glob class.
  return route.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function buildImportGraph(absoluteRoot) {
  const files = [];
  for (const sourceRoot of RUNTIME_SOURCE_ROOTS) {
    collectSourceFiles(path.join(absoluteRoot, sourceRoot), files);
  }

  const sourceFiles = new Set(files);
  const reverseDependencies = new Map();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const resolved = runtimeImportSpecifiers(source)
      .map((specifier) => resolveLocalImport(file, specifier, absoluteRoot, sourceFiles))
      .filter(Boolean);
    for (const dependency of resolved) {
      const readers = reverseDependencies.get(dependency) ?? [];
      readers.push(file);
      reverseDependencies.set(dependency, readers);
    }
  }
  return { files, sourceFiles, reverseDependencies };
}

function readerRouteGlobs(graph, absoluteRoot, moduleRelativePath) {
  const appRoot = path.join(absoluteRoot, "app");
  const target = path.resolve(absoluteRoot, moduleRelativePath);
  if (!graph.sourceFiles.has(target)) return [];

  // Grow the reverse dependency closure to a fixed point. Using the reverse
  // index keeps each reader lookup linear in the reachable graph. A full scan
  // for every frontier node made next.config.mjs slow enough to hit Vitest's
  // test timeout once the map acquired its deferred catalog edges.
  const readers = new Set([target]);
  const pending = [target];
  while (pending.length > 0) {
    const dependency = pending.pop();
    for (const reader of graph.reverseDependencies.get(dependency) ?? []) {
      if (readers.has(reader)) continue;
      readers.add(reader);
      pending.push(reader);
    }
  }

  const routes = new Set();
  for (const file of graph.files) {
    if (!file.startsWith(`${appRoot}${path.sep}`) || !readers.has(file)) continue;
    const route = appEntryRouteGlob(file, appRoot);
    if (route) routes.add(route);
  }
  return [...routes].sort();
}

/**
 * Find App Router runtime entries whose local static-import graph reaches one
 * module. The result is suitable as outputFileTracingIncludes keys.
 *
 * @param {string} projectRoot
 * @param {string} moduleRelativePath project-relative path of the reading module
 * @returns {string[]}
 */
export function discoverRuntimeReaderRouteGlobs(projectRoot, moduleRelativePath) {
  const absoluteRoot = path.resolve(projectRoot);
  return readerRouteGlobs(buildImportGraph(absoluteRoot), absoluteRoot, moduleRelativePath);
}

/**
 * Every runtime data pack keyed by the routes that can open it, merged so a
 * route reading two packs declares both. One import graph serves every pack.
 *
 * @param {string} projectRoot
 * @returns {Record<string, string[]>} outputFileTracingIncludes entries.
 */
export function runtimeDataPackRouteIncludes(projectRoot) {
  const absoluteRoot = path.resolve(projectRoot);
  const graph = buildImportGraph(absoluteRoot);

  /** @type {Record<string, string[]>} */
  const includes = {};
  for (const pack of RUNTIME_DATA_PACKS) {
    for (const packModule of pack.modules) {
      for (const route of readerRouteGlobs(graph, absoluteRoot, packModule)) {
        includes[route] = [...new Set([...(includes[route] ?? []), ...pack.files])];
      }
    }
  }
  return includes;
}

// Everything below finds the modules the registry is FOR: a module that hands
// `fs` a path it built from something other than string literals cannot be
// traced statically, whoever wrote it. join(), resolve() and template paths all
// count, because the shape of the expression is not what makes a path invisible
// to the tracer; the non-literal piece in it is.

const FS_READ_CALL = /\b(?:readFile|readFileSync|createReadStream|open|opendir|readdir|readdirSync)\s*\(/;
const PATH_BUILD_CALL = /\b(?:path\.)?(?:join|resolve)\s*\(/g;
const STRING_LITERAL = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\$])*`)$/s;
const PROCESS_ROOT = /^(?:process\.cwd\(\)|__dirname)$/;
const TEMPLATE_LITERAL = /`(?:\\.|[^`\\])*`/g;
const TEMPLATE_INTERPOLATION = /\$\{/g;

function callArguments(source, openParenIndex) {
  let depth = 0;
  let quote = null;
  const args = [];
  let current = "";
  for (let index = openParenIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
    } else if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      if (depth === 1) continue;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) {
        if (current.trim()) args.push(current.trim());
        return args;
      }
    } else if (character === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      continue;
    }
    if (depth >= 1) current += character;
  }
  return args;
}

// A template path is assembled the moment it interpolates anything besides the
// process root: `${process.cwd()}/data/x.json` is still one static string.
function templatePathIsAssembled(source) {
  for (const [template] of source.matchAll(TEMPLATE_LITERAL)) {
    if (!template.includes("process.cwd()") && !template.includes("__dirname")) continue;
    const interpolations = template.match(TEMPLATE_INTERPOLATION)?.length ?? 0;
    const roots =
      (template.match(/\$\{\s*process\.cwd\(\)\s*\}/g)?.length ?? 0) +
      (template.match(/\$\{\s*__dirname\s*\}/g)?.length ?? 0);
    if (interpolations > roots) return true;
  }
  return false;
}

function assemblesPathAtRuntime(source) {
  if (!FS_READ_CALL.test(source)) return false;
  if (!source.includes("process.cwd()") && !source.includes("__dirname")) return false;
  if (templatePathIsAssembled(source)) return true;
  for (const match of source.matchAll(PATH_BUILD_CALL)) {
    const args = callArguments(source, match.index + match[0].length - 1);
    if (args.length === 0) continue;
    const [base, ...rest] = args;
    const baseIsLiteralRoot = PROCESS_ROOT.test(base) || STRING_LITERAL.test(base);
    if (!baseIsLiteralRoot) return true;
    if (rest.some((argument) => !STRING_LITERAL.test(argument))) return true;
  }
  return false;
}

/**
 * Project-relative modules that open a data file by a path they assemble at
 * request time AND sit on at least one App Router entry's import graph. These
 * are exactly the modules whose files Next cannot trace, so each must be a
 * RUNTIME_DATA_PACK, named in RUNTIME_PATH_MODULES_TRACED_ELSEWHERE, or carried
 * in RUNTIME_PATH_MODULES_PENDING_DECLARATION with what it opens.
 *
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function discoverRuntimePathModules(projectRoot) {
  const absoluteRoot = path.resolve(projectRoot);
  const graph = buildImportGraph(absoluteRoot);

  const modules = [];
  for (const file of graph.files) {
    if (!assemblesPathAtRuntime(readFileSync(file, "utf8"))) continue;
    const relative = path.relative(absoluteRoot, file).split(path.sep).join("/");
    if (readerRouteGlobs(graph, absoluteRoot, relative).length === 0) continue;
    modules.push(relative);
  }
  return modules.sort();
}
