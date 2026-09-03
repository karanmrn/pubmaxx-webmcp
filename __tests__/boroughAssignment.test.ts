import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { SlimVenue } from "@/lib/venuesSlim";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

// Regression guard for the venue→borough join (PRD next-wave F7). The old join
// mislabelled riverside east-London pubs — Prospect of Whitby (Wapping) landed
// in "Havering", and Havering topped the /borough index off the back of it. The
// fix is a point-in-polygon assignment at build time
// (scripts/build_app_dataset.py + data/london_boroughs_simplified.json); the
// join runs in Python, so the vitest seam is the generated artifact the app
// actually ships: public/data/venues_slim.json. These tests pin known
// venue→borough pairs and the index-level symptom so a regressed rebuild fails
// here before it ships.

const ROOT = path.resolve(__dirname, "..");
const SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");

const venues = (rowsFromSlimPayload(JSON.parse(readFileSync(SLIM_PATH, "utf8"))) ?? []) as SlimVenue[];

// Content-hashed stable ids pinned the same way __tests__/pintDropSeeds.test.ts
// pins its venue ids — the name assertion alongside catches an id/name drift.
const KNOWN_PAIRS: { id: string; name: string; borough: string }[] = [
  // Wapping Wall, E1W — THE mis-join case: previously assigned "Havering".
  { id: "venue-16pnwmm", name: "Prospect of Whitby", borough: "Tower Hamlets" },
  // Upper Mall, W6 — west-riverside counterpart on the other side of the city.
  { id: "venue-1p5ftm3", name: "The Dove", borough: "Hammersmith and Fulham" },
];

describe("venue→borough assignment (F7 regression)", () => {
  it.each(KNOWN_PAIRS)("$name resolves to $borough", ({ id, name, borough }) => {
    const venue = venues.find((v) => v.id === id);
    expect(venue, `venue ${id} (${name}) missing from venues_slim.json`).toBeDefined();
    expect(venue?.name).toBe(name);
    expect(venue?.borough).toBe(borough);
  });

  it("Havering is not among the top-3 boroughs by venue count", () => {
    // The mis-join's index-level symptom: Havering (an outer-east borough with
    // few central pubs in this dataset) LED the borough index because Wapping/
    // Limehouse venues were dumped into it. Post-fix it must not appear anywhere
    // near the top.
    const counts = new Map<string, number>();
    for (const v of venues) {
      if (!v.borough) continue;
      counts.set(v.borough, (counts.get(v.borough) ?? 0) + 1);
    }
    const top3 = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([borough]) => borough);
    expect(top3).toHaveLength(3);
    expect(top3).not.toContain("Havering");
  });
});
