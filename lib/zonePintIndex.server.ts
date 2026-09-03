import "server-only";

// Server-only: compute the Zone pint index from the slim venue index.
//
// The slim index (public/data/venues_slim.json) already carries each venue's
// nearest-station fare `zone` and `cheapestPrice`, so the zone medians are a
// pure roll-up of the SAME observed prices the map shows — no separate source,
// no invented numbers. Import from Server Components / route handlers only.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { isVenueKind, type VenueKind } from "@/lib/venues";
import { computeZonePintIndex, type ZonePintIndex } from "@/lib/zones";

type SlimRow = { zone?: unknown; cheapestPrice?: unknown; kind?: unknown };

function toFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `undefined` means "a row from before the vocabulary existed", which
 * `computeZonePintIndex` counts as a pub. A kind this build does not hold is a
 * different answer: the row NAMES something, we just do not know what, so it
 * lands on the neutral kind and stays out of the median. A price authority
 * fails closed.
 */
function toSlimKind(value: unknown): VenueKind | undefined {
  if (value === undefined || value === null) return undefined;
  return isVenueKind(value) ? value : "other";
}

/** Load the slim index and roll it up into the per-zone pint index. */
export async function loadZonePintIndex(): Promise<ZonePintIndex> {
  try {
    const file = path.join(process.cwd(), "public", "data", "venues_slim.json");
    const payload = JSON.parse(await readFile(file, "utf8")) as unknown;
    const list: SlimRow[] = Array.isArray(payload)
      ? (payload as SlimRow[])
      : payload && typeof payload === "object" && Array.isArray((payload as { rows?: unknown }).rows)
        ? (payload as { rows: SlimRow[] }).rows
        : [];
    return computeZonePintIndex(
      list.map((row) => ({
        zone: toFinite(row.zone),
        cheapestPrice: toFinite(row.cheapestPrice),
        kind: toSlimKind(row.kind),
      })),
    );
  } catch {
    // No slim index (fresh checkout before build) → an all-thin index that the
    // strip renders honestly as "not enough pints logged yet".
    return computeZonePintIndex([]);
  }
}
