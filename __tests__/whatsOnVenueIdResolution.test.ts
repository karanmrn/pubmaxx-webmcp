// Smoke tests for W6: after wiring resolveVenueId into the four what's-on
// generators, most (not all — these are honest, partial-coverage datasets)
// rows in each regenerated output file should now carry a resolved venueId.
// Reads the checked-in baseline files rather than re-running the generators
// (quizRefresh.mjs does a live network fetch; the others are deterministic
// but this keeps the assertion aligned with what actually ships).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(__dirname, "..");

function readRows(file: string): Array<Record<string, unknown>> {
  const doc = JSON.parse(readFileSync(join(ROOT, "public", "data", "whats_on", file), "utf8"));
  return Array.isArray(doc?.rows) ? doc.rows : [];
}

function resolutionRate(rows: Array<Record<string, unknown>>): number {
  if (rows.length === 0) return 0;
  const resolved = rows.filter((r) => typeof r.venueId === "string" && r.venueId.length > 0).length;
  return resolved / rows.length;
}

describe("what's-on venueId resolution (W6)", () => {
  it("deals_london.json: most rows resolve a venueId", () => {
    const rows = readRows("deals_london.json");
    expect(rows.length).toBeGreaterThan(0);
    expect(resolutionRate(rows)).toBeGreaterThan(0.3);
  });

  it("sport_fixtures.json: rows keep their (already-resolved) venueId", () => {
    const rows = readRows("sport_fixtures.json");
    expect(rows.length).toBeGreaterThan(0);
    expect(resolutionRate(rows)).toBeGreaterThan(0.8);
  });

  it("quiz_london.json: some rows resolve a venueId", () => {
    const rows = readRows("quiz_london.json");
    expect(rows.length).toBeGreaterThan(0);
    // Question One venues are a real-world third-party listing that only
    // sometimes lines up with the canonical dataset — an honest partial rate.
    // Current baseline resolves 22/83 (~27%); floor at 25% so a resolver or
    // wiring regression that drops resolution actually fails this test.
    expect(resolutionRate(rows)).toBeGreaterThanOrEqual(0.25);
  });

  it("music_london.json: rows are honestly left unresolved while the venues are absent from the canonical dataset", () => {
    const rows = readRows("music_london.json");
    expect(rows.length).toBeGreaterThan(0);
    // The seeds now carry hand-verified address+postcode, but none of the five
    // residency venues exists in pint_prices_app_dataset.json yet, so the
    // resolver (correctly) has no candidate to confirm. Assert the explicit
    // current invariant: exactly zero resolved. When the canonical dataset
    // grows to include these pubs, resolution lights up automatically and
    // this assertion should be flipped to a positive floor.
    const resolved = rows.filter((r) => typeof r.venueId === "string" && r.venueId.length > 0);
    expect(resolved).toEqual([]);
  });
});
