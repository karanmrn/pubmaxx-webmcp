import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupVenueDetail } = vi.hoisted(() => ({ lookupVenueDetail: vi.fn() }));

vi.mock("@/lib/venueDetailIndex", () => ({
  lookupVenueDetail,
  isVenueDetailId: (id: string) => /^venue-[a-z0-9-]+$/.test(id),
}));

import { GET } from "@/app/api/near-price-trust/route";

function request(query: string): Request {
  return new Request(`http://localhost/api/near-price-trust?${query}`);
}

function detail(id: string, price = 4.5, pubUrl = "https://www.pint-prices.com/pub/test") {
  return {
    id,
    cheapestPrice: price,
    prices: [{ app_price_id: "p1", pint_name: "Lager", price_gbp: price, pub_url: pubUrl }],
  };
}

describe("GET /api/near-price-trust", () => {
  beforeEach(() => lookupVenueDetail.mockReset());

  it("rejects empty, malformed, and oversized requests", async () => {
    const empty = await GET(request(""));
    expect(empty.status).toBe(400);
    expect(empty.headers.get("cache-control")).toBe("private, max-age=0, no-store");
    expect(await empty.json()).toEqual({
      error: "Provide one to five valid Venue IDs.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect((await GET(request("venueId=../../secret"))).status).toBe(400);
    expect((await GET(request(
      "venueId=venue-a&venueId=venue-b&venueId=venue-c&venueId=venue-d&venueId=venue-e&venueId=venue-f",
    ))).status).toBe(400);
  });

  it("trims and deduplicates IDs before reading display-safe evidence", async () => {
    lookupVenueDetail.mockImplementation(async (id: string) => ({
      status: "found",
      venue: detail(id),
    }));

    const response = await GET(request("venueId=%20venue-a%20&venueId=venue-a&venueId=venue-b"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=0, no-store");
    expect(await response.json()).toEqual({
      status: "ready",
      collectedAt: "2026-07-03",
      results: [
        { venueId: "venue-a", price: 4.5, publisher: "Pint Prices" },
        { venueId: "venue-b", price: 4.5, publisher: "Pint Prices" },
      ],
    });
    expect(lookupVenueDetail).toHaveBeenCalledTimes(2);
  });

  it("keeps resolved evidence when another detail read is unavailable", async () => {
    lookupVenueDetail
      .mockResolvedValueOnce({ status: "found", venue: detail("venue-a") })
      .mockResolvedValueOnce({ status: "unavailable" });

    const response = await GET(request("venueId=venue-a&venueId=venue-b"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "degraded",
      collectedAt: "2026-07-03",
      results: [{ venueId: "venue-a", price: 4.5, publisher: "Pint Prices" }],
    });
  });

  it("skips a missing Venue without degrading available reads", async () => {
    lookupVenueDetail.mockResolvedValueOnce({ status: "missing" });

    const response = await GET(request("venueId=venue-a"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ready",
      collectedAt: "2026-07-03",
      results: [],
    });
  });
});
