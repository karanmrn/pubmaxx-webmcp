// Shared, dependency-free shard-plan logic for the SLIM venue index.
//
// #315 (`data/outer-london-osm`) grew venues_slim.json to ~805 KB by adding
// ~650 sourced Outer-London OSM venue-PRESENCE pins across the ten "hollow"
// boroughs the persona-coverage audit flagged (Barking & Dagenham, Brent,
// Enfield, Greenwich, Haringey, Hounslow, Kingston upon Thames, Newham, Sutton,
// Waltham Forest). Those pins are overwhelmingly UNPRICED (OSM presence only),
// so they dominate payload while contributing almost no priced density — the
// map's first paint pays ~290 KB for boroughs a given session rarely looks at.
//
// London now partitions the slim rows into geographic cells. A tiny manifest
// names each cell's bbox and URL; the map fetches cells around its opening
// viewport and a neighbouring ring as the camera settles. The central cell is
// also written as the compatibility core. The legacy borough/kind partition
// remains for version-1 city packs and older fixtures.
//
// The classification is OBJECTIVE and data-driven (priced-venue ratio), not a
// hard-coded borough list, so a borough that gains real price coverage in a
// future refresh graduates into core automatically. The legacy build path
// enforces its core budget, while the spatial build path enforces cell, core,
// and total budgets. Data drift that blows a budget fails CI rather than
// silently regressing first paint.

// A borough is a LAZY outer shard when it is dominated by unpriced presence
// pins (low priced ratio) AND carries enough of them to be worth deferring.
// The original ten #315 boroughs sit at 4–17% priced, below this threshold.
export const OUTER_MAX_PRICED_RATIO = 0.4;
export const OUTER_MIN_VENUES = 20;

export const LAZY_KIND_SHARDS = { restaurant: "restaurants" };

export const MANIFEST_FILE = "venues_slim.manifest.json";
export const CORE_FILE = "venues_slim.core.json";
export const SHARD_VERSION = 1;
export const SPATIAL_SHARD_VERSION = 2;
const nonEmptyRevision = (...values) =>
  values.find((value) => typeof value === "string" && value.trim())?.trim();

const configuredDataRevision = nonEmptyRevision(
  process.env.NEXT_PUBLIC_SW_VERSION,
  process.env.DEPLOYMENT_VERSION,
  process.env.VERCEL_DEPLOYMENT_ID,
  process.env.VERCEL_GIT_COMMIT_SHA,
  process.env.GITHUB_SHA,
);

export const DATA_REVISION = configuredDataRevision ??
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error("A deploy revision is required for production data builds");
      })()
    : "local");

// The map opens on a viewport, not on a borough. A fixed grid keeps the first
// request proportional to what the reader can see and makes a pan predictable.
// The client reads these values from the manifest, so the grid can change with
// a data refresh without shipping a second copy of the maths in the bundle.
export const SPATIAL_GRID = {
  originLat: 51.25,
  originLon: -0.575,
  latStep: 0.025,
  lonStep: 0.025,
};

export const SPATIAL_SHARD_PREFIX = "venues_slim.cell.";

/** Public URL path (what the client fetches) for a data filename. */
export function dataUrl(fileName) {
  return `/data/${fileName}`;
}

export function buildShardPayload(rows) {
  return { revision: DATA_REVISION, rows };
}

/** File-safe borough slug, matching the OSM raw-file naming (barking_and_dagenham). */
export function slugifyBorough(borough) {
  return String(borough ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function shardFileForSlug(slug) {
  return `venues_slim.${slug}.json`;
}

export function spatialCellIndex(lat, lng, grid = SPATIAL_GRID) {
  return {
    lat: Math.floor((lat - grid.originLat) / grid.latStep),
    lon: Math.floor((lng - grid.originLon) / grid.lonStep),
  };
}

export function spatialCellId(latIndex, lonIndex, grid = SPATIAL_GRID) {
  const lat = grid.originLat + latIndex * grid.latStep;
  const lon = grid.originLon + lonIndex * grid.lonStep;
  return `${lat.toFixed(3)}_${lon.toFixed(3)}`;
}

export function spatialShardFile(latIndex, lonIndex, grid = SPATIAL_GRID) {
  return `${SPATIAL_SHARD_PREFIX}${spatialCellId(latIndex, lonIndex, grid)}.json`;
}

/** Partition every slim row into one deterministic geographic cell. */
export function classifySpatialShards(slim, grid = SPATIAL_GRID) {
  const cells = new Map();
  for (const venue of slim) {
    const { lat, lon } = spatialCellIndex(Number(venue.lat), Number(venue.lng), grid);
    const id = spatialCellId(lat, lon, grid);
    const existing = cells.get(id);
    if (existing) existing.venues.push(venue);
    else cells.set(id, { lat, lon, venues: [venue] });
  }
  return new Map(
    [...cells.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, cell]) => [
      id,
      cell,
    ]),
  );
}

/** Build a viewport-resolvable manifest with no eager monolithic core. */
export function buildSpatialShardManifest(cells, grid = SPATIAL_GRID, coreId = null) {
  const shards = [];
  for (const [id, { lat, lon, venues }] of cells) {
    const core = id === coreId;
    shards.push({
      id,
      core,
      ...(core ? {} : { partition: "grid" }),
      url: dataUrl(core ? CORE_FILE : spatialShardFile(lat, lon, grid)),
      count: venues.length,
      bbox: [
        grid.originLon + lon * grid.lonStep,
        grid.originLat + lat * grid.latStep,
        grid.originLon + (lon + 1) * grid.lonStep,
        grid.originLat + (lat + 1) * grid.latStep,
      ],
    });
  }
  return { version: SPATIAL_SHARD_VERSION, revision: DATA_REVISION, grid, shards };
}

function pricedRatio(venues) {
  if (venues.length === 0) return 1;
  const priced = venues.filter(
    (v) => typeof v.cheapestPrice === "number" && Number.isFinite(v.cheapestPrice),
  ).length;
  return priced / venues.length;
}

/** [minLng, minLat, maxLng, maxLat] over a venue list (GeoJSON bbox order). */
export function computeBbox(venues) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const v of venues) {
    const lat = Number(v.lat);
    const lng = Number(v.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  if (minLng === Infinity) return [0, 0, 0, 0];
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Partition slim rows into a core list and lazy shards.
 * A borough qualifies as outer iff it has >= OUTER_MIN_VENUES rows AND its
 * priced ratio is < OUTER_MAX_PRICED_RATIO. Every other row (including tiny /
 * ambiguous borough labels) stays in core, where it is always available.
 *
 * Returns { core, outer } where outer is a Map<slug, { borough?, venues }>
 * ordered by descending venue count (stable, deterministic output).
 */
export function classifySlimShards(slim) {
  const kindShardFor = (v) => LAZY_KIND_SHARDS[String(v.kind ?? "")] ?? null;
  const boroughRows = slim.filter((v) => kindShardFor(v) === null);

  const byBorough = new Map();
  for (const v of boroughRows) {
    const borough = String(v.borough ?? "");
    const bucket = byBorough.get(borough);
    if (bucket) bucket.push(v);
    else byBorough.set(borough, [v]);
  }

  const outer = new Map();
  const core = [];
  const outerBoroughs = new Set();
  for (const [borough, venues] of byBorough) {
    const slug = slugifyBorough(borough);
    if (
      slug &&
      venues.length >= OUTER_MIN_VENUES &&
      pricedRatio(venues) < OUTER_MAX_PRICED_RATIO
    ) {
      outerBoroughs.add(borough);
    }
  }

  // Preserve original slim order within each shard so ids stay comparable.
  for (const v of slim) {
    const kindSlug = kindShardFor(v);
    const borough = String(v.borough ?? "");
    const slug = kindSlug ?? (outerBoroughs.has(borough) ? slugifyBorough(borough) : null);
    if (slug === null) {
      core.push(v);
      continue;
    }
    const bucket = outer.get(slug);
    if (bucket) bucket.venues.push(v);
    else outer.set(slug, { ...(kindSlug ? {} : { borough }), venues: [v] });
  }

  // Deterministic shard order: descending venue count, then slug.
  const ordered = new Map(
    [...outer.entries()].sort((a, b) => {
      const d = b[1].venues.length - a[1].venues.length;
      return d !== 0 ? d : a[0].localeCompare(b[0]);
    }),
  );

  return { core, outer: ordered };
}

/**
 * Build the eager manifest. `shards` lists both the core shard (core:true) and
 * every outer shard, each with an { id, url, bbox, count } so the client can
 * resolve a viewport / point to the shards it must fetch without downloading
 * any shard body first.
 */
export function buildShardManifest({ core, outer }) {
  const shards = [
    {
      id: "core",
      core: true,
      url: dataUrl(CORE_FILE),
      count: core.length,
      bbox: computeBbox(core),
    },
  ];
  for (const [slug, { borough, venues }] of outer) {
    shards.push({
      id: slug,
      core: false,
      partition: borough ? "borough" : "kind",
      ...(borough ? { borough } : {}),
      url: dataUrl(shardFileForSlug(slug)),
      count: venues.length,
      bbox: computeBbox(venues),
    });
  }
  return { version: SHARD_VERSION, revision: DATA_REVISION, shards };
}
