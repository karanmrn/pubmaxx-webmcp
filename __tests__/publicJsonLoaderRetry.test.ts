import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadPintIndexLeagueRows,
  resetPintIndexLeagueLoader,
} from "@/lib/pintIndexLeagueLoader";
import {
  loadPriceHistory,
  resetPriceHistoryLoader,
} from "@/lib/priceHistoryLoader";
import {
  loadDrinkPriceUpdates,
  loadFoodPriceUpdates,
  resetPriceUpdatesLoader,
} from "@/lib/priceUpdatesLoader";

type GlobalWithOptionalWindow = { window?: unknown };
const testGlobal = globalThis as GlobalWithOptionalWindow;

afterEach(() => {
  resetPriceUpdatesLoader();
  resetPriceHistoryLoader();
  resetPintIndexLeagueLoader();
  delete testGlobal.window;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function twoAttemptFetch(): ReturnType<typeof vi.fn> {
  return vi
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
}

describe("public JSON loader retries", () => {
  it.each([
    ["drink updates", loadDrinkPriceUpdates],
    ["food updates", loadFoodPriceUpdates],
    ["price history", loadPriceHistory],
    ["Pint Index league", loadPintIndexLeagueRows],
  ])("retries %s after a temporary failed read", async (_label, load) => {
    testGlobal.window = {};
    const fetchMock = twoAttemptFetch();
    vi.stubGlobal("fetch", fetchMock);

    await load();
    await load();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["drink updates", loadDrinkPriceUpdates],
    ["food updates", loadFoodPriceUpdates],
    ["price history", loadPriceHistory],
    ["Pint Index league", loadPintIndexLeagueRows],
  ])("retries %s after a 200 response with an invalid body", async (_label, load) => {
    testGlobal.window = {};
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await load();
    await load();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
