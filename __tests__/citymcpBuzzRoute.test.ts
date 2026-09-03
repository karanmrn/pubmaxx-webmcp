import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/citymcp/buzz/route";
import { resetCityBuzzCache } from "@/lib/citymcp/buzz";

const realFetch = global.fetch;
// The route now rate-limits per IP (S2) before anything else. Vercel's vitest
// run sets NODE_ENV=production with real Supabase env vars, which would send
// the limiter down its durable (network) path here; deleting the two env vars
// for the test keeps it on the deterministic in-memory path (same technique
// as __tests__/lastTrainRoute.test.ts).
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function buzzEnvelope(structuredContent: unknown): string {
  return sseFrame({
    jsonrpc: "2.0",
    id: 1,
    result: { structuredContent },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetCityBuzzCache();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  global.fetch = realFetch;
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
});

describe("GET /api/citymcp/buzz", () => {
  it("400s when id is missing", async () => {
    const res = await GET(new Request("http://localhost/api/citymcp/buzz"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Place id is missing.");
    expect(body.buzz).toBeNull();
  });

  it("400s when id is absurdly long", async () => {
    const long = "x".repeat(300);
    const res = await GET(
      new Request(`http://localhost/api/citymcp/buzz?id=${encodeURIComponent(long)}`),
    );
    expect(res.status).toBe(400);
  });

  it("returns trimmed buzz and calls get_place with deep:true", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        buzzEnvelope({
          name: "The George",
          buzz: {
            value: {
              summary: "Loved for the galleried yard; gets rammed on Fridays.",
              mentions: [
                { label: "The Infatuation", url: "https://www.theinfatuation.com/x" },
                { label: "Insecure", url: "http://plain.example.com" },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await GET(
      new Request("http://localhost/api/citymcp/buzz?id=ChIJoTest"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buzz.summary).toMatch(/galleried yard/);
    expect(body.buzz.mentions).toEqual([
      { label: "The Infatuation", url: "https://www.theinfatuation.com/x" },
    ]);

    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, { body?: string }];
    const payload = JSON.parse(init.body ?? "{}");
    expect(payload.params.name).toBe("get_place");
    expect(payload.params.arguments).toMatchObject({ id: "ChIJoTest", deep: true });
  });

  it("returns buzz:null (no error) when the upstream has no buzz", async () => {
    global.fetch = vi.fn(async () =>
      new Response(buzzEnvelope({ name: "The George" }), { status: 200 }),
    ) as unknown as typeof fetch;

    const res = await GET(
      new Request("http://localhost/api/citymcp/buzz?id=ChIJoNoBuzz"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buzz).toBeNull();
    expect(body.error).toBeUndefined();
  });

  it("fails soft (200 + error + buzz:null) on upstream failure", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const res = await GET(
      new Request("http://localhost/api/citymcp/buzz?id=ChIJoDown"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buzz).toBeNull();
    expect(typeof body.error).toBe("string");
  });

  it("serves the second request for the same id from cache", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        buzzEnvelope({
          buzz: { value: { summary: "Cached summary." } },
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const url = "http://localhost/api/citymcp/buzz?id=ChIJoCache";
    const first = await GET(new Request(url));
    expect((await first.json()).buzz.summary).toBe("Cached summary.");
    const second = await GET(new Request(url));
    expect((await second.json()).buzz.summary).toBe("Cached summary.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429s past the shared CityMCP-surface budget (~60/min per hashed IP)", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;

    const responses: Response[] = [];
    for (let i = 0; i < 61; i++) {
      responses.push(
        await GET(
          new Request("http://localhost/api/citymcp/buzz?id=ChIJoLimit", {
            headers: { "x-forwarded-for": "198.51.100.30" },
          }),
        ),
      );
    }

    expect(responses.slice(0, 60).every((res) => res.status !== 429)).toBe(true);
    expect(responses[60].status).toBe(429);
    expect(await responses[60].json()).toEqual({
      error: "Too many requests, slow down.",
      code: "RATE_LIMITED",
      retryable: true,
      buzz: null,
    });
  });
});
