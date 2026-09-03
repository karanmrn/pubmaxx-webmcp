import { describe, expect, it, vi } from "vitest";

import { areaNewsRefreshQueries, parseArgs, refreshAreaNews } from "../scripts/refresh_area_news.mjs";

const NOW = Date.parse("2026-08-28T12:00:00Z");

function factContent(title: string, detail: string): string {
  return JSON.stringify({
    area: "soho",
    kind: "opening",
    title: `Golden Lion (Soho) ${title}`,
    detail: `${detail} Golden Lion (Soho) pub opened on 27 August 2026.`,
  });
}

describe("area-news refresh job", () => {
  it("builds refresh queries from the current month", () => {
    const queries = areaNewsRefreshQueries(Date.parse("2027-02-10T12:00:00Z"));
    expect(queries[0]).toContain("February 2027");
    expect(queries[0]).toContain("January 2027");
  });

  it("rejects non-positive or non-finite CLI bounds", () => {
    expect(() => parseArgs(["--max-results", "nope"])).toThrow("--max-results must be a positive integer");
    expect(() => parseArgs(["--max-candidates", "0"])).toThrow("--max-candidates must be a positive integer");
    expect(() => parseArgs(["--max-result", "1"])).toThrow("Unsupported argument: --max-result");
  });

  it("fails loud when a search operation exceeds its deadline", async () => {
    const writeDataset = vi.fn();
    let receivedSignal: AbortSignal | undefined;
    await expect(refreshAreaNews({
      now: NOW,
      queries: ["slow"],
      operationTimeoutMs: 1,
      searchFn: vi.fn((_query: string, options?: Record<string, unknown>) => {
        receivedSignal = options?.signal as AbortSignal | undefined;
        return new Promise<never>(() => {});
      }),
      fetchFn: vi.fn(),
      writeDataset,
      logger: vi.fn(),
    })).rejects.toThrow("Area news search timed out after 1ms");
    expect(receivedSignal?.aborted).toBe(true);
    expect(writeDataset).not.toHaveBeenCalled();
  });

  it("fails loud when a fetch response exceeds its deadline", async () => {
    const writeDataset = vi.fn();
    let receivedSignal: AbortSignal | undefined;
    await expect(refreshAreaNews({
      now: NOW,
      queries: ["slow"],
      operationTimeoutMs: 1,
      searchFn: vi.fn().mockResolvedValue([{ url: "https://news.example/slow" }]),
      fetchFn: vi.fn((_url: string, options?: Record<string, unknown>) => {
        receivedSignal = options?.signal as AbortSignal | undefined;
        return new Promise<never>(() => {});
      }),
      writeDataset,
      logger: vi.fn(),
    })).rejects.toThrow("Area news refresh failed: 1 fetch failure");
    expect(receivedSignal?.aborted).toBe(true);
    expect(writeDataset).not.toHaveBeenCalled();
  });

  it("deduplicates sources, keeps dated facts newest first, and writes one snapshot", async () => {
    const writeDataset = vi.fn();
    const searchFn = vi.fn(async (query: string) =>
      query === "first"
        ? [
            { url: "https://news.example/old", published_at: "2026-08-20T09:00:00Z" },
            { url: "https://news.example/new", published_at: "2026-08-27T09:00:00Z" },
          ]
        : [{ url: "https://news.example/new", published_at: "2026-08-27T09:00:00Z" }],
    );
    const fetchFn = vi.fn(async (url: string) => ({
      url,
      published_at: url.endsWith("old") ? "2026-08-20T09:00:00Z" : "2026-08-27T09:00:00Z",
      content: factContent(url.endsWith("old") ? "Older opening" : "Newer opening", "The page states this fact."),
    }));

    const snapshot = await refreshAreaNews({
      now: NOW,
      queries: ["first", "second"],
      knownAreas: new Set(["soho"]),
      searchFn,
      fetchFn,
      previousDataset: { version: 1, generatedAt: "2026-07-18T12:00:00Z", entries: [] },
      writeDataset,
      logger: vi.fn(),
    });

    expect(snapshot.entries.map((entry: { observedAt: string }) => entry.observedAt)).toEqual([
      "2026-08-27",
      "2026-08-20",
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(writeDataset).toHaveBeenCalledOnce();
    expect(writeDataset).toHaveBeenCalledWith(snapshot);
  });

  it("keeps distinct same-day facts in one area", async () => {
    const snapshot = await refreshAreaNews({
      now: NOW,
      queries: ["one"],
      knownAreas: new Set(["soho"]),
      searchFn: vi.fn().mockResolvedValue([
        { url: "https://news.example/one", published_at: "2026-08-27T08:00:00Z" },
        { url: "https://news.example/two", published_at: "2026-08-27T09:00:00Z" },
      ]),
      fetchFn: vi.fn().mockImplementation(async (url: string) => ({
        url,
        published_at: "2026-08-27T08:00:00Z",
        content: factContent(url.endsWith("one") ? "First opening" : "Second opening", "The page states this fact."),
      })),
      writeDataset: vi.fn(),
      logger: vi.fn(),
    });

    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries.map((entry: { title: string }) => entry.title)).toEqual([
      "Golden Lion (Soho) First opening",
      "Golden Lion (Soho) Second opening",
    ]);
  });

  it("keeps existing archive rows while adding fresh rows", async () => {
    const previous = {
      id: "old-row",
      area: "soho",
      kind: "award",
      title: "Golden Lion (Soho) opens in Soho",
      detail: "Golden Lion (Soho) pub opened in Soho on 20 August 2026.",
      sourceUrl: "https://archive.example/award",
      sourceName: "archive.example",
      observedAt: "2026-07-18",
    };
    const replacedMachineRow = { ...previous, id: "area-news-old-machine-row", observedAt: "2026-08-01" };
    const currentMachineRow = { ...previous, id: "area-news-current-machine-row", observedAt: "2026-08-20" };
    const invalidMachineRow = { ...previous, id: "area-news-invalid-machine-row", title: "Soho pub news", detail: "A pub opening was reported in August 2026.", observedAt: "2026-08-21" };

    const snapshot = await refreshAreaNews({
      now: NOW,
      queries: ["one"],
      knownAreas: new Set(["soho"]),
      searchFn: vi.fn().mockResolvedValue([
        { url: "https://news.example/current", published_at: "2026-08-28T08:00:00Z" },
      ]),
      fetchFn: vi.fn().mockResolvedValue({
        url: "https://news.example/current",
        published_at: "2026-08-28T08:00:00Z",
        content: factContent("Current opening", "The page states this current fact."),
      }),
      previousDataset: {
        version: 1,
        generatedAt: "2026-07-18T12:00:00Z",
        entries: [replacedMachineRow, currentMachineRow, invalidMachineRow, previous],
      },
      writeDataset: vi.fn(),
      logger: vi.fn(),
    });

    expect(snapshot.entries.map((entry: { id: string }) => entry.id)).toEqual([
      expect.stringMatching(/^area-news-/),
      "area-news-current-machine-row",
      "old-row",
    ]);
  });

  it("fails without writing when search fails or produces no valid facts", async () => {
    const writeDataset = vi.fn();
    await expect(
      refreshAreaNews({
        now: NOW,
        queries: ["broken"],
        searchFn: vi.fn().mockRejectedValue(new Error("402 payment required")),
        fetchFn: vi.fn(),
        writeDataset,
        logger: vi.fn(),
      }),
    ).rejects.toThrow("Area news search failed for \"broken\": 402 payment required");
    expect(writeDataset).not.toHaveBeenCalled();

    await expect(
      refreshAreaNews({
        now: NOW,
        queries: ["empty"],
        searchFn: vi.fn().mockResolvedValue([]),
        fetchFn: vi.fn(),
        writeDataset,
        logger: vi.fn(),
      }),
    ).rejects.toThrow("Area news refresh found no valid facts");
    expect(writeDataset).not.toHaveBeenCalled();
  });

  it("fails and preserves the prior dataset when any page fetch fails", async () => {
    const logger = vi.fn();
    const writeDataset = vi.fn();
    await expect(refreshAreaNews({
        now: NOW,
        queries: ["one"],
        searchFn: vi.fn().mockResolvedValue([
          { url: "https://news.example/broken", published_at: "2026-08-27T08:00:00Z" },
          { url: "https://news.example/good", published_at: "2026-08-26T08:00:00Z" },
        ]),
        fetchFn: vi
          .fn()
          .mockRejectedValueOnce(new Error("provider timeout"))
          .mockResolvedValueOnce({
            url: "https://news.example/good",
            published_at: "2026-08-26T08:00:00Z",
            content: factContent("Usable opening", "The page states this usable fact."),
          }),
        writeDataset,
        logger,
      })).rejects.toThrow("Area news refresh failed: 1 fetch failure");
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("FETCH FAILED"));
    expect(writeDataset).not.toHaveBeenCalled();
  });
});
