import { describe, expect, it, vi } from "vitest";

import { checkProductionStoreFreshness } from "@/scripts/check-production-store-freshness.mjs";

const registry = {
  version: 1,
  datasets: [
    { id: "store-feed", stamp: { kind: "store", feedKey: "store-feed" } },
    { id: "file-feed", stamp: { kind: "field", pointer: "generatedAt" } },
  ],
};

describe("production store freshness gate", () => {
  it("checks candidate store feeds and the production What's-On overlay without CDN cache", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          datasets: [
            {
              id: "whats_on",
              status: "fresh",
              detail: "Aged 1h",
              stampSource: "durable-store",
            },
            { id: "store-feed", status: "fresh", detail: "Aged 1h" },
            { id: "unrelated-store", status: "stale", detail: "Aged 99h" },
          ],
        }),
      ),
    );

    await expect(
      checkProductionStoreFreshness({ registry, fetchImpl, url: "https://example.test/api/freshness" }),
    ).resolves.toEqual(["whats_on", "store-feed"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({ href: expect.stringContaining("release_gate=") }),
      expect.objectContaining({ cache: "no-store", headers: expect.objectContaining({ "Cache-Control": "no-cache" }) }),
    );
  });

  it("refuses an artifact fallback for What's-On", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          datasets: [
            {
              id: "whats_on",
              status: "fresh",
              detail: "Aged 1h",
              stampSource: "artifact",
            },
            { id: "store-feed", status: "fresh", detail: "Aged 1h" },
          ],
        }),
      ),
    );

    await expect(
      checkProductionStoreFreshness({ registry, fetchImpl, url: "https://example.test/api/freshness" }),
    ).rejects.toThrow("whats_on: fresh - durable store stamp required");
  });

  it("accepts the pinned legacy store stamp until production exposes its source", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          datasets: [
            {
              id: "whats_on",
              status: "fresh",
              detail: "Aged 1h",
              observedAt: "2026-08-21T13:59:12.570Z",
            },
            { id: "store-feed", status: "fresh", detail: "Aged 1h" },
          ],
        }),
      ),
    );

    await expect(
      checkProductionStoreFreshness({
        registry,
        fetchImpl,
        url: "https://example.test/api/freshness",
        artifactStamps: { whats_on: "2026-08-21T13:59:12.570Z" },
      }),
    ).resolves.toEqual(["whats_on", "store-feed"]);
  });

  it("refuses unresolved or stale store feeds", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          datasets: [
            {
              id: "whats_on",
              status: "fresh",
              detail: "Aged 1h",
              stampSource: "durable-store",
            },
            { id: "store-feed", status: "unknown", detail: "No stamp" },
          ],
        }),
      ),
    );

    await expect(
      checkProductionStoreFreshness({ registry, fetchImpl, url: "https://example.test/api/freshness" }),
    ).rejects.toThrow("store-feed: unknown - No stamp");
  });
});
