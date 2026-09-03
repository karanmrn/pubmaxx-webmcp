import { describe, it, expect } from "vitest";

import poisJson from "../public/data/london_pois.json";
import { POI_CATEGORY_META, type Poi, type PoiCategory } from "@/lib/pois";

// Guards the hand-authored ambient POI dataset. The JSON is imported directly
// (node env, same pattern as curatedCrawls/pintDropSeeds tests) rather than
// fetched, so these assertions protect the bundled file at build time.
const pois = poisJson as Poi[];

// Greater London bounding box (generous), matching the authoring constraint.
const LNG_MIN = -0.5;
const LNG_MAX = 0.3;
const LAT_MIN = 51.28;
const LAT_MAX = 51.72;

const CATEGORIES: PoiCategory[] = [
  "tube",
  "rail",
  "bus",
  "river",
  "park",
  "garden",
  "market",
  "historic",
  "viewpoint",
  "sight",
];

describe("london_pois dataset", () => {
  it("parses to a non-empty Poi[]", () => {
    expect(Array.isArray(pois)).toBe(true);
    expect(pois.length).toBeGreaterThan(0);
  });

  it("every row has a valid category", () => {
    for (const poi of pois) {
      expect(CATEGORIES, `${poi.id} category`).toContain(poi.category);
    }
  });

  it("every row has 2-number coordinates inside the London bbox", () => {
    for (const poi of pois) {
      expect(Array.isArray(poi.coordinates), `${poi.id} coordinates`).toBe(true);
      expect(poi.coordinates).toHaveLength(2);
      const [lng, lat] = poi.coordinates;
      expect(typeof lng, `${poi.id} lng type`).toBe("number");
      expect(typeof lat, `${poi.id} lat type`).toBe("number");
      expect(Number.isFinite(lng), `${poi.id} lng finite`).toBe(true);
      expect(Number.isFinite(lat), `${poi.id} lat finite`).toBe(true);
      expect(lng, `${poi.id} lng in range`).toBeGreaterThanOrEqual(LNG_MIN);
      expect(lng, `${poi.id} lng in range`).toBeLessThanOrEqual(LNG_MAX);
      expect(lat, `${poi.id} lat in range`).toBeGreaterThanOrEqual(LAT_MIN);
      expect(lat, `${poi.id} lat in range`).toBeLessThanOrEqual(LAT_MAX);
    }
  });

  it("every row has a non-empty id and name", () => {
    for (const poi of pois) {
      expect(poi.id.length, `${poi.id} id`).toBeGreaterThan(0);
      expect(poi.name.length, `${poi.id} name`).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    const ids = pois.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each category has a reasonable count", () => {
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
      PoiCategory,
      number
    >;
    for (const poi of pois) counts[poi.category] += 1;
    for (const category of CATEGORIES) {
      expect(counts[category], `${category} count`).toBeGreaterThan(0);
    }
  });
});

describe("POI_CATEGORY_META", () => {
  it("provides display metadata for every category", () => {
    for (const category of CATEGORIES) {
      const meta = POI_CATEGORY_META[category];
      expect(meta.label.length, `${category} label`).toBeGreaterThan(0);
      expect(meta.color, `${category} color`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(meta.glyph.length, `${category} glyph`).toBeGreaterThan(0);
    }
  });
});
