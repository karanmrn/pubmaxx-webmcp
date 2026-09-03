import { describe, expect, it, vi } from "vitest";

import {
  buildAreaNewsEntry,
  fetchKeenable,
  KNOWN_AREA_SLUGS,
  parseExtractedFact,
  searchKeenable,
} from "../scripts/lib/keenableAreaNews.mjs";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const FACT = {
  area: "soho",
  kind: "opening",
  title: "Golden Lion (Soho) opens in Soho",
  detail: "Golden Lion (Soho) pub opened in Soho on 27 August 2026.",
};

describe("Keenable area-news client", () => {
  it("uses the keyless public search endpoint when no API key is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ query: "pubs", results: [] }));

    await expect(
      searchKeenable("pubs", { env: {}, fetchImpl, maxResults: 4 }),
    ).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.keenable.ai/v1/search/public",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Keenable-Title": "PUBMAXX area news refresh",
        }),
      }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      query: "pubs",
      max_results: 4,
    });
  });

  it("uses the keyed endpoint when KEENABLE_API_KEY is present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ query: "pubs", results: [] }));

    await searchKeenable("pubs", {
      env: { KEENABLE_API_KEY: "keen_test" },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.keenable.ai/v1/search",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-API-Key": "keen_test" }),
      }),
    );
  });

  it("fails loudly on an HTTP error or malformed response", async () => {
    const failedFetch = vi.fn().mockResolvedValue(jsonResponse({ error: "quota" }, 402));
    await expect(searchKeenable("pubs", { env: {}, fetchImpl: failedFetch })).rejects.toThrow(
      "Keenable search returned 402",
    );

    const malformedFetch = vi.fn().mockResolvedValue(jsonResponse({ query: "pubs" }));
    await expect(searchKeenable("pubs", { env: {}, fetchImpl: malformedFetch })).rejects.toThrow(
      "Keenable search response did not contain results",
    );
  });

  it("fetches a page and fails loudly when content is absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        url: "https://example.com/article",
        title: "Article",
        content: "# Article\n\nA real page.",
        published_at: 1_787_000_000,
      }),
    );

    await expect(
      fetchKeenable("https://example.com/article", { env: {}, fetchImpl }),
    ).resolves.toMatchObject({ content: "# Article\n\nA real page." });
    expect(fetchImpl.mock.calls[0][0]).toContain("/v1/fetch/public?url=");

    const emptyFetch = vi.fn().mockResolvedValue(jsonResponse({ content: "" }));
    await expect(fetchKeenable("https://example.com/article", { env: {}, fetchImpl: emptyFetch })).rejects.toThrow(
      "Keenable fetch response did not contain content",
    );
  });
});

describe("Keenable area-news extraction", () => {
  it("parses plain or fenced JSON and rejects non-facts", () => {
    const options = { currentYear: 2026 };
    expect(KNOWN_AREA_SLUGS.has("hackney")).toBe(true);
    expect(parseExtractedFact({ content: `\`\`\`json\n${JSON.stringify(FACT)}\n\`\`\`` }, options)).toEqual(FACT);
    expect(parseExtractedFact({ content: JSON.stringify({
      ...FACT,
      area: "wimbledon",
      title: "The Dog & Fox opens in Wimbledon",
      detail: "The Dog & Fox pub opened in Wimbledon on 27 August 2026.",
    }) }, options)).toMatchObject({ area: "wimbledon" });
    expect(parseExtractedFact({ content: JSON.stringify({
      ...FACT,
      area: "greenwich",
      title: "The Valley opens in Greenwich",
      detail: "The Valley pub opened in Greenwich on 27 August 2026.",
    }) }, options)).toMatchObject({ area: "greenwich" });
    expect(parseExtractedFact({ content: "null" })).toBeNull();
    expect(parseExtractedFact({ content: JSON.stringify({ ...FACT, area: "Leeds" }) }, options)).toBeNull();
    expect(parseExtractedFact({ content: JSON.stringify({ ...FACT, title: "A — bad title" }) }, options)).toBeNull();
  });

  it("rejects historical or unnamed JSON facts even when the page is recent", () => {
    const options = { knownAreas: new Set(["soho"]), currentYear: 2026 };
    expect(
      parseExtractedFact(
        {
          content: JSON.stringify({
            ...FACT,
            title: "Soho pub award in 2024",
            detail: "The pub won an award in 2024.",
          }),
        },
        options,
      ),
    ).toBeNull();
    expect(
      parseExtractedFact(
        {
          content: JSON.stringify({
            ...FACT,
            title: "John Smith said the pub opened in Soho",
            detail: "John Smith said the pub opened in Soho on 27 August 2026.",
          }),
        },
        options,
      ),
    ).toBeNull();
    expect(
      parseExtractedFact(
        {
          content: JSON.stringify({
            ...FACT,
            title: "Soho Pub News August 2026",
            detail: "A pub opening was reported in August 2026.",
          }),
        },
        options,
      ),
    ).toBeNull();
    expect(
      buildAreaNewsEntry({
        result: { url: "https://example.com/article", published_at: "2026-08-27T12:00:00Z" },
        page: { url: "https://example.com/article", published_at: "2026-08-27T12:00:00Z" },
        fact: { ...FACT, title: "Soho pub award in 2024", detail: "The pub won an award in 2024." },
        now: Date.parse("2026-08-28T12:00:00Z"),
        knownAreas: new Set(["soho"]),
      }),
    ).toBeNull();
  });

  it("extracts a dated fact from clean fetched markdown", () => {
    expect(
      parseExtractedFact(
        {
          content:
            "# Golden Lion (Soho) reopens in Soho\n\nGolden Lion (Soho) pub reopened in Soho on 27 August 2026 after a relaunch.",
        },
        { knownAreas: new Set(["soho"]) },
      ),
    ).toEqual({
      area: "soho",
      kind: "opening",
      title: "Golden Lion (Soho) reopens in Soho",
      detail: "Golden Lion (Soho) pub reopened in Soho on 27 August 2026 after a relaunch.",
    });
  });

  it("classifies closing refurbishment pages as refurbishments", () => {
    expect(
      parseExtractedFact(
        {
          content:
            "# Golden Lion (Soho) pub is closing in Soho\n\nGolden Lion (Soho) pub closed for refurbishment on 27 August 2026 and will reopen on 22 October 2026.",
        },
        { knownAreas: new Set(["soho"]) },
      ),
    ).toMatchObject({ area: "soho", kind: "refurb" });
  });

  it("accepts a prior-year fact during January rollover", () => {
    const fact = {
      ...FACT,
      title: "Golden Lion (Soho) reopens in Soho",
      detail: "Golden Lion (Soho) pub reopened in Soho on 31 December 2026.",
    };
    expect(parseExtractedFact({ content: JSON.stringify(fact) }, {
      knownAreas: new Set(["soho"]),
      currentYear: 2027,
      now: Date.parse("2027-01-05T12:00:00Z"),
    })).toEqual(fact);
    expect(buildAreaNewsEntry({
      result: { url: "https://example.com/article", published_at: "2027-01-04T12:00:00Z" },
      page: { url: "https://example.com/article", published_at: "2027-01-04T12:00:00Z" },
      fact,
      now: Date.parse("2027-01-05T12:00:00Z"),
      knownAreas: new Set(["soho"]),
    })).not.toBeNull();

    expect(parseExtractedFact({ content: JSON.stringify({
      ...fact,
      detail: "Golden Lion (Soho) pub reopened in Soho on 1 January 2026.",
    }) }, {
      knownAreas: new Set(["soho"]),
      currentYear: 2027,
      now: Date.parse("2027-01-05T12:00:00Z"),
    })).toBeNull();

    expect(parseExtractedFact({ content: JSON.stringify({
      ...fact,
      detail: "Golden Lion (Soho) pub reopened in Soho in December 2026.",
    }) }, {
      knownAreas: new Set(["soho"]),
      currentYear: 2027,
      now: Date.parse("2027-01-05T12:00:00Z"),
    })).toBeNull();
  });

  it("requires an exact current-year event date inside the rolling window", () => {
    const options = {
      knownAreas: new Set(["soho"]),
      currentYear: 2026,
      now: Date.parse("2026-08-28T12:00:00Z"),
    };

    expect(parseExtractedFact({ content: JSON.stringify({
      ...FACT,
      detail: "Golden Lion (Soho) pub opened in Soho on 2 January 2026.",
    }) }, options)).toBeNull();
    expect(parseExtractedFact({ content: JSON.stringify({
      ...FACT,
      detail: "Golden Lion (Soho) pub opens in Soho on 29 August 2026.",
    }) }, options)).toBeNull();
  });

  it("rejects a known venue when its dataset borough does not match the fact area", () => {
    expect(parseExtractedFact({ content: JSON.stringify({
      ...FACT,
      area: "teddington",
      title: "The Old King's Head opens in Teddington",
      detail: "The Old King's Head pub opened in Teddington on 27 August 2026.",
    }) }, {
      currentYear: 2026,
      now: Date.parse("2026-08-28T12:00:00Z"),
    })).toBeNull();
  });

  it("rejects historical and generic markdown pages", () => {
    expect(
      parseExtractedFact(
        {
          content: "# Soho pub award in 2024\n\nThe pub won an award in 2024.",
        },
        { knownAreas: new Set(["soho"]), currentYear: 2026 },
      ),
    ).toBeNull();
    expect(
      parseExtractedFact(
        {
          content: "# Soho pub award in 2026\n\nThe pub won an award in 2026.",
        },
        { knownAreas: new Set(["soho"]), currentYear: 2026 },
      ),
    ).toBeNull();
  });

  it("builds a dated, https, source-attributed entry from a fetched page", () => {
    const entry = buildAreaNewsEntry({
      result: {
        url: "https://example.com/article",
        title: "Article",
        published_at: "2026-08-27T12:00:00Z",
      },
      page: {
        url: "https://example.com/article/",
        content: "source",
        published_at: 1787822400,
      },
      fact: FACT,
      now: Date.parse("2026-08-28T12:00:00Z"),
      knownAreas: new Set(["soho"]),
    });

    expect(entry).toMatchObject({
      id: expect.stringMatching(/^area-news-/),
      area: "soho",
      sourceUrl: "https://example.com/article/",
      sourceName: "example.com",
      observedAt: "2026-08-27",
    });
  });
});
