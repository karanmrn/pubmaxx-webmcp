import { describe, it, expect } from "vitest";

import {
  boroughsWithPrices,
  rankBoroughCheapest,
  rankNearMe,
  walkMinutesFromKm,
  type PricedPoint,
} from "@/lib/nearMeAnswer";
import type { VenueKind } from "@/lib/venues";

// A user standing at a central London point.
const here = { lat: 51.5074, lng: -0.1278 };

// ~0.1 km east ≈ one street over. Longitude degrees are ~69 km at London's
// latitude, so 0.001° ≈ 0.07 km — handy for placing fixtures at known-ish
// distances without hand-computing haversine.
function at(
  id: string,
  dLat: number,
  dLng: number,
  price: number | null,
  borough = "Camden",
  kind?: VenueKind,
): PricedPoint {
  return {
    id,
    name: `Pub ${id}`,
    lat: here.lat + dLat,
    lng: here.lng + dLng,
    cheapestPrice: price,
    borough,
    ...(kind !== undefined ? { kind } : {}),
  };
}

describe("walkMinutesFromKm", () => {
  it("floors at 1 minute and never returns 0 or negatives", () => {
    expect(walkMinutesFromKm(0)).toBe(1);
    expect(walkMinutesFromKm(-5)).toBe(1);
    expect(walkMinutesFromKm(0.02)).toBe(1);
  });

  it("uses ~80 m/min so 1 km reads ~12–13 min", () => {
    expect(walkMinutesFromKm(1)).toBe(13);
    expect(walkMinutesFromKm(0.8)).toBe(10);
  });

  it("is tolerant of non-finite input", () => {
    expect(walkMinutesFromKm(Number.NaN)).toBe(1);
    expect(walkMinutesFromKm(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("rankNearMe — walkable answer", () => {
  const venues: PricedPoint[] = [
    at("cheap-far", 0.006, 0.006, 4.5), // priced, near edge of walk ring, cheapest
    at("dear-close", 0.0005, 0.0005, 7.2), // nearest but dearest
    at("mid", 0.002, 0.002, 5.5),
    at("no-price", 0.0006, 0.0006, null), // disqualified: no observation
    at("far-away", 0.2, 0.2, 3.0), // priced but ~25 km — outside walk ring
  ];

  it("returns priced pubs within the walk ring, cheapest first", () => {
    const answer = rankNearMe(here.lat, here.lng, venues);
    expect(answer.scope).toBe("walkable");
    expect(answer.cards.map((c) => c.id)).toEqual(["cheap-far", "mid", "dear-close"]);
  });

  it("excludes pubs with no price observation (the quality bar)", () => {
    const answer = rankNearMe(here.lat, here.lng, venues);
    expect(answer.cards.some((c) => c.id === "no-price")).toBe(false);
  });

  it("excludes priced cocktail and food anchors", () => {
    const answer = rankNearMe(here.lat, here.lng, [
      ...venues,
      at("cocktail", 0.0001, 0.0001, 2, "Camden", "bar"),
      at("doner", 0.0002, 0.0002, 3, "Camden", "food"),
    ]);
    expect(answer.cards.map((card) => card.id)).toEqual([
      "cheap-far",
      "mid",
      "dear-close",
    ]);
  });

  it("excludes pubs outside the walk ring from the walkable answer", () => {
    const answer = rankNearMe(here.lat, here.lng, venues);
    expect(answer.cards.some((c) => c.id === "far-away")).toBe(false);
  });

  it("stamps each card with distance and walking minutes", () => {
    const answer = rankNearMe(here.lat, here.lng, venues);
    for (const card of answer.cards) {
      expect(card.distanceKm).toBeGreaterThan(0);
      expect(card.walkMinutes).toBeGreaterThanOrEqual(1);
    }
  });

  it("caps the answer at maxAnswers", () => {
    const many: PricedPoint[] = Array.from({ length: 10 }, (_, i) =>
      at(`p${i}`, 0.0005 * (i + 1), 0.0005 * (i + 1), 4 + i * 0.1),
    );
    const answer = rankNearMe(here.lat, here.lng, many, { maxAnswers: 4 });
    expect(answer.cards).toHaveLength(4);
  });
});

describe("rankNearMe — widening when nearby is thin", () => {
  it("widens honestly to nearest priced pubs when < min qualify within the walk ring", () => {
    const venues: PricedPoint[] = [
      at("walk-1", 0.001, 0.001, 6), // only ONE within the walk ring
      at("out-1", 0.02, 0.02, 4.5), // ~2.6 km — outside walk, inside widened
      at("out-2", 0.015, 0.015, 5.0),
    ];
    const answer = rankNearMe(here.lat, here.lng, venues, { minAnswers: 3 });
    expect(answer.scope).toBe("widened");
    expect(answer.cards.length).toBeGreaterThanOrEqual(1);
    // still cheapest-first among the nearest set
    const prices = answer.cards.map((c) => c.cheapestPrice);
    expect([...prices]).toEqual([...prices].sort((a, b) => a - b));
  });

  it("reports scope none and no cards when nothing is priced anywhere", () => {
    const venues: PricedPoint[] = [at("a", 0.001, 0.001, null), at("b", 0.002, 0.002, null)];
    const answer = rankNearMe(here.lat, here.lng, venues);
    expect(answer.scope).toBe("none");
    expect(answer.cards).toEqual([]);
  });

  it("is safe on empty input", () => {
    const answer = rankNearMe(here.lat, here.lng, []);
    expect(answer.scope).toBe("none");
    expect(answer.cards).toEqual([]);
  });
});

describe("rankBoroughCheapest", () => {
  const venues: PricedPoint[] = [
    at("cam-dear", 0.01, 0.01, 6.8, "Camden"),
    at("cam-cheap", 0.02, 0.02, 4.2, "Camden"),
    at("south", 0.03, 0.03, 3.9, "Southwark"),
    at("cam-noprice", 0.04, 0.04, null, "Camden"),
  ];

  it("returns cheapest-first priced pubs for the borough, case-insensitive", () => {
    const cards = rankBoroughCheapest(venues, "camden");
    expect(cards.map((c) => c.id)).toEqual(["cam-cheap", "cam-dear"]);
    expect(cards.every((c) => c.distanceKm === undefined)).toBe(true);
  });

  it("does not list non-pub anchors in borough results", () => {
    const withAnchors = [
      ...venues,
      at("cocktail", 0.001, 0.001, 2, "Camden", "bar"),
      at("doner", 0.001, 0.001, 3, "Camden", "food"),
    ];
    expect(rankBoroughCheapest(withAnchors, "Camden").map((card) => card.id)).toEqual([
      "cam-cheap",
      "cam-dear",
    ]);
  });

  it("returns nothing for an empty borough string", () => {
    expect(rankBoroughCheapest(venues, "  ")).toEqual([]);
  });
});

describe("boroughsWithPrices", () => {
  it("lists only boroughs with a priced pub, alphabetical, deduped", () => {
    const venues: PricedPoint[] = [
      at("a", 0, 0.001, 5, "Southwark"),
      at("b", 0, 0.002, 5, "Camden"),
      at("c", 0, 0.003, null, "Hackney"), // no price → excluded
      at("d", 0, 0.004, 5, "Camden"), // dupe borough
      at("e", 0, 0.005, 2, "Hackney", "bar"),
    ];
    expect(boroughsWithPrices(venues)).toEqual(["Camden", "Southwark"]);
  });
});
