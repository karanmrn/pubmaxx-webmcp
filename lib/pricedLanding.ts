import { haversineKm } from "@/lib/haversine";
import { namedLegacyPintPriceSource } from "@/lib/drinks";
import { NIGHT_AREAS, nightAreaHasRouteReadyProof, type NightArea } from "@/lib/nightAreas";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";
import type { Venue } from "@/lib/venues";

// One seam for every governed priced landing page. The drink-brand family and
// the brand-by-area family are two views of one contract, so the cheapest-first
// order, the publication floors, the "null means unpublishable" rule, the
// publisher disclosure and the JSON-LD shape live here once. A second copy of
// any of them is how two pages come to answer one question two ways.

/** The ONE publisher resolver every priced landing row shares. */
export type PricedLandingPublisher = NonNullable<
  ReturnType<typeof namedLegacyPintPriceSource>
>;

export type PricedLandingRow = {
  rank: number;
  venueId: string;
  venueName: string;
  borough: string;
  pintName: string;
  priceGbp: number;
  publisher: PricedLandingPublisher | null;
};

/** A candidate row before ranking. Rank is assigned by this module alone. */
export type PricedLandingCandidate = Omit<PricedLandingRow, "rank">;

/** Every published family and the floor it must clear. One table, no drift. */
export const PRICED_LANDING_PUBLICATION_FLOORS = {
  "drink-brand": 20,
  "drink-brand-area": 10,
} as const;

export type PricedLandingFamily = keyof typeof PRICED_LANDING_PUBLICATION_FLOORS;

/** Rows a page may print. A page never prints more than it can rank honestly. */
export const PRICED_LANDING_ROW_LIMIT = 20;

/** Cheapest first, then name, then id, so one dataset gives one order. */
export function comparePricedLandingRows(
  left: PricedLandingCandidate,
  right: PricedLandingCandidate,
): number {
  return (
    left.priceGbp - right.priceGbp ||
    left.venueName.localeCompare(right.venueName) ||
    left.venueId.localeCompare(right.venueId)
  );
}

export type PublishablePricedRows = {
  /** Every candidate that cleared the floor, not only the printed ones. */
  totalPricedVenues: number;
  rows: [PricedLandingRow, ...PricedLandingRow[]];
};

/**
 * The one place "not publishable" is decided. `null` means no page exists, so
 * the route, generateStaticParams and the sitemap cannot disagree.
 */
export function publishablePricedRows(
  family: PricedLandingFamily,
  candidates: readonly PricedLandingCandidate[],
  limit = PRICED_LANDING_ROW_LIMIT,
): PublishablePricedRows | null {
  // One pub counts once, at its cheapest row. Sorting before the dedupe makes
  // that independent of the order the candidates arrived in, and it keeps the
  // floor honest: a pub listed twice must never buy a page.
  const cheapestPerVenue = new Map<string, PricedLandingCandidate>();
  for (const candidate of [...candidates].sort(comparePricedLandingRows)) {
    if (!cheapestPerVenue.has(candidate.venueId)) {
      cheapestPerVenue.set(candidate.venueId, candidate);
    }
  }

  const ranked = [...cheapestPerVenue.values()];
  if (ranked.length < PRICED_LANDING_PUBLICATION_FLOORS[family]) return null;

  const rows = ranked
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const [firstRow, ...restRows] = rows;
  if (!firstRow) return null;

  return {
    totalPricedVenues: ranked.length,
    rows: [firstRow, ...restRows],
  };
}

/**
 * The venue ids a `?sel=` arrival can resolve, or null when nobody could tell.
 *
 * The map loads only the opening viewport cells first, while the server-side
 * selection gate reads every published cell. `null` is a read that could not
 * answer, and it may never read as "nothing is selectable": both lead to the
 * same safe link, but only one of them is a fact about the map.
 * `lib/mapEagerVenueIndex.server.ts` is the one reader behind it.
 */
export type MapSelectableVenueIds = ReadonlySet<string> | null;

/**
 * The cheapest listed row the map can actually OPEN, or null when it can open
 * none of them. Rows arrive cheapest-first, so the first selectable row is the
 * cheapest selectable row; the ranked list itself never moves.
 */
export function pricedLandingMapArrivalRow(
  rows: readonly PricedLandingRow[],
  selectable: MapSelectableVenueIds,
): PricedLandingRow | null {
  if (!selectable) return null;
  return rows.find((row) => selectable.has(row.venueId)) ?? null;
}

/**
 * The ONE map destination a priced landing page may link to. A pub is named
 * only when the map can resolve it; otherwise the link carries the brand alone,
 * because a `sel` the map drops is a promise the arrival cannot keep. No
 * `?drink=beer`: `decodeDrinkLens` already fills the category from the brand
 * (`lib/crawlUrl.ts`), and `PubMap` excludes beer from the selected lens, so
 * the query would not select a lens.
 */
export function pricedLandingMapHref(input: {
  brandSlug: string;
  venueId?: string | null;
  log?: boolean;
}): string {
  const params = new URLSearchParams();
  if (input.venueId) params.set("sel", input.venueId);
  params.set("brand", input.brandSlug);
  if (input.log) params.set("log", "1");
  return `/map?${params.toString()}`;
}

export type PricedLandingMapCta = { href: string; label: string };

/**
 * The brand-by-area arrival: ONE decision answers both the destination and the
 * words. When the map can open the row, the link says so and names the pint it
 * opens; when it cannot, the link carries the brand and the area alone and the
 * words stop promising a pub. A second predicate deciding "did we get a pub"
 * is exactly how a label comes to describe a link it no longer matches.
 */
export function pricedLandingAreaMapCta(input: {
  brandSlug: string;
  brandLabel: string;
  areaName: string;
  row: PricedLandingRow;
  selectable: MapSelectableVenueIds;
}): PricedLandingMapCta {
  const venueId =
    pricedLandingMapArrivalRow([input.row], input.selectable)?.venueId ?? null;

  return {
    href: pricedLandingMapHref({ brandSlug: input.brandSlug, venueId }),
    label: venueId
      ? `Open the cheapest ${input.areaName} pint on the map`
      : `Find ${input.brandLabel} on the map`,
  };
}

/**
 * The log arrival: ONE decision answers both the destination and the words, on
 * both surfaces that offer it. A ROW may say "this price" only while its own
 * pub is named, because a brand-only href opens the map's own picker instead. A
 * HERO is about the brand rather than about one row, so it names the brand
 * whichever href it gets, and that sentence stays true either way.
 */
export function pricedLandingLogCta(input: {
  brandSlug: string;
  brandLabel: string;
  venueId?: string | null;
  surface?: "row" | "hero";
}): PricedLandingMapCta {
  const venueId = input.venueId || null;
  const brandWording = `Log a ${input.brandLabel} pint price`;
  return {
    href: pricedLandingMapHref({
      brandSlug: input.brandSlug,
      venueId,
      log: true,
    }),
    label:
      input.surface === "hero" || !venueId ? brandWording : "Log this price",
  };
}

export type PricedLandingBrandAreaLink = { href: string; label: string };

/** The brand page's inbound links to published `/area/{slug}/drink/{brand}` pairs. */
export function pricedLandingBrandAreaLinks(
  brandSlug: string,
  pairs: readonly { brandSlug: string; areaSlug: string; areaName: string }[],
): PricedLandingBrandAreaLink[] {
  return pairs
    .filter((pair) => pair.brandSlug === brandSlug)
    .map((pair) => ({
      href: `/area/${encodeURIComponent(pair.areaSlug)}/drink/${encodeURIComponent(brandSlug)}`,
      label: pair.areaName,
    }));
}

/**
 * The tokens a shouted drink tag is allowed to keep in capitals. It is an
 * EXPLICIT list rather than a length rule: "NECK OIL" and "IPA" are both two
 * short words, and only one of them is an acronym, so a rule counting letters
 * printed "Neck OIL" - a half-shout worse than the untouched tag. Anything
 * absent here title-cases, however short.
 */
const PRICED_LANDING_CAPITALISED_DRINK_TOKENS = new Set([
  "IPA",
  "APA",
  "DIPA",
  "NEIPA",
  "ESB",
  "XPA",
]);

/**
 * A drink tag is title-cased when the dataset shouted it; the known all-caps
 * beer tokens stay. The word pattern is Unicode, because an accented shout
 * ("GOLDBRAÜ") split on the accent under an ASCII class and came back out
 * half-shouted.
 */
export function formatPricedLandingPintName(name: string): string {
  return name.replace(/\p{L}[\p{L}\p{N}'’.-]*/gu, (word) => {
    if (word !== word.toUpperCase()) return word;
    if (PRICED_LANDING_CAPITALISED_DRINK_TOKENS.has(word)) return word;
    return `${word.charAt(0)}${word.slice(1).toLowerCase()}`;
  });
}

/** Publisher disclosure copy. `docs/VOICE.md` governs both sentences. */
export function formatPricedLandingPublisherStatus(
  publisher: PricedLandingPublisher | null,
): string {
  return publisher ? `Publisher: ${publisher.label}` : "Publisher not recorded";
}

/** Says how many of the priced pubs a page is actually showing. */
export function pricedLandingCountLabel(
  totalPricedVenues: number,
  shownRowCount: number,
): string {
  return totalPricedVenues > shownRowCount
    ? `Showing ${shownRowCount} of ${totalPricedVenues} pubs`
    : `${totalPricedVenues} pubs`;
}

function validVenuePoint(venue: Venue): boolean {
  return Number.isFinite(venue.latitude) && Number.isFinite(venue.longitude);
}

// One venue is assigned to one area for the life of a process. Without the memo
// the assignment is recomputed per venue per (area x brand) pair, which is
// roughly 1.5M haversines for one sitemap request.
const areaAssignments = new WeakMap<
  readonly NightArea[],
  Map<string, NightArea | null>
>();

/** Assign one venue to its nearest containing area across the supplied catalogue. */
export function assignVenueToNightArea(
  venue: Venue,
  areas: readonly NightArea[] = NIGHT_AREAS,
): NightArea | null {
  let cached = areaAssignments.get(areas);
  if (!cached) {
    cached = new Map();
    areaAssignments.set(areas, cached);
  }
  const held = cached.get(venue.id);
  if (held !== undefined) return held;

  const assigned = !validVenuePoint(venue)
    ? null
    : nightAreaForPoint(venue.longitude, venue.latitude, areas);

  cached.set(venue.id, assigned);
  return assigned;
}

/**
 * The nearest containing area for one point, memo-free.
 *
 * `assignVenueToNightArea` keys its memo on a venue id, which is right for the
 * curated index (a bounded, stable set) and wrong for anything with an
 * EPHEMERAL id - a provider event id would leave one permanent entry per
 * listing the process has ever served. Callers holding a point rather than a
 * catalogued venue ask here.
 */
export function nightAreaForPoint(
  longitude: number,
  latitude: number,
  areas: readonly NightArea[] = NIGHT_AREAS,
): NightArea | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return (
    areas
      .map((area) => ({
        area,
        distanceKm: haversineKm([longitude, latitude], [area.centre.lng, area.centre.lat]),
      }))
      .filter(({ area, distanceKm }) => distanceKm <= area.radiusKm)
      .sort(
        (left, right) =>
          left.distanceKm - right.distanceKm || left.area.slug.localeCompare(right.area.slug),
      )[0]?.area ?? null
  );
}

/**
 * Whether an area may carry an INDEXED price page.
 *
 * Keeps the gate version and completeness predicates from
 * `isNightAreaRouteReady` and drops only the review-expiry clauses
 * (`reviewExpiresAt` and the dated window). Route readiness governs PLANNING a
 * crawl: unchecked transport and opening hours must stop a route. A priced list
 * is not a route. It carries its own collection date, so letting a review
 * window lapse would 404 URLs already in the sitemap and deindex them, which is
 * a worse answer than a price list somebody last reviewed a while ago. The
 * renewal alarm lives in `__tests__/nightAreaReviewRenewal.test.ts`.
 */
export function nightAreaPublishesPrices(area: NightArea): boolean {
  return nightAreaHasRouteReadyProof(area);
}

export type PricedLandingJsonLdNode = {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList" | "ItemList";
  name?: string;
  numberOfItems?: number;
  itemListOrder?: string;
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item?: string;
    url?: string;
  }>;
};

/** One JSON-LD shape for every priced landing page. */
export function pricedLandingJsonLd(input: {
  breadcrumb: ReadonlyArray<{ name: string; path: string }>;
  listName: string;
  rows: readonly PricedLandingRow[];
}): PricedLandingJsonLdNode[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: input.breadcrumb.map((crumb, index) => ({
        "@type": "ListItem" as const,
        position: index + 1,
        name: crumb.name,
        item: `${PRODUCTION_SITE_ORIGIN}${crumb.path}`,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: input.listName,
      numberOfItems: input.rows.length,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: input.rows.map((row) => ({
        "@type": "ListItem" as const,
        position: row.rank,
        name: row.venueName,
        url: `${PRODUCTION_SITE_ORIGIN}/ledger/${encodeURIComponent(row.venueId)}`,
      })),
    },
  ];
}
