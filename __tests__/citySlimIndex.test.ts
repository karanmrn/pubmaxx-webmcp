import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SLIM_PATH = path.join(ROOT, "public", "data", "cities", "manchester", "venues_slim.json");

const MANCHESTER_BBOX = {
  south: 53.38,
  west: -2.35,
  north: 53.55,
  east: -2.1,
};

type SlimRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  borough: string;
  filterHints?: { searchText?: string };
};

describe("manchester city slim index", () => {
  it("exists as a built artifact", () => {
    expect(existsSync(SLIM_PATH)).toBe(true);
  });

  it("has >100 venues with unique city-prefixed ids, in-bounds coords, null prices", () => {
    const payload = JSON.parse(readFileSync(SLIM_PATH, "utf8")) as { rows?: SlimRow[] };
    const rows = payload.rows ?? [];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(100);

    const ids = new Set<string>();
    for (const row of rows) {
      expect(typeof row.id).toBe("string");
      expect(row.id.startsWith("venue-mcr-")).toBe(true);
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);

      expect(typeof row.name).toBe("string");
      expect(row.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(row.lat)).toBe(true);
      expect(Number.isFinite(row.lng)).toBe(true);
      expect(row.lat).toBeGreaterThanOrEqual(MANCHESTER_BBOX.south);
      expect(row.lat).toBeLessThanOrEqual(MANCHESTER_BBOX.north);
      expect(row.lng).toBeGreaterThanOrEqual(MANCHESTER_BBOX.west);
      expect(row.lng).toBeLessThanOrEqual(MANCHESTER_BBOX.east);

      expect(row.cheapestPrice).toBeNull();
      expect(row.borough).toBe("Manchester");
      expect(typeof row.filterHints?.searchText).toBe("string");
      expect(row.filterHints!.searchText!.length).toBeGreaterThan(0);
    }
    expect(ids.size).toBe(rows.length);
  });
});
