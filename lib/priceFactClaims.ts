// Price adapter over the generic fact-claim model (Wayfinder 3.3). Wires the
// existing price signals — the on-record dataset/scraped baseline, the freshest
// community-reported "now" price, and the community price-confirm vouches — through
// lib/factClaims so a served price carries an honest verification level and any
// live conflict surfaces plainly.
//
// This FORMALIZES what lib/priceConfidence.ts only half-modelled: a community
// vouch on an already-shown price is corroboration. priceConfidence keeps its
// exact public API (state + label) untouched — this sits alongside it as the
// resolution/conflict layer, not a rewrite. Pure and hermetic: callers pass `now`.

import {
  buildFactClaims,
  resolveClaims,
  type FactAuthority,
  type FactClaim,
  type FactResolution,
  type FactSource,
} from "@/lib/factClaims";
import { FRESH_WITHIN_DAYS } from "@/lib/priceConfidence";
import { DAY_MS } from "@/lib/dayMs";

// A price disagreement counts as "live" for the same fortnight priceConfidence
// treats a community vouch as fresh (FRESH_WITHIN_DAYS = 14). Beyond it, an old
// losing price is history — the then-vs-now story — not a live conflict.
export const PRICE_CONFLICT_WINDOW_MS = FRESH_WITHIN_DAYS * DAY_MS;

/** Compare GBP prices in integer pennies so 6.4 and 6.40 are one value. */
export function pricesEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export type PriceSignalInput = {
  gbp: number;
  authority: FactAuthority;
  /** Epoch ms observed; 0 for an undated, standing on-record baseline. */
  observedAt: number;
  publisher?: string;
  confidence?: number;
  reviewed?: boolean;
};

export function buildPriceClaims(
  fieldId: string,
  signals: readonly PriceSignalInput[],
): FactClaim<number>[] {
  const sources: FactSource<number>[] = signals.map((s) => ({
    authority: s.authority,
    value: s.gbp,
    observedAt: s.observedAt,
    publisher: s.publisher,
    confidence: s.confidence,
    reviewed: s.reviewed,
  }));
  return buildFactClaims(fieldId, sources, pricesEqual);
}

export type ResolvePriceOptions = {
  now: number;
  windowMs?: number;
};

/**
 * Resolve a venue-beverage price from its signals. Serves by
 * authority > freshness > corroboration > confidence and exposes any live
 * conflict. Returns null when there are no signals.
 */
export function resolvePrice(
  fieldId: string,
  signals: readonly PriceSignalInput[],
  opts: ResolvePriceOptions,
): FactResolution<number> | null {
  return resolveClaims(buildPriceClaims(fieldId, signals), {
    now: opts.now,
    conflictWindowMs: opts.windowMs ?? PRICE_CONFLICT_WINDOW_MS,
    isEqual: pricesEqual,
  });
}

/** Stable field id for a venue-beverage price fact. */
export function priceFieldId(venueId: string, beverage = "pint"): string {
  return `price:${venueId}:${beverage}`;
}

// A community price-confirm tally, exactly the shape lib/priceConfirmStore.ts
// returns. Kept structural so this module never imports the store (which pulls
// in Supabase) and stays browser-safe for the venue surface.
export type PriceConfirmTallyLike = {
  confirms: number;
  lastConfirmedAt: number | null;
  recentConfirms: number;
};

export type PriceStorySignalsInput = {
  /** The dataset/scraped baseline on record, GBP. */
  baselineGbp: number | null;
  /** The freshest community-reported price, GBP. */
  nowGbp: number | null;
  /** Epoch ms the community "now" price was observed, when known. */
  nowObservedAt?: number | null;
  /** The confirm tally for `confirmTargetGbp`, when fetched. */
  confirm?: PriceConfirmTallyLike | null;
  /** Which displayed price the confirm tally is keyed to (usually `now`, else baseline). */
  confirmTargetGbp?: number | null;
};

/**
 * Build price signals for the venue Golden Thread from the values the surface
 * already has: the on-record baseline (scraped, undated), the community "now"
 * price, and the confirm vouches. A vouch on the SAME value as a scraped price
 * corroborates it (distinct authority) — the formalized upgrade path. When the
 * community freshly vouches a DIFFERENT price from the baseline, resolvePrice
 * reports a live conflict for the surface to expose.
 */
export function priceStorySignals(input: PriceStorySignalsInput): PriceSignalInput[] {
  const signals: PriceSignalInput[] = [];

  if (typeof input.baselineGbp === "number" && Number.isFinite(input.baselineGbp)) {
    signals.push({
      gbp: input.baselineGbp,
      authority: "scraped",
      observedAt: 0, // on record, undated — never "recent", but serves by authority
      publisher: "dataset",
      confidence: 0.6,
    });
  }

  const confirm = input.confirm ?? null;
  const confirmAt = confirm && typeof confirm.lastConfirmedAt === "number" ? confirm.lastConfirmedAt : null;

  if (typeof input.nowGbp === "number" && Number.isFinite(input.nowGbp)) {
    // The community "now" price. Its freshness is the drop's own observedAt when
    // known, else the confirm timestamp when the tally is keyed to this price.
    const keyedToNow =
      typeof input.confirmTargetGbp === "number" && pricesEqual(input.confirmTargetGbp, input.nowGbp);
    const nowObservedAt =
      (typeof input.nowObservedAt === "number" ? input.nowObservedAt : null) ??
      (keyedToNow ? confirmAt : null) ??
      0;
    signals.push({
      gbp: input.nowGbp,
      authority: "community",
      observedAt: nowObservedAt,
      publisher: "community-report",
      confidence: 0.5,
    });
  }

  // A community vouch corroborates whichever displayed price it is keyed to: a
  // distinct community publisher at that exact value. On a scraped baseline it
  // upgrades single_source → corroborated; on the community "now" price it
  // corroborates the report.
  if (
    confirm &&
    confirm.confirms > 0 &&
    confirmAt !== null &&
    typeof input.confirmTargetGbp === "number" &&
    Number.isFinite(input.confirmTargetGbp)
  ) {
    signals.push({
      gbp: input.confirmTargetGbp,
      authority: "community",
      observedAt: confirmAt,
      publisher: "price-confirm",
      // A recently-vouched price carries a touch more confidence than a lone report.
      confidence: confirm.recentConfirms > 0 ? 0.6 : 0.55,
    });
  }

  return signals;
}

/**
 * Distinct GBP values in a live price conflict, ascending, or [] when the field
 * resolves cleanly. The surface renders these plainly ("Reported at £6.40 and
 * £6.90 recently") instead of silently serving one.
 */
export function conflictPrices(resolution: FactResolution<number> | null): number[] {
  if (!resolution || !resolution.conflict) return [];
  return [...resolution.conflict.values].sort((a, b) => a - b);
}
