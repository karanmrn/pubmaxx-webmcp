import { describe, expect, it } from "vitest";

import {
  mergeCommunityPriceSignals,
  provisionalCommunityPriceVenueIds,
  provisionalVenueIdKey,
  provisionalVenueIdsFromKey,
  type PricedVenueSignal,
} from "@/components/map/communityPriceSignals";
import {
  freshestCommunityPrice,
  freshestPintPrice,
  replacePrice,
  upsertPrice,
} from "@/components/map/useCommunityPrices";
import {
  COMMUNITY_PRICE_MAX_AGE_MS,
  communityTrustNote,
  type CommunityPrice,
  type CommunityPriceMapCandidate,
} from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";

// The one seam that restamps the map. PubMap hands the merged map to the pins,
// the venue list, the route panel and the sheet, so what this function decides
// is what every surface shows. Pin the things that must never slip:
//
//   • freshest-wins (never backwards)
//   • "a logged price is not a Pint Drop"
//   • "only beer restamps a pin" - pin colours are pint buckets, so a cocktail
//     price must stay on the sheet and never recolour the map
//   • THE TRUST GATE: a lone uncorroborated report, and an aged-out one, must not
//     reach a pin at all - while still rendering on the pub's own sheet.

const NOW = Date.UTC(2026, 6, 26, 20, 0, 0);
const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * A community price. Defaults to CORROBORATED and fresh, because most cases
 * here are about the pre-existing merge rules and would otherwise be testing
 * the trust gate by accident; the gate has its own describe block below.
 */
function price(
  venueId: string,
  priceGbp: number,
  submittedAt: number,
  drinkCategory: DrinkCategory = "beer",
  corroborations = 2,
  mapCandidate?: CommunityPriceMapCandidate,
): CommunityPrice {
  return {
    venueId,
    drinkCategory,
    priceGbp,
    submittedAt,
    source: "community",
    corroborations,
    ...(mapCandidate ? { mapCandidate } : {}),
  };
}

function signals(
  entries: Array<[string, PricedVenueSignal]>,
): Map<string, PricedVenueSignal> {
  return new Map(entries);
}

function merge(
  input: Map<string, PricedVenueSignal>,
  prices: Array<[string, CommunityPrice]>,
  now: number = NOW,
) {
  return mergeCommunityPriceSignals(input, new Map(prices), now);
}

describe("mergeCommunityPriceSignals", () => {
  it("returns the input untouched when there is nothing to merge", () => {
    const input = signals([["v1", { hasPintDrops: true, latestContributorPrice: 5 }]]);
    expect(merge(input, [])).toBe(input);
  });

  it("restamps a venue with the submitted price without mutating the input", () => {
    const input = signals([["v1", { hasPintDrops: false, latestContributorPrice: null }]]);
    const merged = merge(input, [["v1", price("v1", 4.2, NOW - MINUTE)]]);

    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
    expect(merged.get("v1")?.latestContributorAt).toBe(NOW - MINUTE);
    // Pure: the caller's map is the one React compares against next render.
    expect(input.get("v1")?.latestContributorPrice).toBeNull();
  });

  it("adds a signal for a venue that had none", () => {
    const merged = merge(signals([]), [["v9", price("v9", 6.4, NOW - MINUTE)]]);
    expect(merged.get("v9")).toEqual({
      hasPintDrops: false,
      latestContributorPrice: 6.4,
      latestContributorAt: NOW - MINUTE,
    });
  });

  it("yields to a Pint Drop we know is newer, so the map never steps backwards", () => {
    const input = signals([
      ["v1", { hasPintDrops: true, latestContributorPrice: 5.5, latestContributorAt: NOW - MINUTE }],
    ]);
    const merged = merge(input, [["v1", price("v1", 4.2, NOW - DAY)]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(5.5);
  });

  it("takes the submission when it is the newer observation", () => {
    const input = signals([
      ["v1", { hasPintDrops: true, latestContributorPrice: 5.5, latestContributorAt: NOW - DAY }],
    ]);
    const merged = merge(input, [["v1", price("v1", 4.2, NOW - MINUTE)]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("takes the submission when the Pint Drop's age is unknown", () => {
    const input = signals([["v1", { hasPintDrops: true, latestContributorPrice: 5.5 }]]);
    const merged = merge(input, [["v1", price("v1", 4.2, NOW - MINUTE)]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("never lights the has-drops halo - a logged price is not a Pint Drop", () => {
    const merged = merge(signals([["v1", { hasPintDrops: false, latestContributorPrice: null }]]), [
      ["v1", price("v1", 4.2, NOW - MINUTE)],
    ]);
    expect(merged.get("v1")?.hasPintDrops).toBe(false);
  });

  it("never restamps from a non-beer submission - pins price pints only", () => {
    const rows = [
      price("v1", 18, NOW - MINUTE, "cocktail"),
      price("v1", 4.2, NOW - DAY),
    ];
    // The pin signal ignores the fresher cocktail and keeps the beer price…
    const pin = freshestPintPrice(rows);
    expect(pin?.priceGbp).toBe(4.2);
    expect(pin?.drinkCategory).toBe("beer");
    // …while the sheet's dated community row still shows the cocktail, named.
    const sheet = freshestCommunityPrice(rows);
    expect(sheet?.priceGbp).toBe(18);
    expect(sheet?.drinkCategory).toBe("cocktail");
  });

  it("moves no pin signal at all when a venue has only non-beer submissions", () => {
    const rows = [price("v1", 12, NOW - DAY, "wine")];
    expect(freshestPintPrice(rows)).toBeNull();
    // The observation is not lost - the sheet still renders it on its own row.
    expect(freshestCommunityPrice(rows)?.drinkCategory).toBe("wine");
  });

  it("refuses no-alcohol categories even if a caller bypasses the beer selector", () => {
    for (const category of ["soft-drink", "alcohol-free"] as const) {
      const input = signals([
        ["v1", { hasPintDrops: false, latestContributorPrice: null }],
      ]);
      const merged = merge(input, [
        ["v1", price("v1", 3.2, NOW - MINUTE, category, 9)],
      ]);
      expect(merged).toBe(input);
      expect(merged.get("v1")?.latestContributorPrice).toBeNull();
    }
  });

  it("leaves untouched venues exactly as they were", () => {
    const other: PricedVenueSignal = { hasPintDrops: true, latestContributorPrice: 7 };
    const merged = merge(
      signals([
        ["v1", { hasPintDrops: false, latestContributorPrice: null }],
        ["v2", other],
      ]),
      [["v1", price("v1", 4.2, NOW - MINUTE)]],
    );
    expect(merged.get("v2")).toBe(other);
  });
});

// The trust gate (captain decision 2026-07-26, review findings F1/F4). These
// are the assertions that stop one account repainting London.
describe("mergeCommunityPriceSignals trust gate", () => {
  const baseline: PricedVenueSignal = { hasPintDrops: false, latestContributorPrice: null };

  it("does NOT restamp a pin from a single uncorroborated report", () => {
    const merged = merge(signals([["v1", baseline]]), [
      ["v1", price("v1", 4.2, NOW - MINUTE, "beer", 1)],
    ]);
    expect(merged.get("v1")?.latestContributorPrice).toBeNull();
  });

  it("restamps once a second independent submitter agrees", () => {
    const merged = merge(signals([["v1", baseline]]), [
      ["v1", price("v1", 4.2, NOW - MINUTE, "beer", 2)],
    ]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("treats a missing count as one voice - an unknown figure has not earned the map", () => {
    const lone: CommunityPrice = {
      venueId: "v1",
      drinkCategory: "beer",
      priceGbp: 4.2,
      submittedAt: NOW - MINUTE,
      source: "community",
    };
    expect(merge(signals([["v1", baseline]]), [["v1", lone]]).get("v1")?.latestContributorPrice)
      .toBeNull();
  });

  it("keeps driving the map on the last day inside the 30-day window", () => {
    const merged = merge(signals([["v1", baseline]]), [
      ["v1", price("v1", 4.2, NOW - COMMUNITY_PRICE_MAX_AGE_MS + MINUTE)],
    ]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("stops driving the map at 31 days, falling back to the scraped baseline", () => {
    const scraped: PricedVenueSignal = { hasPintDrops: false, latestContributorPrice: null };
    const merged = merge(signals([["v1", scraped]]), [
      ["v1", price("v1", 4.2, NOW - 31 * DAY)],
    ]);
    // Nothing merged at all, so the venue keeps exactly the signal it had and
    // geojson.ts falls through to venue.cheapestPrice for the pin colour.
    expect(merged.get("v1")).toBe(scraped);
  });

  it("an aged-out submission never displaces a live Pint Drop either", () => {
    const withDrop: PricedVenueSignal = {
      hasPintDrops: true,
      latestContributorPrice: 5.5,
      latestContributorAt: NOW - 40 * DAY,
    };
    // Freshest-wins alone would take the submission (it IS newer than the drop).
    // The age gate refuses first: neither observation is about tonight, and the
    // one we keep is the one already on record.
    const merged = merge(signals([["v1", withDrop]]), [["v1", price("v1", 4.2, NOW - 31 * DAY)]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(5.5);
  });

  it("allocates nothing when every candidate is gated - the map keeps its identity", () => {
    const input = signals([["v1", baseline], ["v2", baseline]]);
    const merged = merge(input, [
      ["v1", price("v1", 4.2, NOW - MINUTE, "beer", 1)],
      ["v2", price("v2", 5.0, NOW - 31 * DAY)],
    ]);
    // Identity, not just equality: React memo consumers downstream re-run the
    // whole pin scene when this map changes reference, so a gated-out render
    // must not manufacture a new one.
    expect(merged).toBe(input);
  });

  it("merges the trusted venues and leaves the gated ones alone in the same pass", () => {
    const input = signals([["v1", baseline], ["v2", baseline]]);
    const merged = merge(input, [
      ["v1", price("v1", 4.2, NOW - MINUTE, "beer", 1)],
      ["v2", price("v2", 5.0, NOW - MINUTE, "beer", 2)],
    ]);
    expect(merged).not.toBe(input);
    expect(merged.get("v1")?.latestContributorPrice).toBeNull();
    expect(merged.get("v2")?.latestContributorPrice).toBe(5);
  });
});

// The best-corroborated candidate is the other half of F1's fix: one contributor
// cannot PAINT the map (the gate above), and it cannot UN-PAINT it either. The
// store attaches `mapCandidate` - the category's best-backed in-window figure -
// and the merge paints that, while the sheet keeps reading the freshest row.
describe("mergeCommunityPriceSignals map candidate", () => {
  const baseline: PricedVenueSignal = { hasPintDrops: false, latestContributorPrice: null };
  // Contributors A+B logged £4.20 (corroborated, driving the map); C then
  // logged a fresh, disagreeing £9.00 - the sheet row, at one voice.
  const contradicted = price("v1", 9, NOW - MINUTE, "beer", 1, {
    priceGbp: 4.2,
    submittedAt: NOW - 2 * MINUTE,
    corroborations: 2,
  });

  it("keeps the corroborated figure when a lone fresh disagreement arrives", () => {
    const merged = merge(signals([["v1", baseline]]), [["v1", contradicted]]);
    // Still £4.20 - C's £9.00 is one uncorroborated voice, and it must neither
    // take the map nor drop the venue back to the scraped baseline.
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
    expect(merged.get("v1")?.latestContributorAt).toBe(NOW - 2 * MINUTE);
  });

  it("shows the freshest row on the sheet, awaiting confirmation, while the map paints the corroborated one", () => {
    // The split IS the design: sheet freshest-wins and honest about standing,
    // map best-corroborated. Both facts ride on the same row.
    expect(freshestCommunityPrice([contradicted])?.priceGbp).toBe(9);
    expect(communityTrustNote(contradicted, NOW)).toMatch(/awaiting confirmation/i);
    const merged = merge(signals([["v1", baseline]]), [["v1", contradicted]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(4.2);
  });

  it("hands the map to the contradiction once it reaches the threshold itself", () => {
    const confirmed = price("v1", 9, NOW - MINUTE, "beer", 2, {
      priceGbp: 9,
      submittedAt: NOW - MINUTE,
      corroborations: 2,
    });
    const merged = merge(signals([["v1", baseline]]), [["v1", confirmed]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(9);
  });

  it("cedes the map when the best-corroborated candidate has aged out", () => {
    const input = signals([["v1", baseline]]);
    const stale = price("v1", 9, NOW - MINUTE, "beer", 1, {
      priceGbp: 4.2,
      submittedAt: NOW - 31 * DAY,
      corroborations: 2,
    });
    // Nothing merged: the candidate fails the age gate and the fresh sheet row
    // never was the map's business, so the scraped baseline stands.
    expect(merge(input, [["v1", stale]])).toBe(input);
  });

  it("still yields to a Pint Drop newer than the candidate", () => {
    const withDrop: PricedVenueSignal = {
      hasPintDrops: true,
      latestContributorPrice: 5.5,
      latestContributorAt: NOW,
    };
    const merged = merge(signals([["v1", withDrop]]), [["v1", contradicted]]);
    expect(merged.get("v1")?.latestContributorPrice).toBe(5.5);
  });
});

// The provisional mark: ungated VISIBILITY beside the gated AUTHORITY above.
// The two must stay separable - a report that earns a badge must not be able to
// earn a price, and the badge must vanish the moment the price is real.
describe("provisionalCommunityPriceVenueIds", () => {
  const pending = (
    prices: Array<[string, CommunityPrice]>,
    now: number = NOW,
  ) => provisionalCommunityPriceVenueIds(new Map(prices), now);

  it("marks a venue on its FIRST in-window pint report", () => {
    const lone = price("v1", 4.2, NOW - MINUTE, "beer", 1);
    expect([...pending([["v1", lone]])]).toEqual(["v1"]);
  });

  it("marks nothing when no one has reported", () => {
    expect(pending([]).size).toBe(0);
  });

  it("drops the mark once the price is corroborated - the pin carries it now", () => {
    const confirmed = price("v1", 4.2, NOW - MINUTE, "beer", 2);
    expect(pending([["v1", confirmed]]).size).toBe(0);
  });

  it("drops the mark once the report ages out of the window", () => {
    const stale = price("v1", 4.2, NOW - COMMUNITY_PRICE_MAX_AGE_MS - MINUTE, "beer", 1);
    expect(pending([["v1", stale]]).size).toBe(0);
  });

  it("keeps the mark on the last in-window day and loses it on the next", () => {
    const edge = NOW - COMMUNITY_PRICE_MAX_AGE_MS;
    expect(pending([["v1", price("v1", 4.2, edge, "beer", 1)]]).size).toBe(1);
    expect(pending([["v1", price("v1", 4.2, edge - 1, "beer", 1)]]).size).toBe(0);
  });

  it("never marks a pin for a drink the map does not price", () => {
    // A lone £9 wine cannot be "one report from moving the map", because no
    // number of wine reports moves a pint pin.
    const wine = price("v1", 9, NOW - MINUTE, "wine", 1);
    expect(pending([["v1", wine]]).size).toBe(0);
  });

  it("does not mark a pub whose corroborated price is already painting the pin", () => {
    // A lone fresh disagreement at a confirmed pub: the map is stamped, so
    // there is nothing provisional to say.
    const contradiction = price("v1", 9, NOW - MINUTE, "beer", 1, {
      priceGbp: 4.2,
      submittedAt: NOW - 2 * MINUTE,
      corroborations: 2,
    });
    expect(pending([["v1", contradiction]]).size).toBe(0);
  });

  it("re-marks a pub whose corroborated price has aged out from under it", () => {
    const revived = price("v1", 4.4, NOW - MINUTE, "beer", 1, {
      priceGbp: 4.2,
      submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - DAY,
      corroborations: 3,
    });
    expect([...pending([["v1", revived]])]).toEqual(["v1"]);
  });

  it("returns one stable identity for 'nothing pending', so renders don't churn", () => {
    expect(pending([])).toBe(pending([["v1", price("v1", 4.2, NOW, "beer", 2)]]));
  });

  // THE separation. Same input, both seams: the badge appears, the price does
  // not. If this ever fails, one uncorroborated report is repainting pins again.
  it("marks the map without moving any price the merge owns", () => {
    const lone = price("v1", 4.2, NOW - MINUTE, "beer", 1);
    const input = signals([["v1", { hasPintDrops: false, latestContributorPrice: null }]]);
    expect(pending([["v1", lone]]).has("v1")).toBe(true);
    // Byte-identical to today: the merge returns the very same map object.
    expect(merge(input, [["v1", lone]])).toBe(input);
  });
});

// The provisional set reaches the UK base layer's publish callback, where a new
// Set identity re-resolves the viewport and re-setData's every base pin. So
// membership, not allocation, is what may move it - and the key is what lets a
// memo tell those apart.
describe("provisionalVenueIdKey", () => {
  it("keys the same members identically however they were collected", () => {
    expect(provisionalVenueIdKey(new Set(["venue-uk-n1", "venue-a"]))).toBe(
      provisionalVenueIdKey(new Set(["venue-a", "venue-uk-n1"])),
    );
    // …which is what holds one Set identity across an unrelated venue load.
    const key = provisionalVenueIdKey(new Set(["venue-uk-n1", "venue-a"]));
    expect(provisionalVenueIdsFromKey(key)).toEqual(
      new Set(["venue-a", "venue-uk-n1"]),
    );
  });

  it("moves the key on any real membership change", () => {
    const held = provisionalVenueIdKey(new Set(["venue-uk-n1"]));
    expect(provisionalVenueIdKey(new Set(["venue-uk-n2"]))).not.toBe(held);
    expect(
      provisionalVenueIdKey(new Set(["venue-uk-n1", "venue-uk-n2"])),
    ).not.toBe(held);
    expect(provisionalVenueIdKey(new Set())).not.toBe(held);
  });

  it("shares one identity for nothing pending", () => {
    const empty = provisionalVenueIdKey(new Set());
    expect(empty).toBe("");
    expect(provisionalVenueIdsFromKey(empty)).toBe(
      provisionalVenueIdsFromKey(""),
    );
    expect(provisionalVenueIdsFromKey(empty).size).toBe(0);
  });
});

// The sheet is the other half of the policy: gated prices still SHOW, they just
// say where they stand. If this copy ever goes empty for a gated price the pub
// page would silently imply a restamp that never happened.
describe("communityTrustNote", () => {
  const beer = { drinkCategory: "beer" as const };

  it("says nothing when the price is corroborated and current", () => {
    expect(communityTrustNote({ ...beer, corroborations: 2, submittedAt: NOW - MINUTE }, NOW)).toBe(
      "",
    );
  });

  it("tells a lone pint report where its provisional mark is, and what sets it", () => {
    const note = communityTrustNote(
      { ...beer, corroborations: 1, submittedAt: NOW - MINUTE },
      NOW,
    );
    // The reader can go and look at the badge, so the note names it…
    expect(note).toMatch(/marked on the map/i);
    // …and still says plainly that the map has not moved yet.
    expect(note).toMatch(/second drinker/i);
  });

  it("refuses to claim a mark when a corroborated figure already paints the pin", () => {
    // A lone disagreeing report at a pub whose confirmed price is on the map:
    // the pin is stamped, not provisional, so the note must not say "marked".
    const note = communityTrustNote(
      {
        ...beer,
        corroborations: 1,
        submittedAt: NOW - MINUTE,
        mapCandidate: { priceGbp: 4.2, submittedAt: NOW - 2 * MINUTE, corroborations: 2 },
      },
      NOW,
    );
    expect(note).toMatch(/awaiting confirmation/i);
    expect(note).not.toMatch(/marked on the map/i);
  });

  it("explains an aged-out price has handed the map back to the record", () => {
    expect(
      communityTrustNote({ ...beer, corroborations: 5, submittedAt: NOW - 31 * DAY }, NOW),
    ).toMatch(/30 days/i);
  });

  it("leads with age when a price is both stale and uncorroborated", () => {
    // Age is the more useful fact: "confirm it" is not the advice for a price
    // that would age out again anyway.
    expect(
      communityTrustNote({ ...beer, corroborations: 1, submittedAt: NOW - 31 * DAY }, NOW),
    ).toMatch(/30 days/i);
  });

  it("keeps naming the mark on surfaces whose pin can carry it", () => {
    // Reach defaults to "paint" and can be passed explicitly - either way a
    // curated pub's lone pint report gets the marked-on-the-map standing.
    const note = communityTrustNote(
      { ...beer, corroborations: 1, submittedAt: NOW - MINUTE },
      NOW,
      "paint",
    );
    expect(note).toMatch(/marked on the map/i);
  });

  it("promises a base pin the mark it draws and never the colour it cannot", () => {
    // A UK base pin CAN wear the provisional dot and can never wear a price:
    // no band, no pin label, and the price merge never reaches a base id. So
    // the note names the mark and must not offer a map move for a second
    // report, which is the one promise this layer could never keep.
    const waiting = communityTrustNote(
      { ...beer, corroborations: 1, submittedAt: NOW - MINUTE },
      NOW,
      "mark",
    );
    expect(waiting).toMatch(/marked on the map/i);
    expect(waiting).toMatch(/confirms the figure here/i);
    expect(waiting).not.toMatch(/moves the map/i);

    // Nor may it hand the map back to a "price on record" a base pub has not got.
    const aged = communityTrustNote(
      { ...beer, corroborations: 1, submittedAt: NOW - 31 * DAY },
      NOW,
      "mark",
    );
    expect(aged).toMatch(/30 days/i);
    expect(aged).not.toMatch(/map/i);

    // And a lone report at a base pub already holding a corroborated figure
    // has no mark to point at, so it must not claim the map either way.
    const contradicting = communityTrustNote(
      {
        ...beer,
        corroborations: 1,
        submittedAt: NOW - MINUTE,
        mapCandidate: { priceGbp: 4.2, submittedAt: NOW - 2 * MINUTE, corroborations: 2 },
      },
      NOW,
      "mark",
    );
    expect(contradicting).toMatch(/awaiting confirmation/i);
    expect(contradicting).not.toMatch(/map/i);
  });

  it("never claims a mark on a surface whose pin cannot carry one", () => {
    // A surface with no pin at all passes "page", so a lone pint report must
    // read page-only.
    const waiting = communityTrustNote(
      { ...beer, corroborations: 1, submittedAt: NOW - MINUTE },
      NOW,
      "page",
    );
    expect(waiting).toMatch(/awaiting confirmation/i);
    expect(waiting).not.toMatch(/map/i);
    expect(waiting).not.toMatch(/mark/i);
    const aged = communityTrustNote(
      { ...beer, corroborations: 1, submittedAt: NOW - 31 * DAY },
      NOW,
      "page",
    );
    expect(aged).toMatch(/30 days/i);
    expect(aged).not.toMatch(/map/i);
  });

  it("never promises the map to a drink the map does not price", () => {
    // Pins and list rows are pint surfaces; a wine or cocktail row must state
    // its standing without implying any amount of confirmation moves a pin.
    const wine = { drinkCategory: "wine" as const, corroborations: 1 };
    const waiting = communityTrustNote({ ...wine, submittedAt: NOW - MINUTE }, NOW);
    expect(waiting).toMatch(/awaiting confirmation/i);
    expect(waiting).not.toMatch(/map/i);
    const aged = communityTrustNote({ ...wine, submittedAt: NOW - 31 * DAY }, NOW);
    expect(aged).toMatch(/30 days/i);
    expect(aged).not.toMatch(/map/i);
  });
});

describe("upsertPrice", () => {
  it("keeps a newer local observation when an older row arrives later", () => {
    const localBeer = price("v1", 5.2, 9_000);
    const wine = price("v1", 8.5, 2_000, "wine");
    const staleServerBeer = price("v1", 4.2, 1_000);

    expect(upsertPrice([localBeer, wine], staleServerBeer)).toEqual([
      localBeer,
      wine,
    ]);
  });
});

describe("replacePrice", () => {
  it("adopts the server record even when the optimistic row's device stamp is newer", () => {
    // Device clock ran ahead of the server: the optimistic stamp out-ranks the
    // authoritative POST response, which must still replace it.
    const optimisticBeer = price("v1", 5.2, 9_000);
    const wine = price("v1", 8.5, 2_000, "wine");
    const serverBeer = price("v1", 5.2, 8_000);

    expect(replacePrice([optimisticBeer, wine], serverBeer)).toEqual([
      serverBeer,
      wine,
    ]);
  });
});
