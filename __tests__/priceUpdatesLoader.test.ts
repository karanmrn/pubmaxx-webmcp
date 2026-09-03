import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadDrinkPriceUpdates,
  loadFoodPriceUpdates,
  resetPriceUpdatesLoader,
} from "@/lib/priceUpdatesLoader";

const generatedAt = "2026-07-18T12:00:00.000Z";

const drinkUpdate = {
  venueKey: "the test arms|1 test street|51.50000|-0.10000",
  drinkName: "Doom Bar",
  category: "beer",
  priceGbp: 5.29,
  source: {
    label: "Test brewery",
    url: "https://example.com/drinks",
    licence: "Test fixture",
  },
  observedAt: "2026-07-17T12:00:00.000Z",
};

const foodUpdate = {
  venueKey: "the test arms|1 test street|51.50000|-0.10000",
  itemName: "Chips",
  category: "sides",
  priceGbp: 3.5,
  source: {
    label: "Test kitchen",
    url: "https://example.com/food",
    licence: "Test fixture",
  },
  observedAt: "2026-07-17T12:00:00.000Z",
};

type GlobalWithOptionalWindow = { window?: unknown };
const testGlobal = globalThis as GlobalWithOptionalWindow;

function stubBrowser(): void {
  testGlobal.window = {};
}

afterEach(() => {
  resetPriceUpdatesLoader();
  delete testGlobal.window;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("price update overlay loading", () => {
  it("skips data fetches during server rendering", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadDrinkPriceUpdates()).resolves.toEqual([]);
    await expect(loadFoodPriceUpdates()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and validates fixture overlays, once per data type", async () => {
    stubBrowser();
    const fetchMock = vi.fn(async (path: string) => ({
      ok: true,
      json: async () =>
        path.includes("drink_price_updates")
          ? { generatedAt, updates: [drinkUpdate, { invalid: true }] }
          : { generatedAt, updates: [foodUpdate, { invalid: true }] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const firstDrinkLoad = loadDrinkPriceUpdates();
    expect(loadDrinkPriceUpdates()).toBe(firstDrinkLoad);
    await expect(firstDrinkLoad).resolves.toEqual([
      { ...drinkUpdate, lane: "publisher" },
    ]);

    const firstFoodLoad = loadFoodPriceUpdates();
    expect(loadFoodPriceUpdates()).toBe(firstFoodLoad);
    await expect(firstFoodLoad).resolves.toEqual([foodUpdate]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/data/drink_price_updates/latest.json",
      { headers: { accept: "application/json" } },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/data/food_price_updates/latest.json",
      { headers: { accept: "application/json" } },
    );
  });

  it("fails soft for unsuccessful and malformed responses", async () => {
    stubBrowser();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError("bad json");
        },
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadDrinkPriceUpdates()).resolves.toEqual([]);
    await expect(loadFoodPriceUpdates()).resolves.toEqual([]);
  });

  it("uses the current time when an overlay omits a valid generation date", async () => {
    stubBrowser();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(generatedAt));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ generatedAt: "not-a-date", updates: [drinkUpdate] }),
      })),
    );

    await expect(loadDrinkPriceUpdates()).resolves.toEqual([
      { ...drinkUpdate, lane: "publisher" },
    ]);
  });
});
