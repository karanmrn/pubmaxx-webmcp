import { beforeEach, describe, expect, it, vi } from "vitest";

// C3 — the route's opt-in `weighTonightEvents` plumbing (venue-ranking path
// only). Both dependencies are mocked so the assertions are deterministic and
// independent of the real venue dataset / bundled What's-On files.
vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {} }));

vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: vi.fn(async () => [
    {
      id: "a",
      name: "The Quiet Room",
      area: "City of London",
      lat: 51.51,
      lng: -0.09,
      cheapestPrice: 6,
      amenities: { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false },
      nearWater: false,
      hasStory: false,
      canonical: true,
    },
    {
      id: "b",
      name: "The Session",
      area: "City of London",
      lat: 51.51,
      lng: -0.09,
      cheapestPrice: 6,
      amenities: { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false },
      nearWater: false,
      hasStory: false,
      canonical: true,
    },
  ]),
}));

const { loadWhatsOnMock } = vi.hoisted(() => ({
  loadWhatsOnMock: vi.fn(async () => ({
    rows: [
      {
        id: "music-b",
        venueId: "b",
        placeName: "The Session",
        kind: "music" as const,
        startsAt: "2026-07-12T21:00:00+01:00",
        title: "Live set",
        source: { label: "Venue site", url: "https://example.com/b" },
        observedAt: "2026-07-12T12:00:00+01:00",
        confidence: "listed" as const,
      },
    ],
    asOf: "2026-07-12T18:00:00.000Z",
  })),
}));
vi.mock("@/lib/whatsOnStore", () => ({ loadWhatsOn: loadWhatsOnMock }));

import { POST } from "@/app/api/concierge/route";

beforeEach(() => {
  loadWhatsOnMock.mockClear();
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

describe("POST /api/concierge — weighTonightEvents (C3)", () => {
  it("does not call the What's-On store when the flag is omitted", async () => {
    const res = await post({ intent: { mood: ["lively"], groupSize: 2 }, limit: 2 }, "203.0.113.1");
    expect(res.status).toBe(200);
    expect(loadWhatsOnMock).not.toHaveBeenCalled();
  });

  it("gently favours a venue with a matching-mood tonight row, with a transparent reason", async () => {
    const res = await post(
      { intent: { mood: ["lively"], groupSize: 2 }, limit: 2, weighTonightEvents: true },
      "203.0.113.2",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(loadWhatsOnMock).toHaveBeenCalledTimes(1);
    expect(body.venues[0]).toMatchObject({ id: "b" });
    expect(body.venues[0].reasons).toContain("Live music tonight");
  });

  it("is never a hard filter — a venue with no tonight row still appears", async () => {
    const res = await post(
      { intent: { mood: ["lively"], groupSize: 2 }, limit: 2, weighTonightEvents: true },
      "203.0.113.3",
    );
    const body = await res.json();
    expect(body.venues.map((v: { id: string }) => v.id).sort()).toEqual(["a", "b"]);
  });

  it("fails soft to unweighted ranking when the What's-On store errors", async () => {
    loadWhatsOnMock.mockRejectedValueOnce(new Error("store unavailable"));
    const res = await post(
      { intent: { mood: ["lively"], groupSize: 2 }, limit: 2, weighTonightEvents: true },
      "203.0.113.4",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Ranking itself must still succeed — an outage in the soft-weight lookup
    // must never cascade into the route's "couldn't load grounded venue
    // options" degraded fallback.
    expect(body.venues).toHaveLength(2);
  });
});
