import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const SCALAR_METRE_DISTANCE_CONSUMERS = [
  "scripts/lib/venueCanonicalization.mjs",
  "scripts/lib/heritageMatch.mjs",
  "scripts/lib/ukOsmSeed.mjs",
  "scripts/integrate_wikipedia_london_pubs.mjs",
] as const;

const SCALAR_KILOMETRE_DISTANCE_CONSUMERS = [
  "scripts/lib/postcodeCoordinateConsistency.mjs",
  "scripts/lib/stationZones.mjs",
  "scripts/lib/ukPlaceIndex.mjs",
] as const;

const REPO_ROOT = process.cwd();
const LOCALITY_GENERATOR = join(REPO_ROOT, "scripts", "gen_london_localities.mjs");

function scriptModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return scriptModules(absolute);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [absolute] : [];
  });
}

describe("script great-circle distance", () => {
  it("keeps existing metre exports numerically compatible", async () => {
    const { haversineMeters } = await import("@/scripts/lib/geo.mjs");
    const { haversineMeters: canonicalizationDistance } = await import(
      "@/scripts/lib/venueCanonicalization.mjs"
    );
    // @ts-expect-error - heritage script has no declaration file.
    const { haversineMeters: heritageDistance } = await import("@/scripts/lib/heritageMatch.mjs");
    const { haversineMeters: osmDistance } = await import("@/scripts/lib/ukOsmSeed.mjs");
    const coordinates = [51.5074, -0.1278, 55.9533, -3.1883] as const;

    const originalThreeOfFourValue = 533_652.20033900486;
    expect(haversineMeters(...coordinates)).toBe(originalThreeOfFourValue);
    expect(canonicalizationDistance(...coordinates)).toBe(originalThreeOfFourValue);
    expect(heritageDistance(...coordinates)).toBe(originalThreeOfFourValue);
    expect(osmDistance(...coordinates)).toBe(originalThreeOfFourValue);
  });

  it("keeps migrated consumers on the canonical script owner", () => {
    for (const relativePath of SCALAR_METRE_DISTANCE_CONSUMERS) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).toMatch(/(?:\.\/(?:lib\/)?|\.\.\/lib\/)geo\.mjs/);
      expect(source, relativePath).not.toMatch(/Math\.(?:sin|cos|asin|acos|atan2)\s*\(/);
    }
  });

  it("keeps existing kilometre exports numerically compatible", async () => {
    const { haversineKm } = await import("@/scripts/lib/geo.mjs");
    const { haversineKm: stationDistance } = await import("@/scripts/lib/stationZones.mjs");
    const { haversineDistanceKm: postcodeDistance } = await import(
      "@/scripts/lib/postcodeCoordinateConsistency.mjs"
    );
    const coordinates = [51.5074, -0.1278, 55.9533, -3.1883] as const;

    const originalStationValue = 533.6522003390048;
    const originalPostcodeValue = 533.6522003390049;
    expect(haversineKm(...coordinates)).toBe(originalStationValue);
    expect(stationDistance(...coordinates)).toBe(originalStationValue);
    expect(postcodeDistance(...coordinates)).toBeCloseTo(originalPostcodeValue, 12);
  });

  it("keeps longitude-first generator coordinates numerically compatible", async () => {
    const { haversineKm, haversineKmLngLat } = (await import(
      "@/scripts/lib/geo.mjs"
    )) as {
      haversineKm: (aLat: number, aLng: number, bLat: number, bLng: number) => number;
      haversineKmLngLat: (aLng: number, aLat: number, bLng: number, bLat: number) => number;
    };
    const longitudeFirst = [-0.1278, 51.5074, -3.1883, 55.9533] as const;
    const { localityDistanceKm } = (await import(
      "@/scripts/gen_london_localities.mjs"
    )) as {
      localityDistanceKm: (
        aLng: number,
        aLat: number,
        bLng: number,
        bLat: number,
      ) => number;
    };

    expect(haversineKmLngLat(...longitudeFirst)).toBe(533.6522003390048);
    expect(haversineKmLngLat(...longitudeFirst)).toBe(
      haversineKm(51.5074, -0.1278, 55.9533, -3.1883),
    );
    expect(localityDistanceKm(...longitudeFirst)).toBe(
      haversineKm(51.5074, -0.1278, 55.9533, -3.1883),
    );
  });

  it.each([5, 30])("keeps the %i kilometre decision boundary stable", async (threshold) => {
    const { haversineKm } = await import("@/scripts/lib/geo.mjs");
    const insideDelta = ((threshold - 0.0001) / 6_371) * (180 / Math.PI);
    const outsideDelta = ((threshold + 0.0001) / 6_371) * (180 / Math.PI);

    expect(haversineKm(0, 0, insideDelta, 0)).toBeLessThan(threshold);
    expect(haversineKm(0, 0, outsideDelta, 0)).toBeGreaterThan(threshold);
  });

  it("keeps the UK place cluster decision on both sides of 30 kilometres", async () => {
    const { buildUkPlaceIndex } = await import("@/scripts/lib/ukPlaceIndex.mjs");
    const placeNode = (id: number, lat: number) => ({
      type: "node",
      id,
      lat,
      lon: 0,
      tags: { amenity: "pub", name: `Pub ${id}`, "addr:village": "Newton" },
    });

    expect(buildUkPlaceIndex([placeNode(1, 0), placeNode(2, 0.2697)]).places).toHaveLength(1);
    expect(buildUkPlaceIndex([placeNode(1, 0), placeNode(2, 0.2699)]).places).toHaveLength(2);
  });

  it("keeps compatible kilometre consumers on the canonical script owner", () => {
    for (const relativePath of SCALAR_KILOMETRE_DISTANCE_CONSUMERS) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).toMatch(/\.\/geo\.mjs/);
      expect(source, relativePath).not.toMatch(/Math\.(?:sin|cos|asin|acos|atan2)\s*\(/);
    }
  });

  it("sweeps script modules for a second great-circle formula owner", () => {
    const root = process.cwd();
    for (const absolutePath of scriptModules(join(root, "scripts"))) {
      const relativePath = absolutePath.slice(root.length + 1);
      if (relativePath === "scripts/lib/geo.mjs") continue;
      const source = readFileSync(absolutePath, "utf8");
      const normalizedNumbers = source.replaceAll("_", "").toLowerCase();
      expect(normalizedNumbers, relativePath).not.toMatch(/6371000|6\.371e\+?6/);
      const ownsGreatCircleTrig = /Math\.(?:asin|atan2)\s*\(/.test(source)
        && /Math\.sin\s*\(/.test(source)
        && /Math\.cos\s*\(/.test(source);
      expect(ownsGreatCircleTrig, relativePath).toBe(false);
    }
  });

  it.each([45, 100, 120, 150, 350])(
    "keeps the %i metre decision boundary stable",
    async (threshold) => {
      const { haversineMeters } = await import("@/scripts/lib/geo.mjs");
      const insideDelta = ((threshold - 0.1) / 6_371_000) * (180 / Math.PI);
      const outsideDelta = ((threshold + 0.1) / 6_371_000) * (180 / Math.PI);

      expect(haversineMeters(0, 0, insideDelta, 0)).toBeLessThan(threshold);
      expect(haversineMeters(0, 0, outsideDelta, 0)).toBeGreaterThan(threshold);
    },
  );
});

describe("London locality generator module ownership", () => {
  it("can be imported without starting fetch or changing the caller exit code", () => {
    const moduleUrl = pathToFileURL(LOCALITY_GENERATOR).href;
    const probe = [
      "let fetchCalls = 0;",
      'globalThis.fetch = async () => { fetchCalls += 1; throw new Error("fetch must not run"); };',
      "process.exitCode = 17;",
      `const module = await import(${JSON.stringify(moduleUrl)});`,
      "console.log(JSON.stringify({ fetchCalls, exitCode: process.exitCode, main: typeof module.main }));",
    ].join("\n");

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(17);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout.trim())).toEqual({
      fetchCalls: 0,
      exitCode: 17,
      main: "function",
    });
  });

  it("enters main on documented direct CLI invocation and reports a mocked failure", () => {
    const preload = [
      'globalThis.fetch = async () => { throw new Error("controlled mocked Overpass failure"); };',
      "globalThis.setTimeout = (callback) => { callback(); return 0; };",
    ].join("\n");
    const result = spawnSync(
      process.execPath,
      ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, LOCALITY_GENERATOR],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Building Greater London locality gazetteer");
    expect(result.stderr).toMatch(/FAILED: .*controlled mocked Overpass failure/u);
  });

  it("enters main when the generator is invoked through a symlink", () => {
    const tempDirectory = mkdtempSync(join(REPO_ROOT, "scripts", ".locality-symlink-"));
    const symlinkPath = join(tempDirectory, "gen_london_localities.mjs");
    symlinkSync(LOCALITY_GENERATOR, symlinkPath);

    try {
      const preload = [
        'globalThis.fetch = async () => { throw new Error("controlled symlink failure"); };',
        "globalThis.setTimeout = (callback) => { callback(); return 0; };",
      ].join("\n");
      const result = spawnSync(
        process.execPath,
        ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, symlinkPath],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Building Greater London locality gazetteer");
      expect(result.stderr).toMatch(/FAILED: .*controlled symlink failure/u);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
