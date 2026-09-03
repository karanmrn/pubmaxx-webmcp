import { describe, expect, it, vi } from "vitest";

const loadAreaNews = vi.hoisted(() => vi.fn());

vi.mock("@/lib/areaNews.server", () => ({ loadAreaNews }));

import { GET } from "@/app/api/area-news/route";

describe("GET /api/area-news unavailable response", () => {
  it("preserves an unavailable dataset without returning successful-empty data", async () => {
    loadAreaNews.mockResolvedValue({ status: "unavailable", entries: [] });

    const response = await GET(new Request("https://x/api/area-news?area=soho"));
    const body = (await response.json()) as { status: string; entries: unknown[] };

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "unavailable", entries: [], award: null });
  });

  it("rejects an unknown area filter before reading the dataset", async () => {
    loadAreaNews.mockClear();

    const response = await GET(new Request("https://x/api/area-news?area=not-an-area"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unknown area.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect(loadAreaNews).not.toHaveBeenCalled();
  });

  it("does not cache successful reads past the rolling freshness cutoff", async () => {
    loadAreaNews.mockResolvedValue({
      status: "ready",
      version: 1,
      generatedAt: "2026-08-28T00:00:00.000Z",
      entries: [],
    });

    const areaResponse = await GET(new Request("https://x/api/area-news?area=soho"));
    const venueResponse = await GET(new Request("https://x/api/area-news?venueId=venue-nope"));

    expect(areaResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(venueResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await areaResponse.json()).toEqual({ status: "ready", entries: [] });
    expect(await venueResponse.json()).toEqual({ status: "ready", award: null });
  });
});
