import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  PROVIDER_POLICY,
  discoverRefreshPages,
  fetchRefreshPage,
  providerForJob,
} from "../scripts/lib/localRefreshProviders.mjs";

describe("local refresh provider policy", () => {
  it("assigns one explicit provider and credential to each acquisition job", () => {
    expect(PROVIDER_POLICY).toEqual({
      "pub-discovery": { provider: "exa", key: "EXA_API_KEY" },
      "rendered-menu": { provider: "browserbase", key: "BROWSERBASE_API_KEY" },
      "plain-page": { provider: "tavily", key: "TAVILY_API_KEY" },
    });
    expect(providerForJob("pub-discovery")).toEqual(PROVIDER_POLICY["pub-discovery"]);
  });

  it("names provider and credential when a key is absent", async () => {
    await expect(
      discoverRefreshPages({ query: "new London pub", environment: {} }),
    ).rejects.toMatchObject({
      provider: "exa",
      message: "exa unavailable: missing EXA_API_KEY",
    });
  });

  it("fails loudly when a provider refuses a credential", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "payment required" }), {
        status: 402,
        statusText: "Payment Required",
      }),
    );

    await expect(
      fetchRefreshPage({
        job: "plain-page",
        url: "https://example.com/menu",
        environment: { TAVILY_API_KEY: "secret-value" },
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      provider: "tavily",
      status: 402,
      message: "tavily refused request: HTTP 402 Payment Required",
    });
  });

  it("routes legacy-named harvesters through the shared seam without Firecrawl calls", () => {
    for (const file of [
      "scripts/firecrawl_greene_king_prices.mjs",
      "scripts/firecrawl_mbplc_prices.mjs",
      "scripts/harvest_outer_london_prices.mjs",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toContain("./lib/localRefreshProviders.mjs");
      expect(source).not.toContain("api.firecrawl.dev");
      expect(source).not.toContain("firecrawl-cli");
      expect(source).not.toContain("FIRECRAWL_API_KEY");
    }
  });
});

describe("local refresh provider response contracts", () => {
  it("normalises Exa discovery without changing result meaning", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            url: "https://example.com/new-pub/menu",
            title: "New Pub drinks",
            text: "Official menu page",
          },
        ],
      }),
    );

    await expect(
      discoverRefreshPages({
        query: "new London pubs official menu",
        includeDomains: ["example.com"],
        environment: { EXA_API_KEY: "secret-value" },
        fetchImpl,
      }),
    ).resolves.toEqual([
      {
        url: "https://example.com/new-pub/menu",
        title: "New Pub drinks",
        text: "Official menu page",
      },
    ]);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "secret-value" }),
      }),
    );
  });

  it("returns Tavily markdown and links in existing scraper shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            url: "https://example.com/menu",
            raw_content: "## Drinks\n\n[Beer list](https://example.com/drinks)",
          },
        ],
        failed_results: [],
      }),
    );

    await expect(
      fetchRefreshPage({
        job: "plain-page",
        url: "https://example.com/menu",
        environment: { TAVILY_API_KEY: "secret-value" },
        fetchImpl,
      }),
    ).resolves.toEqual({
      markdown: "## Drinks\n\n[Beer list](https://example.com/drinks)",
      links: ["https://example.com/drinks"],
    });
  });

  it("returns Browserbase rendered content through the same page shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "session-1", connectUrl: "wss://browser.example/session" }), {
        status: 201,
      }),
    );
    const renderBrowserPage = vi.fn().mockResolvedValue({
      markdown: "### Draught Beer\n\n#### Lager\n\n£6.20",
      links: ["https://example.com/drinks"],
    });

    await expect(
      fetchRefreshPage({
        job: "rendered-menu",
        url: "https://example.com/menu",
        environment: { BROWSERBASE_API_KEY: "secret-value" },
        fetchImpl,
        renderBrowserPage,
      }),
    ).resolves.toEqual({
      markdown: "### Draught Beer\n\n#### Lager\n\n£6.20",
      links: ["https://example.com/drinks"],
    });
    expect(renderBrowserPage).toHaveBeenCalledWith(
      "wss://browser.example/session",
      "https://example.com/menu",
    );
  });

  it("does not turn an empty or failed extraction into an honest zero-row page", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        results: [],
        failed_results: [{ url: "https://example.com/menu", error: "blocked" }],
      }),
    );

    await expect(
      fetchRefreshPage({
        job: "plain-page",
        url: "https://example.com/menu",
        environment: { TAVILY_API_KEY: "secret-value" },
        fetchImpl,
      }),
    ).rejects.toThrow("tavily could not extract https://example.com/menu: blocked");
  });
});
