// The pint figure the venue Overview treats as "today" for pubs — the stack
// mug-check and then-and-now compare against, not the ungated community row.
//
// Authority order mirrors mergeCommunityPriceSignals:
//   1. corroborated, in-window community beer (map candidate), unless a Pint
//      Drop we know is newer outranks it;
//   2. the unmerged Pint Drop (`latestContributorPrice`);
//   3. curated cheapest on record (`cheapestPrice`, sourced or baseline).
//
// Uncorroborated sheet-only community never wins — when the main row below is
// still curated baseline, the yardstick must match that figure.

import {
  drivesMap,
  mapCandidateOf,
  type CommunityPrice,
} from "@/lib/communityPrice";

function freshestBeerPrice(
  rows: readonly CommunityPrice[] | undefined | null,
): CommunityPrice | null {
  if (!rows) return null;
  return rows.reduce<CommunityPrice | null>(
    (best, row) => {
      if (row.drinkCategory !== "beer") return best;
      return best === null || row.submittedAt > best.submittedAt ? row : best;
    },
    null,
  );
}

export function overviewDisplayablePintGbp({
  cheapestPrice,
  latestContributorPrice,
  latestPintDropAt,
  communityRows,
  now = Date.now(),
}: {
  cheapestPrice: number | null | undefined;
  latestContributorPrice: number | null | undefined;
  latestPintDropAt?: number | null;
  communityRows?: readonly CommunityPrice[] | null;
  now?: number;
}): number | null {
  const pintDrop =
    latestContributorPrice !== null && latestContributorPrice !== undefined
      ? latestContributorPrice
      : null;

  const beer = freshestBeerPrice(communityRows);
  if (beer) {
    const candidate = mapCandidateOf(beer);
    if (drivesMap(candidate, now)) {
      const dropAt = latestPintDropAt;
      if (
        typeof dropAt === "number" &&
        dropAt > candidate.submittedAt &&
        pintDrop !== null
      ) {
        return pintDrop;
      }
      return candidate.priceGbp;
    }
  }

  if (pintDrop !== null) return pintDrop;

  if (
    typeof cheapestPrice === "number" &&
    Number.isFinite(cheapestPrice) &&
    cheapestPrice > 0
  ) {
    return cheapestPrice;
  }

  return null;
}
