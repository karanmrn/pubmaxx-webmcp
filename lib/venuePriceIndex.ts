import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

// Server-only, price-carrying venue list for the Last Pint "3 nearest pubs to
// the station" feature (user story 22). lib/venueIndex.ts already memoizes the
// bundled dataset for name/location resolution, but its VenueRef shape
// deliberately doesn't carry price (it's a name-resolution seam, not a pricing
// one) and it's owned by another wave (read-only for this task). This module
// reads the same bundled JSON — same cheap-read path — and keeps the full
// grouped `Venue[]` (with `cheapestPrice`) memoized for routes that need price.
//
// `fs`-based, so import this ONLY from server code (route handlers), same rule
// as lib/venueIndex.ts.

let cached: Venue[] | null = null;

// Read-only cache peek for latency-sensitive optional enrichments. This never
// starts the dataset read; callers may include the data only when another route
// has already warmed this process-local cache.
export function peekPricedVenues(): Venue[] | null {
  return cached;
}

export async function getPricedVenues(): Promise<Venue[]> {
  if (cached) return cached;
  try {
    const file = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    cached = groupVenuePrices(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
  return cached;
}

export function resetVenuePriceIndexForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
  }
}
