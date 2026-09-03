import { describe, expect, it } from "vitest";

import {
  NEAR_PRICE_TRUST_COLLECTED_AT,
  nearPriceTrustLabel,
  resolveNearPriceTrust,
  type NearPriceTrustVenue,
} from "@/lib/nearPriceTrust";

function venue(
  prices: NearPriceTrustVenue["prices"],
  cheapestPrice = 4.5,
): NearPriceTrustVenue {
  return {
    id: "venue-abc123",
    cheapestPrice,
    prices,
  };
}

describe("near price trust", () => {
  it("names the publisher from the first exact-price row without exposing its URL", () => {
    const result = resolveNearPriceTrust(
      venue([
        {
          app_price_id: "price-1",
          pint_name: "House lager",
          price_gbp: 4.5,
          pub_url: "https://www.pint-prices.com/pub/test-arms",
        },
      ]),
      4.5,
    );

    expect(result).toEqual({
      venueId: "venue-abc123",
      price: 4.5,
      publisher: "Pint Prices",
    });
    expect(result).not.toHaveProperty("sourceUrl");
  });

  it("reports no publisher when the exact-price row has no acceptable publisher URL", () => {
    const result = resolveNearPriceTrust(
      venue([
        {
          app_price_id: "price-1",
          pint_name: "House lager",
          price_gbp: 4.5,
          pub_url: "javascript:alert(1)",
        },
      ]),
      4.5,
    );

    expect(result).toEqual({
      venueId: "venue-abc123",
      price: 4.5,
      publisher: null,
    });
  });

  it("keeps the first exact-price row as publisher authority when prices tie", () => {
    const result = resolveNearPriceTrust(
      venue([
        {
          app_price_id: "price-1",
          pint_name: "First lager",
          price_gbp: 4.5,
          pub_url: "https://first.example/menu",
        },
        {
          app_price_id: "price-2",
          pint_name: "Second lager",
          price_gbp: 4.5,
          pub_url: "https://second.example/menu",
        },
      ]),
      4.5,
    );

    expect(result?.publisher).toBe("first.example");
  });

  it("returns no evidence when full detail no longer matches the card price", () => {
    const result = resolveNearPriceTrust(
      venue([
        {
          app_price_id: "price-1",
          pint_name: "House lager",
          price_gbp: 4.5,
          pub_url: "https://www.pint-prices.com/pub/test-arms",
        },
      ]),
      4.6,
    );

    expect(result).toBeNull();
  });

  it.each([
    ["loading", null, "On record · Checking publisher"],
    ["named", "Pint Prices", "On record · Pint Prices"],
    ["unrecorded", null, "On record · Publisher not recorded"],
    ["degraded", null, "On record · Publisher could not be checked"],
  ] as const)("formats the %s display state", (state, publisher, expected) => {
    expect(nearPriceTrustLabel(state, publisher)).toBe(expected);
  });

  it("uses the shared pint dataset collection stamp", () => {
    expect(NEAR_PRICE_TRUST_COLLECTED_AT).toBe(
      "Prices last collected 3 July 2026.",
    );
  });
});
