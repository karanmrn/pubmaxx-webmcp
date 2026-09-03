import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isFoodCategory } from "@/lib/food";
import { nightOutPlaceRowValidationErrors } from "@/lib/nightOutPlaceContract.mjs";
import { assertCurrentFamousVenueRows } from "@/scripts/build_slim_index.mjs";

const ROOT = path.resolve(__dirname, "..");
const FAME_GATES = new Set([
  "recognition",
  "longevity",
  "cultural_weight",
  "distinct_experience",
]);

type FamousVenueRow = {
  id: string;
  name: string;
  address: string;
  borough: string;
  lat: number;
  lng: number;
  kind: "bar" | "food" | "restaurant";
  hasStory: true;
  fameGates: Array<{ kind: string; sourceUrl: string }>;
  category: "bar" | "late_food" | "restaurant";
  job: "late_night_bar" | "crawl_ending_food" | "near_pub_food";
  description: string;
  area: string;
  location: { lat: number; lng: number };
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
  expiresAt: string;
  discoveredVia: "manual";
  extractedVia: "manual";
  anchor: {
    kind:
      | "house_cocktail"
      | "pint"
      | "wine"
      | "large_doner"
      | "signature_item"
      | "signature_dish";
    label: string;
    course?: string;
    price: number;
    observedAt: string;
    sourceUrl: string;
  };
  story: { text: string; sourceUrl: string };
};

function loadSeed(file: string): FamousVenueRow[] {
  return JSON.parse(
    readFileSync(path.join(ROOT, "data", "famous_venues", file), "utf8"),
  ) as FamousVenueRow[];
}

const PACKS = [
  ["bars.json", 39, "bar"],
  ["late_food.json", 25, "food"],
  ["restaurants.json", 25, "restaurant"],
] as const;

describe("famous venue seeds", () => {
  it.each([...PACKS])(
    "%s contains exactly %i contract-valid venues",
    (file, count, kind) => {
      const rows = loadSeed(file);
      expect(rows).toHaveLength(count);
      expect(new Set(rows.map((row) => row.id)).size).toBe(count);

      for (const row of rows) {
        expect(row.id).toMatch(
          /^(?:(?:bar|food|restaurant)-[a-z0-9-]+|venue-[a-z0-9]+)$/,
        );
        expect(row.name.trim().length).toBeGreaterThan(1);
        expect(row.address.trim().length).toBeGreaterThan(5);
        expect(row.borough.trim().length).toBeGreaterThan(1);
        expect(row.kind).toBe(kind);
        expect(row.category).toBe(
          kind === "bar" ? "bar" : kind === "food" ? "late_food" : "restaurant",
        );
        expect(row.job).toBe(
          kind === "bar"
            ? "late_night_bar"
            : kind === "food"
              ? "crawl_ending_food"
              : "near_pub_food",
        );
        expect(row.hasStory).toBe(true);
        expect(row.lat).toBeGreaterThanOrEqual(51.26);
        expect(row.lat).toBeLessThanOrEqual(51.72);
        expect(row.lng).toBeGreaterThanOrEqual(-0.55);
        expect(row.lng).toBeLessThanOrEqual(0.3);
        expect(
          new Set(row.fameGates.map((gate) => gate.kind)).size,
        ).toBeGreaterThanOrEqual(2);
        expect(
          row.fameGates.every(
            (gate) =>
              FAME_GATES.has(gate.kind) && /^https:\/\//.test(gate.sourceUrl),
          ),
        ).toBe(true);
        // Fame must not be self-attested: at least one gate has to cite a host
        // other than the venue's own site.
        expect(
          row.fameGates.some(
            (gate) =>
              new URL(gate.sourceUrl).hostname !==
              new URL(row.sourceUrl).hostname,
          ),
          `${row.id} has no independent fame-gate source`,
        ).toBe(true);
        expect(row.sourceUrl).toMatch(/^https:\/\//);
        expect(Number.isNaN(Date.parse(row.observedAt))).toBe(false);
        expect(row.anchor.price).toBeGreaterThan(0);
        if (kind === "restaurant") {
          expect(row.id).toMatch(/^restaurant-[a-z0-9-]+$/);
          expect(row.anchor.kind).toBe("signature_dish");
          expect(
            isFoodCategory(row.anchor.course),
            `${row.id} anchor course "${row.anchor.course}"`,
          ).toBe(true);
        } else {
          expect(row.anchor.course, `${row.id} is not a dish`).toBeUndefined();
        }
        expect(row.anchor.label.trim().length).toBeGreaterThan(2);
        expect(row.anchor.sourceUrl).toMatch(/^https:\/\//);
        expect(Number.isNaN(Date.parse(row.anchor.observedAt))).toBe(false);
        expect(row.story.text.trim().length).toBeGreaterThan(20);
        expect(row.story.sourceUrl).toMatch(/^https:\/\//);
        expect(nightOutPlaceRowValidationErrors(row)).toEqual([]);
      }
    },
  );

  it("carries every field required by the provenance registry", () => {
    const registry = JSON.parse(
      readFileSync(
        path.join(ROOT, "data", "famous_venue_provenance_registry.json"),
        "utf8",
      ),
    ) as { requiredRowFields: string[] };
    const rows = PACKS.flatMap(([file]) => loadSeed(file));

    for (const row of rows) {
      for (const field of registry.requiredRowFields) {
        expect(row, `${row.id} missing ${field}`).toHaveProperty(field);
      }
    }
  });

  it("keeps IDs unique across both packs", () => {
    const rows = PACKS.flatMap(([file]) => loadSeed(file));
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("fails the build boundary when current-trading evidence expires", () => {
    const rows = PACKS.flatMap(([file]) => loadSeed(file));
    expect(
      assertCurrentFamousVenueRows(rows, new Date("2026-08-25T12:00:00.000Z")),
    ).toHaveLength(89);
    expect(() =>
      assertCurrentFamousVenueRows(rows, new Date("2026-09-24T00:00:00.000Z")),
    ).toThrow(/current-trading verification failed.*bar-american-bar-savoy/);
  });
});
