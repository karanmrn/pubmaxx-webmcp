import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SEARCH_GATEWAY_MODEL,
  SearchProviderBudgetError,
  createSearchProvider,
  type SearchProviderDependencies,
} from "@/lib/searchProvider.server";

const officialResult = {
  title: "Independent Arms drinks menu",
  url: "https://independentarms.co.uk/drinks",
  highlights: ["House Bitter - Pint £4.50"],
  publishedDate: "2026-08-01T00:00:00.000Z",
};

function gatewayDependencies(
  generateText: SearchProviderDependencies["generateText"],
): SearchProviderDependencies {
  return {
    generateText,
    gateway: {
      tools: {
        exaSearch: vi.fn((options: Record<string, unknown>) => ({
          kind: "exa-search-tool",
          options,
        })),
      },
    },
  } as SearchProviderDependencies;
}

function tavilyResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    results: [{
      title: "Independent Arms menu",
      url: "https://independentarms.co.uk/menu",
      content: "House Bitter - Pint £4.50",
    }],
    usage: { credits: 1 },
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("search provider selection", () => {
  it("selects Tavily when SEARCH_PROVIDER is tavily", async () => {
    const fetchImpl = vi.fn(async () => tavilyResponse());
    const generateText = vi.fn();
    const provider = createSearchProvider({
      env: {
        SEARCH_PROVIDER: "tavily",
        TAVILY_API_KEY: "tavily-test-key",
      },
      fetchImpl,
      dependencies: gatewayDependencies(generateText),
    });

    const result = await provider.search({ query: "official menu" });

    expect(provider.name).toBe("tavily");
    expect(result.results[0]).toMatchObject({
      url: "https://independentarms.co.uk/menu",
      content: "House Bitter - Pint £4.50",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("passes cancellation through every provider request", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return tavilyResponse();
    });
    const provider = createSearchProvider({
      env: { SEARCH_PROVIDER: "tavily", TAVILY_API_KEY: "tavily-test-key" },
      fetchImpl,
      dependencies: gatewayDependencies(vi.fn()),
    });

    await provider.search({ query: "official menu", signal: controller.signal });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("defaults to Exa and uses gateway tool results", async () => {
    const generateText = vi.fn(async (options: Record<string, unknown>) => {
      expect(options.maxRetries).toBe(0);
      expect(options.model).toBe(SEARCH_GATEWAY_MODEL);
      expect(options.toolChoice).toEqual({ type: "tool", toolName: "exa_search" });
      return {
        steps: [{
          toolResults: [{ toolName: "exa_search", output: { results: [officialResult] } }],
        }],
        usage: { inputTokens: 20, outputTokens: 8 },
      };
    });
    const dependencies = gatewayDependencies(generateText);
    const provider = createSearchProvider({
      env: { AI_GATEWAY_API_KEY: "gateway-test-key" },
      dependencies,
    });

    const result = await provider.search({
      query: 'site:independentarms.co.uk "Independent Arms"',
      includeDomains: ["independentarms.co.uk"],
      startPublishedDate: "2026-07-01T00:00:00.000Z",
      endPublishedDate: "2026-08-14T00:00:00.000Z",
      maxResults: 5,
    });

    expect(provider.name).toBe("exa");
    expect(result.results).toEqual([{
      title: officialResult.title,
      url: officialResult.url,
      content: "House Bitter - Pint £4.50",
      publishedDate: officialResult.publishedDate,
    }]);
    expect(dependencies.gateway.tools.exaSearch).toHaveBeenCalledWith({
      type: "fast",
      numResults: 5,
      includeDomains: ["independentarms.co.uk"],
      startPublishedDate: "2026-07-01T00:00:00.000Z",
      endPublishedDate: "2026-08-14T00:00:00.000Z",
      contents: {
        highlights: { query: 'site:independentarms.co.uk "Independent Arms"', maxCharacters: 1600 },
        maxAgeHours: 24,
      },
    });
  });

  it("uses Exa with Vercel OIDC credentials", async () => {
    const generateText = vi.fn(async () => ({
      steps: [{ toolResults: [{ toolName: "exa_search", output: { results: [officialResult] } }] }],
      usage: { inputTokens: 2, outputTokens: 3 },
    }));
    const provider = createSearchProvider({
      env: { VERCEL_OIDC_TOKEN: "oidc-test-token" },
      dependencies: gatewayDependencies(generateText),
    });

    const result = await provider.search({ query: "official menu" });

    expect(provider.configured).toBe(true);
    expect(result.provider).toBe("exa");
    expect(result.results).toHaveLength(1);
  });

  it("uses Exa with Vercel request-context OIDC credentials", async () => {
    vi.stubGlobal(Symbol.for("@vercel/request-context"), {
      get: () => ({ headers: { "x-vercel-oidc-token": "request-oidc-test-token" } }),
    });
    const provider = createSearchProvider({
      env: {},
      dependencies: gatewayDependencies(vi.fn(async () => ({
        steps: [{ toolResults: [{ toolName: "exa_search", output: { results: [officialResult] } }] }],
        usage: { inputTokens: 2, outputTokens: 3 },
      }))),
    });

    const result = await provider.search({ query: "official menu" });

    expect(provider.configured).toBe(true);
    expect(result.provider).toBe("exa");
    expect(result.results).toHaveLength(1);
  });
});

describe("search provider fallback", () => {
  it("falls back to Tavily when the gateway credential is absent", async () => {
    const fetchImpl = vi.fn(async () => tavilyResponse());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createSearchProvider({
      env: { SEARCH_PROVIDER: "exa", TAVILY_API_KEY: "tavily-test-key" },
      fetchImpl,
      dependencies: gatewayDependencies(vi.fn()),
    });

    const result = await provider.search({ query: "official menu" });

    expect(result.results).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("AI Gateway credentials"));
    expect(provider.stats().selectedProvider).toBe("tavily");
  });

  it("falls back to Tavily when an Exa request fails", async () => {
    const fetchImpl = vi.fn(async () => tavilyResponse());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createSearchProvider({
      env: {
        SEARCH_PROVIDER: "exa",
        AI_GATEWAY_API_KEY: "gateway-test-key",
        TAVILY_API_KEY: "tavily-test-key",
      },
      fetchImpl,
      dependencies: gatewayDependencies(vi.fn(async () => {
        throw new Error("gateway unavailable");
      })),
    });

    const result = await provider.search({ query: "official menu" });

    expect(result.results[0].url).toBe("https://independentarms.co.uk/menu");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back to tavily"));
    expect(provider.stats().selectedProvider).toBe("tavily");
  });

  it("gives Tavily a fresh deadline after Exa times out", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => tavilyResponse());
    const provider = createSearchProvider({
      env: {
        AI_GATEWAY_API_KEY: "gateway-test-key",
        TAVILY_API_KEY: "tavily-test-key",
      },
      fetchImpl,
      dependencies: gatewayDependencies(vi.fn((options: Record<string, unknown>) =>
        new Promise((_resolve, reject) => {
          const signal = options.abortSignal as AbortSignal;
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      )),
    });

    const resultPromise = provider.search({ query: "official menu", timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result.provider).toBe("tavily");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("settles an Exa deadline when generateText ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const generateText = vi.fn(() => new Promise(() => {}));
      const provider = createSearchProvider({
        env: { AI_GATEWAY_API_KEY: "gateway-test-key" },
        dependencies: gatewayDependencies(generateText),
      });
      const resultPromise = provider.search({ query: "official menu", timeoutMs: 100 });
      const settled = resultPromise.then(
        () => true,
        () => true,
      );
      const timeout = new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 1_000);
      });

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(Promise.race([settled, timeout])).resolves.toBe(true);
      expect(generateText).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a valid empty Exa result without falling back", async () => {
    const fetchImpl = vi.fn(async () => tavilyResponse());
    const provider = createSearchProvider({
      env: {
        AI_GATEWAY_API_KEY: "gateway-test-key",
        TAVILY_API_KEY: "tavily-test-key",
      },
      fetchImpl,
      dependencies: gatewayDependencies(vi.fn(async () => ({
        steps: [{ toolResults: [{ toolName: "exa_search", output: { results: [] } }] }],
        usage: { inputTokens: 4, outputTokens: 2 },
      }))),
    });

    const result = await provider.search({ query: "no official page" });

    expect(result).toEqual({ provider: "exa", results: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records Gateway usage before malformed output falls back", async () => {
    const provider = createSearchProvider({
      env: {
        AI_GATEWAY_API_KEY: "gateway-test-key",
        TAVILY_API_KEY: "tavily-test-key",
      },
      fetchImpl: vi.fn(async () => tavilyResponse()),
      dependencies: gatewayDependencies(vi.fn(async () => ({
        steps: [{ toolResults: [{ toolName: "exa_search", output: { unexpected: [] } }] }],
        usage: { inputTokens: 7, outputTokens: 5 },
      }))),
      logger: { warn: vi.fn() },
    });

    const result = await provider.search({ query: "official menu" });

    expect(result.provider).toBe("tavily");
    expect(provider.stats()).toMatchObject({
      estimatedTokens: 12,
      gatewayCalls: 1,
      tavilyCalls: 1,
    });
  });
});

describe("gateway spend guard", () => {
  it("stops before a call would exceed the configured per-run cap", async () => {
    const generateText = vi.fn(async () => ({
      steps: [{ toolResults: [{ toolName: "exa_search", output: { results: [officialResult] } }] }],
      usage: { inputTokens: 2, outputTokens: 3 },
    }));
    const provider = createSearchProvider({
      env: {
        AI_GATEWAY_API_KEY: "gateway-test-key",
        SEARCH_GATEWAY_MAX_CALLS: "1",
      },
      dependencies: gatewayDependencies(generateText),
    });

    await provider.search({ query: "first" });
    await expect(provider.search({ query: "second" })).rejects.toBeInstanceOf(SearchProviderBudgetError);

    expect(generateText).toHaveBeenCalledOnce();
    expect(provider.stats()).toMatchObject({
      gatewayCalls: 1,
      model: SEARCH_GATEWAY_MODEL,
    });
    expect(provider.stats().estimatedTokens).toBeGreaterThan(0);
  });
});
