import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  WetherspoonsDirectory,
  WetherspoonsPub,
} from "@/lib/wetherspoonsDirectory";

// The directory is SCRAPED/observed data. These tests lock the non-negotiable
// invariants: an honest per-pub {source, observedAt} provenance stamp, and
// GeoJSON coordinates that are finite, in [lng, lat] order, and geographically
// sane. If a refresh ever drops provenance or ships a broken pin, this fails.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function load<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf8")) as T;
}

// pubs.json has a single committed home: public/data/wetherspoons/ (the path
// the app fetches at runtime). pubs.geojson is still written to both
// data/wetherspoons/ and public/data/wetherspoons/ by the refresh script, so
// that pair is still checked for byte-identity.
const DIRECTORY_PATHS = ["public/data/wetherspoons/pubs.json"] as const;

const GEOJSON_PATHS = [
  "data/wetherspoons/pubs.geojson",
  "public/data/wetherspoons/pubs.geojson",
] as const;

describe("Wetherspoons directory dataset", () => {
  it("data/ and public/data/ geojson copies are byte-identical", () => {
    const [ga, gb] = GEOJSON_PATHS.map((p) =>
      readFileSync(join(ROOT, p), "utf8"),
    );
    expect(ga).toBe(gb);
  });

  it("holds 824 pubs matching the declared count", () => {
    const dir = load<WetherspoonsDirectory>(DIRECTORY_PATHS[0]);
    expect(dir.pubs).toHaveLength(824);
    expect(dir.count).toBe(dir.pubs.length);
  });

  it("stamps every pub with honest {source, observedAt} provenance", () => {
    const dir = load<WetherspoonsDirectory>(DIRECTORY_PATHS[0]);
    const now = Date.now();
    for (const pub of dir.pubs as WetherspoonsPub[]) {
      expect(pub.source?.label).toBeTruthy();
      expect(pub.source?.url).toMatch(/^https?:\/\//);
      expect(pub.source?.licence).toBeTruthy();
      const observed = Date.parse(pub.observedAt);
      expect(Number.isFinite(observed)).toBe(true);
      // Never present a future observation as if already seen.
      expect(observed).toBeLessThanOrEqual(now);
      // Scraped data is never labelled as community-contributed.
      expect(pub.menuPricesAvailableOnWeb).toBe(false);
    }
  });

  it("has finite, well-ordered [lng, lat] coordinates within sane bounds", () => {
    const geo = load<{
      type: string;
      features: Array<{
        geometry: { coordinates: [number, number] };
        properties: { country: string; name: string };
      }>;
    }>(GEOJSON_PATHS[0]);

    expect(geo.type).toBe("FeatureCollection");
    expect(geo.features).toHaveLength(824);

    let outsideUk = 0;
    for (const feature of geo.features) {
      const [lng, lat] = feature.geometry.coordinates;
      expect(Number.isFinite(lng)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lng)).toBeLessThanOrEqual(180);
      // UK + Ireland box; only the 2 Spanish airport bars fall outside.
      const inUk = lng >= -8.7 && lng <= 1.9 && lat >= 49.8 && lat <= 60.9;
      if (!inUk) {
        outsideUk += 1;
        expect(feature.properties.country).toBe("Spain");
      }
    }
    expect(outsideUk).toBe(2);
  });

  it("keeps the corrected Edinburgh longitude (no North Sea pin)", () => {
    const dir = load<WetherspoonsDirectory>(DIRECTORY_PATHS[0]);
    const edinburgh = dir.pubs.find(
      (pub) => pub.name === "The William Chambers",
    );
    expect(edinburgh).toBeDefined();
    // EH1 1HU is Edinburgh — longitude must be negative (west of Greenwich).
    expect(edinburgh?.longitude).toBeLessThan(0);
    expect(edinburgh?.longitude).toBeCloseTo(-3.19099, 4);
  });
});
