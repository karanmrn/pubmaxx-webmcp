import { describe, expect, it, vi } from "vitest";

import { venueCoordsGroupingKey } from "@/lib/venues";
import {
  classifyChainPub,
  extractPintPrices,
  isOfficialResult,
  mergeCanonicalPrices,
  OFFICIAL_SITE_SOURCE_LICENCE,
  runCityEnrichment,
  selectCityPubs,
  venueKeyForOsmPub,
} from "@/scripts/lib/tavilyPubEnrichment.mjs";
import {
  parseArgs,
  pruneManagedCityPrices,
} from "@/scripts/enrich_city_pubs_tavily.mjs";

const OBSERVED_AT = "2026-07-26T10:00:00.000Z";

const independentPub = {
  osmId: "node/1",
  name: "Independent Arms",
  lat: 53.4808,
  lng: -2.2426,
  address: "10 Example Street, Manchester, M1 1AA",
  postcode: "M1 1AA",
  website: "https://www.independentarms.co.uk/",
  operator: null,
  brewery: null,
};

function tavilyResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      query: "Independent Arms Manchester official drinks menu pint price",
      results: [],
      response_time: 0.2,
      usage: { credits: 1 },
      request_id: "req-test",
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("Tavily pub enrichment governance", () => {
  it("accepts an injected search provider without changing enrichment output", async () => {
    const searchProvider = {
      name: "exa",
      configured: true,
      search: vi.fn(async () => ({
        provider: "exa",
        results: [{
          title: "Independent Arms drinks menu",
          url: "https://www.independentarms.co.uk/drinks",
          content: "Injected Bitter - Pint £4.50",
        }],
      })),
      stats: () => ({
        selectedProvider: "exa",
        gatewayCalls: 1,
        gatewayMaxCalls: 25,
        estimatedTokens: 12,
        model: "openai/gpt-5-nano",
        tavilyCalls: 0,
      }),
    };

    const result = await runCityEnrichment({
      city: "manchester",
      pubs: [independentPub],
      maxQueries: 1,
      observedAt: OBSERVED_AT,
      searchProvider,
    });

    expect(searchProvider.search).toHaveBeenCalledWith(expect.objectContaining({
      includeDomains: ["independentarms.co.uk"],
    }));
    expect(result).toMatchObject({
      queriesSpent: 1,
      matchedPubs: 1,
      prices: [expect.objectContaining({ drinkName: "Injected Bitter", priceGbp: 4.5 })],
    });
  });

  it("enforces a 200-query hard cap at the CLI boundary", () => {
    expect(parseArgs(["--city=leeds"])).toMatchObject({ maxQueries: 200 });
    expect(() => parseArgs(["--city=leeds", "--max-queries=201"])).toThrow(
      "--max-queries must be an integer from 1 to 200.",
    );
  });

  it("prunes only prior Tavily rows for target city before rewriting evidence", () => {
    const oldManaged = {
      venueKey: "leeds|one",
      drinkName: "Old Lager",
      category: "beer",
      source: {
        label: "Leeds One - official site",
        licence: OFFICIAL_SITE_SOURCE_LICENCE,
      },
    };
    const legacySameVenue = {
      ...oldManaged,
      drinkName: "Legacy Lager",
      source: { label: "Legacy source", url: "https://legacy.example" },
    };
    const otherCityManaged = { ...oldManaged, venueKey: "bristol|one" };

    expect(
      pruneManagedCityPrices(
        [oldManaged, legacySameVenue, otherCityManaged],
        new Set(["leeds|one"]),
      ),
    ).toEqual([legacySameVenue, otherCityManaged]);
  });

  it("scopes city-reset replacement to the Tavily provenance lane only", () => {
    const tavilyRowNotReobserved = {
      venueKey: "leeds|bundobust",
      drinkName: "Bundobust IPA",
      category: "beer",
      source: {
        label: "Bundobust - official site",
        licence: OFFICIAL_SITE_SOURCE_LICENCE,
      },
    };
    const chainHarvesterRow = {
      venueKey: "leeds|bundobust",
      drinkName: "Chain Lager",
      category: "beer",
      source: {
        label: "The Chain - Wetherspoons",
        licence:
          "All rights reserved — first-party publisher of its own pub menus/prices; read-only, attributed use only.",
      },
    };
    const communityBaselineRow = {
      venueKey: "leeds|bundobust",
      drinkName: "Baseline Bitter",
      category: "beer",
      source: {
        label: "Scraped baseline",
        licence: "First-party demo fixture for UI coverage; not a live venue price.",
      },
    };

    expect(
      pruneManagedCityPrices(
        [tavilyRowNotReobserved, chainHarvesterRow, communityBaselineRow],
        new Set(["leeds|bundobust"]),
      ),
    ).toEqual([chainHarvesterRow, communityBaselineRow]);
  });

  it("keeps venueKeyForOsmPub in parity with the app's venueCoordsGroupingKey", () => {
    const messyPub = {
      ...independentPub,
      name: "  Independent   Arms ",
      address: " 10  Example Street,  Manchester, M1 1AA ",
    };
    expect(venueKeyForOsmPub(messyPub)).toBe(
      venueCoordsGroupingKey(messyPub.name, messyPub.address, messyPub.lat, messyPub.lng),
    );
    expect(venueKeyForOsmPub(independentPub)).toBe(
      venueCoordsGroupingKey(
        independentPub.name,
        independentPub.address,
        independentPub.lat,
        independentPub.lng,
      ),
    );
  });

  it("delegates known chain pubs without spending Tavily queries", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await runCityEnrichment({
      city: "manchester",
      pubs: [{
        ...independentPub,
        name: "The Waterhouse",
        website: "https://www.jdwetherspoon.com/pubs/all-pubs/england/manchester/the-waterhouse-manchester",
      }],
      apiKey: "test-key",
      maxQueries: 10,
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(classifyChainPub(result.delegatedChains[0].pub)).toEqual({
      chain: "wetherspoons",
      harvester: "scripts/fetch_wetherspoons_pubs.mjs",
    });
    expect(result).toMatchObject({
      queriesSpent: 0,
      creditsSpent: 0,
      matchedPubs: 0,
      nextIndex: 1,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips pubs without an OSM-declared official website", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await runCityEnrichment({
      city: "manchester",
      pubs: [{ ...independentPub, website: null }],
      apiKey: "test-key",
      maxQueries: 10,
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result).toMatchObject({ queriesSpent: 0, matchedPubs: 0, nextIndex: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts only result pages on the OSM-declared official host", () => {
    expect(
      isOfficialResult(independentPub, {
        title: "Drinks menu | Independent Arms",
        url: "https://independentarms.co.uk/drinks",
        content: "Official drinks menu",
      }),
    ).toBe(true);
    expect(
      isOfficialResult(independentPub, {
        title: "Independent Arms Manchester prices",
        url: "https://www.useyourlocal.com/pubs/independent-arms-manchester",
        content: "Pub guide",
      }),
    ).toBe(false);
  });

  it("extracts only plausible GBP prices with explicit pint serving context", () => {
    expect(
      extractPintPrices(
        [
          "## Draught Beer",
          "Manchester Pale Ale - Pint £5.40",
          "House Lager 330ml bottle £4.20",
          "Sharing platter £12.00",
          "Cask Bitter (568ml) £4.75",
        ].join("\n"),
      ),
    ).toEqual([
      { drinkName: "Manchester Pale Ale", priceGbp: 5.4, servingSize: "pint" },
      { drinkName: "Cask Bitter", priceGbp: 4.75, servingSize: "568ml" },
    ]);
  });

  it("extracts whole-pound PDF prices and removes ABV from drink names", () => {
    expect(
      extractPintPrices(
        [
          "PYTHON Premium Lager 4.5% £6.50 PINT Smooth as an ale.",
          "Rotating Cask Collaboration £5 PINT Ongoing seasonal special.",
          "FLIGHT FLIGHT BOARDS BOARDS FLIGHT FLIGHT BOARDS BOARDS cider ROSÉ CIDER Hibiscus & Ginger 3.4% £6.30 PINT",
        ].join("\n"),
      ),
    ).toEqual([
      { drinkName: "PYTHON Premium Lager", priceGbp: 6.5, servingSize: "pint" },
      { drinkName: "Rotating Cask Collaboration", priceGbp: 5, servingSize: "pint" },
      { drinkName: "ROSÉ CIDER Hibiscus & Ginger", priceGbp: 6.3, servingSize: "pint" },
    ]);
  });

  it("extracts the pint column from a multiline official menu table", () => {
    expect(
      extractPintPrices(
        [
          "Draft Beer",
          "Half pint | Pint",
          "Estrella Damm",
          "_£4.00 | £6.80_",
          "Guinness Microdraught Pint",
          "_£6.80_",
          "Ciders",
          "STRAWBERRY & LIME",
          "_£6.00_",
          "ASPALL DRAUGHT CYDER",
          "_£6.00_",
        ].join("\n\n"),
      ),
    ).toEqual([
      { drinkName: "Estrella Damm", priceGbp: 6.8, servingSize: "pint" },
      { drinkName: "Guinness Microdraught", priceGbp: 6.8, servingSize: "pint" },
      { drinkName: "ASPALL DRAUGHT CYDER", priceGbp: 6, servingSize: "pint" },
    ]);
  });

  it("never attributes half-pint prices to a pint serving", () => {
    expect(extractPintPrices("Half pint £2.60")).toEqual([]);
    expect(extractPintPrices("Bitter half £2.60 / pint £4.90")).toEqual([]);
    expect(extractPintPrices("½ pint £2.40")).toEqual([]);
    expect(extractPintPrices("Guinness Pint £5.00, half £2.60")).toEqual([
      { drinkName: "Guinness", priceGbp: 5, servingSize: "pint" },
    ]);
  });

  it("rejects meal bundles which mention a pint", () => {
    expect(extractPintPrices("Burger, fries and a pint £13.95")).toEqual([]);
    expect(
      extractPintPrices("Our super-deal of homemade curry with a pint £10.50"),
    ).toEqual([]);
    expect(extractPintPrices('"Quiet lunchtime" pint promotion £3.95')).toEqual([]);
    expect(extractPintPrices("All beer is priced at £6.50 a pint")).toEqual([]);
  });

  it("rejects a discovered same-name pub page in the wrong locality", () => {
    expect(
      isOfficialResult(
        { ...independentPub, website: null },
        {
          title: "Independent Arms Crowborough - official site",
          url: "https://independentarmscrowborough.co.uk",
          content: "Visit our pub in Crowborough, East Sussex.",
        },
      ),
    ).toBe(false);
  });

  it("never promotes an undeclared domain to official provenance", () => {
    expect(
      isOfficialResult(
        { ...independentPub, website: null },
        {
          title: "Independent Arms Manchester - official drinks",
          url: "https://independentarmsmcr.co.uk",
          content: "Independent Arms, 10 Example Street, Manchester M1 1AA.",
        },
      ),
    ).toBe(false);
  });

  it("preserves legacy duplicate rows while replacing only an incoming price key", () => {
    const legacyA = {
      venueKey: "legacy|a|1|1",
      drinkName: "Bitter",
      category: "beer",
      priceGbp: 4,
      source: { url: "https://one.example" },
    };
    const legacyB = {
      ...legacyA,
      source: { url: "https://two.example" },
    };
    const replacement = {
      ...legacyA,
      priceGbp: 4.5,
      source: { url: "https://official.example" },
    };

    expect(mergeCanonicalPrices([legacyA, legacyB], [])).toEqual([legacyA, legacyB]);
    expect(mergeCanonicalPrices([legacyA, legacyB], [replacement])).toEqual([replacement]);
  });

  it("never exceeds query cap and reports provider credits", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => tavilyResponse());
    const pubs = [1, 2, 3].map((id) => ({
      ...independentPub,
      osmId: `node/${id}`,
      name: `Independent Arms ${id}`,
      website: `https://independentarms${id}.co.uk/`,
    }));

    const result = await runCityEnrichment({
      city: "manchester",
      pubs,
      apiKey: "test-key",
      maxQueries: 2,
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result).toMatchObject({
      queriesSpent: 2,
      creditsSpent: 2,
      matchedPubs: 0,
      nextIndex: 2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops after an abort-ignoring legacy fetch deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>(() => new Promise(() => {}));
      const resultPromise = runCityEnrichment({
        city: "manchester",
        pubs: [
          independentPub,
          { ...independentPub, osmId: "node/2", name: "Independent Arms 2" },
        ],
        apiKey: "test-key",
        maxQueries: 2,
        observedAt: OBSERVED_AT,
        fetchImpl,
      });
      const settled = resultPromise.then(
        () => true,
        () => true,
      );
      const timeout = new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 13_000);
      });

      await vi.advanceTimersByTimeAsync(13_000);

      await expect(Promise.race([settled, timeout])).resolves.toBe(true);
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces the absolute 200-call cap inside the reusable core", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => tavilyResponse());
    const pubs = Array.from({ length: 201 }, (_, index) => ({
      ...independentPub,
      osmId: `node/${index}`,
      website: `https://independentarms${index}.co.uk/`,
    }));

    const result = await runCityEnrichment({
      city: "manchester",
      pubs,
      apiKey: "test-key",
      maxQueries: 999,
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result).toMatchObject({ queriesSpent: 200, nextIndex: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(200);
  });

  it("rejects generic pages when several pubs share an operator domain", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      tavilyResponse({
        results: [{
          title: "Find a pub near you",
          url: "https://operator.example/pubs-near-me",
          content: "Browse every venue in our estate.",
          raw_content: "House Lager Pint £4.50",
          score: 0.91,
        }],
      }),
    );
    const result = await runCityEnrichment({
      city: "leeds",
      pubs: [
        { ...independentPub, osmId: "node/10", website: "https://operator.example/pub-one" },
        { ...independentPub, osmId: "node/11", website: "https://operator.example/pub-two" },
      ],
      apiKey: "test-key",
      maxQueries: 2,
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result).toMatchObject({ matchedPubs: 0, prices: [] });
  });

  it("rejects an explicitly stale official page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      tavilyResponse({
        results: [{
          title: "Hocktoberfest 2023",
          url: "https://www.independentarms.co.uk/news/hocktoberfest-2023",
          content: "Festival archive.",
          raw_content: "Festival Lager Pint £6.50",
          score: 0.91,
        }],
      }),
    );
    const result = await runCityEnrichment({
      city: "manchester",
      pubs: [independentPub],
      apiKey: "test-key",
      maxQueries: 1,
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result).toMatchObject({ matchedPubs: 0, prices: [] });
  });

  it("prefers newest explicitly dated official menu over a richer old menu", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      tavilyResponse({
        results: [
          {
            title: "Drinks menu 2025",
            url: "https://www.independentarms.co.uk/uploads/2025/09/drinks.pdf",
            raw_content: "Old Lager Pint £4.50\nOld Bitter Pint £4.25",
          },
          {
            title: "Drinks menu 2026",
            url: "https://www.independentarms.co.uk/uploads/2026/04/drinks.pdf",
            raw_content: "Current Lager Pint £5.00",
          },
        ],
      }),
    );
    const result = await runCityEnrichment({
      city: "manchester",
      pubs: [independentPub],
      apiKey: "test-key",
      maxQueries: 1,
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result.prices.map((row) => row.drinkName)).toEqual(["Current Lager"]);
    expect(result.pages[0]?.officialUrl).toContain("/2026/04/");
  });

  it("emits canonical provenance rows from an official result", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      tavilyResponse({
        results: [{
          title: "Drinks menu | Independent Arms",
          url: "https://www.independentarms.co.uk/drinks",
          content: "Official drinks and beer menu.",
          raw_content: "## Draught Beer\nManchester Pale Ale - Pint £5.40",
          score: 0.91,
        }],
      }),
    );

    const result = await runCityEnrichment({
      city: "manchester",
      pubs: [independentPub],
      apiKey: "test-key",
      maxQueries: 1,
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result.matchedPubs).toBe(1);
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      query: 'site:independentarms.co.uk "Independent Arms" drinks menu "pint" "£"',
      search_depth: "advanced",
      chunks_per_source: 3,
      max_results: 10,
      include_domains: ["independentarms.co.uk"],
      include_raw_content: "markdown",
      include_usage: true,
    });
    expect(result.prices).toEqual([{
      venueKey: "independent arms|10 example street, manchester, m1 1aa|53.48080|-2.24260",
      drinkName: "Manchester Pale Ale",
      category: "beer",
      priceGbp: 5.4,
      servingSize: "pint",
      source: {
        label: "Independent Arms - official site",
        url: "https://www.independentarms.co.uk/drinks",
        licence: "All rights reserved - first-party publisher of its own pub menu; read-only, attributed price fact.",
      },
      observedAt: OBSERVED_AT,
    }]);
  });

  it("rejects unsupported target cities before calling Tavily", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      runCityEnrichment({
        city: "cardiff",
        pubs: [independentPub],
        apiKey: "test-key",
        maxQueries: 1,
        observedAt: OBSERVED_AT,
        fetchImpl,
      }),
    ).rejects.toThrow('Unsupported enrichment city "cardiff"');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // London was the one city this rotation never held, so no London pub had ever
  // reached the enrichment seam while the site's whole price story is a London
  // one. Its bbox is Greater London and it only SELECTS candidates; it makes no
  // claim about which borough a pub is in.
  it("holds London, and puts a pub the curated layer already owns behind one nobody has looked at", () => {
    const london = (over: Record<string, unknown>) => ({
      ...independentPub,
      lat: 51.51,
      lng: -0.12,
      ...over,
    });
    expect(
      selectCityPubs("london", [
        london({ osmId: "node/2", name: "Covered", curatedRef: { source: "curated-london-slim", id: "venue-1" } }),
        london({ osmId: "node/1", name: "Uncovered" }),
        london({ osmId: "node/3", name: "Manchester", lat: 53.48, lng: -2.24 }),
      ]).map((pub) => pub.osmId),
    ).toEqual(["node/1", "node/2"]);
  });

  it("selects bbox pubs in deterministic website-first order", () => {
    expect(
      selectCityPubs("manchester", [
        { ...independentPub, osmId: "node/3", name: "No Site", website: null },
        { ...independentPub, osmId: "node/2", name: "Beta Arms", website: "https://beta.example/" },
        { ...independentPub, osmId: "node/1", name: "Alpha Arms", website: "https://alpha.example/" },
        { ...independentPub, osmId: "node/4", name: "Outside", lat: 52.48 },
      ]).map((pub) => pub.osmId),
    ).toEqual(["node/1", "node/2", "node/3"]);
  });
});
