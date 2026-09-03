import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  NEAR_ME_PRICE_CAPTION,
  NearMeCardList,
} from "@/components/nearme/NearMeNow";
import { formatNearDistance, type NearMeCard } from "@/lib/nearMeAnswer";

/**
 * The de-box rule on /near (design judgement 2026-08-01, finding 2.13). Two
 * separate defects, pinned apart.
 *
 * 1. The caption. Every row spent a full column repeating "cheapest pint",
 *    and that column is what squeezed "The Three Tuns - LSE Stu…" into an
 *    ellipsis. The caption is the LIST's column header, so it prints once.
 * 2. The zero. "1 min · 0.0 km" presented a rounding artefact as a
 *    measurement. Under 100 m the figure has run out of resolution, so the
 *    row says where the reader is standing instead.
 */
const CARDS: NearMeCard[] = [
  { id: "a", name: "The Three Tuns - LSE Students' Union", borough: "Westminster", cheapestPrice: 2.95, distanceKm: 0.9, walkMinutes: 11 },
  { id: "b", name: "Hercules Pillars", borough: "Camden", cheapestPrice: 4.2, distanceKm: 0.7, walkMinutes: 9 },
  { id: "c", name: "The Queen's Head", borough: "Westminster", cheapestPrice: 5.2, distanceKm: 0.4, walkMinutes: 6 },
  { id: "d", name: "The Lyceum Tavern", borough: "Westminster", cheapestPrice: 5.6, distanceKm: 0.7, walkMinutes: 9 },
  { id: "e", name: "The Coach & Horses", borough: "Westminster", cheapestPrice: 5.7, distanceKm: 0.03, walkMinutes: 1 },
];

function renderList(cards: NearMeCard[] = CARDS): string {
  return renderToStaticMarkup(
    createElement(NearMeCardList, { cards, onOpen: () => undefined }),
  );
}

function occurrences(haystack: string, needle: string): number {
  return haystack.toLowerCase().split(needle.toLowerCase()).length - 1;
}

describe("/near rows: the caption belongs to the list, not the row", () => {
  it("prints the price caption once for a five-row list", () => {
    const markup = renderList();

    expect(occurrences(markup, NEAR_ME_PRICE_CAPTION)).toBe(1);
    // Sanity: all five rows really did render.
    expect(occurrences(markup, "<li")).toBe(5);
  });

  it("keeps the caption count at one however long the list gets", () => {
    const long = Array.from({ length: 12 }, (_, index) => ({
      ...CARDS[0],
      id: `row-${index}`,
      name: `Pub ${index}`,
    }));

    expect(occurrences(renderList(long), NEAR_ME_PRICE_CAPTION)).toBe(1);
    expect(occurrences(renderList(long), "<li")).toBe(12);
  });

  it("heads the list with the caption rather than repeating it beside each price", () => {
    const markup = renderList();

    expect(markup).toContain(`class="nmnListCaption">${NEAR_ME_PRICE_CAPTION}<`);
    expect(markup).not.toContain("nmnCardPriceLabel");
  });
});

describe("/near rows: a sub-100m distance is not a measurement", () => {
  it("reads 'right here' rather than '0.0 km'", () => {
    expect(formatNearDistance(0)).toBe("right here");
    expect(formatNearDistance(0.004)).toBe("right here");
    expect(formatNearDistance(0.03)).toBe("right here");
    expect(formatNearDistance(0.099)).toBe("right here");
  });

  it("still prints a real figure from 100 m upward", () => {
    expect(formatNearDistance(0.1)).toBe("0.1 km");
    expect(formatNearDistance(0.44)).toBe("0.4 km");
    expect(formatNearDistance(0.9)).toBe("0.9 km");
    expect(formatNearDistance(12.35)).toBe("12.3 km");
  });

  it("says nothing at all when there is no fix", () => {
    expect(formatNearDistance(undefined)).toBeNull();
    expect(formatNearDistance(null)).toBeNull();
    expect(formatNearDistance(Number.NaN)).toBeNull();
    expect(formatNearDistance(-1)).toBeNull();
  });

  it("never renders a 0.0 km row", () => {
    const markup = renderList();

    expect(markup).not.toContain("0.0 km");
    expect(markup).toContain("right here");
    expect(markup).toContain("0.9 km");
  });
});
