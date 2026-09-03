import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchCityArea,
  resetCityAreaCache,
  trimCityArea,
} from "@/lib/citymcp/area";

function sseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

beforeEach(() => {
  resetCityAreaCache();
});

describe("trimCityArea", () => {
  it("extracts averagePriceGbp/asOf and echoes the query borough", () => {
    const trimmed = trimCityArea("Hackney", {
      pint: { asOf: "2026-07-01T00:00:00Z", value: { averagePriceGbp: 5.85 } },
      weather: { condition: "clear" },
    });
    expect(trimmed).toEqual({
      borough: "Hackney",
      averagePintGbp: 5.85,
      asOf: "2026-07-01T00:00:00Z",
    });
  });

  it("prefers the upstream's own borough label when present", () => {
    const trimmed = trimCityArea("hackney", {
      pint: { value: { averagePriceGbp: 5.5, borough: "Hackney" } },
    });
    expect(trimmed.borough).toBe("Hackney");
  });

  it("degrades to nulls on a missing/malformed pint block", () => {
    expect(trimCityArea("Camden", {})).toEqual({
      borough: "Camden",
      averagePintGbp: null,
      asOf: null,
    });
    expect(trimCityArea("Camden", { pint: { value: { averagePriceGbp: "NaN" } } })).toEqual({
      borough: "Camden",
      averagePintGbp: null,
      asOf: null,
    });
    expect(trimCityArea("Camden", null)).toEqual({
      borough: "Camden",
      averagePintGbp: null,
      asOf: null,
    });
  });
});

describe("fetchCityArea", () => {
  it("caches per-borough within the TTL and busts on reset", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              pint: { asOf: "2026-07-01T00:00:00Z", value: { averagePriceGbp: 5.85 } },
            },
          },
        }),
        { status: 200 },
      ),
    );

    const first = await fetchCityArea("Hackney", { fetchImpl });
    const second = await fetchCityArea("Hackney", { fetchImpl });
    expect(first.averagePintGbp).toBe(5.85);
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Different borough key → new fetch.
    await fetchCityArea("Camden", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Same borough, different case → still a cache hit (key is normalised).
    await fetchCityArea("hackney", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    resetCityAreaCache();
    await fetchCityArea("Hackney", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws CityMcpError on upstream failure (caller fails soft)", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(fetchCityArea("Hackney", { fetchImpl })).rejects.toThrow();
  });
});
