import { describe, expect, it, vi } from "vitest";

import {
  createFirecrawlClient,
  createHarvestBudget,
  firecrawlApiKey,
  HARVEST_CRON_REQUEST_BUDGET,
  HARVEST_MAX_ATTEMPTS,
  isFirecrawlConfigured,
} from "@/lib/harvest/firecrawl";

const noSleep = async () => {};

function okScrape(markdown: string, metadata: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ success: true, data: { markdown, metadata } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("firecrawl key configuration", () => {
  it("reads the key from the environment and trims it", () => {
    expect(firecrawlApiKey({ FIRECRAWL_API_KEY: "  fc-abc  " } as unknown as NodeJS.ProcessEnv)).toBe("fc-abc");
    expect(isFirecrawlConfigured({ FIRECRAWL_API_KEY: "fc-abc" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("treats an absent or blank key as not configured", () => {
    expect(firecrawlApiKey({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(firecrawlApiKey({ FIRECRAWL_API_KEY: "   " } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(isFirecrawlConfigured({ FIRECRAWL_API_KEY: "" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("fail closed without a key", () => {
  it("returns no client, so a caller cannot fetch by accident", () => {
    const fetchImpl = vi.fn();
    const client = createFirecrawlClient({ env: {} as unknown as NodeJS.ProcessEnv, fetchImpl });
    expect(client).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not fall back to an unauthenticated request", () => {
    const fetchImpl = vi.fn();
    expect(
      createFirecrawlClient({ env: { FIRECRAWL_API_KEY: "  " } as unknown as NodeJS.ProcessEnv, fetchImpl }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("per-run request budget", () => {
  it("counts down and refuses past the ceiling", () => {
    const budget = createHarvestBudget(2);
    expect(budget.limit).toBe(2);
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
    expect(budget.spent()).toBe(2);
    expect(budget.remaining()).toBe(0);
  });

  it("treats a non-positive limit as no requests at all", () => {
    const budget = createHarvestBudget(0);
    expect(budget.take()).toBe(false);
    expect(createHarvestBudget(-5).take()).toBe(false);
  });

  it("stops sending once the run budget is spent, and says so", async () => {
    const fetchImpl = vi.fn(async () => okScrape("# page"));
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(2),
      sleepImpl: noSleep,
    });
    expect(client).not.toBeNull();

    await client!.scrape("https://example.com/one");
    await client!.scrape("https://example.com/two");
    const third = await client!.scrape("https://example.com/three");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error("expected the third scrape to be refused");
    expect(third.failure.reason).toBe("budget-exhausted");
    expect(third.failure.url).toBe("https://example.com/three");
  });

  it("charges retries to the budget, so a retry storm cannot outspend the cap", async () => {
    const fetchImpl = vi.fn(async () => new Response("busy", { status: 429 }));
    const budget = createHarvestBudget(2);
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget,
      sleepImpl: noSleep,
    });

    const outcome = await client!.scrape("https://example.com/rate-limited");

    // Two attempts is all the budget allowed, even though three are permitted.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(budget.remaining()).toBe(0);
    expect(outcome.ok).toBe(false);
  });

  it("shares one budget across scrape and search", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/search")
        ? new Response(JSON.stringify({ success: true, data: { web: [{ url: "https://a.example" }] } }), { status: 200 })
        : okScrape("# page"),
    );
    const budget = createHarvestBudget(3);
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget,
      sleepImpl: noSleep,
    });

    await client!.search("a pub");
    await client!.scrape("https://a.example");
    expect(budget.spent()).toBe(2);
    await client!.search("another pub");
    const refused = await client!.scrape("https://b.example");
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected refusal");
    expect(refused.failure.reason).toBe("budget-exhausted");
  });

  it("keeps the scheduled ceiling small enough that a cron cannot burn the account", () => {
    expect(HARVEST_CRON_REQUEST_BUDGET).toBeGreaterThan(0);
    expect(HARVEST_CRON_REQUEST_BUDGET).toBeLessThanOrEqual(25);
  });
});

describe("bounded retries", () => {
  it("retries a 5xx up to the attempt ceiling, then reports the failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 }));
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(20),
      sleepImpl: noSleep,
    });

    const outcome = await client!.scrape("https://example.com/down");

    expect(fetchImpl).toHaveBeenCalledTimes(HARVEST_MAX_ATTEMPTS);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.failure.reason).toBe("http-error");
    expect(outcome.failure.status).toBe(503);
    expect(outcome.failure.attempts).toBe(HARVEST_MAX_ATTEMPTS);
  });

  it("does not retry a 4xx that is the source's own answer", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(20),
      sleepImpl: noSleep,
    });

    const outcome = await client!.scrape("https://example.com/forbidden");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.failure.status).toBe(403);
  });

  it("succeeds on a retry after a transient network error", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("socket hang up");
      return okScrape("# recovered", { statusCode: 200, cacheState: "miss" });
    });
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(20),
      sleepImpl: noSleep,
    });

    const outcome = await client!.scrape("https://example.com/flaky");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected a page");
    expect(outcome.page.markdown).toBe("# recovered");
    expect(outcome.page.cacheState).toBe("miss");
    expect(calls).toBe(2);
  });

  it("refuses a success envelope carrying no markdown rather than inventing a page", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { markdown: "   " } }), { status: 200 }),
    );
    const client = createFirecrawlClient({
      apiKey: "fc-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(20),
      sleepImpl: noSleep,
    });

    const outcome = await client!.scrape("https://example.com/blank");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.failure.reason).toBe("empty-body");
    // Not retried: an empty body is an answer, not a hiccup.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the key as a bearer token and asks only for markdown", async () => {
    const fetchImpl = vi.fn(async () => okScrape("# page"));
    const client = createFirecrawlClient({
      apiKey: "fc-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: createHarvestBudget(5),
      sleepImpl: noSleep,
    });

    await client!.scrape("https://example.com/one", { maxAgeMs: 0 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/scrape");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer fc-secret");
    const body = JSON.parse(String(init.body));
    expect(body.formats).toEqual(["markdown"]);
    expect(body.maxAge).toBe(0);
  });
});
