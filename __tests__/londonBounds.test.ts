import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The Greater London bounding box applied by the build filter. This mirror is
// the single spec the three build-time filters must agree on
// (scripts/export_app_dataset_json.py, scripts/build_slim_index.mjs,
// scripts/validate-data.mjs). If any of them drifts, the "shipped dataset is in
// bounds" test below fails.
const LAT_MIN = 51.26;
const LAT_MAX = 51.72;
const LON_MIN = -0.55;
const LON_MAX = 0.3;

function inLondon(lng: number, lat: number): boolean {
  return lng >= LON_MIN && lng <= LON_MAX && lat >= LAT_MIN && lat <= LAT_MAX;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

describe("London bounds filter", () => {
  it("accepts central London and rejects out-of-bounds coordinates", () => {
    // Central London — inside.
    expect(inLondon(-0.1276, 51.5072)).toBe(true);
    // On each edge — inclusive.
    expect(inLondon(LON_MIN, LAT_MIN)).toBe(true);
    expect(inLondon(LON_MAX, LAT_MAX)).toBe(true);
    // Just outside each edge — rejected.
    expect(inLondon(LON_MIN - 0.01, 51.5)).toBe(false);
    expect(inLondon(LON_MAX + 0.01, 51.5)).toBe(false);
    expect(inLondon(-0.1, LAT_MIN - 0.01)).toBe(false);
    expect(inLondon(-0.1, LAT_MAX + 0.01)).toBe(false);
    // A wildly-off coordinate (e.g. a lat/lng swap or a mis-geocode).
    expect(inLondon(-0.1, 0)).toBe(false);
    expect(inLondon(2.35, 48.85)).toBe(false); // Paris
  });

  it("the shipped pint dataset has no out-of-bounds rows (export filter applied)", () => {
    const rows = JSON.parse(
      readFileSync(join(ROOT, "public", "data", "pint_prices_app_dataset.json"), "utf8"),
    ) as Array<{ latitude: number; longitude: number }>;
    const oob = rows.filter((r) => !inLondon(r.longitude, r.latitude));
    expect(oob).toEqual([]);
  });

  it("the shipped slim index has no out-of-bounds rows", () => {
    const payload = JSON.parse(
      readFileSync(join(ROOT, "public", "data", "venues_slim.json"), "utf8"),
    ) as { rows?: Array<{ lat: number; lng: number }> };
    const rows = payload.rows ?? [];
    const oob = rows.filter((r) => !inLondon(r.lng, r.lat));
    expect(oob).toEqual([]);
  });
});
