import { describe, expect, it } from "vitest";

import { mergeDrinkUpdates } from "../scripts/harvest_outer_london_prices.mjs";

const source = {
  label: "Tattoo Bar - official website",
  url: "https://tattoo-bar.co.uk/menu",
  licence: "first-party",
};

describe("outer London drink refresh merge", () => {
  it("replaces a prior trailing-pint spelling instead of duplicating the drink", () => {
    const merged = mergeDrinkUpdates(
      [
        {
          venueKey: "tattoo-bar",
          drinkName: "Guinness Microdraught Pint",
          category: "beer",
          priceGbp: 6.8,
          source,
          observedAt: "2026-07-18T00:00:00.000Z",
        },
      ],
      [
        {
          venueKey: "tattoo-bar",
          drinkName: "Guinness Microdraught",
          category: "beer",
          priceGbp: 6.8,
          source,
          observedAt: "2026-08-21T00:00:00.000Z",
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      drinkName: "Guinness Microdraught",
      observedAt: "2026-08-21T00:00:00.000Z",
    });
  });
});
