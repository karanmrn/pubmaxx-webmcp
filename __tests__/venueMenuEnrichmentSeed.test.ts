import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import type { VenueMenuEnrichmentFile } from "@/lib/venueMenuEnrichment";
import { isHttpUrl } from "@/lib/httpUrl";

const ENRICHMENT_PATH = join(
  process.cwd(),
  "public",
  "data",
  "venue_menu_enrichment.json",
);
const DATASET_PATH = join(
  process.cwd(),
  "public",
  "data",
  "pint_prices_app_dataset.json",
);

describe("venue_menu_enrichment.json seed", () => {
  it("pins every enrichment key to a live dataset venue id and vetted URLs", () => {
    const file = JSON.parse(
      readFileSync(ENRICHMENT_PATH, "utf8"),
    ) as VenueMenuEnrichmentFile;
    expect(file.version).toBe(1);
    expect(file.venues).toBeTruthy();

    const rows = JSON.parse(readFileSync(DATASET_PATH, "utf8")) as VenuePrice[];
    const liveIds = new Set(groupVenuePrices(rows).map((v) => v.id));

    const ids = Object.keys(file.venues);
    expect(ids.length).toBeGreaterThanOrEqual(10);

    for (const id of ids) {
      expect(liveIds.has(id), `${id} missing from live dataset`).toBe(true);
      const rec = file.venues[id];
      expect("orderUrl" in rec, `${id} must not seed invented orderUrl`).toBe(false);
      expect(typeof rec.menuUrl, `${id} menuUrl must be a string`).toBe("string");
      expect(isHttpUrl(rec.menuUrl ?? ""), `${id} menuUrl must be http(s)`).toBe(true);
      if (rec.bookingUrl !== undefined) {
        expect(isHttpUrl(rec.bookingUrl), `${id} bookingUrl must be http(s)`).toBe(true);
      }
      if (rec.categoryTiles) {
        for (const tile of rec.categoryTiles) {
          expect(tile.id?.trim()).toBeTruthy();
          expect(tile.label?.trim()).toBeTruthy();
        }
      }
    }
  });
});
