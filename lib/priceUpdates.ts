// Permissible-source price refresh layer.
//
// Community Pint Drops are the LIVE price signal (lib/venues.ts mergeVenueDrops).
// This layer sits BELOW that: a versioned, provenance-stamped file of prices
// gathered from PERMISSIBLE FIRST-PARTY sources only (pub/brewery official
// pages, open data) — never scraped from competitor price sites. The newest
// valid update for a venue overrides the STATIC baseline, but a fresher
// community drop always wins (see mergePriceUpdates precedence rules).
//
// Governance (hard rules, enforced by the loader + the refresh scaffold):
//   - every price carries { source: {label, url}, observedAt } attribution;
//   - a refreshed price is presented as "sourced" (attributed), NEVER as a
//     community contribution;
//   - stale is never presented as live — observedAt is always surfaced.
//
// zod-free: this mirrors the repo's hand-rolled guard style (lib/pois.isValidPoi)
// so a malformed hand-authored / machine-written update file drops the bad row
// instead of poisoning the price layer.

import type { Provenance } from "@/lib/curation";
import type { Venue } from "@/lib/venues";

// One attributed price observation from a permissible source. `venueKey` is the
// canonical grouping key (lib/venues.ts venueGroupingKey) so an update targets
// exactly the same venue the app groups by — no fuzzy name matching.
export type PriceUpdate = {
  venueKey: string;
  price: number;
  source: { label: string; url: string };
  observedAt: string; // ISO-8601
};

// The provenance a refreshed price is stamped with. A sourced (attributed)
// price is authoritative-but-attributed; it is never "contributor"/"demo".
export const PRICE_UPDATE_PROVENANCE: Provenance = "sourced";

// The provenance stamp the venue detail reads to attribute a refreshed price.
export type PriceProvenance = {
  provenance: Provenance; // always "sourced"
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// http(s) URL guard — a first-party source must be a real link the UI can
// attribute to. Rejects anything that isn't an absolute http(s) URL.
function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// A valid ISO timestamp that is not in the future (a future observation is a
// data error — you cannot have observed a price that hasn't happened yet).
function isValidObservedAt(value: unknown, now: number): value is string {
  if (!isNonEmptyString(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= now;
}

// Hand-rolled row guard — drop malformed rows rather than throw. `now` is
// injectable for deterministic tests.
export function isValidPriceUpdate(value: unknown, now: number = Date.now()): value is PriceUpdate {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.venueKey)) return false;
  // A price must be a finite, non-negative number. 0 is allowed (free-pint
  // promo) but a negative price is nonsense.
  if (!isFiniteNumber(row.price) || row.price < 0) return false;
  const source = row.source;
  if (typeof source !== "object" || source === null) return false;
  const src = source as Record<string, unknown>;
  if (!isNonEmptyString(src.label)) return false;
  if (!isHttpUrl(src.url)) return false;
  if (!isValidObservedAt(row.observedAt, now)) return false;
  return true;
}

// Parse a raw price_updates file body → clean PriceUpdate[]. Accepts either a
// bare array or a `{ updates: [...] }` envelope. Malformed rows are dropped.
// When more than one update targets the same venueKey, the newest observedAt
// wins (so an append-only file naturally supersedes older observations).
export function parsePriceUpdates(raw: unknown, now: number = Date.now()): PriceUpdate[] {
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { updates?: unknown }).updates)
      ? (raw as { updates: unknown[] }).updates
      : [];
  const newestByVenue = new Map<string, PriceUpdate>();
  for (const row of rows) {
    if (!isValidPriceUpdate(row, now)) continue;
    const existing = newestByVenue.get(row.venueKey);
    if (!existing || Date.parse(row.observedAt) > Date.parse(existing.observedAt)) {
      newestByVenue.set(row.venueKey, row);
    }
  }
  return Array.from(newestByVenue.values());
}

// The extra fields mergePriceUpdates folds onto a Venue. Kept as its own type so
// the venue detail can read the sourced-price attribution without importing the
// merge internals.
export type PricedVenue = Venue & {
  // Attribution for a price that came from the refresh file. Present ONLY when
  // the sourced update actually won precedence (no fresher community drop and
  // the update improves on / differs from baseline). null otherwise.
  sourcedPrice: PriceProvenance | null;
};

// Fold the price-update layer into venues, with STRICT precedence:
//
//   1. a community Pint Drop (venue.latestContributorAt set) that is at least as
//      fresh as the update ALWAYS wins — the update is ignored, the live
//      community price + freshness stand. This is the "never present stale as
//      live" and "community layer is authoritative-live" guarantee.
//   2. otherwise the sourced update overrides the static baseline cheapestPrice
//      and stamps sourcedPrice attribution ({source, observedAt, "sourced"}).
//   3. no update for a venue → baseline stands, sourcedPrice null.
//
// `keyFor` maps a venue to its canonical grouping key (the update file's
// venueKey). Callers pass venueGroupingKey-of-first-price or a precomputed map.
export function mergePriceUpdates(
  venues: Venue[],
  updates: PriceUpdate[],
  keyFor: (venue: Venue) => string,
): PricedVenue[] {
  const byKey = new Map(updates.map((u) => [u.venueKey, u] as const));
  return venues.map((venue) => {
    const update = byKey.get(keyFor(venue));
    if (!update) {
      return { ...venue, sourcedPrice: null };
    }
    // A community drop that is at least as fresh as the sourced observation wins
    // outright — stale sourced data must never beat a live community price.
    if (
      venue.latestContributorAt !== null &&
      Date.parse(venue.latestContributorAt) >= Date.parse(update.observedAt)
    ) {
      return { ...venue, sourcedPrice: null };
    }
    return {
      ...venue,
      cheapestPrice: update.price,
      sourcedPrice: {
        provenance: PRICE_UPDATE_PROVENANCE,
        sourceLabel: update.source.label,
        sourceUrl: update.source.url,
        observedAt: update.observedAt,
      },
    };
  });
}
