import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { normalizeOverpass as normalizeCityOverpass } from "../scripts/fetch_city_osm_pubs.mjs";
import {
  isFreshOverpassSnapshot,
  parseOverpassRawText,
} from "../scripts/fetch_uk_osm_pubs.mjs";
import { normalizeOsmPubElement } from "../scripts/lib/osmPubNormalizer.mjs";
import {
  CURATED_MATCH_RADIUS_M,
  UK_BBOX,
  annotateCuratedOverlap,
  buildCuratedIndex,
  buildGrid,
  buildUkOverpassQuery,
  chunkFileName,
  matchCurated,
  normalizeElements,
  type UkOsmPub,
} from "../scripts/lib/ukOsmSeed.mjs";

const ROOT = path.resolve(__dirname, "..");
const UK_DIR = path.join(ROOT, "data", "osm", "uk");
const DATASET_PATH = path.join(UK_DIR, "uk_osm_pubs.json");
const MANIFEST_PATH = path.join(UK_DIR, "chunks.json");
const DEDUPE_PATH = path.join(UK_DIR, "dedupe_report.json");
const FETCHER_PATH = path.join(ROOT, "scripts", "fetch_uk_osm_pubs.mjs");

const [UK_SOUTH, UK_WEST, UK_NORTH, UK_EAST] = UK_BBOX;

function pubElement(overrides: Record<string, unknown> = {}) {
  return {
    type: "node",
    id: 1,
    lat: 51.5,
    lon: -0.1,
    tags: { amenity: "pub", name: "The Test Arms", ...(overrides.tags as object) },
    ...overrides,
  };
}

function runFetcherList(...args: string[]) {
  return spawnSync(process.execPath, [FETCHER_PATH, "--list", ...args], {
    encoding: "utf8",
  });
}

describe("uk osm grid", () => {
  it("tiles the whole UK bbox with no gaps and clamps the last row/column", () => {
    const grid = buildGrid();
    expect(grid.length).toBe(132);

    const first = grid[0];
    // Rounded, not UK_WEST + 1: the grid coordinates are cleaned of float drift
    // so chunk ids and query strings stay stable.
    expect(first.bbox).toEqual([49.8, -8.7, 50.8, -7.7]);

    const last = grid[grid.length - 1];
    expect(last.bbox[2]).toBe(UK_NORTH);
    expect(last.bbox[3]).toBe(UK_EAST);

    // Every cell is inside the UK bbox and adjacent cells share an edge.
    const rows = new Map<number, typeof grid>();
    for (const chunk of grid) {
      expect(chunk.bbox[0]).toBeGreaterThanOrEqual(UK_SOUTH);
      expect(chunk.bbox[2]).toBeLessThanOrEqual(UK_NORTH);
      expect(chunk.bbox[1]).toBeGreaterThanOrEqual(UK_WEST);
      expect(chunk.bbox[3]).toBeLessThanOrEqual(UK_EAST);
      rows.set(chunk.row, [...(rows.get(chunk.row) ?? []), chunk]);
    }
    for (const cells of rows.values()) {
      expect(cells[0].bbox[1]).toBe(UK_WEST);
      expect(cells[cells.length - 1].bbox[3]).toBe(UK_EAST);
      for (let i = 1; i < cells.length; i += 1) {
        expect(cells[i].bbox[1]).toBe(cells[i - 1].bbox[3]);
      }
    }
  });

  it("gives every chunk a unique, coordinate-derived id and file name", () => {
    const grid = buildGrid();
    const ids = new Set(grid.map((chunk) => chunk.id));
    expect(ids.size).toBe(grid.length);
    expect(grid[0].id).toBe("lat49.80_lon-8.70");
    expect(chunkFileName(grid[0])).toBe("chunk_lat49.80_lon-8.70.json");
  });

  it("supports finer steps for a heavier split", () => {
    const grid = buildGrid({ bbox: [50, -1, 52, 1], latStep: 0.5, lonStep: 0.5 });
    expect(grid.length).toBe(16);
  });

  it("accepts the city fetcher's --skip-if-present resume flag", () => {
    const result = runFetcherList("--skip-if-present");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("132 chunks");
  });

  it("rejects grid overrides that could mix incompatible raw chunks", () => {
    const result = runFetcherList("--lat-step=0.5");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument "--lat-step=0.5"');
  });

  it("rejects delay overrides that could bypass Overpass rate limits", () => {
    const result = runFetcherList("--delay-ms=0");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument "--delay-ms=0"');
  });

  it("exits non-zero when a targeted --chunk fetch fails", () => {
    // A failed single-chunk refresh must not report success to scripts/CI.
    const stubFetch = "globalThis.fetch = async () => new Response('stub outage', { status: 400 });";
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(stubFetch)}`,
        FETCHER_PATH,
        "--chunk=lat49.80_lon-8.70",
        "--refresh",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAILED");
    expect(result.stderr).toContain("lat49.80_lon-8.70");
    expect(result.stdout).not.toContain("done - rerun without --chunk");
  });

  it("clips each chunk query to the UK area so border cells drop the Republic of Ireland", () => {
    const query = buildUkOverpassQuery([54, -8, 55, -7]);
    expect(query).toContain("area(id:3600062149)->.uk;");
    expect(query).toContain('node["amenity"="pub"](area.uk)(54,-8,55,-7);');
    expect(query).toContain('way["amenity"="pub"](area.uk)(54,-8,55,-7);');
    expect(query).toContain("out center tags;");
    expect(query).toContain("[timeout:90]");
  });
});

describe("uk osm normalization", () => {
  it("rejects truncated and remarked Overpass cache entries", () => {
    expect(parseOverpassRawText('{"elements":[')).toBeNull();
    expect(parseOverpassRawText('{"elements":[],"remark":"runtime error"}')).toBeNull();
    expect(parseOverpassRawText('{"elements":[]}')).toEqual({ elements: [] });
  });

  it("rejects fetched snapshots older than 48 hours", () => {
    const now = Date.parse("2026-07-26T12:00:00Z");
    expect(
      isFreshOverpassSnapshot(
        { elements: [], osm3s: { timestamp_osm_base: "2026-07-25T12:00:00Z" } },
        now,
      ),
    ).toBe(true);
    expect(
      isFreshOverpassSnapshot(
        { elements: [], osm3s: { timestamp_osm_base: "2026-07-20T12:00:00Z" } },
        now,
      ),
    ).toBe(false);
    expect(isFreshOverpassSnapshot({ elements: [] }, now)).toBe(false);
  });

  it("uses the city normalizer contract that retains raw smoking tags", () => {
    const normalized = normalizeCityOverpass(
      {
        elements: [
          pubElement({
            tags: {
              amenity: "pub",
              name: "Shared Arms",
              smoking: "outside",
              "smoking:outside": "isolated",
            },
          }),
        ],
      },
      {
        id: "test",
        displayName: "Test",
        shortPrefix: "tst",
        bbox: [51, -1, 52, 0],
        enabled: true,
      },
    );

    expect(normalized.pubs[0].smoking).toEqual({
      smoking: "outside",
      "smoking:outside": "isolated",
    });
  });

  it("keeps outdoor_seating and every raw smoking tag", () => {
    const pub = normalizeOsmPubElement(
      pubElement({
        tags: {
          amenity: "pub",
          name: "The Smoking Arms",
          outdoor_seating: "yes",
          smoking: "outside",
          "smoking:outside": "isolated",
        },
      }),
    );
    expect(pub?.outdoorSeating).toBe(true);
    expect(pub?.smoking).toEqual({ smoking: "outside", "smoking:outside": "isolated" });
  });

  it("leaves smoking null when untagged and outdoorSeating false unless yes", () => {
    const pub = normalizeOsmPubElement(
      pubElement({ tags: { amenity: "pub", name: "Plain", outdoor_seating: "no" } }),
    );
    expect(pub?.smoking).toBeNull();
    expect(pub?.outdoorSeating).toBe(false);
  });

  it("takes a way's center point and builds an address from addr:* tags", () => {
    const pub = normalizeOsmPubElement({
      type: "way",
      id: 42,
      center: { lat: 53.4, lon: -2.2 },
      tags: {
        amenity: "pub",
        name: "The Way Inn",
        "addr:housenumber": "10",
        "addr:street": "High Street",
        "addr:city": "Manchester",
        "addr:postcode": "M1 1AA",
      },
    });
    expect(pub?.osmId).toBe("way/42");
    expect(pub?.lat).toBe(53.4);
    expect(pub?.lng).toBe(-2.2);
    expect(pub?.address).toBe("10, High Street, Manchester, M1 1AA");
    expect(pub?.postcode).toBe("M1 1AA");
  });

  it("drops unnamed and unlocatable elements", () => {
    expect(normalizeOsmPubElement(pubElement({ tags: { amenity: "pub" } }))).toBeNull();
    expect(
      normalizeOsmPubElement({ type: "node", id: 3, tags: { amenity: "pub", name: "Nowhere" } }),
    ).toBeNull();
  });

  it("dedupes elements that two adjoining chunks both returned", () => {
    const pubs = normalizeElements([
      pubElement({ id: 7, lat: 51, lon: -1 }),
      pubElement({ id: 7, lat: 51, lon: -1 }),
      pubElement({ id: 8, lat: 50, lon: -1, tags: { amenity: "pub", name: "Southern" } }),
    ]);
    expect(pubs.map((pub) => pub.osmId)).toEqual(["node/8", "node/7"]);
  });
});

describe("curated overlap", () => {
  const london: UkOsmPub[] = [
    normalizeOsmPubElement(
      pubElement({
        id: 100,
        lat: 51.5162,
        lon: -0.132117,
        tags: { amenity: "pub", name: "Arnos Arms" },
      }),
    )!,
    normalizeOsmPubElement(
      pubElement({
        id: 101,
        lat: 55.9,
        lon: -3.2,
        tags: { amenity: "pub", name: "Brand New Bothy" },
      }),
    )!,
  ];

  it("matches an existing seed pack on OSM id", () => {
    const index = buildCuratedIndex([
      { source: "city:manchester", id: "node/100", name: "Totally Different Name", lat: 0, lng: 0, osmId: "node/100" },
    ]);
    expect(matchCurated(london[0], index)).toEqual({
      source: "city:manchester",
      id: "node/100",
      matchType: "osm-id",
    });
  });

  it("matches curated London (which has no OSM ids) on normalized name within the radius", () => {
    const index = buildCuratedIndex([
      { source: "curated-london-slim", id: "venue-xjf3n0", name: "The Arnos Arms", lat: 51.5163, lng: -0.132117 },
    ]);
    const match = matchCurated(london[0], index);
    expect(match?.matchType).toBe("name-distance");
    expect(match?.id).toBe("venue-xjf3n0");
    expect(match?.distanceM).toBeLessThanOrEqual(CURATED_MATCH_RADIUS_M);
  });

  it("does not match the same name a town away", () => {
    const index = buildCuratedIndex([
      { source: "curated-london-slim", id: "venue-far", name: "Arnos Arms", lat: 51.7, lng: -0.132117 },
    ]);
    expect(matchCurated(london[0], index)).toBeNull();
  });

  it("reports overlap counts per source and leaves unmatched pubs unannotated", () => {
    const { pubs, report } = annotateCuratedOverlap(london, [
      { source: "curated-london-slim", id: "venue-xjf3n0", name: "Arnos Arms", lat: 51.5162, lng: -0.132117 },
      { source: "city:glasgow", id: "node/999", name: "Elsewhere", lat: 55.86, lng: -4.25, osmId: "node/999" },
    ]);
    expect(report.ukPubs).toBe(2);
    expect(report.matchedTotal).toBe(1);
    expect(report.uniqueToUk).toBe(1);
    expect(report.byMatchType["name-distance"]).toBe(1);
    expect(report.sources).toEqual([
      { source: "city:glasgow", entries: 1, matched: 0 },
      { source: "curated-london-slim", entries: 1, matched: 1 },
    ]);
    expect(pubs[0].curatedRef?.source).toBe("curated-london-slim");
    expect(pubs[1].curatedRef).toBeUndefined();
  });
});

describe("committed UK seed packs", () => {
  // Read once: the pack is ~14 MB, and a per-pub `expect()` over 38k rows costs
  // minutes. Every row-level rule below is folded into counters in one pass and
  // asserted once.
  const pack = JSON.parse(readFileSync(DATASET_PATH, "utf8")) as {
    license: string;
    attribution: string;
    count: number;
    pubs: UkOsmPub[];
  };
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const report = JSON.parse(readFileSync(DEDUPE_PATH, "utf8"));

  const scan = {
    unnamed: 0,
    duplicateIds: 0,
    outOfBounds: 0,
    withSmoking: 0,
    annotated: 0,
    rawCountMismatches: 0,
    oldestRawTimestampMs: Number.POSITIVE_INFINITY,
  };
  const seen = new Set<string>();
  for (const pub of pack.pubs) {
    if (typeof pub.name !== "string" || pub.name.length === 0) scan.unnamed += 1;
    if (seen.has(pub.osmId)) scan.duplicateIds += 1;
    seen.add(pub.osmId);
    const inBounds =
      pub.lat >= UK_SOUTH && pub.lat <= UK_NORTH && pub.lng >= UK_WEST && pub.lng <= UK_EAST;
    if (!inBounds) scan.outOfBounds += 1;
    if (pub.smoking) scan.withSmoking += 1;
    if (pub.curatedRef) scan.annotated += 1;
  }
  for (const chunk of manifest.chunkStats as Array<{
    id: string;
    elements: number;
    timestamp: string;
  }>) {
    const rawText = readFileSync(path.join(UK_DIR, "raw", `chunk_${chunk.id}.json`), "utf8");
    const raw = parseOverpassRawText(rawText);
    if (!raw || raw.elements.length !== chunk.elements) scan.rawCountMismatches += 1;
    const timestampMs = Date.parse(chunk.timestamp);
    if (Number.isFinite(timestampMs)) {
      scan.oldestRawTimestampMs = Math.min(scan.oldestRawTimestampMs, timestampMs);
    }
  }

  it("exist as built artifacts", () => {
    expect(existsSync(DATASET_PATH)).toBe(true);
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    expect(existsSync(DEDUPE_PATH)).toBe(true);
  });

  it("covers the whole grid with no unfetched chunks", () => {
    expect(manifest.missingChunks).toEqual([]);
    expect(manifest.chunkStats.length).toBe(manifest.chunks);
    const missingRaw = (manifest.chunkStats as Array<{ id: string }>).filter(
      (chunk) => !existsSync(path.join(UK_DIR, "raw", `chunk_${chunk.id}.json`)),
    );
    expect(missingRaw).toEqual([]);
    expect(scan.rawCountMismatches).toBe(0);
    expect(manifest.elements).toBe(
      manifest.chunkStats.reduce(
        (total: number, chunk: { elements: number }) => total + chunk.elements,
        0,
      ),
    );
  });

  it("keeps committed raw snapshots within 48 hours of manifest generation", () => {
    const maximumSkewMs = 48 * 60 * 60 * 1_000;
    expect(Date.parse(manifest.generatedAt) - scan.oldestRawTimestampMs).toBeLessThanOrEqual(
      maximumSkewMs,
    );
  });

  it("holds tens of thousands of uniquely-identified, in-bounds, named pubs", () => {
    expect(pack.license).toBe("ODbL");
    expect(pack.attribution).toBe("© OpenStreetMap contributors");
    expect(pack.count).toBe(pack.pubs.length);
    expect(pack.pubs.length).toBeGreaterThan(30_000);
    expect(scan.unnamed).toBe(0);
    expect(scan.duplicateIds).toBe(0);
    expect(scan.outOfBounds).toBe(0);
    // The smoking tags are the whole reason they are retained raw; if a refresh
    // drops them the normalizer regressed.
    expect(scan.withSmoking).toBeGreaterThan(100);
  });

  it("agrees with the dedupe report", () => {
    expect(report.ukPubs).toBe(pack.pubs.length);
    expect(report.matchedTotal).toBe(scan.annotated);
    expect(report.matchedTotal + report.uniqueToUk).toBe(report.ukPubs);
    expect(report.sources.some((source: { source: string }) => source.source === "curated-london-slim")).toBe(true);
    expect(report.matchedTotal).toBeGreaterThan(0);
  });
});
