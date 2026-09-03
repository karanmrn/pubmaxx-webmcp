import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/harvest-refresh/route";

const ORIGINAL_ENV = { ...process.env };

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://pubmaxxing.com/api/cron/harvest-refresh", { headers });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("cron authentication", () => {
  it("rejects a caller with no bearer token when a secret is configured", async () => {
    process.env.CRON_SECRET = "top-secret";
    const response = await GET(request());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("CRON_UNAUTHORIZED");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects a wrong bearer token", async () => {
    process.env.CRON_SECRET = "top-secret";
    const response = await GET(request({ authorization: "Bearer wrong" }));
    expect(response.status).toBe(401);
  });

  it("admits the configured secret", async () => {
    process.env.CRON_SECRET = "top-secret";
    delete process.env.FIRECRAWL_API_KEY;
    const response = await GET(request({ authorization: "Bearer top-secret" }));
    expect(response.status).toBe(200);
  });
});

describe("keyless scheduled run", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "top-secret";
    delete process.env.FIRECRAWL_API_KEY;
  });

  it("fetches nothing and reports every source as skipped", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await GET(request({ authorization: "Bearer top-secret" }));
    const body = await response.json();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(body.ok).toBe(true);
    expect(body.totals.rowsEmitted).toBe(0);
    expect(body.totals.statedItems).toBe(0);
    expect(body.totals.harvested).toBe(0);
    expect(body.sources.length).toBeGreaterThan(0);
    for (const source of body.sources) {
      expect(source.status).toBe("skipped");
    }
    expect(body.sources.some((s: { skipReason?: string }) => s.skipReason === "no-firecrawl-key")).toBe(true);
  });

  it("still reports the sources the policy refuses, with their own reason", async () => {
    const response = await GET(request({ authorization: "Bearer top-secret" }));
    const body = await response.json();
    const byId = new Map(body.sources.map((s: { sourceId: string }) => [s.sourceId, s]));

    expect(byId.get("skiddle-listings")).toMatchObject({ skipReason: "terms-forbid-commercial-use" });
    expect(byId.get("dice-listings")).toMatchObject({ skipReason: "robots-disallowed" });
    expect(byId.get("mitchells-butlers-brands")).toMatchObject({ skipReason: "robots-unreadable" });
  });

  it("never caches a scheduled response", async () => {
    const response = await GET(request({ authorization: "Bearer top-secret" }));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("the scheduled run cannot burn the account", () => {
  it("stops at its request budget even when every source fails and retries", async () => {
    process.env.CRON_SECRET = "top-secret";
    process.env.FIRECRAWL_API_KEY = "fc-test";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("busy", { status: 429 }));

    const response = await GET(request({ authorization: "Bearer top-secret" }));
    const body = await response.json();

    expect(body.budget.spent).toBeLessThanOrEqual(body.budget.limit);
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(body.budget.limit);
    // A run that ran out of budget covered less; it did not break.
    expect(body.ok).toBe(true);
  }, 30_000);

  it("reports a real page as harvested and an empty one as empty", async () => {
    process.env.CRON_SECRET = "top-secret";
    process.env.FIRECRAWL_API_KEY = "fc-test";
    const markdown = `
## Club deals

### Curry Club

Every Thursday, 11.30am - 11pm

A selection of curry dishes at even better prices.
`;
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      // Only the first allowed source states a deal day; the rest state nothing.
      return new Response(
        JSON.stringify({
          success: true,
          data: { markdown: call === 1 ? markdown : "# A page with no offers", metadata: { statusCode: 200 } },
        }),
        { status: 200 },
      );
    });

    const response = await GET(request({ authorization: "Bearer top-secret" }));
    const body = await response.json();

    expect(body.totals.harvested).toBe(1);
    expect(body.totals.statedItems).toBe(1);
    expect(body.totals.empty).toBeGreaterThanOrEqual(1);
    // A scheduled run writes nothing, whatever it read.
    expect(body.totals.rowsEmitted).toBe(0);
  });
});
