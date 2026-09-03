import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {} }));

// Deterministic, offline What's-On store: no CityMCP network in the route path.
const rows = [
  {
    id: "quiz-soho",
    placeName: "The Test Tavern, Soho",
    kind: "quiz" as const,
    startsAt: "2026-07-12T19:30:00+01:00",
    title: "Pub quiz — Sundays",
    detail: "Entry £2",
    priceGbp: 2,
    source: { label: "Question One", url: "https://questionone.com/x" },
    observedAt: "2026-07-11T20:00:00.000Z",
    confidence: "listed" as const,
  },
  {
    id: "quiz-camden",
    placeName: "Camden Arms, Camden",
    kind: "quiz" as const,
    startsAt: "2026-07-12T20:00:00+01:00",
    title: "Quiz — Sundays",
    source: { label: "Question One", url: "https://questionone.com/y" },
    observedAt: "2026-07-11T20:00:00.000Z",
    confidence: "listed" as const,
  },
];

vi.mock("@/lib/whatsOnStore", () => ({
  loadWhatsOn: vi.fn(async (params: { kind?: string }) => ({
    rows: params.kind ? rows.filter((r) => r.kind === params.kind) : rows,
    asOf: "2026-07-12T18:00:00.000Z",
  })),
}));

import { POST } from "@/app/api/concierge/route";

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

function post(body: unknown, ip: string): Promise<Response> {
  return POST(new Request("http://localhost/api/concierge", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/concierge — What's-On intents", () => {
  it("answers a grounded quiz query with provenance", async () => {
    const res = await post({ query: "quiz in Soho tonight" }, "198.51.100.60");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("whats-on");
    expect(body.kind).toBe("quiz");
    expect(body.count).toBe(1);
    expect(body.listings[0]).toMatchObject({
      venue: "The Test Tavern, Soho",
      source: { label: "Question One", url: "https://questionone.com/x" },
    });
    expect(body.asOf).toBe("2026-07-12T18:00:00.000Z");
  });

  it("refuses honestly when nothing matches the location", async () => {
    const res = await post({ query: "quiz in Shoreditch tonight" }, "198.51.100.61");
    const body = await res.json();
    expect(body.mode).toBe("whats-on");
    expect(body.count).toBe(0);
    expect(body.listings).toEqual([]);
    expect(body.message).toMatch(/no sourced/i);
  });

  it("leaves plain venue-mood queries on the ranking path", async () => {
    const res = await post({ query: "Garden near Soho for 4" }, "198.51.100.62");
    const body = await res.json();
    expect(body.mode).toBeUndefined();
    expect(body.venues).toBeDefined();
  });

  it("uses product copy for an unknown city", async () => {
    const res = await post(
      { query: "quiet pub", cityId: "not-a-listed-city" },
      "198.51.100.63",
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Choose a listed city.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
  });

  it("does not misdetect a generic noun phrase as an area (no false refusal)", async () => {
    const res = await post({ query: "quiz in the pub tonight" }, "198.51.100.63");
    const body = await res.json();
    expect(body.mode).toBe("whats-on");
    // No area was captured, so both rows (unfiltered by area) match.
    expect(body.count).toBe(2);
  });

  it("returns 503 with a contract-complete body when the store fails", async () => {
    const { loadWhatsOn } = await import("@/lib/whatsOnStore");
    vi.mocked(loadWhatsOn).mockRejectedValueOnce(new Error("store unavailable"));
    const res = await post({ query: "quiz in Soho tonight" }, "198.51.100.64");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.mode).toBe("whats-on");
    expect(body.count).toBe(0);
    expect(body.listings).toEqual([]);
    expect(typeof body.asOf).toBe("string");
    expect(() => new Date(body.asOf).toISOString()).not.toThrow();
    expect(body.message).toMatch(/couldn't load/i);
  });

  it("503s on a read that reported itself degraded, never 'no matches'", async () => {
    const { loadWhatsOn } = await import("@/lib/whatsOnStore");
    vi.mocked(loadWhatsOn).mockResolvedValueOnce({
      rows: [],
      readStatus: "degraded",
      asOf: "2026-07-12T18:00:00.000Z",
    } as unknown as Awaited<ReturnType<typeof loadWhatsOn>>);
    const res = await post({ query: "quiz in Soho tonight" }, "198.51.100.65");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.message).toMatch(/couldn't load/i);
  });
});
