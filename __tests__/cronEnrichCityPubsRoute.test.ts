import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/enrich-city-pubs/route";
import { SEARCH_CRON_WALL_MS } from "@/lib/tavilyPubEnrichment.server";

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/enrich-city-pubs", {
    headers: auth ? { authorization: auth } : {},
  });
}

function tavilyOk(request: RequestInfo | URL, init?: RequestInit) {
  const body = JSON.parse(String(init?.body)) as { include_domains?: string[]; query: string };
  const quoted = [...body.query.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const pubName = quoted[0] ?? "Independent Arms";
  const locality = quoted[1] ?? "EH1";
  const slug = pubName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const domain = body.include_domains?.[0] ?? `${slug}.co.uk`;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      query: "official pub menu",
      results: [{
        title: `${pubName} official drinks menu`,
        url: `https://${domain}/drinks`,
        content: `Official drinks menu. Find us at ${locality}.`,
        raw_content: "Test Bitter - Pint £4.50",
        score: 0.9,
      }],
      response_time: 0.1,
      usage: { credits: 1 },
      request_id: String(request),
    }),
  };
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-26T03:15:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/cron/enrich-city-pubs", () => {
  it("401s without the cron secret", async () => {
    const response = await GET(req("Bearer wrong"));
    expect(response.status).toBe(401);
  });

  it("is a safe no-op without configured search credentials", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(req("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: "no-search-provider",
      queriesSpent: 0,
      creditsSpent: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rotates a city batch within the exact cron query cap and reports spend", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    const fetchImpl = vi.fn(tavilyOk);
    vi.stubGlobal("fetch", fetchImpl);

    const response = await GET(req("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      city: "edinburgh",
      queriesSpent: 10,
      creditsSpent: 10,
    });
    expect(body.nextIndex).toBeGreaterThan(body.startIndex);
    expect(body.matchedPubs).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });

  it("keeps the cron result contract when Tavily is selected through the provider seam", async () => {
    vi.stubEnv("SEARCH_PROVIDER", "tavily");
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    vi.stubGlobal("fetch", vi.fn(tavilyOk));

    const response = await GET(req("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      provider: "tavily",
      queriesSpent: 10,
      creditsSpent: 10,
      gatewayCalls: 0,
    });
  });

  it("502s loudly without claiming spend when Tavily fails", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(req("Bearer test-secret"));

    expect(response.status).toBe(502);
    expect(errorSpy.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("[city-enrichment][ALERT]"),
    )).toBe(true);
    expect(errorSpy.mock.calls.some(([message, payload]) =>
      typeof message === "string" &&
      message.includes("[city-enrichment][spend]") &&
      typeof payload === "string" &&
      payload.includes('"tavilyCalls":1'),
    )).toBe(true);
  });

  it("aborts a provider request before the cron function deadline", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    vi.stubGlobal("fetch", vi.fn((_request: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    ));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const responsePromise = GET(req("Bearer test-secret"));
    await vi.advanceTimersByTimeAsync(20_000);
    const response = await responsePromise;

    expect(response.status).toBe(502);
  });

  it("returns at the wall-clock bound when a provider ignores abort", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const responsePromise = GET(req("Bearer test-secret"));
    const settled = responsePromise.then(
      () => true,
      () => true,
    );
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 1_000);
    });

    await vi.advanceTimersByTimeAsync(SEARCH_CRON_WALL_MS + 1_000);

    await expect(Promise.race([settled, timeout])).resolves.toBe(true);
    await expect(responsePromise).resolves.toMatchObject({ status: 502 });
  });

  it("preserves partial-run truth in logs when Tavily fails mid-batch", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    let calls = 0;
    const fetchImpl = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls > 2) return { ok: false, status: 503, json: async () => ({}) };
      return tavilyOk(request, init);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(req("Bearer test-secret"));

    expect(response.status).toBe(502);

    const progressLines = logSpy.mock.calls.filter(([message]) =>
      typeof message === "string" && message.includes("[city-enrichment][progress]"),
    );
    expect(progressLines.length).toBeGreaterThan(0);
    const lastProgress = JSON.parse(String(progressLines.at(-1)?.[1]));
    expect(lastProgress.queriesSpent).toBe(3);
    expect(lastProgress.creditsSpent).toBe(2);

    const partialCall = errorSpy.mock.calls.find(([message]) =>
      typeof message === "string" && message.includes("[city-enrichment][partial]"),
    );
    expect(partialCall).toBeDefined();
    const partial = JSON.parse(String(partialCall?.[1]));
    expect(partial).toMatchObject({
      city: "edinburgh",
      queriesSpent: 3,
      creditsSpent: 2,
    });
    expect(partial.matchedPubs).toBeGreaterThan(0);
    expect(partial.pricesExtracted).toBeGreaterThan(0);
  });

  it("isolates Bristol 504 and still enriches spillover cities on Bristol nights", async () => {
    vi.setSystemTime(new Date("2026-07-29T03:15:00.000Z"));
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    const fetchImpl = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.toLowerCase().includes("bristol")) {
        return { ok: false, status: 504, json: async () => ({}) };
      }
      return tavilyOk(request, init);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(req("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      city: "bristol",
      primaryCity: "bristol",
    });
    expect(body.cityRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ city: "bristol", ok: false }),
        expect.objectContaining({ city: "london", ok: true, queriesSpent: expect.any(Number) }),
      ]),
    );
    expect(body.queriesSpent).toBeGreaterThan(0);
    expect(errorSpy.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("[city-enrichment][ALERT]"),
    )).toBe(false);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
  });
});
