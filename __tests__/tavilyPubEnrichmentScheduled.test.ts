import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runCityEnrichment } = vi.hoisted(() => ({
  runCityEnrichment: vi.fn(),
}));

vi.mock("@/scripts/lib/tavilyPubEnrichment.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/scripts/lib/tavilyPubEnrichment.mjs")>();
  return {
    ...actual,
    runCityEnrichment,
  };
});

import {
  BRISTOL_CRON_QUERY_CAP,
  BRISTOL_CRON_WALL_MS,
  runScheduledCityEnrichment,
  SEARCH_CRON_QUERY_CAP,
  SEARCH_CRON_WALL_MS,
} from "@/lib/tavilyPubEnrichment.server";

function enrichmentOk(city: string, maxQueries: number) {
  return {
    city,
    totalPubs: 10,
    startIndex: 0,
    nextIndex: maxQueries,
    queriesSpent: maxQueries,
    creditsSpent: maxQueries,
    matchedPubs: maxQueries,
    prices: [],
    pages: [],
    delegatedChains: [],
    complete: false,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  runCityEnrichment.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runScheduledCityEnrichment", () => {
  it("bounds Bristol to the smaller cron cap on Bristol rotation nights", async () => {
    vi.setSystemTime(new Date("2026-07-29T03:15:00.000Z"));
    runCityEnrichment.mockImplementation(async ({ city, maxQueries }) =>
      enrichmentOk(city, maxQueries),
    );

    const result = await runScheduledCityEnrichment({ apiKey: "test-key" });

    expect(result.primaryCity).toBe("bristol");
    const bristolCall = runCityEnrichment.mock.calls.find((call) => call[0].city === "bristol");
    expect(bristolCall?.[0].maxQueries).toBe(BRISTOL_CRON_QUERY_CAP);
    expect(result.queriesSpent).toBeGreaterThan(BRISTOL_CRON_QUERY_CAP);
    expect(result.cityRuns?.some((run) => run.city === "london" && run.ok)).toBe(true);
  });

  it("isolates Bristol failure and still enriches spillover cities", async () => {
    vi.setSystemTime(new Date("2026-07-29T03:15:00.000Z"));
    runCityEnrichment.mockImplementation(async ({ city, maxQueries, onProgress }) => {
      if (city === "bristol") {
        await onProgress?.({
          nextIndex: 2,
          queriesSpent: 2,
          creditsSpent: 2,
          prices: [],
          pages: [{ osmId: "node/1" }],
          delegatedChains: [],
        });
        throw new Error("Upstream 504");
      }
      return enrichmentOk(city, maxQueries);
    });

    const result = await runScheduledCityEnrichment({ apiKey: "test-key" });

    expect(result.primaryCity).toBe("bristol");
    expect(result.cityRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ city: "bristol", ok: false, queriesSpent: 2 }),
        expect.objectContaining({ city: "london", ok: true, queriesSpent: expect.any(Number) }),
      ]),
    );
    expect(result.queriesSpent).toBeGreaterThan(2);
  });

  it("counts a first-query Bristol failure against the nightly budget", async () => {
    vi.setSystemTime(new Date("2026-07-29T03:15:00.000Z"));
    runCityEnrichment.mockImplementation(async ({ city, maxQueries, onProgress }) => {
      if (city === "bristol") {
        await onProgress?.({
          nextIndex: 0,
          queriesSpent: 1,
          creditsSpent: 0,
          prices: [],
          pages: [],
          delegatedChains: [],
        });
        throw new Error("Upstream 504");
      }
      return enrichmentOk(city, maxQueries);
    });

    const result = await runScheduledCityEnrichment({ apiKey: "test-key" });

    expect(result.cityRuns).toEqual(
      expect.arrayContaining([expect.objectContaining({ city: "bristol", ok: false, queriesSpent: 1 })]),
    );
    const spilloverSpend = (result.cityRuns ?? [])
      .filter((run) => run.city !== "bristol")
      .reduce((sum, run) => sum + run.queriesSpent, 0);
    expect(spilloverSpend).toBeLessThanOrEqual(SEARCH_CRON_QUERY_CAP - 1);
  });

  it("still throws when a non-Bristol primary city fails", async () => {
    vi.setSystemTime(new Date("2026-07-26T03:15:00.000Z"));
    runCityEnrichment.mockRejectedValue(new Error("Upstream 503"));

    await expect(runScheduledCityEnrichment({ apiKey: "test-key" })).rejects.toThrow(
      "Upstream 503",
    );
    expect(runCityEnrichment).toHaveBeenCalledTimes(1);
  });

  it("applies the Bristol wall-clock bound on Bristol rotation nights", async () => {
    vi.setSystemTime(new Date("2026-07-29T03:15:00.000Z"));
    runCityEnrichment.mockImplementation(({ city, maxQueries, signal }) => {
      if (city === "bristol") {
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("City enrichment aborted."), { name: "AbortError" }));
          });
        });
      }
      return Promise.resolve(enrichmentOk(city, maxQueries));
    });

    const resultPromise = runScheduledCityEnrichment({ apiKey: "test-key" });
    await vi.advanceTimersByTimeAsync(BRISTOL_CRON_WALL_MS + 1);
    const result = await resultPromise;

    expect(result.cityRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          city: "bristol",
          ok: false,
          error: expect.stringContaining(String(BRISTOL_CRON_WALL_MS)),
        }),
        expect.objectContaining({ city: "london", ok: true }),
      ]),
    );
  });

  it("returns after the Edinburgh wall-clock bound when a provider ignores abort", async () => {
    vi.setSystemTime(new Date("2026-07-26T03:15:00.000Z"));
    runCityEnrichment.mockImplementation(() => new Promise(() => {}));

    const resultPromise = runScheduledCityEnrichment({ apiKey: "test-key" });
    const settled = resultPromise.then(
      () => true,
      () => true,
    );
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 1_000);
    });

    await vi.advanceTimersByTimeAsync(SEARCH_CRON_WALL_MS + 1_000);

    await expect(Promise.race([settled, timeout])).resolves.toBe(true);
  });

  it("does not publish late Edinburgh progress after the wall-clock timeout", async () => {
    vi.setSystemTime(new Date("2026-07-26T03:15:00.000Z"));
    const progress = vi.fn();
    runCityEnrichment.mockImplementation(({ city, maxQueries, onProgress }) =>
      new Promise((resolve) => {
        setTimeout(async () => {
          await onProgress?.({
            nextIndex: 1,
            queriesSpent: 1,
            creditsSpent: 1,
            prices: [],
            pages: [],
            delegatedChains: [],
          });
          resolve(enrichmentOk(city, maxQueries));
        }, SEARCH_CRON_WALL_MS + 1_000);
      }),
    );

    const resultPromise = runScheduledCityEnrichment({
      apiKey: "test-key",
      onProgress: progress,
    });
    const resultRejection = expect(resultPromise).rejects.toThrow(
      `City enrichment timed out after ${SEARCH_CRON_WALL_MS}ms.`,
    );
    await vi.advanceTimersByTimeAsync(SEARCH_CRON_WALL_MS);
    await resultRejection;

    await vi.advanceTimersByTimeAsync(1_000);

    expect(progress).not.toHaveBeenCalled();
  });

  it("reports failed-city spend when every Bristol-night run fails", async () => {
    vi.setSystemTime(new Date("2026-07-29T03:15:00.000Z"));
    runCityEnrichment.mockImplementation(async ({ city, onProgress }) => {
      await onProgress?.({
        nextIndex: 1,
        queriesSpent: 1,
        creditsSpent: 1,
        prices: [],
        pages: [],
        delegatedChains: [],
      });
      throw new Error(`Upstream failure for ${city}`);
    });

    const result = await runScheduledCityEnrichment({ apiKey: "test-key" });

    expect(result.cityRuns?.every((run) => run.ok === false)).toBe(true);
    expect(result.queriesSpent).toBe(result.cityRuns?.length ?? 0);
    expect(result.creditsSpent).toBe(result.cityRuns?.length ?? 0);
  });
});
