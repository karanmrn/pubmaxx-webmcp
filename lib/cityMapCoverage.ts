import type { VenueKind } from "@/lib/venues";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

export type CityPubCoverage = {
  count: number;
  min: number | null;
  max: number | null;
};

export function summarizeCityPubCoverage(rows: unknown): CityPubCoverage {
  const payloadRows = rowsFromSlimPayload(rows);
  if (!payloadRows) return { count: 0, min: null, max: null };

  let count = 0;
  let min: number | null = null;
  let max: number | null = null;

  for (const value of payloadRows) {
    if (typeof value !== "object" || value === null) continue;
    const row = value as {
      kind?: VenueKind;
      cheapestPrice?: unknown;
    };
    if (!isPubVenueKind(row.kind)) continue;

    count += 1;
    const price = row.cheapestPrice;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      continue;
    }
    min = min === null ? price : Math.min(min, price);
    max = max === null ? price : Math.max(max, price);
  }

  return { count, min, max };
}
