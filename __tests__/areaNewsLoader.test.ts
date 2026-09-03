import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({ readFile }));

import { __resetAreaNewsCache, loadAreaNews } from "@/lib/areaNews.server";

const VALID_ENTRY = {
  id: "area-news-valid",
  area: "soho",
  kind: "opening",
  title: "Golden Lion (Soho) opens in Soho",
  detail: "Golden Lion (Soho) pub opened in Soho on 27 August 2026.",
  sourceUrl: "https://example.com/article",
  sourceName: "example.com",
  observedAt: "2026-08-27",
};

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-08-28T12:00:00Z") });
  __resetAreaNewsCache();
  readFile.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("area-news dataset loader", () => {
  it("does not retain an unavailable read after the file recovers", async () => {
    readFile.mockRejectedValueOnce(new Error("temporary read failure"));
    readFile.mockResolvedValueOnce(JSON.stringify({ version: 1, generatedAt: "2026-08-28T00:00:00Z", entries: [VALID_ENTRY] }));

    await expect(loadAreaNews()).resolves.toMatchObject({ status: "unavailable" });
    await expect(loadAreaNews()).resolves.toMatchObject({ status: "ready", entries: [VALID_ENTRY] });
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed rows as unavailable", async () => {
    readFile.mockResolvedValue(JSON.stringify({ version: 1, generatedAt: "2026-08-28T00:00:00Z", entries: [null] }));

    await expect(loadAreaNews()).resolves.toMatchObject({ status: "unavailable" });
  });

  it("rejects a current row that fails extraction rules", async () => {
    readFile.mockResolvedValue(JSON.stringify({
      version: 1,
      generatedAt: "2026-08-28T00:00:00Z",
      entries: [{
        ...VALID_ENTRY,
        title: "John Smith said the pub opened in Soho",
        detail: "John Smith said the pub opened in Soho on 27 August 2026.",
      }],
    }));

    await expect(loadAreaNews()).resolves.toMatchObject({ status: "unavailable" });
  });
});
