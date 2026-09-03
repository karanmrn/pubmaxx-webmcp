import {
  drivesMap,
  mapCandidateOf,
  marksMapProvisionally,
  type CommunityPrice,
} from "@/lib/communityPrice";
import type { VenueSignal } from "./canvas/types";

// The one seam that turns a submitted price into a restamped map.
//
// PubMap already derives `venueSignals` from the Pint Drops layer and hands the
// SAME map to the pins (PubMapCanvas), the venue list, the route panel and the
// venue sheet. Folding community submissions in here means every one of those
// surfaces restamps from a single merge - the map canvas itself needs no change.
//
// Freshest-wins, never backwards: a community submission takes the price only
// when it is the newer observation, so a three-day-old logged price can't
// displace a Pint Drop from tonight. `hasPintDrops` is left exactly as it was -
// a logged price is not a Pint Drop, and it must not light the "has drops" halo
// or pass the has-drops filter.
//
// AND IT IS THE TRUST GATE. Because this is the only door onto the map, it is
// also where a community figure has to earn the map: `drivesMap` (see
// lib/communityPrice.ts) requires a second independent submitter agreeing about
// the same drink, and drops the price back to the scraped baseline once it is
// over 30 days old. Captain decision 2026-07-26, closing review findings F1
// (product half) and F4.
//
// A gated price is not deleted, it is simply not merged - the venue sheet reads
// `communityPrices.byVenueId` directly and still shows every submission, dated,
// with `communityTrustNote` saying where it stands. That split is the whole
// design: the pub's own page is a record of what people reported; the map is a
// claim about tonight's prices, and only a corroborated, recent figure gets to
// make it.

/** The venue-signal fields this merge reads; usePintDrops supplies them all. */
export type PricedVenueSignal = VenueSignal;

/**
 * Merge community-submitted prices into the venue-signal map used for pin
 * colour, list rows and the sheet. Pure: returns a NEW map, never mutates the
 * input. Returns the input untouched when there is nothing to merge - or when
 * nothing on offer has earned the map - so the common case allocates nothing.
 *
 * `now` is a parameter rather than a `Date.now()` read inside the loop so the
 * age gate is testable and one render can never date two venues differently.
 */
export function mergeCommunityPriceSignals<S extends PricedVenueSignal>(
  signals: Map<string, S>,
  communityPrices: Map<string, CommunityPrice>,
  now: number = Date.now(),
): Map<string, S> {
  if (communityPrices.size === 0) return signals;
  let merged: Map<string, S> | null = null;
  for (const [venueId, price] of communityPrices) {
    // Defence in depth. The normal caller already supplies its beer-only
    // projection, but this seam itself must reject every non-pint category so
    // a future caller cannot route a soft drink into pint colour or buckets.
    if (price.drinkCategory !== "beer") continue;
    // What the map paints is the category's best-corroborated in-window figure
    // (mapCandidateOf), not the freshest report - so a lone fresh disagreement
    // can neither repaint the map nor un-paint a corroborated price. The sheet
    // keeps showing the freshest row for itself, standing note and all.
    const candidate = mapCandidateOf(price);
    // The trust gate, before anything else: uncorroborated or stale prices
    // never reach a pin, a list row or a cheapest bucket.
    if (!drivesMap(candidate, now)) continue;
    const existing = (merged ?? signals).get(venueId);
    const dropAt = existing?.latestContributorAt;
    // Only step aside for a Pint Drop we KNOW is newer. An unknown drop age
    // yields to the submission, which is the observation we can date.
    if (typeof dropAt === "number" && dropAt > candidate.submittedAt) continue;
    merged ??= new Map(signals);
    merged.set(venueId, {
      ...(existing ?? ({ hasPintDrops: false, latestContributorPrice: null } as S)),
      latestContributorPrice: candidate.priceGbp,
      latestContributorAt: candidate.submittedAt,
    });
  }
  return merged ?? signals;
}

/** Shared empty result, so "nothing pending" is one stable identity. */
export const NO_PROVISIONAL_VENUES: ReadonlySet<string> = new Set();

/**
 * Membership of a provisional id set, collapsed to one order-independent
 * string.
 *
 * The set's IDENTITY is load-bearing, not just its contents: it is threaded
 * into the UK base layer's publish callback, where a new Set identity
 * re-resolves the viewport and re-`setData`s every base pin. A combiner that
 * allocates per render would restream the whole base layer every time an
 * unrelated venue sheet loaded. Keying the memo on this string instead is what
 * makes "same members" mean "same object", with no ref read during render.
 *
 * NUL is the one separator no venue id can carry: every id is cleaned of
 * control characters (lib/communityPrice.ts) before it is stored or read back.
 */
export function provisionalVenueIdKey(venueIds: Iterable<string>): string {
  return [...venueIds].sort().join("\u0000");
}

/** The set a key stands for, sharing one identity for "nothing pending". */
export function provisionalVenueIdsFromKey(key: string): ReadonlySet<string> {
  return key === "" ? NO_PROVISIONAL_VENUES : new Set(key.split("\u0000"));
}

/**
 * The venues wearing a PROVISIONAL mark: at least one in-window pint report
 * that has not yet earned the map.
 *
 * A SECOND, deliberately separate seam from the merge above, and the reason the
 * two are separate is the whole policy. The merge answers "what price does this
 * pin claim?" and stays gated; this answers "has anyone been here tonight?" and
 * is ungated, because a first submitter seeing zero map change is what killed
 * the contribution loop (captain decision 2026-07-26). Nothing here touches
 * `VenueSignal`, so no price, list row or cheapest bucket can move through it -
 * it produces ids, and the pin layer turns those into a badge and nothing else.
 *
 * Reads the SAME freshest-pint-per-venue map the merge reads, so the two can
 * never disagree about which report they are talking about.
 */
export function provisionalCommunityPriceVenueIds(
  communityPrices: Map<string, CommunityPrice>,
  now: number = Date.now(),
): ReadonlySet<string> {
  if (communityPrices.size === 0) return NO_PROVISIONAL_VENUES;
  let pending: Set<string> | null = null;
  for (const [venueId, price] of communityPrices) {
    if (!marksMapProvisionally(price, now)) continue;
    pending ??= new Set<string>();
    pending.add(venueId);
  }
  return pending ?? NO_PROVISIONAL_VENUES;
}
