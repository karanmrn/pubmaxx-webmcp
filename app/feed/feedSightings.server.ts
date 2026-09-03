import "server-only";

import { promises as fs } from "fs";
import path from "path";

import {
  parseDrinkPriceUpdates,
  visibleDrinkPriceUpdates,
} from "@/lib/drinkPriceUpdates";
import {
  buildSightings,
  freshSightings,
  type SightingDTO,
} from "@/lib/feedSightings";
import { stableVenueIdFromKey } from "@/lib/venues";
import { getVenueIndex } from "@/lib/venueIndex";
import { venueMapUrl } from "@/lib/venueMapUrl";

// Server seam for the feed's ambient sightings (lib/feedSightings.ts). Reads the
// same public drink-price overlay the menu surfaces read
// (public/data/drink_price_updates/latest.json), resolves each grouping key to a
// real pub name + "/map?sel=…" link through the bundled venue index (the exact
// path GET /api/pint-drops uses), and hands the /feed server page a small,
// bounded, serialisable list.
//
// ONLY INDEX-RESIDENT VENUES SURVIVE. A grouping key the venue index cannot
// resolve is DROPPED, never labelled with a generic stand-in name: the overlay
// is national, the feed is London, and the one fallback that used to name an
// unresolved key "A London pub" is what put a Leeds venue at the top of the
// London feed. Resolution through the London venue index IS the city fence, so
// never reinstate a fallback label here.
//
// Fail-soft throughout: a missing/malformed overlay, or an unreadable venue
// index, yields [] — the feed then falls back to its honest empty state, never
// an error.
//
// ONLY THE CLOCK-FREE HALF IS MEMOISED. Reading the ~2 MB overlay and resolving
// its venues never changes between renders, so it is cached per process; the
// recency window is re-answered on every read, because a lambda outlives many
// requests and the overlay only changes by deploy. A window stamped once would
// keep saying "recent" about rows that had aged out days earlier, which is the
// exact claim the gate exists to retire.

const OVERLAY_PATH = "public/data/drink_price_updates/latest.json";

let cached: Promise<SightingDTO[]> | null = null;

function generatedAtOf(raw: unknown): number {
  const stamp = Date.parse(String((raw as { generatedAt?: unknown })?.generatedAt ?? ""));
  return Number.isFinite(stamp) ? stamp : Date.now();
}

async function build(): Promise<SightingDTO[]> {
  try {
    const file = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      OVERLAY_PATH,
    );
    const raw = JSON.parse(
      await fs.readFile(/* turbopackIgnore: true */ file, "utf8"),
    ) as unknown;
    const updates = visibleDrinkPriceUpdates(
      parseDrinkPriceUpdates(raw, generatedAtOf(raw)),
    );
    if (updates.length === 0) return [];

    const index = await getVenueIndex();
    return buildSightings(updates, (venueKey) => {
      const venueId = stableVenueIdFromKey(venueKey);
      const venue = index.get(venueId);
      if (!venue) return null;
      return {
        venueId,
        venueName: venue.name,
        venueMapUrl: venueMapUrl(venueId),
      };
    });
  } catch {
    // Any failure (missing file, bad JSON, unreadable index) → no sightings.
    return [];
  }
}

/**
 * The bounded ambient sightings for the feed's London tab: the memoised overlay
 * read, aged against THIS request's clock so only rows inside the recency window
 * are served.
 */
export async function loadFeedSightings(): Promise<SightingDTO[]> {
  cached ??= build();
  return freshSightings(await cached, { now: Date.now() });
}

/** Test seam: forget the memoised read. */
export function resetFeedSightingsForTests(): void {
  cached = null;
}
