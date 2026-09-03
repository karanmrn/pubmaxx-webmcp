import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/lib/offlineCache", () => ({
  offlineCache: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      store.set(key, value);
      return true;
    },
  },
}));

import { loadSlimVenuesFromPathResult } from "@/lib/venuesSlim";

const PARTIAL_PATH = "/data/slim-partial-cache.json";
const COMPLETE_PATH = "/data/slim-complete-cache.json";
const VALID_ROW = {
  id: "venue-partial",
  name: "Partial Arms",
  lat: 51.5,
  lng: -0.1,
  cheapestPrice: 5,
  borough: "Camden",
};

describe("loadSlimVenues caches only complete payloads", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    store.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not treat a later fetch failure as a complete cached index", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === PARTIAL_PATH) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{}, VALID_ROW]),
        } as Response);
      }
      return Promise.reject(new Error("cellar signal"));
    }) as typeof fetch;

    await expect(loadSlimVenuesFromPathResult(PARTIAL_PATH)).resolves.toEqual({
      rows: [VALID_ROW],
      status: "unavailable",
    });
    expect([...store.values()]).toEqual([]);

    globalThis.fetch = (() => Promise.reject(new Error("cellar signal"))) as typeof fetch;
    await expect(loadSlimVenuesFromPathResult(PARTIAL_PATH)).rejects.toThrow("cellar signal");
  });

  it("returns a complete cached payload as ready when the live read fails", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === COMPLETE_PATH) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([VALID_ROW]),
        } as Response);
      }
      return Promise.reject(new Error("cellar signal"));
    }) as typeof fetch;

    await expect(loadSlimVenuesFromPathResult(COMPLETE_PATH)).resolves.toEqual({
      rows: [VALID_ROW],
      status: "ready",
    });

    globalThis.fetch = (() => Promise.reject(new Error("cellar signal"))) as typeof fetch;
    await expect(loadSlimVenuesFromPathResult(COMPLETE_PATH)).resolves.toEqual({
      rows: [VALID_ROW],
      status: "ready",
    });
  });
});
