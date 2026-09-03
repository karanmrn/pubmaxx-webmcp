import { describe, expect, it } from "vitest";

import {
  LAZY_KIND_SHARDS,
  OUTER_MAX_PRICED_RATIO,
  OUTER_MIN_VENUES,
  buildShardManifest,
  buildSpatialShardManifest,
  classifySlimShards,
  classifySpatialShards,
  computeBbox,
  SPATIAL_GRID,
  spatialCellId,
  spatialCellIndex,
  slugifyBorough,
} from "@/scripts/lib/slimShards.mjs";

// Synthetic index: one dense priced inner borough, one hollow outer borough
// (mostly unpriced, above the size threshold), and a tiny stray label.
function makeSlim() {
  const rows: { id: string; name: string; lat: number; lng: number; cheapestPrice: number | null; borough: string }[] = [];
  // Camden: 25 venues, all priced → CORE.
  for (let i = 0; i < 25; i += 1) {
    rows.push({ id: `cam${i}`, name: `Camden ${i}`, lat: 51.54 + i * 0.001, lng: -0.14 + i * 0.001, cheapestPrice: 5, borough: "Camden" });
  }
  // Greenwich: 30 venues, 2 priced (~7%) → OUTER lazy shard.
  for (let i = 0; i < 30; i += 1) {
    rows.push({ id: `grn${i}`, name: `Greenwich ${i}`, lat: 51.48 + i * 0.001, lng: 0.01 + i * 0.001, cheapestPrice: i < 2 ? 6 : null, borough: "Greenwich" });
  }
  // Tiny stray label: 3 venues → stays in CORE (below OUTER_MIN_VENUES).
  for (let i = 0; i < 3; i += 1) {
    rows.push({ id: `soho${i}`, name: `Soho ${i}`, lat: 51.51, lng: -0.13, cheapestPrice: null, borough: "Soho" });
  }
  return rows;
}

describe("slugifyBorough", () => {
  it("matches the OSM raw-file naming", () => {
    expect(slugifyBorough("Barking and Dagenham")).toBe("barking_and_dagenham");
    expect(slugifyBorough("Kingston upon Thames")).toBe("kingston_upon_thames");
    expect(slugifyBorough("  Greenwich  ")).toBe("greenwich");
  });
});

describe("classifySlimShards", () => {
  it("routes hollow boroughs above the size threshold to outer shards, everything else to core", () => {
    const { core, outer } = classifySlimShards(makeSlim());
    // Camden (dense) + Soho (tiny) stay in core; only Greenwich is deferred.
    expect(outer.size).toBe(1);
    expect([...outer.keys()]).toEqual(["greenwich"]);
    expect(outer.get("greenwich")!.venues.length).toBe(30);
    const coreBoroughs = new Set(core.map((v) => v.borough));
    expect(coreBoroughs.has("Camden")).toBe(true);
    expect(coreBoroughs.has("Soho")).toBe(true);
    expect(coreBoroughs.has("Greenwich")).toBe(false);
  });

  it("splits every venue exactly once (union == input, no loss, no dup)", () => {
    const slim = makeSlim();
    const { core, outer } = classifySlimShards(slim);
    const ids = new Set(core.map((v) => v.id));
    for (const { venues } of outer.values()) for (const v of venues) ids.add(v.id);
    expect(ids.size).toBe(slim.length);
    expect(slim.every((v) => ids.has(v.id))).toBe(true);
  });

  it("keeps a well-priced borough in core even if it is large", () => {
    // 40 venues, all priced — big but priced ratio 100% >> threshold.
    const slim = Array.from({ length: 40 }, (_, i) => ({
      id: `w${i}`, name: `W${i}`, lat: 51.45, lng: -0.19, cheapestPrice: 4, borough: "Wandsworth",
    }));
    const { outer } = classifySlimShards(slim);
    expect(outer.size).toBe(0);
  });

  it("respects the documented thresholds", () => {
    expect(OUTER_MAX_PRICED_RATIO).toBe(0.4);
    expect(OUTER_MIN_VENUES).toBeGreaterThan(3);
  });

  it("defers a curated non-pint kind to its own lazy shard", () => {
    expect(LAZY_KIND_SHARDS.restaurant).toBe("restaurants");
    const slim = [
      ...makeSlim(),
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `rest${i}`,
        name: `Restaurant ${i}`,
        lat: 51.51,
        lng: -0.12,
        cheapestPrice: 20,
        borough: "Westminster",
        kind: "restaurant",
      })),
    ];
    const { core, outer } = classifySlimShards(slim);
    expect(core.some((v) => v.kind === "restaurant")).toBe(false);
    expect(outer.get("restaurants")!.venues).toHaveLength(25);
    expect(outer.get("restaurants")!.borough).toBeUndefined();
    const manifest = buildShardManifest({ core, outer });
    const entry = manifest.shards.find((s) => s.id === "restaurants");
    expect(entry?.core).toBe(false);
    expect(entry?.url).toBe("/data/venues_slim.restaurants.json");
    expect(entry?.borough).toBeUndefined();
  });

  it("measures a borough's priced ratio without its curated restaurant pins", () => {
    const slim = [
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `grn${i}`,
        name: `Greenwich ${i}`,
        lat: 51.48,
        lng: 0.01,
        cheapestPrice: null,
        borough: "Greenwich",
      })),
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `grnr${i}`,
        name: `Greenwich restaurant ${i}`,
        lat: 51.48,
        lng: 0.01,
        cheapestPrice: 20,
        borough: "Greenwich",
        kind: "restaurant",
      })),
    ];
    const { core, outer } = classifySlimShards(slim);
    expect(core).toHaveLength(0);
    expect([...outer.keys()].sort()).toEqual(["greenwich", "restaurants"]);
  });
});

describe("computeBbox + buildShardManifest", () => {
  it("computes a [minLng,minLat,maxLng,maxLat] bbox", () => {
    const bbox = computeBbox([
      { lat: 51.5, lng: -0.1 },
      { lat: 51.6, lng: 0.05 },
    ]);
    expect(bbox).toEqual([-0.1, 51.5, 0.05, 51.6]);
  });

  it("emits a core entry plus one entry per outer shard, with urls + bboxes", () => {
    const plan = classifySlimShards(makeSlim());
    const manifest = buildShardManifest(plan);
    expect(manifest.version).toBe(1);
    const core = manifest.shards.find((s) => s.core);
    expect(core?.url).toBe("/data/venues_slim.core.json");
    const grn = manifest.shards.find((s) => s.id === "greenwich");
    expect(grn?.core).toBe(false);
    expect(grn?.url).toBe("/data/venues_slim.greenwich.json");
    expect(grn?.count).toBe(30);
    expect(grn?.bbox).toHaveLength(4);
  });
});

describe("location-first spatial shards", () => {
  it("keeps every row in exactly one cell and emits bounded bboxes", () => {
    const rows = [
      { id: "a", lat: 51.5074, lng: -0.1278 },
      { id: "b", lat: 51.5301, lng: -0.1022 },
    ];
    const cells = classifySpatialShards(rows, SPATIAL_GRID);
    const manifest = buildSpatialShardManifest(cells, SPATIAL_GRID);
    expect(manifest.version).toBe(2);
    expect(manifest.shards).toHaveLength(2);
    expect(new Set(manifest.shards.map((shard) => shard.count))).toEqual(new Set([1]));
    expect(manifest.shards.every((shard) => shard.partition === "grid")).toBe(true);
  });

  it("names central compatibility core without changing cell membership", () => {
    const cell = spatialCellIndex(51.5074, -0.1278, SPATIAL_GRID);
    const coreId = spatialCellId(cell.lat, cell.lon, SPATIAL_GRID);
    const cells = classifySpatialShards([
      { id: "a", lat: 51.5074, lng: -0.1278 },
    ], SPATIAL_GRID);
    const manifest = buildSpatialShardManifest(cells, SPATIAL_GRID, coreId);
    expect(manifest.shards[0]).toMatchObject({ id: coreId, core: true });
    expect(manifest.shards[0]?.url).toBe("/data/venues_slim.core.json");
  });
});
