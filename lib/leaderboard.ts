import { DAY_MS } from "@/lib/dayMs";
import type { Venue } from "@/lib/venues";

// Pure ranking helpers over grouped Venue[] for the /discover leaderboard.
// No fetch, no React, no side effects — everything here is a plain transform so
// it can be unit-tested directly (see __tests__/leaderboard.test.ts).

// A venue that carries a usable (non-null) cheapest price. Narrowing to this
// shape lets callers treat `cheapestPrice` as a number without re-checking.
export type PricedVenue = Venue & { cheapestPrice: number };

// A venue paired with its rank + area, ready to hand straight to the table.
export type LeaderboardEntry = {
  rank: number;
  venue: PricedVenue;
  area: string;
};

// The fallback area label used when a venue has no borough/area field at all.
export const UNKNOWN_AREA = "Greater London";

// We group by `primaryBorough` because it is the app's canonical area field:
// the dataset fills it for all but a handful of rows (29 distinct London
// boroughs), and it already drives the map's borough context. When a venue has
// no primaryBorough we fall back to the first visibleBorough, then to a coarse
// UNKNOWN_AREA bucket — so a sparse row is grouped, never dropped.
export function venueArea(venue: Venue): string {
  const primary = venue.primaryBorough?.trim();
  if (primary) return primary;
  const visible = venue.visibleBoroughs.find((borough) => borough.trim());
  if (visible) return visible.trim();
  return UNKNOWN_AREA;
}

function hasPrice(venue: Venue): venue is PricedVenue {
  return typeof venue.cheapestPrice === "number";
}

// Cheapest priced venues, ascending. Venues with a null cheapestPrice are
// dropped entirely (they can't be ranked on price). Ties break on name so the
// order is deterministic across renders. `limit` caps the returned list.
export function cheapestPints(venues: Venue[], limit = 10): LeaderboardEntry[] {
  return venues
    .filter(hasPrice)
    .sort(
      (a, b) =>
        a.cheapestPrice - b.cheapestPrice || a.name.localeCompare(b.name),
    )
    .slice(0, Math.max(0, limit))
    .map((venue, index) => ({
      rank: index + 1,
      venue,
      area: venueArea(venue),
    }));
}

// The single cheapest priced venue in each area. Venues with no price are
// ignored; areas with no priced venue don't appear. The result is sorted by
// price ascending so the cheapest areas lead. Ties break on area name.
export function cheapestByArea(venues: Venue[]): LeaderboardEntry[] {
  const cheapestPerArea = new Map<string, PricedVenue>();

  for (const venue of venues) {
    if (!hasPrice(venue)) continue;
    const area = venueArea(venue);
    const current = cheapestPerArea.get(area);
    if (
      !current ||
      venue.cheapestPrice < current.cheapestPrice ||
      (venue.cheapestPrice === current.cheapestPrice &&
        venue.name.localeCompare(current.name) < 0)
    ) {
      cheapestPerArea.set(area, venue);
    }
  }

  return Array.from(cheapestPerArea.entries())
    .map(([area, venue]) => ({ area, venue, rank: 0 }))
    .sort(
      (a, b) =>
        a.venue.cheapestPrice - b.venue.cheapestPrice ||
        a.area.localeCompare(b.area),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

// ── "Cheapest pints logged tonight" (PRD §5.1) ──────────────────────────────
// A live, community-driven leaderboard: the cheapest community Pint Drops
// reported in the trailing 24h. Unlike cheapestPints (which ranks the dataset
// baseline), this ranks what people actually paid *tonight* — the reason to
// reopen Discover on a Friday. Pure/testable: no fetch, no React, `now`
// injectable so "the last 24h" is deterministic under test.

// The minimal community-drop shape cheapestTonight reads. The public
// /api/pint-drops DTO satisfies this (venueId, priceGbp, createdAt, handle,
// server-enriched venueName); callers narrow the API payload before passing it.
export type TonightDrop = {
  venueId: string;
  priceGbp: number | null;
  createdAt: string;
  handle?: string;
  venueName?: string;
  avatarUrl?: string;
};

// One ranked row of the tonight board, ready to hand straight to the board.
export type TonightEntry = {
  rank: number;
  venueId: string;
  venueName: string;
  priceGbp: number;
  handle?: string;
  createdAt: string;
  avatarUrl?: string;
};

// The friendly label used when a drop carries no resolvable pub name — kept in
// step with the API's VENUE_FALLBACK_LABEL so the board never shows a raw id.
const TONIGHT_FALLBACK_VENUE = "A London pub";

function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Parse an ISO createdAt to epoch ms; NaN for an unparseable/empty string so
// such drops fall out of the 24h window rather than crashing the compare.
function dropTime(createdAt: string): number {
  return Date.parse(createdAt);
}

export type CheapestTonightOptions = {
  // Upper bound of the window (defaults to Date.now()). Injectable for tests.
  now?: number;
  // Max rows returned (defaults to 10).
  limit?: number;
};

// Rank the cheapest community Pint Drops from the trailing 24h, cheapest-first,
// one row per venue (the cheapest drop for that venue wins). A drop qualifies
// only when it carries a finite priceGbp AND a createdAt inside (now - 24h, now].
// Ties are fully deterministic: price, then createdAt (older first), then
// venueId. Empty/malformed input → []. `now` is injectable for testability.
export function cheapestTonight(
  drops: TonightDrop[],
  opts: CheapestTonightOptions = {},
): TonightEntry[] {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 10;
  const windowStart = now - DAY_MS;

  // Keep the single cheapest qualifying drop per venue. On a tie between two
  // drops for the same venue, prefer the earlier one, then the lower venueId —
  // so the winner is stable regardless of input order.
  const cheapestPerVenue = new Map<string, TonightEntry>();
  for (const drop of drops) {
    if (!drop.venueId) continue;
    if (!isFinitePrice(drop.priceGbp)) continue;
    const at = dropTime(drop.createdAt);
    if (!Number.isFinite(at) || at <= windowStart || at > now) continue;

    const candidate: TonightEntry = {
      rank: 0,
      venueId: drop.venueId,
      venueName: drop.venueName?.trim() || TONIGHT_FALLBACK_VENUE,
      priceGbp: drop.priceGbp,
      handle: drop.handle?.trim() || undefined,
      createdAt: drop.createdAt,
      avatarUrl: drop.avatarUrl,
    };

    const current = cheapestPerVenue.get(drop.venueId);
    if (!current || tonightBeats(candidate, current)) {
      cheapestPerVenue.set(drop.venueId, candidate);
    }
  }

  return Array.from(cheapestPerVenue.values())
    .sort(tonightCompare)
    .slice(0, Math.max(0, limit))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

// True when `a` should outrank `b`: cheaper wins; on a price tie the earlier
// drop wins; on a createdAt tie the lower venueId wins. Total + deterministic.
function tonightBeats(a: TonightEntry, b: TonightEntry): boolean {
  return tonightCompare(a, b) < 0;
}

function tonightCompare(a: TonightEntry, b: TonightEntry): number {
  return (
    a.priceGbp - b.priceGbp ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.venueId.localeCompare(b.venueId)
  );
}
