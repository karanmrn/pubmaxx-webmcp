import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NearMeCardList } from "@/components/nearme/NearMeNow";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import type { NearPriceTrustResponse } from "@/lib/nearPriceTrust";

const CARDS: NearMeCard[] = [
  {
    id: "venue-a",
    name: "The First Pint",
    borough: "Westminster",
    cheapestPrice: 3.25,
    distanceKm: 0.2,
    walkMinutes: 3,
  },
  {
    id: "venue-b",
    name: "The Second Pint",
    borough: "Camden",
    cheapestPrice: 4.5,
    distanceKm: 0.4,
    walkMinutes: 5,
  },
];

function render(priceTrust: "loading" | NearPriceTrustResponse): string {
  return renderToStaticMarkup(
    createElement(NearMeCardList, {
      cards: CARDS,
      onOpen: () => undefined,
      priceTrust,
    }),
  );
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("/near price trust rows", () => {
  it("keeps useful prices visible while publisher evidence loads", () => {
    const markup = render("loading");

    expect(markup).toContain("£3.25");
    expect(markup).toContain("£4.50");
    expect(occurrences(markup, "On record · Checking publisher")).toBe(2);
  });

  it("shows named and honestly unrecorded publishers", () => {
    const markup = render({
      status: "ready",
      collectedAt: "2026-07-03",
      results: [
        { venueId: "venue-a", price: 3.25, publisher: "Pint Prices" },
        { venueId: "venue-b", price: 4.5, publisher: null },
      ],
    });

    expect(markup).toContain("On record · Pint Prices");
    expect(markup).toContain("On record · Publisher not recorded");
    expect(occurrences(markup, "Prices last collected 3 July 2026.")).toBe(1);
  });

  it("does not attach evidence to a card when its price has changed", () => {
    const markup = render({
      status: "ready",
      collectedAt: "2026-07-03",
      results: [
        { venueId: "venue-a", price: 9.99, publisher: "Wrong price publisher" },
        { venueId: "venue-b", price: 4.5, publisher: null },
      ],
    });

    expect(markup).toContain("£3.25");
    expect(markup).not.toContain("Wrong price publisher");
    expect(markup).toContain("On record · Publisher could not be checked");
  });

  it("keeps a failed read distinct from an unrecorded publisher", () => {
    const markup = render({
      status: "degraded",
      collectedAt: "2026-07-03",
      results: [],
    });

    expect(occurrences(markup, "On record · Publisher could not be checked")).toBe(2);
    expect(markup).not.toContain("Publisher not recorded");
  });

  it("keeps matching publisher evidence in a mixed degraded response", () => {
    const markup = render({
      status: "degraded",
      collectedAt: "2026-07-03",
      results: [
        { venueId: "venue-a", price: 3.25, publisher: "Pint Prices" },
      ],
    });

    expect(markup).toContain("On record · Pint Prices");
    expect(occurrences(markup, "On record · Publisher could not be checked")).toBe(1);
  });

  it("uses the shared dataset stamp instead of an arbitrary response date", () => {
    const markup = render({
      status: "ready",
      collectedAt: "2026-07-04",
      results: [{ venueId: "venue-a", price: 3.25, publisher: "Pint Prices" }],
    });

    expect(markup).toContain("Prices last collected 3 July 2026.");
    expect(markup).not.toContain("Prices last collected 4 July 2026.");
  });
});
