import type { Provenance } from "@/lib/curation";
import type { Venue } from "@/lib/venues";

// "Then vs Now" — connect a venue's baseline dataset price ("then") to the most
// recent community-reported Pint Drop price ("now"). Pure/testable: no fetch, no
// React, no side effects. The /discover page feeds it grouped Venue[] plus the
// public drops from GET /api/pint-drops and renders the result.

// The minimal community-drop shape computeThenVsNow reads. The public
// /api/pint-drops DTO satisfies this (it carries venueId, priceGbp, createdAt);
// callers narrow the API payload to this before passing it in.
export type ThenVsNowDrop = {
  venueId: string;
  priceGbp: number | null;
  createdAt: string;
};

// One resolved comparison row, ready to hand straight to a card.
// - thenGbp  = the venue's baseline/dataset cheapest price
// - nowGbp   = the price on the most-recent priced community drop for that venue
// - deltaGbp = nowGbp - thenGbp (positive → gone up, negative → gone down)
// - pct      = deltaGbp / thenGbp * 100 (0 when thenGbp is 0, guarded)
export type ThenVsNowItem = {
  venueId: string;
  venueName: string;
  thenGbp: number;
  nowGbp: number;
  deltaGbp: number;
  pct: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// The most-recent priced drop for a venue: filter to drops carrying a usable
// price, then pick the newest by createdAt (ISO strings sort lexicographically).
// Returns null when the venue has no priced community drop at all.
function mostRecentPricedDrop(drops: ThenVsNowDrop[]): ThenVsNowDrop | null {
  let best: ThenVsNowDrop | null = null;
  for (const drop of drops) {
    if (!isFiniteNumber(drop.priceGbp)) continue;
    if (!best || drop.createdAt.localeCompare(best.createdAt) > 0) best = drop;
  }
  return best;
}

// Build the "Then vs Now" rows. A venue only qualifies when it carries BOTH
// signals: a baseline `cheapestPrice` ("then") AND at least one priced community
// drop ("now"). Venues missing either are silently ignored.
//
// Ranking: biggest movers first — by absolute delta descending (the drops that
// tell the most striking price story lead), ties broken on venue name so the
// order is deterministic across renders. `limit` caps the returned list.
export function computeThenVsNow(
  venues: Venue[],
  drops: ThenVsNowDrop[],
  limit = 8,
): ThenVsNowItem[] {
  // Bucket drops by venue once so each venue is a single Map read.
  const byVenue = new Map<string, ThenVsNowDrop[]>();
  for (const drop of drops) {
    const key = drop.venueId;
    if (!key) continue;
    byVenue.set(key, [...(byVenue.get(key) ?? []), drop]);
  }

  const items: ThenVsNowItem[] = [];
  for (const venue of venues) {
    const thenGbp = venue.cheapestPrice;
    if (!isFiniteNumber(thenGbp)) continue; // no "then" baseline → skip

    const now = mostRecentPricedDrop(byVenue.get(venue.id) ?? []);
    if (!now || !isFiniteNumber(now.priceGbp)) continue; // no "now" community price → skip

    const nowGbp = now.priceGbp;
    const deltaGbp = nowGbp - thenGbp;
    const pct = thenGbp !== 0 ? (deltaGbp / thenGbp) * 100 : 0;

    items.push({
      venueId: venue.id,
      venueName: venue.name,
      thenGbp,
      nowGbp,
      deltaGbp,
      pct,
    });
  }

  return items
    .sort(
      (a, b) =>
        Math.abs(b.deltaGbp) - Math.abs(a.deltaGbp) ||
        a.venueName.localeCompare(b.venueName),
    )
    .slice(0, Math.max(0, limit));
}

// ────────────────────────────────────────────────────────────────────────────
// The Golden Thread — per-venue price story with inflation ("a pint here was £X
// in YYYY — £Y in today's money"). Everything below is pure/testable: no fetch,
// no React, no side effects. The venue surface (VenueInspector) feeds it the
// selected Venue plus that venue's drops and renders the resolved story.
// ────────────────────────────────────────────────────────────────────────────

// UK CPI (all items, 2015 = 100) decadal anchors, annual averages. Post-1988
// values are ONS series D7BT; pre-1988 use the ONS long-run modelled CPI
// back-series, rounded to the tenth. These are the only "inflation" numbers in
// the app, kept as a compact anchor table so the math stays deterministic and
// unit-testable offline (no live index fetch). We linearly interpolate BETWEEN
// anchors and clamp OUTSIDE the covered range, so a stray year never throws.
const CPI_ANCHORS: ReadonlyArray<readonly [year: number, index: number]> = [
  [1950, 6.6],
  [1960, 8.1],
  [1970, 11.0],
  [1980, 33.4],
  [1990, 58.2],
  [2000, 74.8],
  [2010, 92.6],
  [2015, 100.0],
  [2020, 108.9],
  [2024, 133.4],
];

// The "today" the CPI table revalues into — the newest anchor year. Kept as a
// named constant so both the math and the copy ("in today's money") agree on
// which year "today" means without a wall-clock dependency (deterministic).
export const INFLATION_TODAY_YEAR = CPI_ANCHORS[CPI_ANCHORS.length - 1][0];

// The CPI index for a year, linearly interpolated between the nearest anchors
// and clamped to the endpoint index outside the covered range. Returns null
// only for a non-finite year.
export function cpiIndexForYear(year: number): number | null {
  if (!isFiniteNumber(year)) return null;
  const first = CPI_ANCHORS[0];
  const last = CPI_ANCHORS[CPI_ANCHORS.length - 1];
  if (year <= first[0]) return first[1];
  if (year >= last[0]) return last[1];
  for (let i = 1; i < CPI_ANCHORS.length; i += 1) {
    const [loYear, loIdx] = CPI_ANCHORS[i - 1];
    const [hiYear, hiIdx] = CPI_ANCHORS[i];
    if (year <= hiYear) {
      const t = (year - loYear) / (hiYear - loYear);
      return loIdx + t * (hiIdx - loIdx);
    }
  }
  return last[1]; // unreachable given the clamp above, but keeps TS total
}

// Revalue a GBP amount from `fromYear` into INFLATION_TODAY_YEAR money using the
// CPI anchor table. Returns null when either the amount or the year can't be
// used (so the caller shows the honest "no historical anchor" state instead of
// a bogus figure). Rounds to the penny.
export function inflateToToday(amountGbp: number, fromYear: number): number | null {
  if (!isFiniteNumber(amountGbp)) return null;
  const fromIdx = cpiIndexForYear(fromYear);
  const todayIdx = cpiIndexForYear(INFLATION_TODAY_YEAR);
  if (fromIdx === null || todayIdx === null || fromIdx === 0) return null;
  return Math.round(amountGbp * (todayIdx / fromIdx) * 100) / 100;
}

// Pull a usable baseline YEAR out of a free-text era string. Community era tags
// look like "Dad's rule, 1980s", "The wedding, 1971", "Nan's shift, 1950s".
// A bare 4-digit year wins; a "…0s" decade resolves to its MIDPOINT (1980s →
// 1985) so the inflation anchor sits in the middle of the remembered span
// rather than its very start. Only years in a plausible pub-era range
// (1900–INFLATION_TODAY_YEAR) count — an address number or "£5" never leaks in.
export function parseEraYear(era: string | null | undefined): number | null {
  if (typeof era !== "string") return null;
  // Decade first ("1980s") so "1980" inside it doesn't win as a bare year.
  const decade = era.match(/\b(19|20)(\d)0s\b/);
  if (decade) {
    const base = Number(`${decade[1]}${decade[2]}0`);
    const mid = base + 5;
    if (mid >= 1900 && mid <= INFLATION_TODAY_YEAR) return mid;
  }
  const bare = era.match(/\b(19|20)\d{2}\b/);
  if (bare) {
    const year = Number(bare[0]);
    if (year >= 1900 && year <= INFLATION_TODAY_YEAR) return year;
  }
  return null;
}

// One resolved figure in a venue's price story. `provenance` is carried through
// verbatim so the surface can badge each row (sourced / contributor / anecdote
// / demo) and never flatten a demo price into "real" community data.
export type VenuePriceStamp = {
  gbp: number;
  provenance: Provenance;
  // A human label for the moment this price is FROM: an era string for a
  // historical drop, "Baseline on record" for the dataset price, "Community
  // tonight" for the newest priced drop.
  label: string;
};

// The historical "then" anchor: an anecdotal/contributor drop carrying BOTH a
// price and a parseable era year, revalued into today's money.
export type VenueInflationAnchor = {
  year: number;
  thenGbp: number; // the price as originally remembered/logged
  todayGbp: number; // that same price in INFLATION_TODAY_YEAR money
  todayYear: number;
  provenance: Provenance;
  handle: string;
};

export type VenuePriceStory = {
  venueId: string;
  venueName: string;
  // The dataset baseline "price on record" (sourced/editorial), when present.
  baseline: VenuePriceStamp | null;
  // The freshest priced community drop ("now"), when present.
  now: VenuePriceStamp | null;
  // now.gbp - baseline.gbp, and its percent, when BOTH are present. Mirrors
  // computeThenVsNow so the venue surface can reuse the same delta framing.
  deltaGbp: number | null;
  pct: number | null;
  // The inflation line: the best historical priced+dated drop revalued to today.
  // null when the venue has no drop that carries both a price and an era year.
  inflation: VenueInflationAnchor | null;
  // True when there is nothing to show at all — the surface renders its honest
  // empty state ("no price story on record yet").
  isEmpty: boolean;
};

// A drop shape rich enough to build the inflation anchor: the ThenVsNowDrop
// fields plus the era/handle/provenance the story needs. VenueInspector already
// holds full PintDrops for the venue, so it satisfies this directly.
export type VenuePriceStoryDrop = ThenVsNowDrop & {
  era?: string | null;
  handle?: string | null;
  provenance: Provenance;
};

// Pick the best historical inflation anchor: among drops that carry BOTH a
// finite price AND a parseable era year, prefer the OLDEST year (the deepest
// look back tells the most striking inflation story); ties break on the lower
// price, then newest createdAt, for determinism. Demo drops are eligible but
// keep their "demo" provenance so the surface badges them honestly.
function bestInflationAnchor(drops: VenuePriceStoryDrop[]): VenueInflationAnchor | null {
  let best: { year: number; drop: VenuePriceStoryDrop } | null = null;
  for (const drop of drops) {
    if (!isFiniteNumber(drop.priceGbp)) continue;
    const year = parseEraYear(drop.era);
    if (year === null) continue;
    if (
      !best ||
      year < best.year ||
      (year === best.year && drop.priceGbp < (best.drop.priceGbp ?? Infinity)) ||
      (year === best.year &&
        drop.priceGbp === best.drop.priceGbp &&
        drop.createdAt.localeCompare(best.drop.createdAt) > 0)
    ) {
      best = { year, drop };
    }
  }
  if (!best) return null;
  const todayGbp = inflateToToday(best.drop.priceGbp as number, best.year);
  if (todayGbp === null) return null;
  return {
    year: best.year,
    thenGbp: best.drop.priceGbp as number,
    todayGbp,
    todayYear: INFLATION_TODAY_YEAR,
    provenance: best.drop.provenance,
    handle: (best.drop.handle ?? "").trim() || "A drinker",
  };
}

// Build the whole per-venue price story in one pass. Pure: hand it the selected
// venue and that venue's drops. Each of the three surfaces (baseline / now /
// inflation) is resolved independently, so a venue can show any subset — and
// when it has none, `isEmpty` is true for an honest empty state. Provenance is
// NEVER flattened: the dataset baseline is "sourced", `now` and the inflation
// anchor carry their drop's own provenance.
export function computeVenuePriceStory(
  venue: Venue,
  drops: VenuePriceStoryDrop[],
): VenuePriceStory {
  const baselineGbp = venue.cheapestPrice;
  const baseline: VenuePriceStamp | null = isFiniteNumber(baselineGbp)
    ? {
        gbp: baselineGbp,
        // The dataset baseline is editorial/sourced record, unless the venue's
        // curation explicitly marks its provenance otherwise (e.g. demo).
        provenance: venue.curation.provenance ?? "sourced",
        label: "Baseline on record",
      }
    : null;

  const nowDrop = mostRecentPricedDrop(drops);
  const now: VenuePriceStamp | null =
    nowDrop && isFiniteNumber(nowDrop.priceGbp)
      ? {
          gbp: nowDrop.priceGbp,
          provenance: (nowDrop as VenuePriceStoryDrop).provenance,
          label: "Community tonight",
        }
      : null;

  let deltaGbp: number | null = null;
  let pct: number | null = null;
  if (baseline && now) {
    deltaGbp = now.gbp - baseline.gbp;
    pct = baseline.gbp !== 0 ? (deltaGbp / baseline.gbp) * 100 : 0;
  }

  const inflation = bestInflationAnchor(drops);

  return {
    venueId: venue.id,
    venueName: venue.name,
    baseline,
    now,
    deltaGbp,
    pct,
    inflation,
    isEmpty: !baseline && !now && !inflation,
  };
}
